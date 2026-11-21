/**
 * Clothes: a garment (and for a blazer, the top under it) on generated shoulders, under the head's root node so it
 * nods with the bust. The GNM head ends in a short bust (the neck flaring into the tops of the shoulders, capped at a
 * slanted cut), so each garment is fitted to the face as it is now:
 *
 *   - round the neck and over the bust it hugs the skin, a fabric's thickness off it: rays from the neck's axis find the
 *     skin's outer surface (morphs applied, so the neck sliders and expressions move the collar too);
 *   - below the bust's edge it carries on into generated shoulders and a torso (a rounded box: Shoulders, Build), so
 *     the cut never shows.
 *
 * One column of points per direction round the neck, from the neckline down; the neckline (crew, V, scoop, high
 * collar, an open jacket front) is each column's top height, so every cut is a clean edge. Rebuilt when the face settles
 * (and while a slider drags, throttled), never per frame. Plain colours with fabric sheen, no textures: the .glb export
 * carries them as they are (lib/export/model.ts).
 * Tweak here: CLOTHES, STYLES, FABRICS.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  type Object3D,
  Vector3,
} from "three";

import { installHairShadow } from "@/lib/hairShadow";
import { revealedSnapshot, subscribeRevealed } from "@/lib/headLoad";
import { morphs } from "@/lib/morphs/store";
import { sculptedVertexPosition } from "@/lib/sculpt";
import { STORAGE_KEYS } from "@/lib/storageKeys";

export type ClothesStyleId = "none" | "tee" | "vneck" | "scoop" | "turtleneck" | "shirt" | "blazer";
export type FabricId = "cotton" | "knit" | "satin" | "denim" | "leather";

export const CLOTHES_STYLES: { id: ClothesStyleId; label: string; inner?: boolean }[] = [
  { id: "none", label: "None" },
  { id: "tee", label: "T-shirt" },
  { id: "vneck", label: "V-neck" },
  { id: "scoop", label: "Scoop neck" },
  { id: "turtleneck", label: "Turtleneck" },
  { id: "shirt", label: "Collared shirt" },
  { id: "blazer", label: "Blazer", inner: true },
];

export const FABRICS: { id: FabricId; label: string; roughness: number; sheen: number; sheenRoughness: number; clearcoat?: number }[] = [
  { id: "cotton", label: "Cotton", roughness: 0.85, sheen: 0.35, sheenRoughness: 0.8 },
  { id: "knit", label: "Knit", roughness: 0.95, sheen: 0.7, sheenRoughness: 0.9 },
  { id: "satin", label: "Satin", roughness: 0.38, sheen: 0.9, sheenRoughness: 0.35 },
  { id: "denim", label: "Denim", roughness: 0.9, sheen: 0.2, sheenRoughness: 0.7 },
  { id: "leather", label: "Leather", roughness: 0.45, sheen: 0, sheenRoughness: 0.5, clearcoat: 0.35 },
];

export const CLOTHES_COLOURS: { id: string; label: string; hex: string }[] = [
  { id: "black", label: "Black", hex: "#1d1d20" },
  { id: "white", label: "White", hex: "#f2f0ec" },
  { id: "cream", label: "Cream", hex: "#e9dfcb" },
  { id: "grey", label: "Grey", hex: "#8a8c90" },
  { id: "charcoal", label: "Charcoal", hex: "#3c3e44" },
  { id: "navy", label: "Navy", hex: "#1f2a48" },
  { id: "royal", label: "Royal blue", hex: "#1d3f9e" },
  { id: "sky", label: "Sky blue", hex: "#8fb5dd" },
  { id: "teal", label: "Teal", hex: "#1f6f72" },
  { id: "forest", label: "Forest green", hex: "#24452f" },
  { id: "olive", label: "Olive", hex: "#5f6236" },
  { id: "camel", label: "Camel", hex: "#b08856" },
  { id: "brown", label: "Brown", hex: "#5b3a26" },
  { id: "burgundy", label: "Burgundy", hex: "#6b1f2c" },
  { id: "red", label: "Red", hex: "#b3222b" },
  { id: "pink", label: "Pink", hex: "#e3a1b4" },
  { id: "lavender", label: "Lavender", hex: "#a998cf" },
  { id: "mustard", label: "Mustard", hex: "#c99a2e" },
];

export interface ClothesState {
  style: ClothesStyleId;
  colour: string; // #rrggbb: the garment (the jacket, for a blazer)
  inner: string; // #rrggbb: the top under a blazer
  fabric: FabricId;
  fit: number; // −1 snug … +1 loose
  shoulders: number; // −1 narrow … +1 broad
  build: number; // −1 slim … +1 broad chest
  neckline: number; // −1 shallow … +1 deep (V, scoop, the blazer's top)
}

export const CLOTHES_DEFAULTS: ClothesState = { style: "none", colour: "#1d3f9e", inner: "#f2f0ec", fabric: "cotton", fit: 0, shoulders: 0, build: 0, neckline: 0 };

/** Tweak freely: sizes in metres (head.glb's space: Y up, the face towards +Z). */
const CLOTHES = {
  columns: 120, // directions round the neck
  rows: 64, // points down each column
  step: 0.002, // ray spacing down the neck and bust
  bottom: -0.34, // where the torso ends (well out of frame)
  thickness: 0.003, // fabric off the skin
  shoulders: { width: 0.19, perUnit: 0.025, depth: 0.108, depthPerUnit: 0.018, centreZ: -0.008, power: 3.2 },
  drop: { front: 0.012, side: 0.05 }, // how far the shoulder line falls from the bust's edge
  rayNormalY: 0.6, // surfaces facing further down than this (the bust's cap, under the jaw) are not the outside
};

