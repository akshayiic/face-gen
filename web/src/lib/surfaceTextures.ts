/**
 * Uploaded textures: a skin texture laid over the head and a hair texture laid along the strands. Everything stays in
 * the browser: the image is read, scaled down and kept in this tab (sessionStorage, as a JPEG, when it fits); it is
 * never uploaded and never part of a rebuild link. It shows in the 3D view, in the voice step's screenshot and in the
 * exported model (the skin's colour is baked from its shader; strand colours are sampled from the same pixels).
 *
 * Skin, two ways (lib/skinShader.ts USE_SKIN_TEX):
 *  - "uv": a texture painted in the head's own UV layout (download it with "Download skin map", paint, upload);
 *  - "tile": a photo of a patch of skin, repeated over the head from three sides, `scale` mm per repeat.
 *  `keepTone`: use only the texture's variation round its own average colour, so the chosen tone stays (and the
 *  redness, lips and shadows the shader adds); off, the texture's own colours replace the tone.
 *
 * Hair (lib/groomShader.ts): an image of hair with the strands running top (root) to bottom (tip). Each strand takes
 * one column of it, chosen at random, along its length: the colours, streaks and highlights of the photo spread over
 * the style. `amount` blends it with the chosen hair colour.
 */
import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

import { skinRig } from "@/lib/skin";
import { skinUniforms } from "@/lib/skinShader";
import { TEXTURE_KEYS } from "@/lib/storageKeys";

export type SkinTextureMode = "uv" | "tile";
export type SkinTextureSettings = { mode: SkinTextureMode; amount: number; scale: number; keepTone: boolean };
export type HairTextureSettings = { amount: number };

export const SKIN_TEXTURE_DEFAULTS: SkinTextureSettings = { mode: "tile", amount: 0.8, scale: 60, keepTone: true };
export const HAIR_TEXTURE_DEFAULTS: HairTextureSettings = { amount: 0.85 };
/** Biggest side kept on the GPU, and stored (sessionStorage holds ~5 MB per site). */
const SIZE = { skin: 2048, hair: 1024, stored: 1024, hairPixels: 256, jpeg: 0.88 };
/** Largest file read at all. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type Slot<S> = { name: string; settings: S; canvas: HTMLCanvasElement | null; texture: CanvasTexture | null; busy: boolean; error: string };

const skin: Slot<SkinTextureSettings> & { mean: [number, number, number] } = {
  name: "", settings: { ...SKIN_TEXTURE_DEFAULTS }, canvas: null, texture: null, busy: false, error: "", mean: [0.5, 0.5, 0.5],
};
const hair: Slot<HairTextureSettings> & { pixels: ImageData | null } = {
  name: "", settings: { ...HAIR_TEXTURE_DEFAULTS }, canvas: null, texture: null, busy: false, error: "", pixels: null,
};

// --- store (useSyncExternalStore in the controls) ---

export type TextureSnapshot<S> = { on: boolean; name: string; busy: boolean; error: string; preview: string } & S;
const snap = <S,>(s: Slot<S>): TextureSnapshot<S> => ({
  ...s.settings, on: !!s.texture, name: s.name, busy: s.busy, error: s.error, preview: s.canvas ? thumbnail(s.canvas) : "",
});
let skinSnap = snap(skin), hairSnap = snap(hair);
export const SKIN_TEXTURE_SERVER_SNAPSHOT: TextureSnapshot<SkinTextureSettings> = { ...SKIN_TEXTURE_DEFAULTS, on: false, name: "", busy: false, error: "", preview: "" };
export const HAIR_TEXTURE_SERVER_SNAPSHOT: TextureSnapshot<HairTextureSettings> = { ...HAIR_TEXTURE_DEFAULTS, on: false, name: "", busy: false, error: "", preview: "" };
export const skinTextureSnapshot = () => skinSnap;
export const hairTextureSnapshot = () => hairSnap;

const listeners = new Set<() => void>();
/** Fires on any change to either texture (lib/hair.ts re-tints its strands on it). */
export function onTextureChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(which: "skin" | "hair"): void {
  if (which === "skin") {
    skinSnap = snap(skin);
    applySkinTexture();
  } else hairSnap = snap(hair);
  for (const fn of listeners) fn();
}

