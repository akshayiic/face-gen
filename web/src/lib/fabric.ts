/**
 * The clothes' fabric surface (lib/clothes.ts): the structure of the cloth drawn in its shader, no textures: knit stitches
 * (columns of V-shaped loops), a fine cotton weave, denim's diagonal twill and slubby yarn, leather's pebbled grain; satin
 * stays smooth. Laid round the body in millimetres (the garment's angle round its axis × its radius, and its height),
 * shaded darker in the grooves and bumped like the skin's pores (screen-space derivatives); it fades out where one
 * repeat is under a few pixels, so the cloth never shimmers from afar.
 *
 * Tweak in FABRIC_LOOK (per fabric: how deep the relief is, in mm, and how dark the grooves).
 */
import type { MeshPhysicalMaterial } from "three";

import type { FabricId } from "@/lib/clothes";

export const FABRIC_LOOK: Record<FabricId, { code: number; depthMm: number; groove: number }> = {
  cotton: { code: 0, depthMm: 0.08, groove: 0.06 },
  knit: { code: 1, depthMm: 0.35, groove: 0.24 },
  satin: { code: 2, depthMm: 0, groove: 0 },
  denim: { code: 3, depthMm: 0.12, groove: 0.22 },
  leather: { code: 4, depthMm: 0.1, groove: 0.07 },
};

/** Shared by the outer garment and the top under it (they are the same fabric). */
export const fabricUniforms = { uFabric: { value: 0 }, uFabricDepth: { value: 0.08 }, uFabricGroove: { value: 0.06 } };

export function setFabric(id: FabricId): void {
  const f = FABRIC_LOOK[id] ?? FABRIC_LOOK.cotton;
  fabricUniforms.uFabric.value = f.code;
  fabricUniforms.uFabricDepth.value = f.depthMm;
  fabricUniforms.uFabricGroove.value = f.groove;
}

const DECL = /* glsl */ `
uniform int uFabric;
uniform float uFabricDepth, uFabricGroove;
varying vec3 vFabric; // the garment's own space, mm
float fabricH = 0.5, fabricFade = 0.0;
float fbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fbNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fbHash(i), fbHash(i + vec2(1.0, 0.0)), f.x), mix(fbHash(i + vec2(0.0, 1.0)), fbHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// the cloth's surface (0..1) at p (x round the body, y up, mm); cell: the size of one repeat (mm)
float fabricHeight(vec2 p, out float cell) {
  if (uFabric == 1) { // knit (jersey): columns of V-shaped loops
    cell = 2.0;
    vec2 c = vec2(p.x / 2.0, p.y / 1.6);
    float lx = fract(c.x) - 0.5;
    float ly = fract(c.y + abs(lx) * 0.9) - 0.5;
    float loop = (1.0 - smoothstep(0.32, 0.5, abs(lx))) * (0.5 + 0.5 * cos(ly * 6.2831853));
    return loop * 0.85 + 0.15 * fbNoise(p * 2.5);
  }
  if (uFabric == 3) { // denim: a diagonal twill, slubby yarn
    cell = 1.1;
    return 0.5 + 0.4 * sin((p.x + p.y) * 6.2831853 / 1.1) + 0.25 * (fbNoise(vec2(p.x * 0.3, p.y * 4.0)) - 0.5);
  }
  if (uFabric == 4) { // leather: a pebbled grain
    cell = 1.4;
    vec2 g = p / 1.4, i = floor(g);
    float d = 9.0;
    for (int x = -1; x <= 1; x++)
      for (int y = -1; y <= 1; y++) {
        vec2 c = i + vec2(float(x), float(y));
        d = min(d, length(g - c - vec2(fbHash(c), fbHash(c + 7.0))));
      }
    return smoothstep(0.0, 0.7, d);
  }
  if (uFabric == 2) { // satin: smooth
    cell = 1.0;
    return 0.5;
  }
  cell = 0.7; // cotton: a fine plain weave
  return 0.5 + 0.3 * sin(p.x * 6.2831853 / 0.7) * sin(p.y * 6.2831853 / 0.7) + 0.2 * (fbNoise(p * 1.7) - 0.5);
}
vec3 fabricBump(vec3 surfPos, vec3 n, float h, float faceDir) {
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec2 dh = vec2(dFdx(h), dFdy(h)) * 0.001; // mm -> m
  return normalize(abs(det) * n - sign(det) * (dh.x * r1 + dh.y * r2));
}
`;

const COLOUR = /* glsl */ `
#include <color_fragment>
{
  vec2 fp = vec2(atan(vFabric.x, vFabric.z) * length(vFabric.xz), vFabric.y);
  float cell;
  fabricH = fabricHeight(fp, cell);
  float px = max(length(fwidth(vFabric)), 1e-4); // mm per pixel here
  fabricFade = 1.0 - smoothstep(cell * 0.25, cell * 0.8, px); // a repeat under ~2 px: none
  diffuseColor.rgb *= 1.0 - uFabricGroove * (1.0 - fabricH) * fabricFade;
}
`;

const NORMAL = /* glsl */ `
#include <normal_fragment_maps>
normal = fabricBump(-vViewPosition, normal, (fabricH - 0.5) * uFabricDepth * fabricFade, faceDirection);
`;

/** Add the fabric to a clothes material (keeps any onBeforeCompile it had: install before lib/hairShadow.ts's). */
export function installFabric(material: MeshPhysicalMaterial): void {
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, fabricUniforms);
    shader.vertexShader = "varying vec3 vFabric;\n" + shader.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvFabric = position * 1000.0;");
    shader.fragmentShader = DECL + shader.fragmentShader.replace("#include <color_fragment>", COLOUR).replace("#include <normal_fragment_maps>", NORMAL);
  };
}