const MAX_COLUMN_NEIGHBOURS = 0.5; // triangles spanning more than this round the axis (radians) are the cap's: skipped

// --- state --------------------------------------------------------------------------------------------------------

export const clothesState: ClothesState = { ...CLOTHES_DEFAULTS };
let snapshot: ClothesState = { ...clothesState };
const listeners = new Set<() => void>();

export const clothesSnapshot = (): ClothesState => snapshot;
export const CLOTHES_SERVER_SNAPSHOT: ClothesState = { ...CLOTHES_DEFAULTS };
export function onClothesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const HEX = /^#[0-9a-f]{6}$/i;
const clampUnit = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : fallback);

/** A saved or linked value, checked field by field (unknown ids and bad colours fall back to the default). */
export function sanitizeClothes(raw: unknown): ClothesState {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<ClothesState>;
  return {
    style: CLOTHES_STYLES.some((x) => x.id === s.style) ? (s.style as ClothesStyleId) : CLOTHES_DEFAULTS.style,
    colour: typeof s.colour === "string" && HEX.test(s.colour) ? s.colour.toLowerCase() : CLOTHES_DEFAULTS.colour,
    inner: typeof s.inner === "string" && HEX.test(s.inner) ? s.inner.toLowerCase() : CLOTHES_DEFAULTS.inner,
    fabric: FABRICS.some((f) => f.id === s.fabric) ? (s.fabric as FabricId) : CLOTHES_DEFAULTS.fabric,
    fit: clampUnit(s.fit, 0),
    shoulders: clampUnit(s.shoulders, 0),
    build: clampUnit(s.build, 0),
    neckline: clampUnit(s.neckline, 0),
  };
}

function load(): void {
  try {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(STORAGE_KEYS.clothes) : null;
    if (raw) Object.assign(clothesState, sanitizeClothes(JSON.parse(raw)));
  } catch {
    /* private mode or malformed: the defaults */
  }
  snapshot = { ...clothesState };
}
load();

/** Change any of the clothes' settings; geometry rebuilds only when the shape of the garment changes. */
export function setClothes(patch: Partial<ClothesState>): void {
  const before = { ...clothesState };
  Object.assign(clothesState, sanitizeClothes({ ...clothesState, ...patch }));
  snapshot = { ...clothesState };
  try {
    window.sessionStorage.setItem(STORAGE_KEYS.clothes, JSON.stringify(clothesState));
  } catch {
    /* private mode */
  }
  const shapeChanged = (["style", "fit", "shoulders", "build", "neckline"] as const).some((k) => before[k] !== clothesState[k]);
  if (shapeChanged) rebuild();
  else applyMaterials();
  for (const fn of listeners) fn();
}

