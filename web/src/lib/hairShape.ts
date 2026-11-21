/**
 * Re-shaping a hair style's strands (Style tab → Hair → "Wear it" and "Volume"): any long enough style can be tied back
 * (half up, a low or high ponytail, a bun), with face-framing strands left loose, and any style made fuller or flatter.
 * Pure arithmetic on the strand file's points (head space, metres), so it runs on every style without new downloads;
 * lib/groom.ts writes the result into the strands' position texture (the hair's shadow, the export and the screenshot
 * all use it).
 *
 * Tying: each tied strand is combed over the scalp (along the great circle from its root's direction to the tie's,
 * `lift` off the skin, meeting the others at the band), then its remaining length makes the tail (out from the head,
 * then down under gravity, fanning wider towards the ends) or coils round into a bun. A strand keeps its length; one too
 * short to reach the band just lies combed back. The style's own waves and curls (each point's offset from its
 * strand's moving average) are put back on: sleek on the scalp, all of it in the tail.
 *
 * Volume: every point moves away from the head (radially above the ears, out from the head's vertical axis below),
 * growing over the strand's first few cm; never into the head (`scalp`, the skin's radius in each direction).
 *
 * Tweak in HAIR_SHAPE.
 */

export const HAIR_TIES = ["down", "half", "low", "high", "bun"] as const;
export type HairTie = (typeof HAIR_TIES)[number];
export type HairShape = { tie: HairTie; framing: boolean; volume: number };
export const HAIR_SHAPE_DEFAULTS: HairShape = { tie: "down", framing: true, volume: 0 };

export const HAIR_SHAPE = {
  centre: [0, 0.29, 0.005] as [number, number, number], // the head's centre (m): directions and the scalp radius are from here
  lift: 0.0035, // tied hair lies this far off the scalp (m)
  // where each tie sits: elevation (degrees, from the centre, at the back of the head) and its band's radius (m)
  ties: { half: { pitch: 22, band: 0.007 }, low: { pitch: -24, band: 0.008 }, high: { pitch: 34, band: 0.008 }, bun: { pitch: 2, band: 0.012 } },
  tailOut: 0.03, // a tail first leaves the head this far before it falls (m)
  tailSpread: 0.022, // how much wider a tail fans by its ends (m)
  bunRadius: [0.012, 0.034] as [number, number], // a bun's coil, inner and outer (m)
  volumeOut: 0.024, // the most "Volume" +1 moves hair away from the head (m) …
  volumeIn: 0.012, // … and −1 towards it
  volumeRamp: 0.05, // … reached this far along a strand (m)
  collideAbove: 0.215, // m: below this the head isn't round any more (neck, shoulders): no collision there
  clearance: 0.0018, // hair never closer to the skin than this (m)
  framingShare: 0.55, // of the strands rooted at the front corners of the hairline, this many stay loose (framing)
};

export function sanitizeHairShape(raw: unknown): HairShape {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = HAIR_SHAPE_DEFAULTS;
  return {
    tie: HAIR_TIES.includes(r.tie as HairTie) ? (r.tie as HairTie) : d.tie,
    framing: typeof r.framing === "boolean" ? r.framing : d.framing,
    volume: typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.min(1, Math.max(-1, r.volume)) : d.volume,
  };
}

export const isPlainShape = (s: HairShape) => s.tie === "down" && Math.abs(s.volume) < 1e-3;

// --- the scalp -------------------------------------------------------------------------------------------------------

/** The skin's distance from the head centre in any direction (the furthest skin there: scalp, face, ears). */
export type Scalp = { radius: (x: number, y: number, z: number) => number };

const GW = 96, GH = 48; // longitude × latitude cells

/** From the skin's rest positions (head space, metres, 3 per vertex). */
export function scalpLookup(skin: Float32Array, centre = HAIR_SHAPE.centre): Scalp {
  const grid = new Float32Array(GW * GH);
  const [cx, cy, cz] = centre;
  for (let i = 0; i < skin.length; i += 3) {
    const x = skin[i] - cx, y = skin[i + 1] - cy, z = skin[i + 2] - cz;
    const r = Math.hypot(x, y, z);
    if (r < 1e-6) continue;
    const c = cellOf(x / r, y / r, z / r);
    if (r > grid[c]) grid[c] = r;
  }
  // cells no vertex fell in: the average of filled neighbours, repeated until all are filled
  for (let pass = 0; pass < 64; pass++) {
    let empty = 0;
    const next = grid.slice();
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        const k = j * GW + i;
        if (grid[k] > 0) continue;
        let sum = 0, cnt = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jj = j + dj;
          if (jj < 0 || jj >= GH) continue;
          const v = grid[jj * GW + ((i + di + GW) % GW)];
          if (v > 0) {
            sum += v;
            cnt++;
          }
        }
        if (cnt) next[k] = sum / cnt;
        else empty++;
      }
    grid.set(next);
    if (!empty) break;
  }
  return {
    radius(x, y, z) {
      const len = Math.hypot(x, y, z) || 1;
      const u = ((Math.atan2(x / len, z / len) / (2 * Math.PI) + 1) % 1) * GW - 0.5;
      const v = ((Math.asin(Math.max(-1, Math.min(1, y / len))) / Math.PI) + 0.5) * GH - 0.5;
      const i0 = Math.floor(u), j0 = Math.max(0, Math.min(GH - 1, Math.floor(v)));
      const j1 = Math.min(GH - 1, j0 + 1), fu = u - i0, fv = Math.max(0, Math.min(1, v - j0));
      const at = (i: number, j: number) => grid[j * GW + ((i + GW) % GW)];
      return (at(i0, j0) * (1 - fu) + at(i0 + 1, j0) * fu) * (1 - fv) + (at(i0, j1) * (1 - fu) + at(i0 + 1, j1) * fu) * fv;
    },
  };
}

