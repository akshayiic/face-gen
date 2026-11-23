/**
 * A character as data: character.json in the export, and what a rebuild link carries (/#c=<base64url JSON>).
 * Pure: no app state here, so the link can be opened before anything else loads (lib/export/openLink.ts) and the
 * round trip is unit-tested. lib/export/character.ts reads the live character into this shape.
 *
 * Values are as the app stores them: `shape` is morph target → slider value (only what differs from the default),
 * `pose` is degrees, the rest are ids from the app's own lists. Opening a link writes it into the same sessionStorage
 * keys a reload reads, so the app's usual restore code checks every value (unknown ids and targets are ignored,
 * numbers clamped to their ranges).
 */
import { STORAGE_KEYS } from "@/lib/storageKeys";

export const CHARACTER_FORMAT = "face-to-voice/character";
export const CHARACTER_VERSION = 1;

export interface CharacterFile {
  format: typeof CHARACTER_FORMAT;
  version: number;
  sliders: number; // data/sliders.json version the shape was made with
  shape: Record<string, number>;
  emotion: string;
  intensity: number;
  pose: Record<string, number>; // headYaw, headPitch, headRoll, gazeYaw, gazePitch (degrees)
  /** style and colour, and how it is worn (lib/hair.ts HairWear; missing in older links: as filed) */
  hair: { style: string; colour: string; tie?: string; framing?: boolean; volume?: number; faceStrand?: number; frizz?: number; shine?: number; density?: number; thickness?: number };
  addons: Record<string, string>; // eyebrows, eyelashes, facialHair, glasses, facialHairColour
  skin: string;
  eyes: string;
  /** lib/clothes.ts ClothesState; missing in links made before clothes (no clothes). */
  clothes?: Record<string, unknown>;
  /** lib/skinDetails.ts SkinDetails (blush, freckles, moles, pores); missing in older links (none). */
  skinDetails?: Record<string, unknown>;
  /** lib/marks.ts: scars and marks on the rest skin; missing in older links (none). */
  marks?: unknown[];
  /** lib/sculpt.ts FineShape (local feature sliders, asymmetry); missing in older links (none). The sculpt itself is
   *  far too big for a link: only the config file carries it. */
  fineShape?: Record<string, unknown>;
}

/** Longest link payload we'll read: a full random face is ~1.5 KB, so anything far larger isn't ours. */
const MAX_CODE = 16_000;

export function encodeCharacter(c: CharacterFile): string {
  const bytes = new TextEncoder().encode(JSON.stringify(c));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The character in a link code, or null if it isn't one (wrong format, a newer version, or malformed). */
export function decodeCharacter(code: string): CharacterFile | null {
  if (!code || code.length > MAX_CODE || !/^[A-Za-z0-9_-]+$/.test(code)) return null;
  try {
    const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
    return checkCharacter(JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))));
  } catch {
    return null;
  }
}

/** A parsed character (a link's, character.json's or a config file's), or null if it isn't one we can read. */
export function checkCharacter(raw: unknown): CharacterFile | null {
  const c = raw as CharacterFile | null;
  if (!c || typeof c !== "object" || c.format !== CHARACTER_FORMAT || typeof c.version !== "number" || c.version > CHARACTER_VERSION) return null;
  const isObject = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObject(c.shape) || !isObject(c.pose) || !isObject(c.hair) || !isObject(c.addons)) return null;
  return c;
}

/**
 * The sessionStorage entries a reload reads (shapes as in lib/faceSession.ts, pose.ts, hair.ts, addons.ts, skin.ts and
 * eyes.ts). Each module validates its own entry when it restores.
 */
export function storageEntries(c: CharacterFile): Record<string, string> {
  return {
    [STORAGE_KEYS.face]: JSON.stringify({ shape: c.shape, emotion: c.emotion, intensity: c.intensity }),
    [STORAGE_KEYS.pose]: JSON.stringify(c.pose),
    [STORAGE_KEYS.hair]: JSON.stringify(c.hair),
    [STORAGE_KEYS.addons]: JSON.stringify(c.addons),
    [STORAGE_KEYS.skin]: String(c.skin),
    [STORAGE_KEYS.eyes]: String(c.eyes),
    [STORAGE_KEYS.clothes]: JSON.stringify(c.clothes && typeof c.clothes === "object" ? c.clothes : { style: "none" }),
    [STORAGE_KEYS.skinDetails]: JSON.stringify(c.skinDetails && typeof c.skinDetails === "object" ? c.skinDetails : {}),
    [STORAGE_KEYS.marks]: JSON.stringify(Array.isArray(c.marks) ? c.marks : []),
    [STORAGE_KEYS.fineShape]: JSON.stringify(c.fineShape && typeof c.fineShape === "object" ? c.fineShape : {}),
  };
}
