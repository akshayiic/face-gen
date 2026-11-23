/**
 * Fine skin texture (Style tab → Colouring → Realistic skin): the micro relief real skin has at the scale of a pore, a
 * fraction of a millimetre, which a render needs for light to break up on the skin as it does on a face. A tileable
 * "slope map" laid over the face from three sides (no UVs) and drawn by the skin shader (lib/skinShader.ts SKIN_MICRO):
 *   R, G  the surface slope along the texture's two axes (0.5 = flat, ±2 either side),
 *   B     the pore mask (the pits are a touch darker and hold no shine),
 *   A     a roughness variation (cell tops a little glossier than the furrows between them).
 *
 * Two sources:
 *  - built in: generated here, nothing downloaded. A network of pillow-shaped cells about 0.45 mm across (the furrow
 *    polygons of skin) with finer cells inside them and pores on about half of the cells. Measured on a studio skin
 *    pack's micro normal map (cells ~0.4 mm, mean slope ~0.26, rms ~0.30: MICRO.rmsSlope): the relief is scaled to that.
 *  - your own: any tileable normal map (a "micro normal" from a skin scan pack). It is read in the browser, scaled to
 *    1024 px, converted to the same slope map and kept in this tab (and the config file); never uploaded.
 *
 * Why a slope map and not heights: the shader bumps by screen-space derivatives (no tangent frames on a morphing head),
 * and a slope turns straight into the height change per screen pixel: slope · d(position)/dx. Mipmaps average slopes,
 * so the detail fades out with distance by itself instead of shimmering.
 */
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from "three";

import { skinRig } from "@/lib/skin";
import { skinUniforms } from "@/lib/skinShader";
import { onTier, tierSettings } from "@/lib/quality";
import { TEXTURE_KEYS } from "@/lib/storageKeys";

export const MICRO = {
  size: 512, // texels per side of the built-in tile
  tileMm: 7.2, // what it covers (≈ 16 cells of 0.45 mm)
  rmsSlope: 0.3, // the relief's rms slope at amount 1 (the measured pack: 0.30)
  slopeRange: 2, // stored slopes run ±this
  uploadSize: 1024, // an uploaded map is scaled to this
  uploadTileMm: 14, // …covering this much by default
};

// --- the built-in tile -------------------------------------------------------------------------------------------------

const h32 = (x: number, y: number, s: number): number => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483629);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Worley noise at u,v in cell units on an n×n torus: nearest and second-nearest distances, and the nearest cell's hash. */
function worley(u: number, v: number, n: number, seed: number): { f1: number; f2: number; id: number } {
  const cx = Math.floor(u), cy = Math.floor(v);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
      const px = gx + 0.15 + 0.7 * h32(wx, wy, seed), py = gy + 0.15 + 0.7 * h32(wx, wy, seed + 101);
      const d = Math.hypot(px - u, py - v);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = h32(wx, wy, seed + 202);
      } else if (d < f2) f2 = d;
    }
  return { f1, f2, id };
}

/**
 * The built-in slope map, `size`² RGBA bytes, tileable. Deterministic for a seed. `rms` is the relief's rms slope
 * actually reached (the tests check it is MICRO.rmsSlope).
 */
export function generateMicro(size = MICRO.size, seed = 7): { data: Uint8Array; rms: number } {
  const H = new Float32Array(size * size);
  const pore = new Float32Array(size * size);
  const tops = new Float32Array(size * size);
  const N1 = 16, N2 = 36, N3 = 11; // cells across: the furrow network, the finer cells in them, the pores
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const a = worley(u * N1, v * N1, N1, seed);
      // pillows: flat edges where two cells meet, a dome inside
      const h1 = smooth(0, 0.26, a.f2 - a.f1) * (0.62 + 0.38 * (1 - Math.min(1, a.f1 / 0.62) ** 2));
      const b = worley(u * N2, v * N2, N2, seed + 17);
      const h2 = smooth(0, 0.3, b.f2 - b.f1);
      // pores: a pit at the centre of about half of the cells of a coarser grid
      const c = worley(u * N3, v * N3, N3, seed + 41);
      const p = c.id < 0.52 ? Math.exp(-((c.f1 / 0.14) ** 2)) : 0;
      const i = y * size + x;
      H[i] = 0.62 * h1 + 0.26 * h2 - 0.6 * p + 0.03 * h32(x, y, seed + 7);
      pore[i] = p;
      tops[i] = h1;
    }
  // slopes by central differences on the torus, scaled so their rms is the measured one
  const gx = new Float32Array(size * size), gy = new Float32Array(size * size);
  let s2 = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = (H[y * size + ((x + 1) % size)] - H[y * size + ((x - 1 + size) % size)]) * 0.5;
      const dy = (H[((y + 1) % size) * size + x] - H[((y - 1 + size) % size) * size + x]) * 0.5;
      gx[i] = dx;
      gy[i] = dy;
      s2 += dx * dx + dy * dy;
    }
  const k = MICRO.rmsSlope / Math.sqrt(s2 / (size * size));
  const out = new Uint8Array(size * size * 4);
  const enc = (g: number) => Math.round(255 * Math.min(1, Math.max(0, 0.5 + g / (2 * MICRO.slopeRange))));
  let r2 = 0;
  for (let i = 0; i < size * size; i++) {
    const sx = Math.min(MICRO.slopeRange, Math.max(-MICRO.slopeRange, gx[i] * k)), sy = Math.min(MICRO.slopeRange, Math.max(-MICRO.slopeRange, gy[i] * k));
    r2 += sx * sx + sy * sy;
    out[i * 4] = enc(sx);
    out[i * 4 + 1] = enc(sy);
    out[i * 4 + 2] = Math.round(255 * Math.min(1, pore[i] * 1.2));
    out[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - 0.35 * (tops[i] - 0.6) + 0.12 * (h32(i % size, (i / size) | 0, seed + 9) - 0.5))));
  }
  return { data: out, rms: Math.sqrt(r2 / (size * size)) };
}

