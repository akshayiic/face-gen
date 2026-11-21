/**
 * Scanned skin maps (Style tab → Colouring): the normal, roughness and cavity maps of a scanned face, in THIS head's
 * UV layout (pipeline/tools/bake_scan_to_head.py transfers a scan's maps onto it). The colour map is the skin texture's
 * "painted map" mode (lib/surfaceTextures.ts). Each has a strength; lib/skinShader.ts draws them (USE_SKIN_NORMAL_MAP,
 * USE_SKIN_ROUGH_MAP, USE_SKIN_CAVITY_MAP). They're data, not colour: read linear, never sRGB-decoded.
 *
 * Like the other uploads: read in the browser, scaled down, kept in this tab (sessionStorage, as a JPEG) and in the config
 * file; never uploaded, never in a rebuild link.
 */
import { CanvasTexture, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping } from "three";

import { skinRig } from "@/lib/skin";
import { skinUniforms } from "@/lib/skinShader";
import { TEXTURE_KEYS } from "@/lib/storageKeys";

export type ScanSlot = "skinNormal" | "skinRough" | "skinCavity";
export const SCAN_SLOTS: { id: ScanSlot; title: string; hint: string; define: string }[] = [
  { id: "skinNormal", title: "Normal map", hint: "Pores and fine lines from a scan (tangent space, this head's UV layout).", define: "USE_SKIN_NORMAL_MAP" },
  { id: "skinRough", title: "Roughness map", hint: "Where the skin is oily or matte (grey: light = matte).", define: "USE_SKIN_ROUGH_MAP" },
  { id: "skinCavity", title: "Cavity map", hint: "Pores and creases in black on white: darker and less shiny in them.", define: "USE_SKIN_CAVITY_MAP" },
];
const UNIFORMS: Record<ScanSlot, { tex: "uSkinNormalMap" | "uSkinRoughMap" | "uSkinCavityMap"; amt: "uSkinNormalAmt" | "uSkinRoughAmt" | "uSkinCavityAmt" }> = {
  skinNormal: { tex: "uSkinNormalMap", amt: "uSkinNormalAmt" },
  skinRough: { tex: "uSkinRoughMap", amt: "uSkinRoughAmt" },
  skinCavity: { tex: "uSkinCavityMap", amt: "uSkinCavityAmt" },
};
const SIZE = { gpu: 4096, stored: 1024, jpeg: 0.92 };
export const SCAN_DEFAULT_AMOUNT = 1;
const MAX_BYTES = 40 * 1024 * 1024;

type State = { name: string; amount: number; canvas: HTMLCanvasElement | null; texture: CanvasTexture | null; busy: boolean; error: string };
const state: Record<ScanSlot, State> = {
  skinNormal: { name: "", amount: 1, canvas: null, texture: null, busy: false, error: "" },
  skinRough: { name: "", amount: 1, canvas: null, texture: null, busy: false, error: "" },
  skinCavity: { name: "", amount: 1, canvas: null, texture: null, busy: false, error: "" },
};

export type ScanSnapshot = { on: boolean; name: string; amount: number; busy: boolean; error: string; preview: string };
const thumbs = new WeakMap<HTMLCanvasElement, string>();
const snapOf = (s: State): ScanSnapshot => {
  let preview = "";
  if (s.canvas) {
    preview = thumbs.get(s.canvas) ?? "";
    if (!preview) thumbs.set(s.canvas, (preview = scaled(s.canvas, 96).toDataURL("image/jpeg", 0.8)));
  }
  return { on: !!s.texture, name: s.name, amount: s.amount, busy: s.busy, error: s.error, preview };
};
const empty: ScanSnapshot = { on: false, name: "", amount: SCAN_DEFAULT_AMOUNT, busy: false, error: "", preview: "" };
let snapshot: Record<ScanSlot, ScanSnapshot> = { skinNormal: empty, skinRough: empty, skinCavity: empty };
export const SCAN_SERVER_SNAPSHOT = snapshot;
export const scanMapsSnapshot = () => snapshot;
const listeners = new Set<() => void>();
export function onScanMapsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  snapshot = { skinNormal: snapOf(state.skinNormal), skinRough: snapOf(state.skinRough), skinCavity: snapOf(state.skinCavity) };
  applyScanMaps();
  for (const fn of listeners) fn();
}

