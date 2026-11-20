/**
 * The camera finish's settings (Style tab → Camera): on or off, and how much depth of field, bloom, film grain, vignette
 * and colour grade lib/finish.ts puts over the frame. Plain state with no three.js (the panel imports it), kept in
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
};

export const FINISH_DEFAULTS: FinishSettings = { on: true, focus: 0.5, bloom: 0.5, grain: 0.5, vignette: 0.5, grade: 0.5 };
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
