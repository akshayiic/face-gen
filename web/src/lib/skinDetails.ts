/**
 * Skin details (Style tab → Colouring): blush, freckles, moles, how deep the pores read, how dark it is under the
 * eyes, how uneven the tone is and how much the veins show; wrinkles at any age and how much expressions crease the
 * skin (lib/age.ts); and weathering: sun damage, sun spots, broken capillaries, oiliness, sweat and grime.
 * Plain module state pushed into the skin shader's uniforms (lib/skinShader.ts), kept in sessionStorage like the
 * tone, and carried by the rebuild link. The baked colour in the .glb export picks all of it up (it draws the skin's
 * own shader into its UVs).
 *
 * Moles are spots on the rest skin (template millimetres, the shader's vRest), so they move with every face the
 * sliders make. `moleSeed` picks where: the same seed puts them in the same places on any face, "Shuffle" rolls a new
 * one. Places are drawn from the face, ears and neck, never on the lips, the eyes or inside the nostrils.
 */
import { setWrinkleSettings } from "@/lib/age";
import { MAX_MOLES, skinUniforms } from "@/lib/skinShader";
import { skinSurface } from "@/lib/skinSurface";
import { STORAGE_KEYS } from "@/lib/storageKeys";

export type SkinDetails = {
  /** 0..1 cheek flush */
  blush: number;
  /** 0..1 how many freckles (and how dark) */
  freckles: number;
  /** 0..MAX_MOLES */
  moles: number;
  /** 0..1: small … large */
  moleSize: number;
  moleSeed: number;
  /** 0..2: 1 is the shader's own pore depth */
  pores: number;
  /** 0..2: 1 is the shader's own shadow under the eyes */
  underEye: number;
  /** 0..2: how uneven the tone is (patches of browner and redder skin); 0 = one flat colour */
  variation: number;
  /** 0..1: veins under thin skin (temples, under the eyes, neck) */
  veins: number;
  /** 0..1.5: wrinkles at any age, as if this much older on the Age slider */
  wrinkles: number;
  /** 0..2: how deep expressions crease the skin (frown lines, crow's feet …); 1 is natural */
  expression: number;
  /** 0..1 each: weathering */
  sun: number;
  sunSpots: number;
  capillaries: number;
  /** 0..2: 1 is the skin's own T-zone shine */
  oiliness: number;
  sweat: number;
  grime: number;
};

export const SKIN_DETAILS_DEFAULTS: SkinDetails = {
  blush: 0, freckles: 0, moles: 0, moleSize: 0.4, moleSeed: 1, pores: 1, underEye: 1, variation: 1, veins: 0.4,
  wrinkles: 0, expression: 1, sun: 0, sunSpots: 0, capillaries: 0, oiliness: 1, sweat: 0, grime: 0,
};
export const skinDetails: SkinDetails = { ...SKIN_DETAILS_DEFAULTS };

const clamp = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** A stored or linked value, checked field by field (unknown fields dropped, numbers clamped). */
export function sanitizeSkinDetails(raw: unknown): SkinDetails {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = SKIN_DETAILS_DEFAULTS;
  return {
    blush: clamp(r.blush, 0, 1, d.blush),
    freckles: clamp(r.freckles, 0, 1, d.freckles),
    moles: Math.round(clamp(r.moles, 0, MAX_MOLES, d.moles)),
    moleSize: clamp(r.moleSize, 0, 1, d.moleSize),
    moleSeed: Math.round(clamp(r.moleSeed, 1, 2 ** 31 - 2, d.moleSeed)),
    pores: clamp(r.pores, 0, 2, d.pores),
    underEye: clamp(r.underEye, 0, 2, d.underEye),
    variation: clamp(r.variation, 0, 2, d.variation),
    veins: clamp(r.veins, 0, 1, d.veins),
    wrinkles: clamp(r.wrinkles, 0, 1.5, d.wrinkles),
    expression: clamp(r.expression, 0, 2, d.expression),
    sun: clamp(r.sun, 0, 1, d.sun),
    sunSpots: clamp(r.sunSpots, 0, 1, d.sunSpots),
    capillaries: clamp(r.capillaries, 0, 1, d.capillaries),
    oiliness: clamp(r.oiliness, 0, 2, d.oiliness),
    sweat: clamp(r.sweat, 0, 1, d.sweat),
    grime: clamp(r.grime, 0, 1, d.grime),
  };
}

// --- store (useSyncExternalStore in SkinDetailsControl) ---
const listeners = new Set<() => void>();
let snapshot: SkinDetails = { ...skinDetails };
export const SKIN_DETAILS_SERVER_SNAPSHOT: SkinDetails = { ...SKIN_DETAILS_DEFAULTS };
export const skinDetailsSnapshot = () => snapshot;
export function onSkinDetailsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setSkinDetails(patch: Partial<SkinDetails>): void {
  Object.assign(skinDetails, sanitizeSkinDetails({ ...skinDetails, ...patch }));
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.skinDetails, JSON.stringify(skinDetails));
  } catch {
    /* private mode: no persistence */
  }
  applySkinDetails();
  snapshot = { ...skinDetails };
  for (const fn of listeners) fn();
}