/**
 * An uploaded normal map (RGBA bytes, `size`²) as a slope map. Normals (nx, ny, nz) belong to a surface with slope
 * (−nx/nz, −ny/nz); the map's green is taken as pointing up the image (OpenGL), so the slope along the image's rows
 * (down) is +ny/nz. `invert` flips the relief (a DirectX map, or one that reads inside out).
 */
export function slopeMapFromNormal(rgba: Uint8ClampedArray | Uint8Array, size: number, invert = false): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const s = invert ? -1 : 1;
  const enc = (g: number) => Math.round(255 * Math.min(1, Math.max(0, 0.5 + g / (2 * MICRO.slopeRange))));
  for (let i = 0; i < size * size; i++) {
    const nx = rgba[i * 4] / 127.5 - 1, ny = rgba[i * 4 + 1] / 127.5 - 1;
    const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
    out[i * 4] = enc((s * -nx) / nz);
    out[i * 4 + 1] = enc((s * ny) / nz);
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = 128;
  }
  return out;
}

// --- state ---------------------------------------------------------------------------------------------------------------

export type MicroSnapshot = { source: "builtin" | "upload"; name: string; busy: boolean; error: string; preview: string; tileMm: number; invert: boolean };
const state = { name: "", canvas: null as HTMLCanvasElement | null, tileMm: MICRO.uploadTileMm, invert: false, busy: false, error: "", built: null as DataTexture | null, upload: null as DataTexture | null };

const thumbs = new WeakMap<HTMLCanvasElement, string>();
function snapOf(): MicroSnapshot {
  let preview = "";
  if (state.canvas) {
    preview = thumbs.get(state.canvas) ?? "";
    if (!preview) thumbs.set(state.canvas, (preview = scaled(state.canvas, 96).toDataURL("image/jpeg", 0.8)));
  }
  return { source: state.upload ? "upload" : "builtin", name: state.name, busy: state.busy, error: state.error, preview, tileMm: state.tileMm, invert: state.invert };
}
const EMPTY: MicroSnapshot = { source: "builtin", name: "", busy: false, error: "", preview: "", tileMm: MICRO.uploadTileMm, invert: false };
let snapshot: MicroSnapshot = EMPTY;
export const MICRO_SERVER_SNAPSHOT = EMPTY;
export const microSnapshot = () => snapshot;
const listeners = new Set<() => void>();
export function onMicroChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  snapshot = snapOf();
  applyMicro();
  for (const fn of listeners) fn();
}

