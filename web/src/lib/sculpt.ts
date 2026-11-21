/**
 * Deep shape changes the 24 whole-head components can't make (Shape tab → Fine shape and Sculpt): one offset per skin
 * vertex, added on top of every slider, made of
 *  - fine-shape sliders: local changes placed from landmarks (nostril flare, a nose hump, hollow cheeks, hooded lids,
 *    square jaw corners …), each a smooth field over a few centimetres of skin (FINE);
 *  - asymmetry: a few soft random bulges and dips, so the two sides differ as real faces do;
 *  - sculpting: brush strokes on the face (raise, lower, smooth, grab, erase; mirrored across the face by default).
 *
 * The offset reaches everything that follows the skin: the GPU draws it (the skin shader adds `aSculpt` before the
 * morphs), the CPU shape adds it (NormalRefresher.setExtra: normals, the limiter, hair, brows, beards, glasses) and so do
 * the clothes' fit and the .glb export (sculptedVertexPosition). The skin's rest position (vRest: wrinkles, pores,
 * marks) is not moved, so skin details stay on their bit of skin.
 *
 * Never near the seams with other meshes: the offset fades to nothing within a few mm of the inside of the mouth and of
 * the eyeballs (`protect`), so lips and lids can't tear from their neighbours.
 *
 * Offsets are kept in head space (template mm); the GPU and the CPU shape get them in the skin mesh's own (quantised)
 * space. Fine shape and asymmetry are in the character (rebuild link, config); the sculpt is in this tab and the config
 * file only (an offset per vertex is far too big for a link).
 */
import { Float32BufferAttribute, Matrix3, Matrix4, type Mesh, type Ray, Vector3 } from "three";

import ageing from "@/data/ageing.json";
import { headSpaceMatrix } from "@/lib/age";
import type { NormalRefresher } from "@/lib/morphs/normals";
import { morphs } from "@/lib/morphs/store";
import { skinTriangles } from "@/lib/skinPick";
import { SCULPT_KEY, STORAGE_KEYS } from "@/lib/storageKeys";

// --- fine shape ------------------------------------------------------------------------------------------------------

export const FINE = [
  { id: "nostrils", name: "Nostril flare", low: "narrow", high: "flared", min: -1 },
  { id: "noseHump", name: "Nose hump", low: "scooped", high: "humped", min: -1 },
  { id: "noseTip", name: "Nose tip", low: "fine", high: "bulbous", min: -1 },
  { id: "cheekHollows", name: "Cheek hollows", low: "full", high: "gaunt", min: -1 },
  { id: "temples", name: "Temples", low: "hollow", high: "full", min: -1 },
  { id: "nasolabial", name: "Nose-to-mouth folds", low: "smooth", high: "deep", min: -1 },
  { id: "hoodedLids", name: "Hooded eyelids", low: "open", high: "hooded", min: -1 },
  { id: "eyeBags", name: "Eye bags", low: "smooth", high: "puffy", min: -1 },
  { id: "jawAngle", name: "Jaw corners", low: "soft", high: "square", min: -1 },
  { id: "chinCleft", name: "Chin cleft", low: "none", high: "deep", min: 0 },
  { id: "adamsApple", name: "Adam's apple", low: "none", high: "prominent", min: 0 },
] as const;
export type FineId = (typeof FINE)[number]["id"];

export type FineShape = { sliders: Partial<Record<FineId, number>>; asymmetry: number; asymSeed: number };
export const FINE_DEFAULTS: FineShape = { sliders: {}, asymmetry: 0, asymSeed: 1 };

const clampNum = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** A stored or linked value, checked (unknown sliders dropped, values clamped, zeros left out). */
export function sanitizeFine(raw: unknown): FineShape {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (r.sliders && typeof r.sliders === "object" ? r.sliders : {}) as Record<string, unknown>;
  const sliders: FineShape["sliders"] = {};
  for (const f of FINE) {
    const v = clampNum(s[f.id], f.min, 1, 0);
    if (Math.abs(v) > 1e-4) sliders[f.id] = v;
  }
  return { sliders, asymmetry: clampNum(r.asymmetry, 0, 1, 0), asymSeed: Math.round(clampNum(r.asymSeed, 1, 99999, 1)) };
}

export let fineShape: FineShape = { ...FINE_DEFAULTS, sliders: {} };

// --- the sculpt tool's settings ----------------------------------------------------------------------------------------

