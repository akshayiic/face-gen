/**
 * Hair shadows on the skin and the clothes. The strands (lib/groom.ts) are drawn by their own shader, so they can't go
 * into the key light's shadow map. Instead their density goes into a small 3D texture in head space, built on the CPU
 * from the shipped strands whenever the hair or beard on the head changes (~10–30 ms, once per change). The skin and
 * clothes shaders march from each pixel towards every directional light through it (light through hair fades as
 * exp(−optical depth), never below HAIR_SHADOW.floor: hair scatters light on), and look a little way out along the
 * normal for the ambient light: the fringe darkens the forehead, long hair the neck and shoulders, a beard the chin.
 *
 * Space: head space in mm, the strand files' space × 1000 and the skin's vRest (lib/age.ts: uRest is the same toHead
 * matrix). The hair follows the face's sliders by offsets the volume doesn't see; at a 4 mm voxel that hardly shows.
 * Medium and high tiers only (lib/quality.ts hairShadow): the march is 12 texture reads per light.
 *
 * Tweak in HAIR_SHADOW (`__faceToVoice.hairShadow` in debug: edit, then `apply()`).
 */
import {
  ClampToEdgeWrapping,
  type Camera,
  Data3DTexture,
  LinearFilter,
  Matrix3,
  Matrix4,
  type MeshPhysicalMaterial,
  type Object3D,
  RedFormat,
  ShaderChunk,
  type ShaderMaterial,
  UnsignedByteType,
  Vector3,
} from "three";

import { onTier, tierSettings } from "@/lib/quality";
import { skinSurface } from "@/lib/skinSurface";

export const HAIR_SHADOW = {
  voxelMm: 4, // the volume's cell (it grows when the hair is so long the grid would pass maxDim)
  maxDim: 96,
  strength: 0.6, // × the optical depth towards a light (strand width × length per volume, ×this)
  ambient: 0.5, // × the optical depth out along the normal (the ambient light's occlusion)
  floor: 0.18, // the least light that gets through: hair scatters light on, it never casts a black shadow
};

/** One groom's strands: positions in metres (head space), n strands of p points; width: mm of ribbon per mm of strand. */
export type HairShadowSource = { positions: Float32Array; n: number; p: number; width: number };

export type HairVolume = {
  /** sqrt(σ / sigmaMax) per cell, 0..255 (the square root keeps precision for thin hair). x fastest, then y, then z. */
  data: Uint8Array;
  dims: [number, number, number];
  /** The corner of cell (0, 0, 0), mm. */
  min: [number, number, number];
  voxel: number;
  /** σ (1/mm) at 255. */
  sigmaMax: number;
};

/**
 * The density volume of these strands, or null when there are none. σ per cell is the ribbon area inside it (strand
 * length × width) over its volume: the chance per mm that a ray through it meets a strand.
 */