function toTexture(data: Uint8Array, size: number, name: string): DataTexture {
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace; // data, not colour
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/**
 * Put the fine texture on the skin: the texture (the built-in one is made the first time it is wanted), its tile size
 * and the shader's define, once the amount is above zero (and kept on after, a slider passing through 0 shouldn't
 * recompile the skin). Medium and high tiers only (lib/quality.ts detailNormals).
 */
export function applyMicro(): void {
  const u = skinUniforms;
  const wanted = u.uMicro.value > 0 || !!state.upload;
  if (wanted && tierSettings().detailNormals) state.built ??= toTexture(generateMicro().data, MICRO.size, "skin_micro");
  const tex = state.upload ?? state.built;
  u.uSkinMicro.value = tex;
  u.uMicroTile.value = state.upload ? state.tileMm : MICRO.tileMm;
  const m = skinRig.material;
  if (!m) return;
  const on = !!tex && tierSettings().detailNormals && (u.uMicro.value > 0 || m.defines?.SKIN_MICRO !== undefined);
  if (on === (m.defines?.SKIN_MICRO !== undefined)) return;
  m.defines ??= {};
  if (on) m.defines.SKIN_MICRO = "";
  else delete m.defines.SKIN_MICRO;
  m.needsUpdate = true;
}
if (typeof window !== "undefined") onTier(applyMicro);

// --- uploading -----------------------------------------------------------------------------------------------------------

export const MAX_MICRO_BYTES = 40 * 1024 * 1024;

export async function uploadMicro(file: File): Promise<void> {
  state.error = "";
  if (!file.type.startsWith("image/")) {
    state.error = "That isn't an image. Use a PNG, JPEG or WebP.";
    return notify();
  }
  if (file.size > MAX_MICRO_BYTES) {
    state.error = "That image is over 40 MB.";
    return notify();
  }
  state.busy = true;
  notify();
  const url = URL.createObjectURL(file);
  try {
    takeImage(await loadImage(url), file.name);
    store();
  } catch {
    state.error = "That image couldn't be read.";
  } finally {
    URL.revokeObjectURL(url);
    state.busy = false;
    notify();
  }
}

export function removeMicro(): void {
  state.upload?.dispose();
  state.upload = null;
  state.canvas = null;
  state.name = "";
  state.error = "";
  try {
    window.sessionStorage.removeItem(TEXTURE_KEYS.skinMicro);
  } catch {
    /* private mode */
  }
  notify();
}

export function setMicroTile(mm: number): void {
  state.tileMm = Number.isFinite(mm) ? Math.min(40, Math.max(2, mm)) : MICRO.uploadTileMm;
  saveSettings();
  notify();
}

export function setMicroInvert(invert: boolean): void {
  state.invert = invert;
  saveSettings();
  if (state.canvas) rebuildUpload();
  notify();
}

function rebuildUpload(): void {
  if (!state.canvas) return;
  const size = state.canvas.width;
  const px = state.canvas.getContext("2d")!.getImageData(0, 0, size, size).data;
  state.upload?.dispose();
  state.upload = toTexture(slopeMapFromNormal(px, size, state.invert), size, "skin_micro_upload");
}

function takeImage(img: CanvasImageSource & { width: number; height: number }, name: string): void {
  state.canvas = scaled(img, MICRO.uploadSize, true);
  state.name = name.slice(0, 120);
  rebuildUpload();
}

/** The uploaded map as a JPEG data URL (stored size) for the config file, or null. */
export function microDataUrl(): string | null {
  return state.canvas ? state.canvas.toDataURL("image/jpeg", 0.95) : null;
}

/** For the config file: the tile size and the relief direction. */
export const microSettings = () => ({ tile: state.tileMm, invert: state.invert });

function scaled(img: CanvasImageSource & { width: number; height: number }, max: number, square = false): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  if (square) canvas.width = canvas.height = max; // a tile: squared (a micro normal map is square anyway)
  else {
    const k = Math.min(1, max / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * k));
    canvas.height = Math.max(1, Math.round(img.height * k));
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });

function saveSettings(): void {
  try {
    window.sessionStorage.setItem(`${TEXTURE_KEYS.skinMicro}:settings`, JSON.stringify(microSettings()));
  } catch {
    /* private mode */
  }
}

function store(): void {
  try {
    window.sessionStorage.setItem(TEXTURE_KEYS.skinMicro, JSON.stringify({ name: state.name, url: microDataUrl() }));
  } catch {
    try {
      window.sessionStorage.removeItem(TEXTURE_KEYS.skinMicro); // too big for this tab: it stays until a reload
    } catch {
      /* private mode */
    }
  }
}

/** A stored or file value, checked. */
export function sanitizeMicroSettings(raw: unknown): { tile: number; invert: boolean } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    tile: typeof r.tile === "number" && Number.isFinite(r.tile) ? Math.min(40, Math.max(2, r.tile)) : MICRO.uploadTileMm,
    invert: r.invert === true,
  };
}

// Restore this tab's uploaded map once, in the browser only.
if (typeof window !== "undefined") {
  try {
    const settings = window.sessionStorage.getItem(`${TEXTURE_KEYS.skinMicro}:settings`);
    if (settings) {
      const s = sanitizeMicroSettings(JSON.parse(settings));
      state.tileMm = s.tile;
      state.invert = s.invert;
    }
    const raw = window.sessionStorage.getItem(TEXTURE_KEYS.skinMicro);
    if (raw) {
      const { name, url } = JSON.parse(raw) as { name?: unknown; url?: unknown };
      if (typeof url === "string" && url.startsWith("data:image/"))
        void loadImage(url)
          .then((img) => {
            takeImage(img, typeof name === "string" ? name : "micro normal");
            notify();
          })
          .catch(() => {});
    }
  } catch {
    /* private mode or malformed: nothing to restore */
  }
  snapshot = snapOf();
}