export type Brush = "raise" | "lower" | "smooth" | "grab" | "erase";
export type SculptTool = { on: boolean; brush: Brush; radius: number; strength: number; symmetry: boolean };
export const sculptTool: SculptTool = { on: false, brush: "raise", radius: 12, strength: 0.5, symmetry: true };

/** Brush tuning: mm one dab moves at full strength per mm of radius, the most any vertex may move (mm). */
const SCULPT = { dab: 0.035, maxMm: 25, undo: 24 };

// --- store (useSyncExternalStore in the panel) ---
type Snapshot = { fine: FineShape; tool: SculptTool; canUndo: boolean; sculpted: boolean; ready: boolean };
const listeners = new Set<() => void>();
let snapshot: Snapshot = { fine: fineShape, tool: { ...sculptTool }, canUndo: false, sculpted: false, ready: false };
export const SCULPT_SERVER_SNAPSHOT: Snapshot = { fine: FINE_DEFAULTS, tool: { ...sculptTool }, canUndo: false, sculpted: false, ready: false };
export const sculptSnapshot = () => snapshot;
export function onSculptChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function publish(): void {
  snapshot = { fine: { ...fineShape, sliders: { ...fineShape.sliders } }, tool: { ...sculptTool }, canUndo: undo.length > 0, sculpted: !!bound?.sculpted, ready: !!(bound || pending) };
  for (const fn of listeners) fn();
}

// --- the bound skin ----------------------------------------------------------------------------------------------------

type Field = { idx: Int32Array; d: Float32Array }; // sparse: vertex ids and their offsets (mm per unit)

type Bound = {
  mesh: Mesh;
  refresher: NormalRefresher;
  n: number;
  rest: Float32Array; // rest positions, head mm
  restN: Float32Array; // rest normals, head space
  canon: Int32Array; // each vertex → the first vertex at the same place (UV-seam copies move together)
  adjStart: Int32Array; // canonical neighbours (CSR)
  adj: Int32Array;
  protect: Float32Array; // 0 at the mouth's and eyes' seams … 1 a few mm away
  toHeadLin: Matrix3; // mesh → head (linear part, metres)
  toMeshLin: Matrix3; // head → mesh
  meshToWorld: Matrix4;
  fields: Map<string, Field>;
  sculpt: Float32Array; // brush offsets per canonical vertex (head mm)
  sculpted: boolean;
  total: Float32Array; // head mm
  attr: Float32BufferAttribute; // aSculpt, mesh space (also the refresher's extra)
};
let bound: Bound | null = null;
/** The skin handed over by Head.tsx, set up on first use (ensure): most faces never sculpt. */
let pending: { mesh: Mesh; refresher: NormalRefresher; others: Mesh[] } | null = null;
const undo: Float32Array[] = [];

const L = ageing.landmarks as Record<string, number[]>;
const lm = (name: string) => new Vector3(L[name][0], L[name][1], L[name][2]).multiplyScalar(1000);