export function buildHairVolume(list: readonly HairShadowSource[], voxelMm = HAIR_SHADOW.voxelMm, maxDim = HAIR_SHADOW.maxDim): HairVolume | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const s of list)
    for (let i = 0; i < s.n * s.p; i++)
      for (let a = 0; a < 3; a++) {
        const v = s.positions[i * 3 + a] * 1000;
        if (v < lo[a]) lo[a] = v;
        if (v > hi[a]) hi[a] = v;
      }
  if (!(hi[0] >= lo[0])) return null;
  const PAD = 4; // empty cells round the hair (the blur reaches 2), so outside the box reads as no hair
  const span = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const voxel = Math.max(voxelMm, span / (maxDim - 2 * PAD));
  const dims = [0, 1, 2].map((a) => Math.ceil((hi[a] - lo[a]) / voxel) + 2 * PAD) as [number, number, number];
  const min = [0, 1, 2].map((a) => lo[a] - PAD * voxel) as [number, number, number];
  const [nx, ny, nz] = dims;
  const sigma = new Float32Array(nx * ny * nz);

  // splat every segment at half-cell steps: the ribbon area it adds to the cell it is in
  const half = voxel * 0.5;
  for (const s of list) {
    const pos = s.positions;
    for (let strand = 0; strand < s.n; strand++) {
      for (let k = 0; k < s.p - 1; k++) {
        const a = (strand * s.p + k) * 3;
        const ax = pos[a] * 1000, ay = pos[a + 1] * 1000, az = pos[a + 2] * 1000;
        const dx = pos[a + 3] * 1000 - ax, dy = pos[a + 4] * 1000 - ay, dz = pos[a + 5] * 1000 - az;
        const len = Math.hypot(dx, dy, dz);
        if (len === 0) continue;
        const steps = Math.max(1, Math.ceil(len / half));
        const w = (s.width * len) / steps;
        for (let j = 0; j < steps; j++) {
          const t = (j + 0.5) / steps;
          const ix = Math.floor((ax + dx * t - min[0]) / voxel);
          const iy = Math.floor((ay + dy * t - min[1]) / voxel);
          const iz = Math.floor((az + dz * t - min[2]) / voxel);
          sigma[ix + nx * (iy + ny * iz)] += w;
        }
      }
    }
  }
  const cell = voxel * voxel * voxel;
  for (let i = 0; i < sigma.length; i++) sigma[i] /= cell;

  // soften: [1 2 1] / 4 along each axis, twice (the GPU's child strands spread round every shipped one)
  const tmp = new Float32Array(sigma.length);
  const strides = [1, nx, nx * ny];
  for (let pass = 0; pass < 2; pass++)
    for (let axis = 0; axis < 3; axis++) {
      const st = strides[axis];
      const n = dims[axis];
      for (let z = 0; z < nz; z++)
        for (let y = 0; y < ny; y++)
          for (let x = 0; x < nx; x++) {
            const i = x + nx * (y + ny * z);
            const c = [x, y, z][axis];
            const l = c > 0 ? sigma[i - st] : 0;
            const r = c < n - 1 ? sigma[i + st] : 0;
            tmp[i] = (l + 2 * sigma[i] + r) * 0.25;
          }
      sigma.set(tmp);
    }

  let sigmaMax = 0;
  for (let i = 0; i < sigma.length; i++) if (sigma[i] > sigmaMax) sigmaMax = sigma[i];
  const data = new Uint8Array(sigma.length);
  if (sigmaMax > 0)
    for (let z = 1; z < nz - 1; z++)
      for (let y = 1; y < ny - 1; y++)
        for (let x = 1; x < nx - 1; x++) {
          const i = x + nx * (y + ny * z);
          data[i] = Math.round(255 * Math.sqrt(sigma[i] / sigmaMax)); // the outermost cells stay 0 (clamped reads outside)
        }
  return { data, dims, min, voxel, sigmaMax };
}

// --- the live volume -------------------------------------------------------------------------------------------------

function volumeTexture(data: Uint8Array, nx: number, ny: number, nz: number): Data3DTexture {
  const t = new Data3DTexture(data, nx, ny, nz);
  t.format = RedFormat;
  t.type = UnsignedByteType;
  t.minFilter = t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export const hairShadowUniforms = {
  uHairVol: { value: volumeTexture(new Uint8Array(1), 1, 1, 1) },
  uHairVolMin: { value: new Vector3() },
  uHairVolInv: { value: new Vector3(1, 1, 1) }, // 1 / the volume's size in mm, per axis
  uHairSigma: { value: 0 }, // σ at full density × strength; 0: no hair (the shaders skip the march)
  uHairAmbient: { value: HAIR_SHADOW.ambient },
  uHairFloor: { value: HAIR_SHADOW.floor },
  uViewToHead: { value: new Matrix3() }, // view-space directions → head space (lights, normals)
  uWorldToHead: { value: new Matrix4() }, // world positions → head space in mm (the clothes)
};

const sources = new Map<Object3D, HairShadowSource>();
let volume: HairVolume | null = null;
let shown = ""; // the sources in the volume now (ids)
let pending = 0;

/** Strand hair or a beard joins the shadow (lib/groom.ts); it counts while it is in the scene. Returns the removal. */
export function registerHairShadow(group: Object3D, source: HairShadowSource): () => void {
  sources.set(group, source);
  return () => {
    sources.delete(group);
  };
}

/**
 * The hair's own shade per strand point (0 buried … 1 lit, as the strand files bake it), for strands re-shaped in the
 * app (lib/hairShape.ts): how much of the key light reaches each point through the hair (`toLight`, head space, the
 * same march as hairTransmit) and how much of the sky the hair round it leaves. Once per re-shape on the CPU (~0.1 s),
 * not per pixel: hair overdraws far too much for a march in its fragment shader.
 */
export function bakeHairShade(source: HairShadowSource, toLight: [number, number, number] = [-0.5, 0.42, 0.75]): Float32Array {
  const out = new Float32Array(source.n * source.p).fill(1);
  const vol = buildHairVolume([source]);
  if (!vol) return out;
  const { data, dims, min, voxel, sigmaMax } = vol;
  const [nx, ny, nz] = dims;
  const k = sigmaMax * HAIR_SHADOW.strength;
  const sigmaAt = (x: number, y: number, z: number) => {
    const ix = Math.floor((x - min[0]) / voxel), iy = Math.floor((y - min[1]) / voxel), iz = Math.floor((z - min[2]) / voxel);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx || iy >= ny || iz >= nz) return 0;
    const d = data[ix + nx * (iy + ny * iz)] / 255;
    return d * d * k;
  };
  const len = Math.hypot(...toLight);
  const L = toLight.map((v) => v / len);
  const c = [0, 290, 5]; // the head's centre (mm): "outward" for the sky
  const pos = source.positions;
  for (let i = 0; i < source.n * source.p; i++) {
    const x = pos[i * 3] * 1000, y = pos[i * 3 + 1] * 1000, z = pos[i * 3 + 2] * 1000;
    let tau = 0, t = 3;
    for (let s = 0; s < 12; s++) {
      const dt = 1.5 + s * 1.1;
      const m = t + 0.5 * dt;
      tau += sigmaAt(x + L[0] * m, y + L[1] * m, z + L[2] * m) * dt;
      t += dt;
    }
    const ox = x - c[0], oy = y - c[1], oz = z - c[2];
    const ol = Math.hypot(ox, oy, oz) || 1;
    let amb = 0;
    for (const [d, w] of [[2, 3], [6, 5], [12, 7], [21, 10]]) amb += sigmaAt(x + (ox / ol) * d, y + (oy / ol) * d, z + (oz / ol) * d) * w;
    out[i] = 0.6 * Math.exp(-tau) + 0.4 * Math.exp(-amb * HAIR_SHADOW.ambient);
  }
  return out;
}