function cellOf(x: number, y: number, z: number): number {
  const i = Math.min(GW - 1, Math.floor(((Math.atan2(x, z) / (2 * Math.PI) + 1) % 1) * GW));
  const j = Math.min(GH - 1, Math.max(0, Math.floor((Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI + 0.5) * GH)));
  return j * GW + i;
}

// --- shaping ---------------------------------------------------------------------------------------------------------

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V): V => mul(a, 1 / (len(a) || 1));
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Unit-vector spherical interpolation (via "up" when the two are nearly opposite). */
function slerp(a: V, b: V, t: number): V {
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (d < -0.95) return t < 0.5 ? slerp(a, [0, 1, 0], t * 2) : slerp([0, 1, 0], b, t * 2 - 1);
  const th = Math.acos(d);
  if (th < 1e-5) return a;
  const s = Math.sin(th);
  return norm(add(mul(a, Math.sin((1 - t) * th) / s), mul(b, Math.sin(t * th) / s)));
}

/** A small deterministic random number per (strand, salt). */
const rnd = (s: number, salt: number) => {
  const x = Math.sin(s * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * The style re-shaped: positions (n·p·3) and per-point shade (0..1, how buried; the baked shade for strands left as they
 * were). `src`/`srcShade` are the file's.
 */
export function shapeStrands(src: Float32Array, srcShade: Float32Array, n: number, p: number, shape: HairShape, scalp: Scalp): { positions: Float32Array; shade: Float32Array } {
  const out = src.slice();
  const shade = srcShade.slice();
  if (isPlainShape(shape)) return { positions: out, shade };
  const H = HAIR_SHAPE;
  const c: V = [...H.centre];
  const tie = shape.tie === "down" ? null : H.ties[shape.tie];
  const tieDir: V = tie ? norm([0, Math.sin((tie.pitch * Math.PI) / 180), -Math.cos((tie.pitch * Math.PI) / 180)]) : [0, 0, -1];
  const surf = (d: V) => scalp.radius(d[0], d[1], d[2]);
  const vol = shape.volume;
  // the plane across the tie (for each strand's place in the band, and the bun's coil)
  const tu = norm(Math.abs(tieDir[1]) > 0.9 ? cross(tieDir, [1, 0, 0]) : cross(tieDir, [0, 1, 0]));
  const tv = cross(tieDir, tu);
  const arc = new Float32Array(p);
  const pts: V[] = [];
  const dev: V[] = [];
  for (let s = 0; s < n; s++) {
    const o = s * p * 3;
    const at = (k: number): V => [src[o + k * 3], src[o + k * 3 + 1], src[o + k * 3 + 2]];
    arc[0] = 0;
    for (let k = 1; k < p; k++) arc[k] = arc[k - 1] + len(sub(at(k), at(k - 1)));
    const total = arc[p - 1];
    const root = at(0);
    const rootDir = norm(sub(root, c));
    // the style's waves and curls: each point's offset from its strand's 5-point moving average
    pts.length = dev.length = 0;
    for (let k = 0; k < p; k++) pts.push(at(k));
    for (let k = 0; k < p; k++) {
      let m: V = [0, 0, 0], cnt = 0;
      for (let q = Math.max(0, k - 2); q <= Math.min(p - 1, k + 2); q++) {
        m = add(m, pts[q]);
        cnt++;
      }
      dev.push(sub(pts[k], mul(m, 1 / cnt)));
    }
    const framing = shape.framing && rootDir[2] > 0.35 && Math.abs(rootDir[0]) > 0.22 && rootDir[1] < 0.75 && rnd(s, 1) < H.framingShare;
    const tied = !!tie && !framing && (shape.tie !== "half" || rootDir[1] > 0.3 || (rootDir[1] > 0.12 && rootDir[2] > 0.2));
    if (tied && total > 1e-4) {
      // this strand's place in the band and its own tail direction
      const ang = rnd(s, 2) * Math.PI * 2, rr = Math.sqrt(rnd(s, 3));
      const bandOff: V = add(mul(tu, Math.cos(ang) * rr), mul(tv, Math.sin(ang) * rr));
      const band = tie!.band * (1 + 0.5 * Math.max(0, vol));
      // over the scalp: the great circle from the root to the tie
      const lift0 = Math.max(0, len(sub(root, c)) - surf(rootDir));
      const path: V[] = [];
      const steps = 24;
      for (let j = 0; j <= steps; j++) {
        const u = j / steps;
        const d = slerp(rootDir, tieDir, u);
        const r = surf(d) + lift0 * (1 - u) + (H.lift + Math.max(0, vol) * 0.004) * smooth(0, 0.2, u);
        path.push(add(add(c, mul(d, r)), mul(bandOff, band * smooth(0.6, 1, u))));
      }
      const gate = path[path.length - 1];
      const curve: V[] = [...path];
      // the rest: a tail or a bun
      const pathLen = path.reduce((acc, q, j) => (j ? acc + len(sub(q, path[j - 1])) : 0), 0);
      const rest = total - pathLen;
      if (rest > 0) {
        const segs = Math.max(4, Math.ceil(rest / 0.006));
        if (shape.tie === "bun") {
          const [r0, r1] = H.bunRadius;
          const a0 = rnd(s, 4) * Math.PI * 2;
          let a = a0;
          for (let j = 1; j <= segs; j++) {
            const l = (j / segs) * rest;
            const f = Math.min(1, l / 0.4);
            let r = (r0 + (r1 - r0) * Math.sqrt(f)) * (0.85 + 0.3 * rnd(s, 5)) * (1 + 0.25 * vol);
            if (j > segs * 0.9) r *= 0.7; // the ends tucked in
            a += rest / segs / Math.max(r, 0.004);
            const h = 0.005 + 0.016 * f * (0.6 + 0.4 * Math.sin(a * 0.5 + a0));
            curve.push(add(add(gate, mul(tieDir, h)), add(mul(tu, Math.cos(a) * r), mul(tv, Math.sin(a) * r))));
          }
        } else {
          const sway = (rnd(s, 6) - 0.5) * 0.4;
          const spread = norm(add(bandOff, [sway * 0.2, 0, 0]));
          for (let j = 1; j <= segs; j++) {
            const l = (j / segs) * rest;
            const out = H.tailOut * (1 - Math.exp(-l / H.tailOut));
            const fan = (H.tailSpread * (1 + 0.6 * vol)) * smooth(0, 0.3, l) * Math.sqrt(rnd(s, 7));
            curve.push(add(add(add(gate, mul(tieDir, out)), [0, -(l - out), 0]), mul(spread, fan)));
          }
        }
      }
      // resample at the strand's own arc lengths (it keeps its length), then put its waves back
      const cl = [0];
      for (let j = 1; j < curve.length; j++) cl.push(cl[j - 1] + len(sub(curve[j], curve[j - 1])));
      let seg = 1;
      for (let k = 0; k < p; k++) {
        const want = Math.min(arc[k], cl[cl.length - 1]);
        while (seg < cl.length - 1 && cl[seg] < want) seg++;
        const t = (want - cl[seg - 1]) / Math.max(1e-9, cl[seg] - cl[seg - 1]);
        let q = add(curve[seg - 1], mul(sub(curve[seg], curve[seg - 1]), Math.max(0, Math.min(1, t))));
        const onScalp = arc[k] < pathLen;
        q = add(q, mul(dev[k], onScalp ? 0.25 : 1));
        if (k === 0) q = root;
        out.set(q, o + k * 3);
        // shade: lying on the scalp, half lit; in a tail or bun, darker towards its middle
        shade[s * p + k] = onScalp ? 0.75 : 0.45 + 0.5 * Math.sqrt(rnd(s, 7));
      }
    }
    if (vol !== 0) {
      // fuller or flatter: away from (towards) the head, growing over the first few cm
      const k0 = tied ? 0.35 : 1; // tied hair is sleek: less of it
      const amount = (vol > 0 ? H.volumeOut : H.volumeIn) * vol * k0;
      for (let k = 1; k < p; k++) {
        const q: V = [out[o + k * 3], out[o + k * 3 + 1], out[o + k * 3 + 2]];
        const axis: V = [c[0], Math.min(q[1], c[1]), c[2]]; // radial above the centre, out from the axis below it
        const d = norm(sub(q, axis));
        out.set(add(q, mul(d, amount * smooth(0, H.volumeRamp, arc[k]))), o + k * 3);
      }
    }
    // never inside the head
    for (let k = 1; k < p; k++) {
      const q: V = [out[o + k * 3], out[o + k * 3 + 1], out[o + k * 3 + 2]];
      if (q[1] < H.collideAbove) continue;
      const d = sub(q, c);
      const r = len(d);
      const min = surf(d) + H.clearance;
      if (r < min) out.set(add(c, mul(d, min / (r || 1))), o + k * 3);
    }
  }
  return { positions: out, shade };
}