/** The canonical skin vertex nearest a point (head mm). */
function nearest(b: Bound, p: Vector3): number {
  let best = Infinity, id = 0;
  for (let v = 0; v < b.n; v++) {
    if (b.canon[v] !== v) continue;
    const dx = b.rest[v * 3] - p.x, dy = b.rest[v * 3 + 1] - p.y, dz = b.rest[v * 3 + 2] - p.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < best) {
      best = d;
      id = v;
    }
  }
  return id;
}
const vertexAt = (b: Bound, v: number) => new Vector3(b.rest[v * 3], b.rest[v * 3 + 1], b.rest[v * 3 + 2]);
const snap = (b: Bound, x: number, y: number, z: number) => vertexAt(b, nearest(b, new Vector3(x, y, z)));
const gauss = (dx: number, dy: number, dz: number, rx: number, ry: number, rz: number) => Math.exp(-((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2));
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Each fine slider's offset (mm at +1) at a rest point P with rest normal N; `out` gets it. */
function fieldFn(b: Bound, id: FineId): (P: Vector3, N: Vector3, out: Vector3) => void {
  const side = (P: Vector3) => (P.x < 0 ? -1 : 1);
  switch (id) {
    case "nostrils": {
      const C = lm("alare_l");
      return (P, N, out) => {
        const w = gauss(Math.abs(P.x) - C.x, P.y - C.y, P.z - C.z, 7, 7, 8) * smooth(3, 8, Math.abs(P.x));
        out.set(side(P) * 2.2, 0, 0).addScaledVector(N, 0.4).multiplyScalar(w);
      };
    }
    case "noseHump": {
      const C = snap(b, 0, 291, 150);
      return (P, N, out) => void out.copy(N).multiplyScalar(2.0 * gauss(P.x - C.x, P.y - C.y, P.z - C.z, 5, 9, 9));
    }
    case "noseTip": {
      const C = snap(b, 0, 263, 160);
      return (P, N, out) => void out.copy(N).multiplyScalar(1.8 * gauss(P.x - C.x, P.y - C.y, P.z - C.z, 7, 7, 7));
    }
    case "cheekHollows": {
      const C = snap(b, 48, 252, 120);
      return (P, N, out) => void out.copy(N).multiplyScalar(-3.0 * gauss(Math.abs(P.x) - C.x, P.y - C.y, P.z - C.z, 11, 10, 12));
    }
    case "temples": {
      const C = snap(b, 62, 320, 90);
      return (P, N, out) => void out.copy(N).multiplyScalar(2.5 * gauss(Math.abs(P.x) - C.x, P.y - C.y, P.z - C.z, 13, 13, 13));
    }
    case "nasolabial": {
      // the fold of lib/age.ts (a curve from the nose wing to beside the mouth corner, seen from the front): a groove on
      // the curve and the cheek bulging over it on the outer side
      const al = lm("alare_l"), ch = lm("cheilion_l"), gl = lm("glabella");
      const b0 = [al.x + 1.5, al.y + 2.5], b2 = [ch.x + 4, ch.y - 5];
      const b1 = [Math.max(b0[0], b2[0]) + 3, 0.5 * (b0[1] + b2[1])];
      const pts: number[][] = [];
      for (let i = 0; i <= 16; i++) {
        const u = i / 16;
        pts.push([0, 1].map((k) => (1 - u) * (1 - u) * b0[k] + 2 * u * (1 - u) * b1[k] + u * u * b2[k]));
      }
      return (P, N, out) => {
        const qx = Math.abs(P.x), qy = P.y;
        let best = Infinity, along = 0, cx = 0;
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
          const abx = bx - ax, aby = by - ay;
          const t = Math.min(1, Math.max(0, ((qx - ax) * abx + (qy - ay) * aby) / (abx * abx + aby * aby)));
          const px = ax + t * abx, py = ay + t * aby;
          const d = Math.hypot(qx - px, qy - py);
          if (d < best) {
            best = d;
            along = (i - 1 + t) / (pts.length - 1);
            cx = px;
          }
        }
        const outer = smooth(-0.5, 1.5, qx - cx);
        const fold = smooth(0, 0.15, along) * (1 - smooth(0.9, 1, along)) * smooth(gl.z - 45, gl.z - 30, P.z);
        out.copy(N).multiplyScalar(1.3 * (outer * Math.exp(-(((best - 3.5) / 3) ** 2)) - 0.6 * Math.exp(-((best / 1.6) ** 2))) * fold);
      };
    }
    case "hoodedLids": {
      const C = snap(b, 31, 312, 120);
      return (P, N, out) => {
        const w = gauss(Math.abs(P.x) - C.x, P.y - C.y, P.z - C.z, 12, 4.5, 8);
        out.set(0, -1.6, 0).addScaledVector(N, 0.7).multiplyScalar(w);
      };
    }
    case "eyeBags": {
      const ll = lm("lid_lower_l");
      const C = snap(b, ll.x, ll.y - 6.5, ll.z + 5);
      return (P, N, out) => {
        const dx = Math.abs(P.x) - C.x, dy = P.y - C.y, dz = P.z - C.z;
        out.copy(N).multiplyScalar(1.4 * gauss(dx, dy, dz, 10, 3.5, 8) - 0.8 * gauss(dx, dy + 6, dz + 1, 12, 2.5, 8));
      };
    }
    case "jawAngle": {
      const C = snap(b, 60, 200, 40);
      return (P, _N, out) => {
        const w = 4 * gauss(Math.abs(P.x) - C.x, P.y - C.y, P.z - C.z, 15, 15, 15);
        out.set(side(P) * 0.86, -0.48, 0.16).multiplyScalar(w);
      };
    }
    case "chinCleft": {
      const C = lm("pogonion");
      return (P, N, out) => void out.copy(N).multiplyScalar(-1.3 * Math.exp(-((P.x / 1.8) ** 2)) * Math.exp(-(((P.y - C.y) / 6) ** 2)) * smooth(C.z - 15, C.z - 6, P.z));
    }
    case "adamsApple": {
      const C = snap(b, 0, 150, 90);
      return (P, N, out) => void out.copy(N).multiplyScalar(4 * gauss(P.x - C.x, P.y - C.y, P.z - C.z, 8, 12, 10));
    }
  }
}

