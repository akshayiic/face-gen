/**
 * The camera finish: what a photograph has and a raw render doesn't, drawn over each frame on the medium and high tiers
 * (lib/quality.ts finish):
 *  - depth of field: an 85 mm portrait lens focused on the eyes, so the ears, the hair behind and the shoulders soften
 *    by how far they are from the focus (a gather of up to 24 taps, which leaves sharp things sharp);
 *  - bloom: the brightest highlights glow a little (a half-size bright pass, its mip chain added back);
 *  - a colour grade (a little contrast, cool shadows and warm highlights), a vignette, and fine film grain;
 *  - skin translucency: light scatters under real skin, softening its shading most in red (a separable subsurface blur
 *    after Jimenez: two passes, a different width per colour channel, measured in millimetres on the face, only across
 *    skin at the same depth, in linear light). The skin marks itself with alpha 0.5 while it is drawn into the finish's
 *    target (skinUniforms.uSkinAlpha), so hair, brows and clothes over it are never smeared;
 *  - clarity: local contrast (the image minus a wide blur of itself) and a fine sharpen, in the mid-tones: the crisp,
 *    gritty look of a retouched portrait. None where the depth of field has blurred.
 *
 * The scene is first drawn into a multisampled target that three treats like the screen (flagged as an XR target: tone
 * mapping and the sRGB encoding happen in the materials, the background is cleared in display colour), so with every
 * effect at zero the picture is exactly the plain render; the effects then work on display pixels, and the backdrop
 * keeps its colour (the grade and vignette touch only the head and clothes). three's own HDR output chain would
 * instead blend hair edges into the light backdrop before tone mapping, which washes fine hair out.
 *
 * Tweak in FINISH; the strengths visitors set are in lib/finishSettings.ts.
 */