/** A registered group's strands moved (lib/hairShape.ts: tied back, more volume): rebuild the volume from `source`. */
export function updateHairShadow(group: Object3D, source: HairShadowSource): void {
  if (!sources.has(group)) return;
  sources.set(group, source);
  shown = ""; // differs from any stage: the next view update rebuilds
}

const onStage = (o: Object3D): boolean => {
  let n: Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    if ((n as { isScene?: boolean }).isScene) return true;
    n = n.parent;
  }
  return false;
};

function staged(): [Object3D, HairShadowSource][] {
  return [...sources].filter(([g]) => onStage(g));
}

function rebuild(): void {
  pending = 0;
  const list = staged();
  shown = list.map(([g]) => g.id).join(",");
  volume = buildHairVolume(list.map(([, s]) => s));
  const u = hairShadowUniforms;
  if (!volume) {
    u.uHairSigma.value = 0;
    return;
  }
  const [nx, ny, nz] = volume.dims;
  u.uHairVol.value.dispose();
  u.uHairVol.value = volumeTexture(volume.data, nx, ny, nz);
  u.uHairVolMin.value.fromArray(volume.min);
  u.uHairVolInv.value.set(1 / (nx * volume.voxel), 1 / (ny * volume.voxel), 1 / (nz * volume.voxel));
  apply();
}

/** Push HAIR_SHADOW into the uniforms (debug handle). */
export function apply(): void {
  const u = hairShadowUniforms;
  u.uHairSigma.value = volume ? volume.sigmaMax * HAIR_SHADOW.strength : 0;
  u.uHairAmbient.value = HAIR_SHADOW.ambient;
  u.uHairFloor.value = HAIR_SHADOW.floor;
}

const toHeadNow = new Matrix4();
const viewToHead = new Matrix4();
const MM = new Matrix4().makeScale(1000, 1000, 1000);

/**
 * Per frame, from the skin's and the clothes' onBeforeRender: the head-space matrices for this camera, and a rebuild
 * (next task) when the hair on the head changed.
 */
export function updateHairShadowView(camera: Camera): void {
  const skin = skinSurface.mesh;
  if (!skin) return;
  toHeadNow.copy(skin.matrixWorld).invert().premultiply(skinSurface.toHead); // world → head (m)
  hairShadowUniforms.uWorldToHead.value.multiplyMatrices(MM, toHeadNow);
  viewToHead.multiplyMatrices(toHeadNow, camera.matrixWorld);
  hairShadowUniforms.uViewToHead.value.setFromMatrix4(viewToHead);
  if (!pending) {
    const now = staged().map(([g]) => g.id).join(",");
    if (now !== shown) pending = window.setTimeout(rebuild, 0);
  }
}

// --- shaders ---------------------------------------------------------------------------------------------------------

