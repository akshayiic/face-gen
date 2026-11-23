/**
 * The realistic-skin pieces: the built-in fine skin texture (relief as measured on a studio skin pack's micro normal,
 * tileable, the shader's slope encoding), the conversion of an uploaded normal map, the presets, the blush colour and
 * the new stored values (hair density and thickness, lashes, eye makeup).
 */
import { describe, expect, it } from "vitest";

import { sanitizeHairWear } from "@/lib/hair";
import { LASH_DEFAULTS } from "@/lib/lashLook";
import { blushTint, sanitizeSkinDetails, SKIN_DETAILS_DEFAULTS } from "@/lib/skinDetails";
import { generateMicro, MICRO, slopeMapFromNormal } from "@/lib/skinMicro";
import { detectRealism, REALISM_PRESETS } from "@/lib/skinRealism";

const dec = (b: number) => (b / 255 - 0.5) * 2 * MICRO.slopeRange;

describe("the built-in fine skin texture", () => {
  const { data, rms } = generateMicro(256);

  it("has the relief the pack's micro normal has (rms slope 0.30), within what an 8-bit slope can say", () => {
    expect(rms).toBeCloseTo(MICRO.rmsSlope, 1);
    let s2 = 0;
    for (let i = 0; i < 256 * 256; i++) s2 += dec(data[i * 4]) ** 2 + dec(data[i * 4 + 1]) ** 2;
    expect(Math.sqrt(s2 / (256 * 256))).toBeGreaterThan(0.27);
    expect(Math.sqrt(s2 / (256 * 256))).toBeLessThan(0.33);
  });

  it("is centred (no overall tilt), has pores on some of it and a roughness variation", () => {
    let mx = 0, my = 0, pores = 0, rmin = 255, rmax = 0;
    for (let i = 0; i < 256 * 256; i++) {
      mx += dec(data[i * 4]);
      my += dec(data[i * 4 + 1]);
      if (data[i * 4 + 2] > 128) pores++;
      rmin = Math.min(rmin, data[i * 4 + 3]);
      rmax = Math.max(rmax, data[i * 4 + 3]);
    }
    expect(Math.abs(mx / (256 * 256))).toBeLessThan(0.02);
    expect(Math.abs(my / (256 * 256))).toBeLessThan(0.02);
    expect(pores / (256 * 256)).toBeGreaterThan(0.005);
    expect(pores / (256 * 256)).toBeLessThan(0.15);
    expect(rmax - rmin).toBeGreaterThan(40);
  });

  it("tiles: across the edge it changes no more than inside", () => {
    // mean absolute difference between neighbouring texels, inside vs across the wrap (columns 255 → 0)
    let inside = 0, edge = 0;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 255; x++) inside += Math.abs(data[(y * 256 + x) * 4] - data[(y * 256 + x + 1) * 4]);
      edge += Math.abs(data[(y * 256 + 255) * 4] - data[y * 256 * 4]);
    }
    expect(edge / 256).toBeLessThan((inside / (256 * 255)) * 1.6 + 2);
  });

  it("is the same every time", () => {
    expect(generateMicro(64).data).toEqual(generateMicro(64).data);
  });

  it("uses the slope range the shader decodes (stored 0.5 ± 2: × 4 − 2)", () => {
    expect(MICRO.slopeRange).toBe(2);
  });
});