// --- skin ------------------------------------------------------------------------------------------------------------

/** Put the skin texture on the skin material (no-op for the material until the head has loaded). */
export function applySkinTexture(): void {
  const u = skinUniforms;
  const s = skin.settings;
  u.uSkinTex.value = skin.texture;
  u.uSkinTexAmt.value = s.amount;
  u.uSkinTexMode.value = s.mode === "tile" ? 1 : 0;
  u.uSkinTexTile.value = s.scale;
  u.uSkinTexMatch.value = s.keepTone ? 1 : 0;
  u.uSkinTexMean.value.set(...skin.mean);
  const m = skinRig.material;
  if (!m) return;
  const on = !!skin.texture;
  if (on === (m.defines?.USE_SKIN_TEX !== undefined)) return;
  if (on) m.defines = { ...m.defines, USE_SKIN_TEX: "" };
  else delete m.defines!.USE_SKIN_TEX;
  m.needsUpdate = true;
}

export function setSkinTextureSettings(patch: Partial<SkinTextureSettings>): void {
  skin.settings = sanitizeSkin({ ...skin.settings, ...patch });
  saveSettings(TEXTURE_KEYS.skin, skin.settings);
  notify("skin");
}

export async function uploadSkinTexture(file: File): Promise<void> {
  await upload(skin, file, "skin");
}

export function removeSkinTexture(): void {
  drop(skin, TEXTURE_KEYS.skin);
  notify("skin");
}

// --- hair ------------------------------------------------------------------------------------------------------------

/** What the hair's strand shader reads (lib/hair.ts puts it on the style on the head). */
export function hairTextureUniforms(): { texture: Texture | null; amount: number } {
  return { texture: hair.texture, amount: hair.texture ? hair.settings.amount : 0 };
}

/** The hair texture's pixels (sRGB bytes, small) for the model export's strand colours, and how much it counts. */
export function hairTexturePixels(): { image: ImageData; amount: number } | null {
  return hair.pixels && hair.texture ? { image: hair.pixels, amount: hair.settings.amount } : null;
}

export function setHairTextureSettings(patch: Partial<HairTextureSettings>): void {
  hair.settings = sanitizeHair({ ...hair.settings, ...patch });
  saveSettings(TEXTURE_KEYS.hair, hair.settings);
  notify("hair");
}

export async function uploadHairTexture(file: File): Promise<void> {
  await upload(hair, file, "hair");
}

export function removeHairTexture(): void {
  drop(hair, TEXTURE_KEYS.hair);
  hair.pixels = null;
  notify("hair");
}

// --- shared ----------------------------------------------------------------------------------------------------------

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function sanitizeSkin(raw: unknown): SkinTextureSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = SKIN_TEXTURE_DEFAULTS;
  return {
    mode: r.mode === "uv" || r.mode === "tile" ? r.mode : d.mode,
    amount: clamp(r.amount, 0, 1, d.amount),
    scale: clamp(r.scale, 15, 250, d.scale),
    keepTone: typeof r.keepTone === "boolean" ? r.keepTone : d.keepTone,
  };
}

export function sanitizeHair(raw: unknown): HairTextureSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { amount: clamp(r.amount, 0, 1, HAIR_TEXTURE_DEFAULTS.amount) };
}

async function upload(slot: typeof skin | typeof hair, file: File, which: "skin" | "hair"): Promise<void> {
  slot.error = "";
  if (!file.type.startsWith("image/")) {
    slot.error = "That isn't an image. Use a JPEG, PNG or WebP.";
    return notify(which);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    slot.error = "That image is over 25 MB.";
    return notify(which);
  }
  slot.busy = true;
  notify(which);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    takeImage(slot, which, img, file.name);
    store(which === "skin" ? TEXTURE_KEYS.skin : TEXTURE_KEYS.hair, slot.canvas!, file.name);
  } catch {
    slot.error = "That image couldn't be read.";
  } finally {
    URL.revokeObjectURL(url);
    slot.busy = false;
    notify(which);
  }
}