/** The maps onto the skin material (Head.tsx calls this once the skin is there). */
export function applyScanMaps(): void {
  const m = skinRig.material;
  let changed = false;
  for (const slot of SCAN_SLOTS) {
    const s = state[slot.id];
    const u = UNIFORMS[slot.id];
    skinUniforms[u.tex].value = s.texture;
    skinUniforms[u.amt].value = s.amount;
    if (!m) continue;
    const on = !!s.texture;
    if (on === (m.defines?.[slot.define] !== undefined)) continue;
    if (on) m.defines = { ...m.defines, [slot.define]: "" };
    else delete m.defines![slot.define];
    changed = true;
  }
  if (m && changed) m.needsUpdate = true;
}

export function setScanAmount(slot: ScanSlot, amount: number): void {
  state[slot].amount = Number.isFinite(amount) ? Math.min(2, Math.max(0, amount)) : 1;
  try {
    window.sessionStorage.setItem(`${TEXTURE_KEYS[slot]}:settings`, JSON.stringify({ amount: state[slot].amount }));
  } catch {
    /* private mode */
  }
  notify();
}

export async function uploadScanMap(slot: ScanSlot, file: File): Promise<void> {
  const s = state[slot];
  s.error = "";
  if (!file.type.startsWith("image/")) {
    s.error = "That isn't an image. Use a PNG, JPEG or WebP.";
    return notify();
  }
  if (file.size > MAX_BYTES) {
    s.error = "That image is over 40 MB.";
    return notify();
  }
  s.busy = true;
  notify();
  const url = URL.createObjectURL(file);
  try {
    take(slot, await loadImage(url), file.name);
    store(slot);
  } catch {
    s.error = "That image couldn't be read.";
  } finally {
    URL.revokeObjectURL(url);
    s.busy = false;
    notify();
  }
}

export function removeScanMap(slot: ScanSlot): void {
  const s = state[slot];
  s.texture?.dispose();
  s.texture = null;
  s.canvas = null;
  s.name = "";
  s.error = "";
  try {
    window.sessionStorage.removeItem(TEXTURE_KEYS[slot]);
  } catch {
    /* private mode */
  }
  notify();
}

/** A map now as a JPEG data URL (stored size) for the config file, or null. */
export function scanMapDataUrl(slot: ScanSlot): string | null {
  const c = state[slot].canvas;
  return c ? scaled(c, SIZE.stored).toDataURL("image/jpeg", SIZE.jpeg) : null;
}

function take(slot: ScanSlot, img: CanvasImageSource & { width: number; height: number }, name: string): void {
  const s = state[slot];
  const canvas = scaled(img, SIZE.gpu);
  s.texture?.dispose();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace; // data: used as stored
  texture.flipY = false; // glTF's convention, like the head's own maps
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  texture.name = slot;
  s.canvas = canvas;
  s.texture = texture;
  s.name = name.slice(0, 120);
}

function store(slot: ScanSlot): void {
  const key = TEXTURE_KEYS[slot];
  try {
    window.sessionStorage.setItem(key, JSON.stringify({ name: state[slot].name, url: scanMapDataUrl(slot) }));
  } catch {
    try {
      window.sessionStorage.removeItem(key); // too big for this tab: it stays until a reload
    } catch {
      /* private mode */
    }
  }
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = src;
  });

function scaled(img: CanvasImageSource & { width: number; height: number }, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * k));
  canvas.height = Math.max(1, Math.round(img.height * k));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Restore this tab's maps once, in the browser only.
if (typeof window !== "undefined") {
  for (const { id } of SCAN_SLOTS) {
    try {
      const settings = window.sessionStorage.getItem(`${TEXTURE_KEYS[id]}:settings`);
      if (settings) {
        const a = (JSON.parse(settings) as { amount?: unknown }).amount;
        if (typeof a === "number" && Number.isFinite(a)) state[id].amount = Math.min(2, Math.max(0, a));
      }
      const raw = window.sessionStorage.getItem(TEXTURE_KEYS[id]);
      if (!raw) continue;
      const { name, url } = JSON.parse(raw) as { name?: unknown; url?: unknown };
      if (typeof url !== "string" || !url.startsWith("data:image/")) continue;
      void loadImage(url)
        .then((img) => {
          take(id, img, typeof name === "string" ? name : id);
          notify();
        })
        .catch(() => {});
    } catch {
      /* private mode or malformed */
    }
  }
  snapshot = { skinNormal: snapOf(state.skinNormal), skinRough: snapOf(state.skinRough), skinCavity: snapOf(state.skinCavity) };
}
