/**
 * Re-shaping hair (lib/hairShape.ts) on a round test head: tied strands meet at the tie and keep their length, tails
 * hang below it, buns coil round it, volume moves hair away from (towards) the head, and nothing goes inside it.
 */
import { describe, expect, it } from "vitest";

import { HAIR_SHAPE, type HairShape, sanitizeHairShape, scalpLookup, shapeStrands } from "@/lib/hairShape";

const C = HAIR_SHAPE.centre;
const R = 0.09; // the test head's radius (m)
const P = 24;

/** A sphere of "skin" round the head centre. */
function sphereSkin(): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i < 4000; i++) {
    const y = 1 - (2 * (i + 0.5)) / 4000, r = Math.sqrt(1 - y * y), a = i * 2.399963;
    pts.push(C[0] + R * r * Math.cos(a), C[1] + R * y, C[2] + R * r * Math.sin(a));
  }
  return Float32Array.from(pts);
}

/** Strands rooted over the top of the head, combed down and hanging `length` m. */
function strands(n: number, length: number): Float32Array {
  const out = new Float32Array(n * P * 3);
  for (let s = 0; s < n; s++) {
    const el = 0.2 + 1.2 * ((s * 0.618) % 1), az = s * 2.399963;
    const dir = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    const root = [C[0] + dir[0] * R, C[1] + dir[1] * R, C[2] + dir[2] * R];
    for (let k = 0; k < P; k++) {
      const l = (k / (P - 1)) * length;
      // out a little from the head, then straight down
      const side = Math.min(l, 0.01);
      out.set([root[0] + dir[0] * side, root[1] - (l - side), root[2] + dir[2] * side], (s * P + k) * 3);
    }
  }
  return out;
}

const scalp = scalpLookup(sphereSkin());
const shade = (n: number) => new Float32Array(n * P).fill(0.6);
const strandLen = (pos: Float32Array, s: number) => {
  let l = 0;
  for (let k = 1; k < P; k++) {
    const a = (s * P + k - 1) * 3, b = (s * P + k) * 3;
    l += Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
  }
  return l;
};
const dist = (pos: Float32Array, i: number) => Math.hypot(pos[i * 3] - C[0], pos[i * 3 + 1] - C[1], pos[i * 3 + 2] - C[2]);
const shape = (s: Partial<HairShape>): HairShape => ({ tie: "down", framing: false, volume: 0, ...s });

describe("hair shape", () => {
  it("knows the skin's radius in every direction", () => {
    for (const d of [[0, 1, 0], [1, 0, 0], [0, 0, -1], [0.5, -0.5, 0.7]]) expect(scalp.radius(d[0], d[1], d[2])).toBeCloseTo(R, 2);
  });

  it("leaves the style alone as filed", () => {
    const src = strands(20, 0.3);
    expect(shapeStrands(src, shade(20), 20, P, shape({}), scalp).positions).toEqual(src);
  });

  it("ties a low ponytail: every strand through the band, its length kept, the tail hanging below, never in the head", () => {
    const n = 60, src = strands(n, 0.35);
    const { positions } = shapeStrands(src, shade(n), n, P, shape({ tie: "low" }), scalp);
    const pitch = (HAIR_SHAPE.ties.low.pitch * Math.PI) / 180;
    const band = [C[0], C[1] + Math.sin(pitch) * (R + 0.006), C[2] - Math.cos(pitch) * (R + 0.006)];
    for (let s = 0; s < n; s++) {
      expect(positions.slice(s * P * 3, s * P * 3 + 3)).toEqual(src.slice(s * P * 3, s * P * 3 + 3)); // the root stays
      expect(Math.abs(strandLen(positions, s) - strandLen(src, s))).toBeLessThan(0.05 * strandLen(src, s)); // its waves put back stretch it a little
      let near = Infinity;
      for (let k = 0; k < P; k++) {
        const i = (s * P + k) * 3;
        near = Math.min(near, Math.hypot(positions[i] - band[0], positions[i + 1] - band[1], positions[i + 2] - band[2]));
        if (k > 0 && positions[i + 1] > HAIR_SHAPE.collideAbove) expect(dist(positions, s * P + k)).toBeGreaterThan(R); // roots sit on the skin
      }
      expect(near).toBeLessThan(0.02); // through the band
      expect(positions[(s * P + P - 1) * 3 + 1]).toBeLessThan(band[1] - 0.02); // the tail hangs …
    }
    // … most of them well down (hair rooted at the front spends ~30 cm getting over the crown, as on a real head)
    const tips = Array.from({ length: n }, (_, s) => positions[(s * P + P - 1) * 3 + 1]).sort((a, b) => a - b);
    expect(tips[Math.floor(n / 2)]).toBeLessThan(band[1] - 0.08);
  });

  it("coils a bun round the tie, and short strands just lie combed back", () => {
    const n = 40, src = strands(n, 0.3);
    const { positions } = shapeStrands(src, shade(n), n, P, shape({ tie: "bun" }), scalp);
    for (let s = 0; s < n; s++) {
      const tip = (s * P + P - 1) * 3;
      // the tip sits at the back of the head, within the bun's reach
      expect(positions[tip + 2]).toBeLessThan(C[2] - R * 0.7);
      expect(Math.abs(positions[tip + 1] - C[1])).toBeLessThan(0.06);
    }
    const short = strands(10, 0.04);
    const combed = shapeStrands(short, shade(10), 10, P, shape({ tie: "bun" }), scalp).positions;
    for (let s = 0; s < 10; s++) expect(Math.abs(strandLen(combed, s) - strandLen(short, s))).toBeLessThan(0.004);
  });

  it("moves hair out with volume, in without it, never into the head", () => {
    const n = 40, src = strands(n, 0.3);
    const away = (pos: Float32Array) => {
      let sum = 0;
      for (let i = 0; i < n * P; i++) sum += Math.hypot(pos[i * 3] - C[0], pos[i * 3 + 2] - C[2]);
      return sum / (n * P);
    };
    const full = shapeStrands(src, shade(n), n, P, shape({ volume: 1 }), scalp).positions;
    const flat = shapeStrands(src, shade(n), n, P, shape({ volume: -1 }), scalp).positions;
    expect(away(full)).toBeGreaterThan(away(src) + 0.01);
    expect(away(flat)).toBeLessThan(away(src));
    for (let i = 0; i < n * P; i++) if (i % P && flat[i * 3 + 1] > HAIR_SHAPE.collideAbove) expect(dist(flat, i)).toBeGreaterThan(R);
  });

  it("checks stored values", () => {
    expect(sanitizeHairShape({ tie: "dreads", framing: "yes", volume: 5 })).toEqual({ tie: "down", framing: true, volume: 1 });
    expect(sanitizeHairShape({ tie: "bun", framing: false, volume: -0.3 })).toEqual({ tie: "bun", framing: false, volume: -0.3 });
  });
});
