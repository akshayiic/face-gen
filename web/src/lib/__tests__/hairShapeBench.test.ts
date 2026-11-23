/** Re-shaping a full-size style (6000 strands × 32 points) stays quick: shaping, then re-baking its shade. */
import { describe, expect, it } from "vitest";

import { bakeHairShade } from "@/lib/hairShadow";
import { HAIR_SHAPE, scalpLookup, shapeStrands } from "@/lib/hairShape";

const C = HAIR_SHAPE.centre, R = 0.09, P = 32, N = 6000;

describe("hair shape speed", () => {
  it("ties back a full-size style quickly", () => {
    const skin: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const y = 1 - (2 * (i + 0.5)) / 4000, r = Math.sqrt(1 - y * y), a = i * 2.399963;
      skin.push(C[0] + R * r * Math.cos(a), C[1] + R * y, C[2] + R * r * Math.sin(a));
    }
    const scalp = scalpLookup(Float32Array.from(skin));
    const src = new Float32Array(N * P * 3);
    for (let s = 0; s < N; s++) {
      const el = 0.2 + 1.2 * ((s * 0.618) % 1), az = s * 2.399963;
      const d = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
      for (let k = 0; k < P; k++) src.set([C[0] + d[0] * (R + 0.002), C[1] + d[1] * R - k * 0.01, C[2] + d[2] * (R + 0.002)], (s * P + k) * 3);
    }
    const t = performance.now();
    const res = shapeStrands(src, new Float32Array(N * P).fill(0.6), N, P, { tie: "low", framing: true, volume: 0.4 }, scalp);
    const shade = bakeHairShade({ positions: res.positions, n: N, p: P, width: 0.1 });
    expect(shade.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(performance.now() - t).toBeLessThan(5000); // ~0.25 s on a laptop; generous for a loaded CI machine
  }, 60_000);
});
