/**
 * The camera finish's settings (Style tab → Camera): on or off, and how much depth of field, bloom, film grain, vignette,
 * colour grade, clarity and skin translucency lib/finish.ts puts over the frame; and which light the studio uses. Plain state with no three.js (the panel imports it), kept in
 * sessionStorage. It is how the view is drawn, not part of the character: not in the rebuild link, not in the export.
 */
import { VIEW_KEYS } from "@/lib/storageKeys";

export type FinishSettings = {
  on: boolean;
  /** 0..1: none … a wide-open portrait lens (lib/finish.ts FINISH.fNumber) */
  focus: number;
  /** 0..1 each, × lib/finish.ts FINISH's strongest */
  bloom: number;
  grain: number;
  vignette: number;
  grade: number;
  /** 0..1: local contrast and fine sharpening (the crisp, gritty look of a retouched portrait) */
  clarity: number;
  /** 0..1: light scattering under the skin (a screen-space blur of the skin only, widest in red) */
  skin: number;
  /** the light: the soft studio, a hard sun from above, or a low side light (components/scene/Lighting.tsx) */
  light: LightPreset;
  /** what's behind the head: the page's own colour, or a photo studio's grey, dark or white backdrop */
  backdrop: Backdrop;
};

export const BACKDROPS = { page: "#f5f3f1", grey: "#8c8c8c", dark: "#2a2b2e", white: "#ffffff" } as const;
export type Backdrop = keyof typeof BACKDROPS;

export const LIGHT_PRESETS = ["studio", "sun", "side"] as const;
export type LightPreset = (typeof LIGHT_PRESETS)[number];

export const FINISH_DEFAULTS: FinishSettings = { on: true, focus: 0.5, bloom: 0.5, grain: 0.5, vignette: 0.5, grade: 0.5, clarity: 0.3, skin: 0.6, light: "studio", backdrop: "page" };
export const finishSettings: FinishSettings = { ...FINISH_DEFAULTS };

const unit = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback);

/** A stored value, checked field by field. */
export function sanitizeFinish(raw: unknown): FinishSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = FINISH_DEFAULTS;
  return {
    on: typeof r.on === "boolean" ? r.on : d.on,
    focus: unit(r.focus, d.focus),
    bloom: unit(r.bloom, d.bloom),
    grain: unit(r.grain, d.grain),
    vignette: unit(r.vignette, d.vignette),
    grade: unit(r.grade, d.grade),
    clarity: unit(r.clarity, d.clarity),
    skin: unit(r.skin, d.skin),
    light: LIGHT_PRESETS.includes(r.light as LightPreset) ? (r.light as LightPreset) : d.light,
    backdrop: typeof r.backdrop === "string" && Object.hasOwn(BACKDROPS, r.backdrop) ? (r.backdrop as Backdrop) : d.backdrop,
  };
}

const listeners = new Set<() => void>();
let snapshot: FinishSettings = { ...finishSettings };
export const FINISH_SERVER_SNAPSHOT: FinishSettings = { ...FINISH_DEFAULTS };
export const finishSnapshot = () => snapshot;
export function onFinishChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setFinish(patch: Partial<FinishSettings>): void {
  Object.assign(finishSettings, sanitizeFinish({ ...finishSettings, ...patch }));
  try {
    window.sessionStorage.setItem(VIEW_KEYS.finish, JSON.stringify(finishSettings));
  } catch {
    /* private mode: no persistence */
  }
  snapshot = { ...finishSettings };
  for (const fn of listeners) fn();
}

if (typeof window !== "undefined") {
  try {
    const saved = window.sessionStorage.getItem(VIEW_KEYS.finish);
    if (saved) Object.assign(finishSettings, sanitizeFinish(JSON.parse(saved)));
  } catch {
    /* private mode or malformed: keep the defaults */
  }
  snapshot = { ...finishSettings };
}