describe("an uploaded normal map as a slope map", () => {
  const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);

  it("a flat normal is a flat slope", () => {
    const out = slopeMapFromNormal(px(128, 128, 255), 1);
    expect(Math.abs(dec(out[0]))).toBeLessThan(0.02);
    expect(Math.abs(dec(out[1]))).toBeLessThan(0.02);
    expect(out[2]).toBe(0);
  });

  it("a normal leaning +x is a surface falling towards +x; the green is up the image, so rows read it the other way", () => {
    const lean = Math.round(127.5 + 127.5 * 0.5); // nx = 0.5
    const out = slopeMapFromNormal(px(lean, 128, 220), 1);
    expect(dec(out[0])).toBeLessThan(-0.4); // −nx/nz
    const up = slopeMapFromNormal(px(128, lean, 220), 1);
    expect(dec(up[1])).toBeGreaterThan(0.4); // +ny/nz along the rows
  });

  it("invert flips the relief", () => {
    const lean = Math.round(127.5 + 127.5 * 0.5);
    const a = slopeMapFromNormal(px(lean, lean, 200), 1, false);
    const b = slopeMapFromNormal(px(lean, lean, 200), 1, true);
    expect(dec(a[0])).toBeCloseTo(-dec(b[0]), 1);
    expect(dec(a[1])).toBeCloseTo(-dec(b[1]), 1);
  });

  it("keeps a steep slope inside the stored range", () => {
    const out = slopeMapFromNormal(px(255, 128, 20), 1);
    expect(dec(out[0])).toBeGreaterThanOrEqual(-MICRO.slopeRange);
  });
});

describe("realistic skin presets", () => {
  it("each preset is found again from its own values, and a changed slider is custom", () => {
    for (const p of REALISM_PRESETS) expect(detectRealism({ ...SKIN_DETAILS_DEFAULTS, ...p.patch })).toBe(p.id);
    expect(detectRealism({ ...SKIN_DETAILS_DEFAULTS, ...REALISM_PRESETS[2].patch, pores: 1.9 })).toBeNull();
  });

  it("Realistic is the defaults, so a new visitor has it chosen", () => {
    expect(detectRealism(SKIN_DETAILS_DEFAULTS)).toBe("realistic");
  });

  it("gets stronger from Natural to Hyper-real", () => {
    const m = REALISM_PRESETS.map((p) => p.patch.microDetail);
    expect([...m].sort((a, b) => a - b)).toEqual(m);
  });
});

describe("blush colours and the other new settings", () => {
  it("the default blush is the rose the shader always had, and a colour keeps its own ratios", () => {
    expect(blushTint("")).toEqual([1, 0.68, 0.7]);
    const peach = blushTint("#f0a08a");
    expect(peach[0]).toBe(1);
    expect(peach[1]).toBeGreaterThan(0.6);
    expect(peach[2]).toBeLessThan(peach[1]); // peach: less blue than green
    const berry = blushTint("#d8607a");
    expect(berry[1]).toBeLessThan(peach[1]); // deeper
  });

  it("checks every new skin detail", () => {
    const d = sanitizeSkinDetails({
      microDetail: 9, lipLines: -1, blushColour: "pink", blushSpread: 5, eyeLiner: 2, eyeLinerWing: "x", eyeLinerColour: "nope", eyeShadow: -3, eyeShadowColour: "#ABCDEF",
      lashLength: 9, lashCurl: -9, lashDensity: 9,
    });
    expect(d).toMatchObject({
      microDetail: 2, lipLines: 0, blushColour: "", blushSpread: 1, eyeLiner: 1, eyeLinerWing: 0.5, eyeLinerColour: "#1c1517", eyeShadow: 0,
      eyeShadowColour: "#abcdef", lashLength: 1.8, lashCurl: -1, lashDensity: 2,
    });
  });

  it("lashes start as they were drawn", () => {
    expect(LASH_DEFAULTS).toMatchObject({ length: 1, curl: 0, density: 1 });
    expect(SKIN_DETAILS_DEFAULTS).toMatchObject({ lashLength: 1, lashCurl: 0, lashDensity: 1, microDetail: 1, lipLines: 0.6, eyeLiner: 0, eyeShadow: 0 });
  });

  it("hair density and thickness are kept in range (older saves get 1)", () => {
    expect(sanitizeHairWear({ density: 9, thickness: 0 })).toMatchObject({ density: 2, thickness: 0.5 });
    expect(sanitizeHairWear({})).toMatchObject({ density: 1, thickness: 1 });
  });
});