/** A field over the canonical vertices, kept sparse. */
function buildField(b: Bound, fn: (P: Vector3, N: Vector3, out: Vector3) => void): Field {
  const idx: number[] = [];
  const d: number[] = [];
  const P = new Vector3(), N = new Vector3(), out = new Vector3();
  for (let v = 0; v < b.n; v++) {
    if (b.canon[v] !== v) continue;
    P.fromArray(b.rest, v * 3);
    N.fromArray(b.restN, v * 3);
    fn(P, N, out.set(0, 0, 0));
    if (out.lengthSq() < 1e-8) continue;
    idx.push(v);
    d.push(out.x, out.y, out.z);
  }
  return { idx: Int32Array.from(idx), d: Float32Array.from(d) };
}

function fieldOf(b: Bound, id: FineId): Field {
  let f = b.fields.get(id);
  if (!f) b.fields.set(id, (f = buildField(b, fieldFn(b, id))));
  return f;
}

/** Asymmetry: soft random bulges and dips over the face (2 mm at most), the same for the same seed on any face. */
function asymField(b: Bound, seed: number): Field {
  const key = `asym:${seed}`;
  let f = b.fields.get(key);
  if (f) return f;
  let s = seed % 2147483647 || 1;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const face: number[] = [];
  for (let v = 0; v < b.n; v++) {
    if (b.canon[v] !== v) continue;
    const z = b.rest[v * 3 + 2], y = b.rest[v * 3 + 1];
    if (z > 60 && y > 190 && y < 350) face.push(v);
  }
  const bumps = Array.from({ length: 12 }, () => {
    const c = vertexAt(b, face[Math.floor(rand() * face.length)]);
    const dir = new Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(1.5 + rand());
    return { c, dir, r: 14 + 16 * rand() };
  });
  f = buildField(b, (P, _N, out) => {
    for (const k of bumps) out.addScaledVector(k.dir, Math.exp(-P.distanceToSquared(k.c) / (k.r * k.r)));
  });
  b.fields.set(key, f);
  return f;
}

// --- composing the offset ----------------------------------------------------------------------------------------------

let settleTimer: ReturnType<typeof setTimeout> | undefined;
const tmp = new Vector3();

/** Rebuild the whole offset and hand it to the GPU and the CPU shape. `settle`: refit clothes etc. (else soon). */
function compose(settle = false): void {
  const b = ensure();
  if (!b) return;
  const t = b.total;
  t.fill(0);
  for (let v = 0; v < b.n; v++) {
    const c = b.canon[v] * 3;
    t[v * 3] = b.sculpt[c];
    t[v * 3 + 1] = b.sculpt[c + 1];
    t[v * 3 + 2] = b.sculpt[c + 2];
  }
  const add = (f: Field, k: number) => {
    if (!k) return;
    for (let i = 0; i < f.idx.length; i++) {
      const v = f.idx[i] * 3;
      t[v] += k * f.d[i * 3];
      t[v + 1] += k * f.d[i * 3 + 1];
      t[v + 2] += k * f.d[i * 3 + 2];
    }
  };
  for (const f of FINE) add(fieldOf(b, f.id), fineShape.sliders[f.id] ?? 0);
  if (fineShape.asymmetry > 0) add(asymField(b, fineShape.asymSeed), fineShape.asymmetry);
  // the seam copies take their canonical vertex's field values; protect the mouth and eyes; to the mesh's space
  const out = b.attr.array as Float32Array;
  let any = false;
  for (let v = 0; v < b.n; v++) {
    const c = b.canon[v];
    const k = b.protect[c] / 1000;
    const j = v * 3, cj = c * 3;
    if (c !== v) {
      t[j] = t[cj];
      t[j + 1] = t[cj + 1];
      t[j + 2] = t[cj + 2];
    }
    tmp.set(t[j] * k, t[j + 1] * k, t[j + 2] * k).applyMatrix3(b.toMeshLin);
    out[j] = tmp.x;
    out[j + 1] = tmp.y;
    out[j + 2] = tmp.z;
    if (!any && (tmp.x || tmp.y || tmp.z)) any = true;
  }
  b.attr.needsUpdate = true;
  b.refresher.setExtra(b.mesh, any ? out : null);
  morphs.markShapeChanged(); // the live settle (Head.tsx) recomputes the normals and the followers next frame
  clearTimeout(settleTimer);
  if (settle) morphs.settleNow();
  else settleTimer = setTimeout(() => morphs.settleNow(), 250); // the clothes refit once it stops changing
}

