/**
 * Scars and marks (Style tab → Scars and marks): up to MAX_MARKS decals the skin shader draws (lib/skinShader.ts):
 * scars, cuts, acne pockmarks, burns and bruises. Each sits at a spot on the REST skin (template millimetres, where
 * the visitor clicked: lib/skinPick.ts) and is projected along that spot's normal, so it stays on the same bit of skin
 * whatever face the sliders make. Each has its own size, angle and how healed it is (fresh … old).
 *
 * Plain module state, pushed into the shader's uniforms, kept in sessionStorage and carried by the rebuild link and the
 * config file (lib/export/characterCode.ts), like the skin details. Placing: `startPlacing(type)` arms the next click
 * on the face (components/scene/SkinTools.tsx does the click).
 */
import { MAX_MARKS, skinUniforms } from "@/lib/skinShader";
import { STORAGE_KEYS } from "@/lib/storageKeys";

export type MarkType = "scar" | "cut" | "pockmarks" | "burn" | "bruise";

/** Shader type ids and each type's size when placed (mm). */
export const MARK_TYPES: { id: MarkType; label: string; code: number; length: number; width: number; healed: number }[] = [
  { id: "scar", label: "Scar", code: 0, length: 32, width: 2.2, healed: 0.8 },
  { id: "cut", label: "Cut", code: 1, length: 22, width: 1.0, healed: 0.2 },
  { id: "pockmarks", label: "Pockmarks", code: 2, length: 30, width: 1.2, healed: 0.8 },
  { id: "burn", label: "Burn", code: 3, length: 34, width: 2, healed: 0.8 },
  { id: "bruise", label: "Bruise", code: 4, length: 30, width: 2, healed: 0.2 },
];
const TYPE = Object.fromEntries(MARK_TYPES.map((t) => [t.id, t])) as Record<MarkType, (typeof MARK_TYPES)[number]>;

export type Mark = {
  type: MarkType;
  /** where on the rest skin (template mm) and its outward normal there */
  at: [number, number, number];
  normal: [number, number, number];
  /** degrees: 0 runs across the face, 90 up and down */
  angle: number;
  /** mm: a line's length, a patch's or a cluster's size */
  length: number;
  /** mm: a line's width, a pit's size */
  width: number;
  /** 0 fresh … 1 long healed */
  healed: number;
  seed: number;
};

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const vec = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? [v[0], v[1], v[2]] : null;

/** A stored or linked list, checked mark by mark (unknown types and malformed spots dropped, numbers clamped). */
export function sanitizeMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) return [];
  const out: Mark[] = [];
  for (const r of raw.slice(0, MAX_MARKS)) {
    if (!r || typeof r !== "object") continue;
    const m = r as Record<string, unknown>;
    const type = TYPE[m.type as MarkType];
    const at = vec(m.at);
    const n = vec(m.normal);
    if (!type || !at || !n || at.some((x) => Math.abs(x) > 600)) continue;
    const len = Math.hypot(...n);
    if (len < 1e-6) continue;
    out.push({
      type: type.id,
      at,
      normal: [n[0] / len, n[1] / len, n[2] / len],
      angle: num(m.angle, -180, 180, 0),
      length: num(m.length, 2, 90, type.length),
      width: num(m.width, 0.3, 8, type.width),
      healed: num(m.healed, 0, 1, type.healed),
      seed: Math.round(num(m.seed, 0, 9999, 1)),
    });
  }
  return out;
}

export let marks: Mark[] = [];

// --- store (useSyncExternalStore in MarksControl) ---
type Snapshot = { marks: Mark[]; placing: MarkType | null };
const listeners = new Set<() => void>();
let snapshot: Snapshot = { marks: [], placing: null };
export const MARKS_SERVER_SNAPSHOT: Snapshot = { marks: [], placing: null };
export const marksSnapshot = () => snapshot;
export function onMarksChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
let placing: MarkType | null = null;
function publish(save = true): void {
  if (save) {
    try {
      window.sessionStorage.setItem(STORAGE_KEYS.marks, JSON.stringify(marks));
    } catch {
      /* private mode: no persistence */
    }
  }
  applyMarks();
  snapshot = { marks: marks.map((m) => ({ ...m })), placing };
  for (const fn of listeners) fn();
}

/** Replace the whole list (restore, a config file). */
export function setMarks(list: unknown): void {
  marks = sanitizeMarks(list);
  publish();
}

export function updateMark(i: number, patch: Partial<Mark>): void {
  if (!marks[i]) return;
  marks = marks.map((m, j) => (j === i ? sanitizeMarks([{ ...m, ...patch }])[0] ?? m : m));
  publish();
}

export function removeMark(i: number): void {
  marks = marks.filter((_, j) => j !== i);
  publish();
}

export const clearMarks = () => setMarks([]);

/** Arm the next click on the face to place a mark of this type (null: stop). */
export function startPlacing(type: MarkType | null): void {
  placing = type;
  publish(false);
}
export const placingMark = () => placing;

/** Place the armed mark at a spot on the rest skin (template mm) with its normal; returns false if it's full. */
export function placeMark(at: [number, number, number], normal: [number, number, number]): boolean {
  if (!placing || marks.length >= MAX_MARKS) return false;
  const t = TYPE[placing];
  // lines run across the face by default, a little tilted, each its own
  const seed = 1 + Math.floor(Math.random() * 9998);
  marks = [...marks, ...sanitizeMarks([{ type: t.id, at, normal, angle: 20 - (seed % 40), length: t.length, width: t.width, healed: t.healed, seed }])];
  placing = null;
  publish();
  return true;
}

/** Push the list into the shader. */
export function applyMarks(): void {
  const u = skinUniforms;
  marks.forEach((m, i) => {
    u.uMarkA.value[i].set(m.at[0], m.at[1], m.at[2], TYPE[m.type].code);
    u.uMarkB.value[i].set(m.normal[0], m.normal[1], m.normal[2], (m.angle * Math.PI) / 180);
    u.uMarkC.value[i].set(m.length, m.width, m.healed, m.seed);
  });
  u.uMarkCount.value = marks.length;
}

// Restore the last list once, in the browser only.
if (typeof window !== "undefined") {
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEYS.marks);
    if (saved) marks = sanitizeMarks(JSON.parse(saved));
  } catch {
    /* private mode or malformed: none */
  }
  applyMarks();
  snapshot = { marks: marks.map((m) => ({ ...m })), placing };
}
