/** The camera finish's stored settings are checked field by field (lib/finishSettings.ts). */
import { describe, expect, it } from "vitest";

import { FINISH_DEFAULTS, sanitizeFinish } from "@/lib/finishSettings";

describe("finish settings", () => {
  it("clamps, drops unknown fields and falls back to the defaults", () => {
    expect(sanitizeFinish({ on: "yes", focus: 3, bloom: -1, grain: Number.NaN, vignette: 0.2, extra: true })).toEqual({
      on: FINISH_DEFAULTS.on,
      focus: 1,
      bloom: 0,
      grain: FINISH_DEFAULTS.grain,
      vignette: 0.2,
      grade: FINISH_DEFAULTS.grade,
      clarity: FINISH_DEFAULTS.clarity,
      skin: FINISH_DEFAULTS.skin,
      light: FINISH_DEFAULTS.light,
    });
    expect(sanitizeFinish(null)).toEqual(FINISH_DEFAULTS);
    expect(sanitizeFinish({ on: false }).on).toBe(false);
  });
});