/** A skin vertex's position as drawn (morphs applied), with the offset: for the clothes' fit and the export. */
export function sculptedVertexPosition(mesh: Mesh, i: number, out: Vector3): Vector3 {
  mesh.getVertexPosition(i, out);
  const a = mesh.geometry.getAttribute("aSculpt");
  if (a) out.set(out.x + a.getX(i), out.y + a.getY(i), out.z + a.getZ(i));
  return out;
}

// --- binding -----------------------------------------------------------------------------------------------------------

/**
 * Head.tsx, once the skin is registered with the refresher. `others`: the head's other meshes; the ones touching the skin
 * (the mouth, the eyes) get a protected seam. Set up now only if this tab has a sculpt or a fine shape to show.
 */
export function bindSculpt(mesh: Mesh, refresher: NormalRefresher, others: Mesh[]): () => void {
  pending = { mesh, refresher, others };
  let hasSaved = false;
  try {
    hasSaved = !!window.sessionStorage.getItem(SCULPT_KEY);
  } catch {
    /* private mode */
  }
  if (hasSaved || Object.keys(fineShape.sliders).length || fineShape.asymmetry > 0) compose(true);
  publish();
  return () => {
    if (pending?.mesh === mesh) pending = null;
    if (bound?.mesh !== mesh) return;
    mesh.geometry.deleteAttribute("aSculpt");
    refresher.setExtra(mesh, null);
    bound = null;
    publish();
  };
}

/** The bound skin, set up on first use. */
function ensure(): Bound | null {
  if (bound || !pending) return bound;
  bound = setup(pending.mesh, pending.refresher, pending.others);
  restoreSculpt(bound);
  return bound;
}