// --- the scene ----------------------------------------------------------------------------------------------------

const rig = {
  root: null as Object3D | null,
  skin: null as Mesh | null,
  group: null as Group | null,
  outer: new MeshPhysicalMaterial({ name: "clothes", side: DoubleSide, vertexColors: true }),
  inner: new MeshPhysicalMaterial({ name: "clothes_inner", side: DoubleSide, vertexColors: true }),
  bust: null as Uint32Array | null, // the skin's vertices round the neck and bust
};
// Long hair and beards shade the clothes (lib/hairShadow.ts); the key light's shadow map does the rest (rebuild).
installHairShadow(rig.outer, "clothes-hair-shadow-v1");
installHairShadow(rig.inner, "clothes-hair-shadow-v1");

/** Head.tsx: the head's root node exists. Puts the clothes on and keeps them fitted. Returns the teardown. */
export function mountClothes(root: Object3D): () => void {
  const node = root.getObjectByName("skin");
  let skin: Mesh | null = null;
  node?.traverse((o) => {
    if (!skin && (o as Mesh).isMesh) skin = o as Mesh;
  });
  rig.root = root;
  rig.skin = skin;
  rig.bust = null;
  const group = new Group();
  group.name = "clothes";
  group.visible = revealedSnapshot(); // not during the loader's morph reveal: the head forms from a bubble first
  root.add(group);
  rig.group = group;
  applyMaterials();
  rebuild();
  const offRevealed = subscribeRevealed(() => (group.visible = revealedSnapshot()));
  const offSettle = morphs.onSettle(rebuild);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const offChange = morphs.onChange(() => {
    if (timer || clothesState.style === "none") return;
    timer = setTimeout(() => {
      timer = null;
      rebuild();
    }, 120);
  });
  return () => {
    offRevealed();
    offSettle();
    offChange();
    if (timer) clearTimeout(timer);
    clearGroup();
    group.removeFromParent();
    rig.root = rig.skin = rig.group = null;
  };
}

function applyMaterials(): void {
  const fabric = FABRICS.find((f) => f.id === clothesState.fabric) ?? FABRICS[0];
  for (const [m, hex] of [[rig.outer, clothesState.colour], [rig.inner, clothesState.inner]] as const) {
    m.color.set(hex);
    m.roughness = fabric.roughness;
    m.metalness = 0;
    m.sheen = fabric.sheen;
    m.sheenRoughness = fabric.sheenRoughness;
    m.sheenColor.set(hex).lerp(new Color(0xffffff), 0.35);
    m.clearcoat = fabric.clearcoat ?? 0;
    m.clearcoatRoughness = 0.4;
    m.needsUpdate = true;
  }
}

function clearGroup(): void {
  const g = rig.group;
  if (!g) return;
  for (const c of [...g.children]) {
    (c as Mesh).geometry?.dispose();
    g.remove(c);
  }
}

/** Build the clothes again for the face as it is now (or take them off). */
export function rebuild(): void {
  if (!rig.group || !rig.skin || !rig.root) return;
  clearGroup();
  if (clothesState.style === "none") return;
  const probe = makeProbe(rig.skin, rig.root);
  if (!probe) return;
  for (const layer of layersFor(clothesState, probe)) {
    const mesh = new Mesh(layer.geometry, layer.inner ? rig.inner : rig.outer);
    mesh.name = layer.name;
    mesh.userData.clothes = true;
    mesh.castShadow = mesh.receiveShadow = true; // the chin on the chest, the collar on the neck (Lighting.tsx: the key's shadow)
    mesh.renderOrder = layer.inner ? 0 : 1;
    rig.group.add(mesh);
  }
}

// --- the skin, seen from the neck's axis --------------------------------------------------------------------------

type Probe = {
  /** Distance from the neck's axis to the skin's outer surface at angle θ (0 = the front, +X = π/2) and height y. */
  r(theta: number, y: number): number | null;
  /** Where the neck starts to flare into the shoulders, seen from the side. */
  flareY: number;
};