/** New places for the moles. */
export const shuffleMoles = () => setSkinDetails({ moleSeed: 1 + Math.floor(Math.random() * 2 ** 30) });

/** Push the state into the shader (Head.tsx calls it once the skin is bound; before that only the amounts land). */
export function applySkinDetails(): void {
  const u = skinUniforms;
  u.uBlush.value = skinDetails.blush;
  u.uFreckles.value = skinDetails.freckles;
  u.uPores.value = skinDetails.pores;
  u.uUnderEye.value = skinDetails.underEye;
  u.uMottle.value = skinDetails.variation;
  u.uVeins.value = skinDetails.veins;
  u.uSun.value = skinDetails.sun;
  u.uSunSpots.value = skinDetails.sunSpots;
  u.uCapillaries.value = skinDetails.capillaries;
  u.uOil.value = skinDetails.oiliness;
  u.uSweat.value = skinDetails.sweat;
  u.uGrime.value = skinDetails.grime;
  setWrinkleSettings(skinDetails.wrinkles, skinDetails.expression);
  const spots = molePlaces(skinDetails.moleSeed);
  const n = Math.min(skinDetails.moles, spots.length);
  for (let i = 0; i < n; i++) {
    const s = spots[i];
    // 0.7 … 2.2 mm radius by the size slider, each mole ±30 % of that
    u.uMoles.value[i].set(s.x, s.y, s.z, (0.7 + 1.5 * skinDetails.moleSize) * s.scale);
  }
  u.uMoleCount.value = n;
}

// --- where the moles go ---------------------------------------------------------------------------------------------

type Spot = { x: number; y: number; z: number; scale: number };
let candidates: Float32Array | null = null; // rest skin vertices (mm) a mole may sit on, 3 floats each
let candidatesOf: unknown = null;
const placed = new Map<number, Spot[]>();

/** Skin vertices (template mm) a mole may sit on: face, ears and neck; not lips, eyes, nostrils or the scalp's top. */
function moleCandidates(): Float32Array | null {
  const mesh = skinSurface.mesh;
  if (!mesh) return null;
  if (candidates && candidatesOf === mesh) return candidates;
  const p = mesh.geometry.getAttribute("position");
  const m = skinSurface.toHead.elements;
  const out: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i);
    const x = (m[0] * px + m[4] * py + m[8] * pz + m[12]) * 1000;
    const y = (m[1] * px + m[5] * py + m[9] * pz + m[13]) * 1000;
    const z = (m[2] * px + m[6] * py + m[10] * pz + m[14]) * 1000;
    if (y < 130 || y > 360) continue; // the neck from below the jaw, up to the forehead
    if (z < -20 && y > 260) continue; // the back of the head (under hair)
    const ex = Math.abs(x) - 30.9, ey = y - 303.2;
    if (z > 70 && (ex / 19) ** 2 + (ey / 13) ** 2 < 1) continue; // the eyes and lids
    if (z > 105 && Math.abs(x) < 30 && y > 218 && y < 252) continue; // the lips
    if (z > 115 && Math.abs(x) < 22 && y > 252 && y < 268) continue; // the nostrils and the nose's underside
    out.push(x, y, z);
  }
  candidates = new Float32Array(out);
  candidatesOf = mesh;
  placed.clear();
  return candidates;
}

/** MAX_MOLES places for a seed, spread out (never two within 8 mm), in a fixed order: more moles adds to the list. */
function molePlaces(seed: number): Spot[] {
  const pts = moleCandidates();
  if (!pts) return [];
  const known = placed.get(seed);
  if (known) return known;
  let s = seed % 2147483647 || 1;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: Spot[] = [];
  const count = pts.length / 3;
  for (let tries = 0; out.length < MAX_MOLES && tries < 400; tries++) {
    const i = Math.floor(rand() * count);
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    const scale = 0.7 + 0.6 * rand();
    // most on the face, fewer on the neck and ears (they draw half the time)
    if ((y < 200 || Math.abs(x) > 70) && rand() < 0.5) continue;
    if (out.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 + (o.z - z) ** 2 < 64)) continue;
    out.push({ x, y, z, scale });
  }
  placed.set(seed, out);
  return out;
}

// Restore the last choice once, in the browser only.
if (typeof window !== "undefined") {
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEYS.skinDetails);
    if (saved) Object.assign(skinDetails, sanitizeSkinDetails(JSON.parse(saved)));
  } catch {
    /* private mode or malformed: keep the defaults */
  }
  snapshot = { ...skinDetails };
}