/** Take a decoded image into a slot: scaled down, as a texture, with what the shader and the export need from it. */
function takeImage(slot: typeof skin | typeof hair, which: "skin" | "hair", img: CanvasImageSource & { width: number; height: number }, name: string): void {
  const canvas = scaled(img, which === "skin" ? SIZE.skin : SIZE.hair);
  slot.texture?.dispose();
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // the GPU decodes it to linear as the shaders expect
  texture.flipY = false; // glTF's convention, like the head's own maps: the image's top row is v = 0 (and a strand's root)
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.name = `${which}_texture`;
  slot.canvas = canvas;
  slot.texture = texture;
  slot.name = name;
  if (which === "skin") skin.mean = meanLinear(canvas);
  else hair.pixels = pixels(canvas, SIZE.hairPixels);
}

function drop(slot: typeof skin | typeof hair, key: string): void {
  slot.texture?.dispose();
  slot.texture = null;
  slot.canvas = null;
  slot.name = "";
  slot.error = "";
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* private mode */
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

function pixels(canvas: HTMLCanvasElement, max: number): ImageData {
  const small = scaled(canvas, max);
  return small.getContext("2d")!.getImageData(0, 0, small.width, small.height);
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** The image's average colour in linear RGB (what "keep tone" divides by). */
function meanLinear(canvas: HTMLCanvasElement): [number, number, number] {
  const { data } = pixels(canvas, 64);
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    for (let c = 0; c < 3; c++) sum[c] += toLinear(data[i + c] / 255);
    n++;
  }
  return n ? [sum[0] / n, sum[1] / n, sum[2] / n] : [0.5, 0.5, 0.5];
}

/** A small preview for the panel (a data URL; made once per image). */
const thumbs = new WeakMap<HTMLCanvasElement, string>();
function thumbnail(canvas: HTMLCanvasElement): string {
  let t = thumbs.get(canvas);
  if (!t) thumbs.set(canvas, (t = scaled(canvas, 96).toDataURL("image/jpeg", 0.8)));
  return t;
}

function saveSettings(key: string, settings: object): void {
  try {
    window.sessionStorage.setItem(`${key}:settings`, JSON.stringify(settings));
  } catch {
    /* private mode */
  }
}

/** Keep the image for this tab (a reload keeps it); a full storage just means it isn't kept. */
function store(key: string, canvas: HTMLCanvasElement, name: string): void {
  try {
    const url = scaled(canvas, SIZE.stored).toDataURL("image/jpeg", SIZE.jpeg);
    window.sessionStorage.setItem(key, JSON.stringify({ name, url }));
  } catch {
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      /* private mode */
    }
  }
}

/** The texture in a slot now as a JPEG data URL (stored size), or null when there is none: Save config (lib/export/config.ts). */
export function textureDataUrl(which: "skin" | "hair"): string | null {
  const slot = which === "skin" ? skin : hair;
  return slot.canvas ? scaled(slot.canvas, SIZE.stored).toDataURL("image/jpeg", SIZE.jpeg) : null;
}

// Restore this tab's textures once, in the browser only.
if (typeof window !== "undefined") {
  const restore = (which: "skin" | "hair") => {
    const slot = which === "skin" ? skin : hair;
    const key = which === "skin" ? TEXTURE_KEYS.skin : TEXTURE_KEYS.hair;
    try {
      const settings = window.sessionStorage.getItem(`${key}:settings`);
      if (settings) {
        const parsed = JSON.parse(settings) as unknown;
        if (which === "skin") skin.settings = sanitizeSkin(parsed);
        else hair.settings = sanitizeHair(parsed);
      }
      const raw = window.sessionStorage.getItem(key);
      if (!raw) return;
      const { name, url } = JSON.parse(raw) as { name?: unknown; url?: unknown };
      if (typeof url !== "string" || !url.startsWith("data:image/")) return;
      void loadImage(url)
        .then((img) => {
          takeImage(slot, which, img, typeof name === "string" ? name.slice(0, 120) : "texture");
          notify(which);
        })
        .catch(() => {});
    } catch {
      /* private mode or malformed: nothing to restore */
    }
  };
  restore("skin");
  restore("hair");
  skinSnap = snap(skin);
  hairSnap = snap(hair);
}