import {
  BufferGeometry,
  type Camera,
  DepthTexture,
  Float32BufferAttribute,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  type PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

import { eyeUniforms } from "@/lib/eyeShader";
import { finishSettings } from "@/lib/finishSettings";
import { tierSettings } from "@/lib/quality";
import { skinUniforms } from "@/lib/skinShader";

export const FINISH = {
  fNumber: 2.0, // the aperture at full "Depth of field" (f/2; the default half is f/4)
  maxCocPx: 10, // the most any pixel blurs (CSS px; × the canvas's pixel ratio)
  bloomThreshold: 0.86, // display brightness where bloom starts (highlights, not white clothes)
  bloom: 0.55, // the strongest bloom
  grain: 0.06, // the strongest grain (± display units in the mid-tones)
  vignette: 0.3, // the most the corners darken
  grade: 1, // the strongest grade
  clarity: 1.4, // local contrast at full "Clarity" (× the image minus its wide blur)
  sharpen: 1.6, // the fine sharpen at full "Clarity" (× the image minus its 4 neighbours)
  // the subsurface blur's width per channel (standard deviation, mm on the face) at full "Skin translucency": red light
  // travels furthest in skin, blue least (after d'Eon's and Jimenez's skin profiles)
  sssMm: [1.4, 0.6, 0.35] as [number, number, number],
  sssTaps: 7, // taps each side, per pass
};

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const BRIGHT = /* glsl */ `
uniform sampler2D tColor, tDepth;
uniform float uThreshold;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float subject = step(texture2D(tDepth, vUv).r, 0.99999); // never the backdrop
  float k = smoothstep(uThreshold, 1.0, max(c.r, max(c.g, c.b)));
  gl_FragColor = vec4(c * k * subject, 1.0);
}`;

// One pass of the separable subsurface blur (uDir: one texel across or down). Skin is alpha 0.5; taps off the skin, or
// on skin at another depth (the nose over the cheek), don't count.
const SSS = /* glsl */ `
#include <packing>
uniform sampler2D tColor, tDepth;
uniform vec2 uDir;
uniform float uNear, uFar, uPxPerMm1m, uStrength;
uniform vec3 uSigma;
varying vec2 vUv;
float skinMask(float a) { return 1.0 - smoothstep(0.06, 0.18, abs(a - 0.5)); }
float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).r, uNear, uFar); }
void main() {
  vec4 c0 = texture2D(tColor, vUv);
  float m0 = skinMask(c0.a);
  if (m0 < 0.01) { gl_FragColor = c0; return; }
  float z0 = viewZ(vUv);
  float pxPerMm = uPxPerMm1m / max(z0, 0.05);
  vec3 sum = pow(c0.rgb, vec3(2.2)), wsum = vec3(1.0);
  for (int i = -${FINISH.sssTaps}; i <= ${FINISH.sssTaps}; i++) {
    if (i == 0) continue;
    float xmm = float(i) / ${FINISH.sssTaps}.0 * 2.5 * uSigma.r;
    vec2 uv = vUv + uDir * xmm * pxPerMm;
    vec4 s = texture2D(tColor, uv);
    float ok = skinMask(s.a) * (1.0 - smoothstep(1.5, 5.0, abs(viewZ(uv) - z0) * 1000.0));
    vec3 w = exp(-(xmm * xmm) / (2.0 * uSigma * uSigma)) * ok;
    sum += pow(s.rgb, vec3(2.2)) * w;
    wsum += w;
  }
  vec3 blurred = pow(sum / wsum, vec3(1.0 / 2.2));
  gl_FragColor = vec4(mix(c0.rgb, blurred, m0 * uStrength), c0.a);
}`;

// The image into the half-size mipmapped target that clarity reads its wide blur from.
const COPY = /* glsl */ `
uniform sampler2D tColor;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tColor, vUv).rgb, 1.0); }`;

const FINAL = /* glsl */ `
#include <packing>
uniform sampler2D tColor, tDepth, tBloom, tBlur;
uniform vec2 uTexel;
uniform float uNear, uFar, uFocus, uCocScale, uMaxCoc;
uniform int uTaps;
uniform float uBloom, uGrain, uVignette, uGrade, uAspect, uFrame, uClarity, uSharpen;
varying vec2 vUv;

// circle of confusion (px) at uv: a thin lens focused at uFocus; the backdrop counts as far away
float cocAt(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  if (d >= 0.99999) return uMaxCoc;
  float z = -perspectiveDepthToViewZ(d, uNear, uFar);
  return min(uMaxCoc, uCocScale * abs(z - uFocus) / z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  vec3 sharp = c;
  float subject = step(texture2D(tDepth, vUv).r, 0.99999);
  float focusKeep = 1.0; // how sharp this pixel stays under the depth of field (clarity follows it)

  // depth of field: gather round this pixel; a tap counts where its own blur reaches here, so a sharp face never
  // smears into a soft background and a soft background never covers a sharp face
  if (uTaps > 0) {
    float coc = cocAt(vUv);
    focusKeep = 1.0 - smoothstep(0.5, 3.0, coc);
    if (coc > 0.5) {
      vec3 sum = c;
      float wsum = 1.0;
      float phi = hash12(gl_FragCoord.xy) * 6.2831853;
      for (int i = 0; i < 24; i++) {
        if (i >= uTaps) break;
        float r = sqrt((float(i) + 0.5) / float(uTaps)) * coc;
        float a = float(i) * 2.39996323 + phi;
        vec2 off = vec2(cos(a), sin(a)) * r;
        vec2 uv = vUv + off * uTexel;
        float w = clamp(cocAt(uv) - r + 1.0, 0.0, 1.0);
        sum += texture2D(tColor, uv).rgb * w;
        wsum += w;
      }
      c = sum / wsum;
    }
  }

  // clarity: the luminance detail of the sharp image (minus its wide blur, and minus its 4 neighbours) added back,
  // mid-tones most, keeping the hue
  if (uClarity > 0.0 || uSharpen > 0.0) {
    const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
    float ls = dot(sharp, LUMA);
    vec3 wide = textureLod(tBlur, vUv, 1.0).rgb * 0.5 + textureLod(tBlur, vUv, 2.5).rgb * 0.5;
    vec3 near4 = 0.25 * (texture2D(tColor, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(uTexel.x, 0.0)).rgb
                       + texture2D(tColor, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tColor, vUv - vec2(0.0, uTexel.y)).rgb);
    float detail = uClarity * (ls - dot(wide, LUMA)) + uSharpen * (ls - dot(near4, LUMA));
    float l = dot(c, LUMA);
    float mid = clamp(4.0 * l * (1.0 - l), 0.0, 1.0);
    c = clamp(c + c / max(l, 0.03) * clamp(detail, -0.2, 0.2) * mid * subject * focusKeep, 0.0, 1.0);
  }

  // bloom: the bright pass's mips, screened on (brightens without clipping)
  if (uBloom > 0.0) {
    vec3 b = textureLod(tBloom, vUv, 1.0).rgb * 0.4 + textureLod(tBloom, vUv, 2.0).rgb * 0.3
           + textureLod(tBloom, vUv, 3.0).rgb * 0.2 + textureLod(tBloom, vUv, 4.0).rgb * 0.1;
    c = 1.0 - (1.0 - c) * (1.0 - clamp(b * uBloom, 0.0, 1.0));
  }

  // grade (head and clothes only): a touch less saturation, cool shadows, warm highlights, a soft S-curve
  {
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 g = mix(vec3(l), c, 1.0 - 0.08 * uGrade);
    g += uGrade * (vec3(-0.008, 0.002, 0.014) * (1.0 - l) + vec3(0.014, 0.004, -0.012) * l);
    g = clamp(g, 0.0, 1.0);
    g = mix(g, g * g * (3.0 - 2.0 * g), 0.2 * uGrade);
    c = mix(c, g, subject);
  }

  // vignette (head and clothes only: the backdrop keeps the page's colour)
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= mix(1.0, 1.0 - uVignette * smoothstep(0.3, 0.95, length(q)), subject);

  // grain: luminance noise, a new pattern every frame, strongest in the mid-tones
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c += (hash12(gl_FragCoord.xy + uFrame * vec2(17.31, 41.73)) - 0.5) * uGrain * (0.25 + 3.0 * lum * (1.0 - lum));

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

type Rig = {
  scene: WebGLRenderTarget;
  bright: WebGLRenderTarget;
  blur: WebGLRenderTarget; // half size, mipmapped: clarity's wide blur
  sssA: WebGLRenderTarget; // the subsurface blur's two passes
  sssB: WebGLRenderTarget;
  sssMat: ShaderMaterial;
  copyMat: ShaderMaterial;
  quad: Mesh;
  quadScene: Scene;
  quadCamera: OrthographicCamera;
  brightMat: ShaderMaterial;
  finalMat: ShaderMaterial;
};

let rig: Rig | null = null;
const size = new Vector2();
let frame = 0;

/** A target three draws into as if it were the canvas (see the header): display colour, the same programs. */
function screenLikeTarget(w: number, h: number): WebGLRenderTarget {
  const t = new WebGLRenderTarget(w, h, { samples: 4, type: UnsignedByteType, depthBuffer: true, depthTexture: new DepthTexture(w, h) });
  t.texture.colorSpace = SRGBColorSpace; // what the materials encode to
  t.texture.internalFormat = "RGBA8"; // stored as written, like the canvas (not an sRGB texture, which would encode again)
  t.texture.minFilter = t.texture.magFilter = LinearFilter;
  t.texture.generateMipmaps = false;
  (t as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
  return t;
}

function makeRig(w: number, h: number): Rig {
  const geometry = new BufferGeometry(); // one triangle over the screen
  geometry.setAttribute("position", new Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  geometry.setAttribute("uv", new Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const scene = screenLikeTarget(w, h);
  const half = () => {
    const t = new WebGLRenderTarget(Math.max(1, w >> 1), Math.max(1, h >> 1), { type: UnsignedByteType, depthBuffer: false });
    t.texture.minFilter = LinearMipmapLinearFilter;
    t.texture.magFilter = LinearFilter;
    t.texture.generateMipmaps = true;
    return t;
  };
  const full = () => {
    const t = new WebGLRenderTarget(w, h, { type: UnsignedByteType, depthBuffer: false });
    t.texture.minFilter = t.texture.magFilter = LinearFilter;
    t.texture.generateMipmaps = false;
    return t;
  };
  const bright = half();
  const blur = half();
  const sssA = full();
  const sssB = full();
  const common = { vertexShader: VERTEX, depthTest: false, depthWrite: false, toneMapped: false };
  const brightMat = new ShaderMaterial({
    ...common,
    fragmentShader: BRIGHT,
    uniforms: { tColor: { value: scene.texture }, tDepth: { value: scene.depthTexture }, uThreshold: { value: FINISH.bloomThreshold } },
  });
  const sssMat = new ShaderMaterial({
    ...common,
    fragmentShader: SSS,
    uniforms: {
      tColor: { value: scene.texture },
      tDepth: { value: scene.depthTexture },
      uDir: { value: new Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 5 },
      uPxPerMm1m: { value: 1 },
      uStrength: { value: 0 },
      uSigma: { value: new Vector3() },
    },
  });
  const copyMat = new ShaderMaterial({ ...common, fragmentShader: COPY, uniforms: { tColor: { value: scene.texture } } });
  const finalMat = new ShaderMaterial({
    ...common,
    fragmentShader: FINAL,
    uniforms: {
      tColor: { value: scene.texture },
      tDepth: { value: scene.depthTexture },
      tBloom: { value: bright.texture },
      tBlur: { value: blur.texture },
      uClarity: { value: 0 },
      uSharpen: { value: 0 },
      uTexel: { value: new Vector2() },
      uNear: { value: 0.1 },
      uFar: { value: 5 },
      uFocus: { value: 1.3 },
      uCocScale: { value: 0 },
      uMaxCoc: { value: FINISH.maxCocPx },
      uTaps: { value: 0 },
      uBloom: { value: 0 },
      uGrain: { value: 0 },
      uVignette: { value: 0 },
      uGrade: { value: 0 },
      uAspect: { value: 1 },
      uFrame: { value: 0 },
    },
  });
  const quad = new Mesh(geometry, finalMat);
  quad.frustumCulled = false;
  const quadScene = new Scene();
  quadScene.add(quad);
  return { scene, bright, blur, sssA, sssB, sssMat, copyMat, quad, quadScene, quadCamera: new OrthographicCamera(-1, 1, 1, -1, 0, 1), brightMat, finalMat };
}

const eyeMid = new Vector3();
const headWorld = new Matrix4();

/** How far in front of the camera the eyes are (m): the focus. The middle of the view's target if the eyes aren't in. */
function focusDistance(camera: Camera): number {
  const { uEyeL, uEyeR, uHeadInv } = eyeUniforms;
  if (uEyeL.value.lengthSq() > 0 && uEyeR.value.lengthSq() > 0) {
    headWorld.copy(uHeadInv.value).invert();
    eyeMid.addVectors(uEyeL.value, uEyeR.value).multiplyScalar(0.5).applyMatrix4(headWorld);
  } else eyeMid.set(0, 0.3, 0.1);
  return Math.max(0.2, -eyeMid.applyMatrix4(camera.matrixWorldInverse).z);
}

/** Is the finish drawn now (tier and setting)? */
export const finishActive = () => tierSettings().finish && finishSettings.on;

/**
 * Draw the scene to the canvas, with the finish when it is on: the render loop (PieceFadeRender) and the voice's
 * screenshot (lib/sceneRig.ts) both draw through here. Otherwise exactly gl.render.
 */
export function renderView(gl: WebGLRenderer, scene: Scene, camera: Camera): void {
  if (!finishActive()) {
    gl.render(scene, camera);
    return;
  }
  gl.getDrawingBufferSize(size);
  const w = Math.max(1, Math.floor(size.x));
  const h = Math.max(1, Math.floor(size.y));
  if (!rig) rig = makeRig(w, h);
  else if (rig.scene.width !== w || rig.scene.height !== h) {
    rig.scene.setSize(w, h);
    rig.bright.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    rig.blur.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    rig.sssA.setSize(w, h);
    rig.sssB.setSize(w, h);
  }
  const s = finishSettings;
  const tier = tierSettings();
  const ratio = gl.getPixelRatio();

  const cam = camera as PerspectiveCamera;
  const before = gl.getRenderTarget();
  const sss = cam.isPerspectiveCamera ? s.skin : 0;
  skinUniforms.uSkinAlpha.value = sss > 0 ? 0.5 : 1; // the skin marks itself for the blur (only in this target)
  gl.setRenderTarget(rig.scene);
  try {
    gl.render(scene, camera);
  } finally {
    skinUniforms.uSkinAlpha.value = 1;
  }
  const r = rig;
  const pass = (material: ShaderMaterial, target: WebGLRenderTarget) => {
    r.quad.material = material;
    gl.setRenderTarget(target);
    gl.render(r.quadScene, r.quadCamera);
  };

  // the subsurface blur, across and then down; everything after reads its result
  let src = rig.scene.texture;
  if (sss > 0) {
    const su = rig.sssMat.uniforms;
    su.uNear.value = cam.near;
    su.uFar.value = cam.far;
    su.uPxPerMm1m.value = h / (2 * Math.tan((cam.fov * Math.PI) / 360)) / 1000;
    su.uStrength.value = Math.min(1, 0.4 + sss);
    su.uSigma.value.set(...FINISH.sssMm).multiplyScalar(0.35 + 0.65 * sss);
    su.tColor.value = rig.scene.texture;
    su.uDir.value.set(1 / w, 0);
    pass(rig.sssMat, rig.sssA);
    su.tColor.value = rig.sssA.texture;
    su.uDir.value.set(0, 1 / h);
    pass(rig.sssMat, rig.sssB);
    src = rig.sssB.texture;
  }
  if (s.clarity > 0) {
    rig.copyMat.uniforms.tColor.value = src;
    pass(rig.copyMat, rig.blur);
  }
  const bloom = FINISH.bloom * s.bloom;
  if (bloom > 0) {
    rig.brightMat.uniforms.tColor.value = src;
    pass(rig.brightMat, rig.bright);
  }

  const u = rig.finalMat.uniforms;
  u.tColor.value = src;
  u.uClarity.value = FINISH.clarity * s.clarity;
  u.uSharpen.value = FINISH.sharpen * s.clarity;
  u.uTexel.value.set(1 / w, 1 / h);
  u.uAspect.value = w / h;
  u.uBloom.value = bloom;
  u.uGrain.value = FINISH.grain * s.grain;
  u.uVignette.value = FINISH.vignette * s.vignette;
  u.uGrade.value = FINISH.grade * s.grade;
  u.uFrame.value = frame = (frame + 1) % 1000;
  if (cam.isPerspectiveCamera && s.focus > 0 && tier.dofTaps > 0) {
    // a thin lens: blur (px) = f / (N·(s − f)) · |z − s| / z / (2·tan(fov/2)) · image height; f from the view's fov on
    // a full-frame sensor (24 mm tall), the aperture f/N by the setting
    const halfTan = Math.tan((cam.fov * Math.PI) / 360);
    const f = 0.012 / halfTan;
    const focus = focusDistance(cam);
    const N = FINISH.fNumber / s.focus;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uFocus.value = focus;
    u.uCocScale.value = (f / (N * Math.max(0.05, focus - f)) / (2 * halfTan)) * h;
    u.uMaxCoc.value = FINISH.maxCocPx * ratio;
    u.uTaps.value = tier.dofTaps;
  } else u.uTaps.value = 0;
  rig.quad.material = rig.finalMat;
  gl.setRenderTarget(before);
  gl.render(rig.quadScene, rig.quadCamera);
}

/** Free the finish's targets (the canvas went away). */
export function disposeFinish(): void {
  if (!rig) return;
  rig.scene.depthTexture?.dispose();
  rig.scene.dispose();
  rig.bright.dispose();
  rig.blur.dispose();
  rig.sssA.dispose();
  rig.sssB.dispose();
  rig.brightMat.dispose();
  rig.sssMat.dispose();
  rig.copyMat.dispose();
  rig.finalMat.dispose();
  rig.quad.geometry.dispose();
  rig = null;
}