function setup(mesh: Mesh, refresher: NormalRefresher, others: Mesh[]): Bound {
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const n = pos.count;
  const toHead = headSpaceMatrix(mesh);
  const toHeadLin = new Matrix3().setFromMatrix4(toHead);
  const normalM = new Matrix3().getNormalMatrix(toHead);
  const rest = new Float32Array(n * 3);
  const restN = new Float32Array(n * 3);
  const v3 = new Vector3();
  for (let i = 0; i < n; i++) {
    v3.fromBufferAttribute(pos, i).applyMatrix4(toHead).multiplyScalar(1000).toArray(rest, i * 3);
    v3.fromBufferAttribute(nrm, i).applyMatrix3(normalM).normalize().toArray(restN, i * 3);
  }
  // seam copies: same place (to 0.01 mm)
  const key = (x: number, y: number, z: number) => `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
  const first = new Map<string, number>();
  const canon = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const k = key(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
    const f = first.get(k);
    canon[i] = f ?? i;
    if (f === undefined) first.set(k, i);
  }
  // neighbours of each canonical vertex
  const index = skinTriangles() ?? (g.index!.array as Uint32Array);
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let f = 0; f < index.length; f += 3) {
    const a = canon[index[f]], bv = canon[index[f + 1]], c = canon[index[f + 2]];
    sets[a].add(bv).add(c);
    sets[bv].add(a).add(c);
    sets[c].add(a).add(bv);
  }
  const adjStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) adjStart[i + 1] = adjStart[i] + sets[i].size;
  const adj = new Int32Array(adjStart[n]);
  for (let i = 0; i < n; i++) adj.set([...sets[i]], adjStart[i]);
  // the seams: distance to the mouth's and the eyes' vertices (head mm, a 6 mm grid), 0 within 1.2 mm … 1 beyond 5 mm
  const cell = 6;
  const cellKey = (x: number, y: number, z: number) => ((Math.floor(x / cell) + 512) * 1024 + Math.floor(y / cell) + 512) * 1024 + Math.floor(z / cell) + 512;
  const otherPts: number[] = [];
  for (const m of others) {
    const part = m.parent?.name || m.name;
    if (!/^(mouth|sclera|cornea|iris|pupil)/.test(part)) continue;
    const mm = headSpaceMatrix(m);
    const p = m.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      v3.fromBufferAttribute(p, i).applyMatrix4(mm).multiplyScalar(1000);
      otherPts.push(v3.x, v3.y, v3.z);
    }
  }
  const op = Float32Array.from(otherPts);
  const ogrid = new Map<number, number[]>();
  for (let i = 0; i < op.length / 3; i++) {
    const k = cellKey(op[i * 3], op[i * 3 + 1], op[i * 3 + 2]);
    (ogrid.get(k) ?? ogrid.set(k, []).get(k)!).push(i);
  }
  const protect = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (canon[i] !== i) continue;
    const x = rest[i * 3], y = rest[i * 3 + 1], z = rest[i * 3 + 2];
    let best = 36;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    for (let a = -1; a <= 1; a++)
      for (let bb = -1; bb <= 1; bb++)
        for (let c = -1; c <= 1; c++) {
          const list = ogrid.get(((cx + a + 512) * 1024 + cy + bb + 512) * 1024 + cz + c + 512);
          if (!list) continue;
          for (const j of list) best = Math.min(best, (op[j * 3] - x) ** 2 + (op[j * 3 + 1] - y) ** 2 + (op[j * 3 + 2] - z) ** 2);
        }
    protect[i] = smooth(1.2, 5, Math.sqrt(best));
  }
  const attr = new Float32BufferAttribute(new Float32Array(n * 3), 3);
  g.setAttribute("aSculpt", attr);
  mesh.updateWorldMatrix(true, false);
  return {
    mesh, refresher, n, rest, restN, canon, adjStart, adj, protect,
    toHeadLin, toMeshLin: toHeadLin.clone().invert(), meshToWorld: mesh.matrixWorld,
    fields: new Map(), sculpt: new Float32Array(n * 3), sculpted: false, total: new Float32Array(n * 3), attr,
  };
}

// --- persistence -------------------------------------------------------------------------------------------------------

/** The sculpt as text: "s1:" + base64 of int16 offsets in 0.01 mm, 3 per skin vertex. */
export function encodeSculpt(s: Float32Array): string {
  const q = new Int16Array(s.length);
  for (let i = 0; i < s.length; i++) q[i] = Math.max(-32767, Math.min(32767, Math.round(s[i] * 100)));
  const bytes = new Uint8Array(q.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return "s1:" + btoa(bin);
}

/** Back from encodeSculpt, for a skin of `n` vertices; null if it isn't one (or for another head). */
export function decodeSculpt(text: string, n: number): Float32Array | null {
  if (typeof text !== "string" || !text.startsWith("s1:")) return null;
  try {
    const bin = atob(text.slice(3));
    if (bin.length !== n * 6) return null;
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const q = new Int16Array(bytes.buffer);
    const out = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) out[i] = q[i] / 100;
    return out;
  } catch {
    return null;
  }
}

function restoreSculpt(b: Bound): void {
  try {
    const saved = window.sessionStorage.getItem(SCULPT_KEY);
    const s = saved ? decodeSculpt(saved, b.n) : null;
    if (s) {
      b.sculpt.set(s);
      b.sculpted = s.some((x) => x !== 0);
    }
  } catch {
    /* private mode or malformed: none */
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveSculpt(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const b = bound;
    if (!b) return;
    try {
      if (b.sculpted) window.sessionStorage.setItem(SCULPT_KEY, encodeSculpt(b.sculpt));
      else window.sessionStorage.removeItem(SCULPT_KEY);
    } catch {
      /* private mode, or too big for this tab: kept until reload */
    }
  }, 300);
}

/** The sculpt as text for the config file (lib/export/config.ts), or null when there is none. */
export function currentSculpt(): string | null {
  return bound?.sculpted ? encodeSculpt(bound.sculpt) : null;
}

// --- fine shape and the tool, from the panel ---------------------------------------------------------------------------

export function setFine(patch: { sliders?: FineShape["sliders"]; asymmetry?: number; asymSeed?: number }, settle = false): void {
  fineShape = sanitizeFine({ ...fineShape, ...patch, sliders: { ...fineShape.sliders, ...patch.sliders } });
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.fineShape, JSON.stringify(fineShape));
  } catch {
    /* private mode */
  }
  compose(settle);
  publish();
}
export const shuffleAsymmetry = () => setFine({ asymSeed: 1 + Math.floor(Math.random() * 99998) }, true);

export function setSculptTool(patch: Partial<SculptTool>): void {
  Object.assign(sculptTool, patch);
  sculptTool.radius = clampNum(sculptTool.radius, 3, 40, 12);
  sculptTool.strength = clampNum(sculptTool.strength, 0.05, 1, 0.5);
  publish();
}

function pushUndo(): void {
  if (!bound) return;
  undo.push(bound.sculpt.slice());
  if (undo.length > SCULPT.undo) undo.shift();
}

export function undoSculpt(): void {
  const b = ensure();
  const prev = undo.pop();
  if (!b || !prev) return;
  b.sculpt.set(prev);
  b.sculpted = prev.some((x) => x !== 0);
  compose(true);
  saveSculpt();
  publish();
}

/** Reset: no fine shape and no sculpt (the sculpt can come back with Undo). */
export function resetFineShape(): void {
  const b = bound;
  if (b?.sculpted) {
    pushUndo();
    b.sculpt.fill(0);
    b.sculpted = false;
    saveSculpt();
  }
  if (!bound && !Object.keys(fineShape.sliders).length && !fineShape.asymmetry) return; // nothing to undo: skip the setup
  setFine({ sliders: Object.fromEntries(FINE.map((f) => [f.id, 0])), asymmetry: 0 }, true);
}

export function clearSculpt(): void {
  const b = ensure();
  if (!b || !b.sculpted) return;
  pushUndo();
  b.sculpt.fill(0);
  b.sculpted = false;
  compose(true);
  saveSculpt();
  publish();
}

// --- brushing ----------------------------------------------------------------------------------------------------------

type Stroke = {
  /** grab: where it started (world), the plane it drags in, and each vertex's pull and starting offset */
  start?: Vector3;
  planeN?: Vector3;
  weights?: Map<number, number>;
  mirrored?: Map<number, number>;
  base?: Float32Array;
};
let stroke: Stroke | null = null;

/** The canonical vertices within `r` mm of a point (head mm, the face as drawn now) and their falloff. */
function within(b: Bound, cur: Float32Array, c: Vector3, r: number): Map<number, number> {
  const out = new Map<number, number>();
  const r2 = r * r;
  for (let v = 0; v < b.n; v++) {
    if (b.canon[v] !== v) continue;
    const dx = cur[v * 3] - c.x, dy = cur[v * 3 + 1] - c.y, dz = cur[v * 3 + 2] - c.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    const f = 1 - d2 / r2;
    out.set(v, f * f * b.protect[v]);
  }
  return out;
}

/** The face as drawn now (head mm) and its normals (head space), from the CPU shape. */
function currentHead(b: Bound): { cur: Float32Array; nrm: Float32Array } | null {
  const shape = b.refresher.shapeOf(b.mesh);
  if (!shape) return null;
  const toHead = headSpaceMatrix(b.mesh);
  const normalM = new Matrix3().getNormalMatrix(toHead);
  const nAttr = b.mesh.geometry.getAttribute("normal");
  const cur = new Float32Array(b.n * 3);
  const nrm = new Float32Array(b.n * 3);
  for (let v = 0; v < b.n; v++) {
    if (b.canon[v] !== v) continue;
    tmp.fromArray(shape.current, v * 3).applyMatrix4(toHead).multiplyScalar(1000).toArray(cur, v * 3);
    tmp.fromBufferAttribute(nAttr, v).applyMatrix3(normalM).normalize().toArray(nrm, v * 3);
  }
  return { cur, nrm };
}

/** World point → head mm. */
function worldToHead(b: Bound, p: Vector3, out: Vector3): Vector3 {
  b.mesh.updateWorldMatrix(true, false);
  const inv = new Matrix4().copy(b.mesh.matrixWorld).invert();
  return out.copy(p).applyMatrix4(inv).applyMatrix4(headSpaceMatrix(b.mesh)).multiplyScalar(1000);
}

/** Start a stroke where the pointer hit the skin (lib/skinPick.ts world point); `viewDir`: the camera's look direction. */
export function beginStroke(world: Vector3, viewDir: Vector3): void {
  const b = ensure();
  if (!b) return;
  pushUndo();
  stroke = {};
  if (sculptTool.brush === "grab") {
    const now = currentHead(b);
    if (!now) return;
    const c = worldToHead(b, world, new Vector3());
    stroke.start = world.clone();
    stroke.planeN = viewDir.clone().normalize();
    stroke.weights = within(b, now.cur, c, sculptTool.radius);
    stroke.mirrored = sculptTool.symmetry ? within(b, now.cur, new Vector3(-c.x, c.y, c.z), sculptTool.radius) : undefined;
    stroke.base = b.sculpt.slice();
    return;
  }
  dab(world);
}

/** One dab of the brush at a world point on the skin (raise, lower, smooth, erase). */
export function dab(world: Vector3): void {
  const b = bound;
  if (!b || !stroke || sculptTool.brush === "grab") return;
  const now = currentHead(b);
  if (!now) return;
  const c = worldToHead(b, world, new Vector3());
  const centres = sculptTool.symmetry && Math.abs(c.x) > 0.5 ? [c, new Vector3(-c.x, c.y, c.z)] : [c];
  const r = sculptTool.radius;
  const k = sculptTool.strength;
  for (const centre of centres) {
    const w = within(b, now.cur, centre, r);
    for (const [v, f] of w) {
      const j = v * 3;
      switch (sculptTool.brush) {
        case "raise":
        case "lower": {
          const s = (sculptTool.brush === "raise" ? 1 : -1) * SCULPT.dab * r * k * f;
          for (let a = 0; a < 3; a++) b.sculpt[j + a] += now.nrm[j + a] * s;
          break;
        }
        case "smooth": {
          let ax = 0, ay = 0, az = 0;
          const s0 = b.adjStart[v], s1 = b.adjStart[v + 1];
          if (s1 === s0) break;
          for (let q = s0; q < s1; q++) {
            const u = b.adj[q] * 3;
            ax += now.cur[u];
            ay += now.cur[u + 1];
            az += now.cur[u + 2];
          }
          const m = 1 / (s1 - s0), s = 0.5 * k * f;
          b.sculpt[j] += (ax * m - now.cur[j]) * s;
          b.sculpt[j + 1] += (ay * m - now.cur[j + 1]) * s;
          b.sculpt[j + 2] += (az * m - now.cur[j + 2]) * s;
          break;
        }
        case "erase": {
          const s = 1 - 0.5 * k * f;
          for (let a = 0; a < 3; a++) b.sculpt[j + a] *= s;
          break;
        }
      }
      clampOffset(b, v);
    }
  }
  b.sculpted = true;
  compose();
}

/** Grab: drag the stroke's skin with the pointer's ray (in the plane facing the camera through where it started). */
export function dragTo(ray: Ray): void {
  const b = bound;
  if (!b || !stroke?.start || !stroke.planeN || !stroke.weights || !stroke.base) return;
  const denom = ray.direction.dot(stroke.planeN);
  if (Math.abs(denom) < 1e-6) return;
  const t = stroke.start.clone().sub(ray.origin).dot(stroke.planeN) / denom;
  const hit = ray.origin.clone().addScaledVector(ray.direction, t);
  const d = worldToHead(b, hit, new Vector3()).sub(worldToHead(b, stroke.start, new Vector3()));
  const lim = sculptTool.radius * 0.8; // never drag further than the brush is wide
  if (d.length() > lim) d.setLength(lim);
  b.sculpt.set(stroke.base);
  const apply = (w: Map<number, number>, dx: number) => {
    for (const [v, f] of w) {
      const j = v * 3;
      b.sculpt[j] += dx * f;
      b.sculpt[j + 1] += d.y * f;
      b.sculpt[j + 2] += d.z * f;
      clampOffset(b, v);
    }
  };
  apply(stroke.weights, d.x);
  if (stroke.mirrored) apply(stroke.mirrored, -d.x);
  b.sculpted = true;
  compose();
}

function clampOffset(b: Bound, v: number): void {
  const j = v * 3;
  const len = Math.hypot(b.sculpt[j], b.sculpt[j + 1], b.sculpt[j + 2]);
  if (len > SCULPT.maxMm) for (let a = 0; a < 3; a++) b.sculpt[j + a] *= SCULPT.maxMm / len;
}

export function endStroke(): void {
  if (!stroke) return;
  stroke = null;
  compose(true);
  saveSculpt();
  publish();
}

/** Replace the sculpt (a config file); "" or null clears it. */
export function setSculptText(text: string | null): void {
  const b = ensure();
  if (!b) return;
  const s = text ? decodeSculpt(text, b.n) : null;
  b.sculpt.fill(0);
  if (s) b.sculpt.set(s);
  b.sculpted = !!s && s.some((x) => x !== 0);
  compose(true);
  saveSculpt();
  publish();
}

// Restore the fine shape once, in the browser only (the sculpt waits for the skin: bindSculpt).
if (typeof window !== "undefined") {
  try {
    const saved = window.sessionStorage.getItem(STORAGE_KEYS.fineShape);
    if (saved) fineShape = sanitizeFine(JSON.parse(saved));
  } catch {
    /* private mode or malformed: none */
  }
  snapshot = { ...snapshot, fine: fineShape };
}