const BINS = 90;
const binOf = (a: number) => ((Math.floor(((a + Math.PI) / (2 * Math.PI)) * BINS) % BINS) + BINS) % BINS;

function makeProbe(skin: Mesh, root: Object3D): Probe | null {
  const geometry = skin.geometry;
  const index = geometry.index?.array;
  if (!index) return null;
  root.updateWorldMatrix(true, false);
  skin.updateWorldMatrix(true, false);
  const toRoot = new Matrix4().copy(root.matrixWorld).invert().multiply(skin.matrixWorld);

  // the bust's vertices, once: everything below the jaw at rest
  if (!rig.bust) {
    const pos = geometry.attributes.position;
    const v = new Vector3();
    const keep: number[] = [];
    for (let i = 0; i < pos.count; i++) if (v.fromBufferAttribute(pos, i).applyMatrix4(toRoot).y < 0.24) keep.push(i);
    rig.bust = Uint32Array.from(keep);
  }
  const at = new Map<number, number>(); // vertex → slot in P
  const P = new Float32Array(rig.bust.length * 3);
  const v = new Vector3();
  rig.bust.forEach((i, k) => {
    sculptedVertexPosition(skin, i, v).applyMatrix4(toRoot).toArray(P, k * 3); // with the sculpt (lib/sculpt.ts)
    at.set(i, k);
  });

  // the outward-facing triangles, bucketed by angle round the axis
  const bins: number[][] = Array.from({ length: BINS }, () => []);
  const tris: number[] = []; // 9 floats per triangle
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), n = new Vector3();
  for (let t = 0; t < index.length; t += 3) {
    const ka = at.get(index[t]), kb = at.get(index[t + 1]), kc = at.get(index[t + 2]);
    if (ka === undefined || kb === undefined || kc === undefined) continue;
    a.fromArray(P, ka * 3);
    b.fromArray(P, kb * 3);
    c.fromArray(P, kc * 3);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    const len = n.length();
    if (len < 1e-12 || n.y / len < -CLOTHES.rayNormalY) continue; // facing down: the bust's cap and the jaw's underside
    const a0 = Math.atan2(a.x, a.z);
    const unwrap = (x: number) => a0 + Math.atan2(Math.sin(x - a0), Math.cos(x - a0));
    const angles = [a0, unwrap(Math.atan2(b.x, b.z)), unwrap(Math.atan2(c.x, c.z))];
    const lo = Math.min(...angles), hi = Math.max(...angles);
    if (hi - lo > MAX_COLUMN_NEIGHBOURS) continue;
    const id = tris.length / 9;
    tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const first = binOf(lo), last = binOf(hi);
    for (let k = first; ; k = (k + 1) % BINS) {
      bins[k].push(id);
      if (k === last) break;
    }
  }
  const T = Float32Array.from(tris);

  const r = (theta: number, y: number): number | null => {
    const dx = Math.sin(theta), dz = Math.cos(theta);
    let best = -1;
    for (const id of bins[binOf(theta)]) {
      const o = id * 9;
      // Möller–Trumbore, ray from (0, y, 0) along (dx, 0, dz)
      const ax = T[o], ay = T[o + 1], az = T[o + 2];
      const e1x = T[o + 3] - ax, e1y = T[o + 4] - ay, e1z = T[o + 5] - az;
      const e2x = T[o + 6] - ax, e2y = T[o + 7] - ay, e2z = T[o + 8] - az;
      const px = -e2y * dz, py = dz * e2x - dx * e2z, pz = dx * e2y; // dir × e2, dir.y = 0
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = -ax, sy = y - ay, sz = -az;
      const u = (sx * px + sy * py + sz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const w = (dx * qx + dz * qz) * inv;
      if (w < 0 || u + w > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      // the nearest surface out from the axis: the neck or the bust (the chin, jaw and ears are further out)
      if (dist > 1e-4 && (best < 0 || dist < best)) best = dist;
    }
    return best > 0 ? best : null;
  };

  // the flare: going down the side of the neck, where it has widened by a quarter
  const side = (y: number) => Math.max(r(Math.PI / 2, y) ?? 0, r(-Math.PI / 2, y) ?? 0);
  // the neck's width a little under the jaw (the first height down from 0.2 m where the side is found)
  let from = 0.2;
  while (from > 0.1 && !side(from)) from -= 0.002;
  const neck = side(from) || 0.06;
  let flareY = 0.13;
  for (let y = from; y > 0.06; y -= 0.002) {
    const s = side(y);
    if (s > neck * 1.25) {
      flareY = y;
      break;
    }
  }
  return { r, flareY: Math.min(0.165, Math.max(0.1, flareY)) };
}

// --- garments -----------------------------------------------------------------------------------------------------

interface Layer {
  name: string;
  geometry: BufferGeometry;
  inner: boolean;
}

/** How a garment is cut: its neckline per direction, how thick it sits, and the roll along its top edge. */
interface Cut {
  top: (theta: number) => number;
  thickness: number;
  torsoGrow: number;
  band: number; // m down from the top edge that rolls outward (rib, collar, lapel)
  roll: number; // m it rolls out at the edge
  bandWhere?: (theta: number) => number; // 0..1: how much of the band applies in a direction (default everywhere)
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function layersFor(s: ClothesState, probe: Probe): Layer[] {
  const yf = probe.flareY;
  const thick = CLOTHES.thickness + 0.002 * (s.fit + 1);
  const grow = 0.006 * (s.fit + 1);
  const deep = (s.neckline + 1) / 2; // 0..1
  // crew: at the base of the neck, a little lower at the front
  const crew = (t: number) => yf - 0.03 + 0.036 * ((1 - Math.cos(t)) / 2) ** 0.8;
  const vee = (depth: number, width: number) => (t: number) => crew(t) - depth * Math.max(0, 1 - Math.abs(t) / width);
  const scoop = (depth: number, width: number) => (t: number) => crew(t) - depth * Math.cos(Math.min(1, Math.abs(t) / width) * (Math.PI / 2)) ** 1.5;

  switch (s.style) {
    case "tee":
      return [garment("clothes_top", probe, s, { top: crew, thickness: thick, torsoGrow: grow, band: 0.01, roll: 0.0015 }, false)];
    case "vneck":
      return [garment("clothes_top", probe, s, { top: vee(0.03 + 0.04 * deep, 0.75), thickness: thick, torsoGrow: grow, band: 0.008, roll: 0.0012 }, false)];
    case "scoop":
      return [garment("clothes_top", probe, s, { top: scoop(0.025 + 0.035 * deep, 1.25), thickness: thick, torsoGrow: grow, band: 0.006, roll: 0.001 }, false)];
    case "turtleneck": {
      const top = (t: number) => yf + 0.02 + 0.02 * ((1 - Math.cos(t)) / 2);
      return [garment("clothes_top", probe, s, { top, thickness: thick + 0.0015, torsoGrow: grow + 0.002, band: 0.035, roll: 0.004 }, false)];
    }
    case "shirt": {
      // a stand collar round the back, open at the throat (the top button undone)
      const collar = (t: number) => yf + 0.012 + 0.022 * ((1 - Math.cos(t)) / 2);
      const top = (t: number) => collar(t) - (0.035 + 0.03 * deep) * smooth(1 - Math.abs(t) / 0.42);
      return [garment("clothes_shirt", probe, s, { top, thickness: thick, torsoGrow: grow, band: 0.028, roll: 0.0035 }, false)];
    }
    case "blazer": {
      const inner = garment("clothes_inner", probe, s, { top: vee(0.02 + 0.03 * deep, 0.7), thickness: thick, torsoGrow: grow, band: 0.005, roll: 0.001 }, true);
      // the jacket: a collar up the back of the neck, open in front in a deep V down to the button
      const collar = (t: number) => yf + 0.006 + 0.026 * ((1 - Math.cos(t)) / 2);
      const open = 0.95; // radians either side of the front where the opening reaches the collar
      const button = yf - 0.15 - 0.05 * deep;
      const top = (t: number) => {
        const x = Math.abs(t) / open;
        if (x >= 1) return collar(t);
        const k = smooth(x * 1.08);
        return button + (collar(open) - button) * k ** 0.9;
      };
      const lapel = (t: number) => 1 - smooth((Math.abs(t) - open) / 0.35);
      const jacket = garment("clothes_jacket", probe, s, { top, thickness: thick + 0.007, torsoGrow: grow + 0.01, band: 0.05, roll: 0.005, bandWhere: lapel }, false);
      return [inner, jacket];
    }
    default:
      return [];
  }
}

/** The torso's half-extent along direction θ from the neck's axis: a rounded box (superellipse) round the chest. */
function torsoRadius(theta: number, s: ClothesState, grow: number): number {
  const C = CLOTHES.shoulders;
  const W = C.width + C.perUnit * s.shoulders + grow;
  const D = C.depth + C.depthPerUnit * s.build + grow;
  const dx = Math.sin(theta), dz = Math.cos(theta);
  // bisection for t: |t·dx / W|^p + |(t·dz − z0) / D|^p = 1
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    const f = Math.abs((t * dx) / W) ** C.power + Math.abs((t * dz - C.centreZ) / D) ** C.power;
    if (f > 1) hi = t;
    else lo = t;
  }
  return lo;
}

/** One garment layer as a grid: `columns` directions round the axis × `rows` points from its neckline down. */
function garment(name: string, probe: Probe, s: ClothesState, cut: Cut, inner: boolean): Layer {
  const N = CLOTHES.columns, M = CLOTHES.rows;
  const position = new Float32Array(N * M * 3);
  const colour = new Float32Array(N * M * 3);
  const uv = new Float32Array(N * M * 2);
  // 1. each column's outline, resampled to M rows (r, y, length from the top edge)
  const R = new Float32Array(N * M), Y = new Float32Array(N * M), D = new Float32Array(N * M);
  const missing: boolean[] = [];
  for (let i = 0; i < N; i++) {
    const theta = -Math.PI + (2 * Math.PI * i) / N;
    const { pts, found } = columnProfile(theta, probe, s, cut);
    missing.push(!found && cut.top(theta) > 0.1); // should be on the neck, found no skin (an extreme face)
    const len = [0];
    for (let k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const total = len[len.length - 1] || 1;
    let k = 0;
    for (let j = 0; j < M; j++) {
      // denser near the top edge, where the neckline and collar are
      const f = j / (M - 1);
      const d = total * (f * f * 0.55 + f * 0.45);
      while (k < pts.length - 2 && len[k + 1] < d) k++;
      const span = len[k + 1] - len[k] || 1;
      const u = (d - len[k]) / span;
      R[i * M + j] = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u;
      Y[i * M + j] = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u;
      D[i * M + j] = d;
    }
  }
  // 2. a column that found no skin takes its rows from the nearest good columns either side
  if (missing.some(Boolean) && !missing.every(Boolean)) {
    for (let i = 0; i < N; i++) {
      if (!missing[i]) continue;
      let a = i, b = i, da = 0, db = 0;
      while (missing[a]) {
        a = (a - 1 + N) % N;
        da++;
      }
      while (missing[b]) {
        b = (b + 1) % N;
        db++;
      }
      const t = da / (da + db);
      for (let j = 0; j < M; j++) {
        R[i * M + j] = R[a * M + j] * (1 - t) + R[b * M + j] * t;
        Y[i * M + j] = Y[a * M + j] * (1 - t) + Y[b * M + j] * t;
        D[i * M + j] = D[a * M + j] * (1 - t) + D[b * M + j] * t;
      }
    }
  }
  // 3. the band rolled out, the fold shading, the points placed round the axis
  for (let i = 0; i < N; i++) {
    const theta = -Math.PI + (2 * Math.PI * i) / N;
    const where = cut.bandWhere ? cut.bandWhere(theta) : 1;
    const dx = Math.sin(theta), dz = Math.cos(theta);
    for (let j = 0; j < M; j++) {
      const d = D[i * M + j];
      let rr = R[i * M + j];
      const yy = Y[i * M + j];
      const inBand = cut.band > 0 ? Math.max(0, 1 - d / cut.band) : 0;
      rr += cut.roll * where * Math.sqrt(inBand);
      // a soft shadow where a lapel or collar folds over (at the band's lower edge)
      const crease = where * Math.exp(-(((d - cut.band) / 0.006) ** 2)) * 0.35;
      const edge = Math.exp(-((d / 0.004) ** 2)) * 0.12; // the edge itself catches a little less light
      const shade = 1 - Math.min(0.5, crease + edge);
      const o = (i * M + j) * 3;
      position[o] = dx * rr;
      position[o + 1] = yy;
      position[o + 2] = dz * rr;
      colour[o] = colour[o + 1] = colour[o + 2] = shade;
      uv[(i * M + j) * 2] = i / N;
      uv[(i * M + j) * 2 + 1] = d;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j, b = i2 * M + j, c = i * M + j + 1, d = i2 * M + j + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colour, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(new Uint32Array(index), 1));
  geometry.computeVertexNormals();
  return { name, geometry, inner };
}

/** One column's outline in (distance from the axis, height): hugging the skin from the neckline down, then shoulders. */
function columnProfile(theta: number, probe: Probe, s: ClothesState, cut: Cut): { pts: [number, number][]; found: boolean } {
  const pts: [number, number][] = [];
  const top = cut.top(theta);
  let y = top;
  // a collar above the skin the probe sees (a long neck, a high collar): start where the neck is found
  let first = probe.r(theta, y);
  for (let guard = 0; first === null && guard < 40; guard++) first = probe.r(theta, (y -= CLOTHES.step));
  if (first === null) y = top; // nothing below either: a jacket's opening, under the bust
  for (let guard = 0; guard < 250; guard++, y -= CLOTHES.step) {
    const hit = probe.r(theta, y);
    if (hit === null) break;
    pts.push([hit + cut.thickness, y]);
  }
  const T = torsoRadius(theta, s, cut.torsoGrow) + cut.thickness;
  if (!pts.length) {
    // below the bust already (a jacket's opening): straight down the torso
    pts.push([T, top], [T, CLOTHES.bottom]);
    return { pts: monotone(pts), found: false };
  }
  const [r0, y0] = pts[pts.length - 1];
  // the skin's direction at its edge, carried on into the shoulder
  let tr = 1, ty = -1;
  if (pts.length >= 3) {
    const [r1, y1] = pts[pts.length - 3];
    tr = r0 - r1;
    ty = y0 - y1;
  }
  const tl = Math.hypot(tr, ty) || 1;
  tr /= tl;
  ty /= tl;
  if (T > r0 + 0.004) {
    const side = Math.sin(theta) ** 2;
    const yShoulder = y0 - (CLOTHES.drop.front + (CLOTHES.drop.side - CLOTHES.drop.front) * side);
    const round = Math.min(0.045, (T - r0) * 0.6);
    const P0: [number, number] = [r0, y0];
    const reach = (T - r0) * 0.55;
    const P1: [number, number] = [r0 + tr * reach, y0 + ty * reach];
    const P3: [number, number] = [T, yShoulder - round];
    const P2: [number, number] = [T, yShoulder + round * 0.2];
    for (let k = 1; k <= 24; k++) {
      const t = k / 24, m = 1 - t;
      pts.push([
        m * m * m * P0[0] + 3 * m * m * t * P1[0] + 3 * m * t * t * P2[0] + t * t * t * P3[0],
        m * m * m * P0[1] + 3 * m * m * t * P1[1] + 3 * m * t * t * P2[1] + t * t * t * P3[1],
      ]);
    }
  }
  const last = pts[pts.length - 1];
  pts.push([last[0], CLOTHES.bottom]);
  return { pts: monotone(pts), found: true };
}

/** Never back in towards the axis going down (the fabric hangs from the widest point above), heights only falling. */
function monotone(pts: [number, number][]): [number, number][] {
  for (let k = 1; k < pts.length; k++) {
    pts[k][0] = Math.max(pts[k][0], pts[k - 1][0]);
    pts[k][1] = Math.min(pts[k][1], pts[k - 1][1] - 1e-5);
  }
  return pts;
}

/** For the .glb export: the clothes' material as drawn (a copy: the export disposes what it is given). */
export function clothesMaterialFor(mesh: Mesh): MeshPhysicalMaterial {
  const m = (mesh.material as MeshPhysicalMaterial).clone();
  m.name = mesh.name;
  return m;
}
