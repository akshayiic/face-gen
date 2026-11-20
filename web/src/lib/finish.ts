/**
 * The camera finish: what a photograph has and a raw render doesn't, drawn over each frame on the medium and high tiers
 * (lib/quality.ts finish):
 *  - depth of field: an 85 mm portrait lens focused on the eyes, so the ears, the hair behind and the shoulders soften
 *    by how far they are from the focus (a gather of up to 24 taps, which leaves sharp things sharp);
 *  - bloom: the brightest highlights glow a little (a half-size bright pass, its mip chain added back);
 *  - a colour grade (a little contrast, cool shadows and warm highlights), a vignette, and fine film grain.
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

export const FINISH = {
  fNumber: 2.0, // the aperture at full "Depth of field" (f/2; the default half is f/4)
  maxCocPx: 10, // the most any pixel blurs (CSS px; × the canvas's pixel ratio)
  bloomThreshold: 0.86, // display brightness where bloom starts (highlights, not white clothes)
  bloom: 0.55, // the strongest bloom
  grain: 0.06, // the strongest grain (± display units in the mid-tones)
  vignette: 0.3, // the most the corners darken
  grade: 1, // the strongest grade
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

const FINAL = /* glsl */ `
#include <packing>
uniform sampler2D tColor, tDepth, tBloom;
uniform vec2 uTexel;
uniform float uNear, uFar, uFocus, uCocScale, uMaxCoc;
uniform int uTaps;
uniform float uBloom, uGrain, uVignette, uGrade, uAspect, uFrame;
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
  float subject = step(texture2D(tDepth, vUv).r, 0.99999);

  // depth of field: gather round this pixel; a tap counts where its own blur reaches here, so a sharp face never
  // smears into a soft background and a soft background never covers a sharp face
  if (uTaps > 0) {
    float coc = cocAt(vUv);
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
  const bright = new WebGLRenderTarget(Math.max(1, w >> 1), Math.max(1, h >> 1), { type: UnsignedByteType, depthBuffer: false });
  bright.texture.minFilter = LinearMipmapLinearFilter;
  bright.texture.magFilter = LinearFilter;
  bright.texture.generateMipmaps = true;
  const common = { vertexShader: VERTEX, depthTest: false, depthWrite: false, toneMapped: false };
  const brightMat = new ShaderMaterial({
    ...common,
    fragmentShader: BRIGHT,
    uniforms: { tColor: { value: scene.texture }, tDepth: { value: scene.depthTexture }, uThreshold: { value: FINISH.bloomThreshold } },
  });
  const finalMat = new ShaderMaterial({
    ...common,
    fragmentShader: FINAL,
    uniforms: {
      tColor: { value: scene.texture },
      tDepth: { value: scene.depthTexture },
      tBloom: { value: bright.texture },
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
  return { scene, bright, quad, quadScene, quadCamera: new OrthographicCamera(-1, 1, 1, -1, 0, 1), brightMat, finalMat };
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
  }
  const s = finishSettings;
  const tier = tierSettings();
  const ratio = gl.getPixelRatio();

  const before = gl.getRenderTarget();
  gl.setRenderTarget(rig.scene);
  gl.render(scene, camera);

  const bloom = FINISH.bloom * s.bloom;
  if (bloom > 0) {
    rig.quad.material = rig.brightMat;
    gl.setRenderTarget(rig.bright);
    gl.render(rig.quadScene, rig.quadCamera);
  }

  const u = rig.finalMat.uniforms;
  const cam = camera as PerspectiveCamera;
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
  rig.brightMat.dispose();
  rig.finalMat.dispose();
  rig.quad.geometry.dispose();
  rig = null;
}