/** Declarations: the volume, and the march towards a light and out along the normal. */
export const HAIR_SHADOW_DECL = /* glsl */ `
uniform highp sampler3D uHairVol;
uniform vec3 uHairVolMin, uHairVolInv;
uniform float uHairSigma, uHairAmbient, uHairFloor;
uniform mat3 uViewToHead;
float hairSigmaAt(vec3 p) {
  float d = texture(uHairVol, (p - uHairVolMin) * uHairVolInv).r;
  return d * d;
}
// light reaching p (head mm) from the direction l (head space, unit) through the hair: 1 = no hair in the way
float hairTransmit(vec3 p, vec3 l) {
  if (uHairSigma <= 0.0) return 1.0;
  float tau = 0.0, t = 1.0;
  for (int i = 0; i < 12; i++) { // steps of 1.5 mm growing to 13.6 mm: 9 cm in all
    float dt = 1.5 + float(i) * 1.1;
    tau += hairSigmaAt(p + l * (t + 0.5 * dt)) * dt;
    t += dt;
  }
  return mix(uHairFloor, 1.0, exp(-tau * uHairSigma));
}
// the ambient light's share at p: hair out along the normal n (head space, unit) hides part of the sky
float hairAmbient(vec3 p, vec3 n) {
  if (uHairSigma <= 0.0) return 1.0;
  float tau = hairSigmaAt(p + n * 2.0) * 3.0 + hairSigmaAt(p + n * 6.0) * 5.0 + hairSigmaAt(p + n * 12.0) * 7.0 + hairSigmaAt(p + n * 21.0) * 10.0;
  return mix(uHairFloor, 1.0, exp(-tau * uHairSigma * uHairAmbient));
}
`;

const DIR_INFO = "getDirectionalLightInfo( directionalLight, directLight );";
export const DIR_SHADOW =
  "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;";

/**
 * three's lights_fragment_begin with the hair's shadow on every directional light (when USE_HAIR_SHADOW), `headPos` the
 * GLSL for this fragment's head-space position (mm), kept as `hsHead`. `shadow`: a replacement for the line that applies
 * the shadow map (the skin's tinted penumbra).
 */
export function hairLitChunk(headPos: string, shadow?: string): string {
  let c = ShaderChunk.lights_fragment_begin;
  if (!c.includes(DIR_INFO) || (shadow && !c.includes(DIR_SHADOW))) {
    console.warn("[shader] three's light loop changed; hair shadows are off");
    return `vec3 hsHead = ${headPos};\n#include <lights_fragment_begin>`;
  }
  c = c.replace(DIR_INFO, `${DIR_INFO}\n#ifdef USE_HAIR_SHADOW\n\t\tdirectLight.color *= hairTransmit( hsHead, normalize( uViewToHead * directLight.direction ) );\n#endif`);
  if (shadow) c = c.replace(DIR_SHADOW, shadow);
  return `vec3 hsHead = ${headPos};\n${c}`;
}

/** The ambient part: after three's aomap_fragment, both indirect terms (the normal in view space). */
export const hairAmbientChunk = (normal: string) => /* glsl */ `
#ifdef USE_HAIR_SHADOW
  {
    float hairAo = hairAmbient(hsHead, normalize(uViewToHead * ${normal}));
    reflectedLight.indirectDiffuse *= hairAo;
    reflectedLight.indirectSpecular *= hairAo;
  }
#endif
`;

// --- which materials have it on --------------------------------------------------------------------------------------

const materials = new Set<MeshPhysicalMaterial | ShaderMaterial>();

/** USE_HAIR_SHADOW on the materials that take it, for the current tier (one recompile when it changes). */
export function applyHairShadowTier(material: MeshPhysicalMaterial | ShaderMaterial): void {
  materials.add(material);
  const on = tierSettings().hairShadow;
  if (on === (material.defines?.USE_HAIR_SHADOW !== undefined)) return;
  material.defines ??= {};
  if (on) material.defines.USE_HAIR_SHADOW = "";
  else delete material.defines.USE_HAIR_SHADOW;
  material.needsUpdate = true;
}
onTier(() => materials.forEach(applyHairShadowTier));

/** A material that is going away (a hair style swapped out): stop following the tier for it. */
export function releaseHairShadowTier(material: MeshPhysicalMaterial | ShaderMaterial): void {
  materials.delete(material);
}

/**
 * Hair shadows on a plain physical material (the clothes): its world position into head space, the light loop and the
 * ambient part patched. Keeps any onBeforeCompile it had.
 */
export function installHairShadow(material: MeshPhysicalMaterial, key: string): void {
  const before = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    Object.assign(shader.uniforms, hairShadowUniforms);
    shader.vertexShader =
      "varying vec3 vHsWorld;\n" +
      shader.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvHsWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader =
      "uniform mat4 uWorldToHead;\nvarying vec3 vHsWorld;\n" +
      HAIR_SHADOW_DECL +
      shader.fragmentShader
        .replace("#include <lights_fragment_begin>", hairLitChunk("(uWorldToHead * vec4(vHsWorld, 1.0)).xyz"))
        .replace("#include <aomap_fragment>", "#include <aomap_fragment>\n" + hairAmbientChunk("normal"));
  };
  material.customProgramCacheKey = () => key;
  material.onBeforeRender = (_r, _s, camera) => updateHairShadowView(camera);
  applyHairShadowTier(material);
}
