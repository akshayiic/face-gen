import { describe, expect, it } from "vitest";

import { addonStyles } from "@/lib/addons";
import { INDIAN_WOMAN, womanLean } from "@/lib/characterProfiles";
import { sliders } from "@/lib/data";
import { EYE_COLOURS } from "@/lib/eyes";
import { HAIR_STYLES } from "@/lib/hair";
import { HAIR_COLOURS, SKIN_TONES } from "@/lib/swatches";

const ids = (list: readonly { id: string }[]) => new Set(list.map((x) => x.id));

describe("Random Indian woman (lib/characterProfiles.ts)", () => {
  it("only names skin tones, eye and hair colours, hair groups, brows and lashes that exist", () => {
    for (const k of Object.keys(INDIAN_WOMAN.skin)) expect(ids(SKIN_TONES).has(k), `skin ${k}`).toBe(true);
    for (const k of Object.keys(INDIAN_WOMAN.eyes)) expect(ids(EYE_COLOURS).has(k), `eyes ${k}`).toBe(true);
    for (const k of Object.keys(INDIAN_WOMAN.hairColours)) expect(ids(HAIR_COLOURS).has(k), `hair ${k}`).toBe(true);
    const groups = new Set(HAIR_STYLES.map((s) => s.group));
    for (const k of Object.keys(INDIAN_WOMAN.hairGroups)) expect(groups.has(k as never), `group ${k}`).toBe(true);
    for (const k of Object.keys(INDIAN_WOMAN.eyebrows)) expect(ids(addonStyles("eyebrows")).has(k), `brows ${k}`).toBe(true);
    for (const k of Object.keys(INDIAN_WOMAN.eyelashes)) expect(ids(addonStyles("eyelashes")).has(k), `lashes ${k}`).toBe(true);
  });

  it("leans only on Feature sliders the model has, and every lip shade is a hex colour", () => {
    const targets = new Set(sliders.sliders.map((s) => s.target));
    for (const k of Object.keys(INDIAN_WOMAN.lean)) expect(targets.has(k), `slider ${k}`).toBe(true);
    for (const c of INDIAN_WOMAN.lipShades) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps the lean inside each slider's range, around its centre", () => {
    const ranges = Object.fromEntries(sliders.sliders.map((s) => [s.target, { min: s.min, max: s.max }]));
    const sums: Record<string, number> = {};
    const n = 400;
    for (let i = 0; i < n; i++) {
      const w = womanLean(ranges);
      for (const [t, v] of Object.entries(w)) {
        expect(v).toBeGreaterThanOrEqual(ranges[t].min);
        expect(v).toBeLessThanOrEqual(ranges[t].max);
        sums[t] = (sums[t] ?? 0) + v;
      }
    }
    for (const [t, [centre, spread]] of Object.entries(INDIAN_WOMAN.lean)) expect(Math.abs(sums[t] / n - centre)).toBeLessThan(spread * 0.25);
  });

  it("skips a slider the build doesn't have", () => {
    expect(womanLean({ sem_jaw_width: { min: -1, max: 1 } })).toEqual({ sem_jaw_width: expect.any(Number) });
  });

  it("covers an Age range from youthful to mature, with girls under the makeup line", () => {
    expect(INDIAN_WOMAN.age[0]).toBeLessThan(INDIAN_WOMAN.girlBelow);
    expect(INDIAN_WOMAN.age[1]).toBeGreaterThan(0);
  });
});
