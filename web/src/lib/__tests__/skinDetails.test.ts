/**
 * Skin details on the real head (public/models/head.glb): moles land on the skin, spread out and never on the eyes,
 * lips or nostrils; the same seed gives the same places; stored and linked values are checked field by field.
 */
import { readFileSync } from "node:fs";

import type { Mesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { beforeAll, describe, expect, it } from "vitest";

import { headSpaceMatrix } from "@/lib/age";
import { applySkinDetails, sanitizeSkinDetails, setSkinDetails } from "@/lib/skinDetails";
import { MAX_MOLES, skinUniforms } from "@/lib/skinShader";
import { skinSurface } from "@/lib/skinSurface";
import { sanitizeHair, sanitizeSkin } from "@/lib/surfaceTextures";

beforeAll(async () => {
  const buf = readFileSync("public/models/head.glb");
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), "");
  let skin: Mesh | null = null;
  gltf.scene.traverse((o) => {
    if ((o as Mesh).isMesh && (o.parent?.name || o.name) === "skin") skin = o as Mesh;
  });
  skinSurface.mesh = skin;
  headSpaceMatrix(skin!, skinSurface.toHead);
});

const moles = () => skinUniforms.uMoles.value.slice(0, skinUniforms.uMoleCount.value).map((v) => v.clone());

describe("skin details", { timeout: 30_000 }, () => {
  it("puts every mole on the skin, apart, and off the eyes, lips and nostrils", () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      setSkinDetails({ moles: MAX_MOLES, moleSeed: seed, moleSize: 1 });
      const spots = moles();
      expect(spots.length).toBe(MAX_MOLES);
      for (const m of spots) {
        expect(m.w).toBeGreaterThan(0.4);
        expect(m.w).toBeLessThan(3);
        const eye = ((Math.abs(m.x) - 30.9) / 19) ** 2 + ((m.y - 303.2) / 13) ** 2;
        if (m.z > 70) expect(eye, `seed ${seed}: on an eye`).toBeGreaterThanOrEqual(1);
        expect(m.z > 105 && Math.abs(m.x) < 30 && m.y > 218 && m.y < 252, `seed ${seed}: on the lips`).toBe(false);
        expect(m.y).toBeGreaterThanOrEqual(130);
        expect(m.y).toBeLessThanOrEqual(360);
      }
      for (let i = 0; i < spots.length; i++)
        for (let j = i + 1; j < spots.length; j++)
          expect(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y, spots[i].z - spots[j].z)).toBeGreaterThanOrEqual(8 - 1e-4);
    }
  });

  it("keeps the places for a seed, and more moles only adds to them", () => {
    setSkinDetails({ moles: 4, moleSeed: 7 });
    const four = moles();
    setSkinDetails({ moles: 9 });
    const nine = moles();
    expect(nine.slice(0, 4).map((v) => v.toArray().slice(0, 3))).toEqual(four.map((v) => v.toArray().slice(0, 3)));
    setSkinDetails({ moleSeed: 8 });
    expect(moles()[0].toArray()).not.toEqual(nine[0].toArray());
    setSkinDetails({ moles: 0 });
    expect(skinUniforms.uMoleCount.value).toBe(0);
  });

  it("puts the amounts in the shader", () => {
    setSkinDetails({ blush: 0.5, freckles: 0.7, pores: 1.5, underEye: 0.2, variation: 1.6, veins: 0.9 });
    applySkinDetails();
    expect([skinUniforms.uBlush.value, skinUniforms.uFreckles.value, skinUniforms.uPores.value, skinUniforms.uUnderEye.value]).toEqual([0.5, 0.7, 1.5, 0.2]);
    expect([skinUniforms.uMottle.value, skinUniforms.uVeins.value]).toEqual([1.6, 0.9]);
  });

  it("puts the lip makeup in the shader (no lipstick = no amount; an automatic liner colour)", () => {
    setSkinDetails({ lipColour: "", lipOpacity: 0.6, lipLiner: 0.5, lipLinerColour: "", lipGloss: 1.5 });
    applySkinDetails();
    expect([skinUniforms.uLipAmt.value, skinUniforms.uLipLiner.value, skinUniforms.uLipLinerAuto.value, skinUniforms.uLipGloss.value]).toEqual([0, 0.5, 1, 1.5]);
    setSkinDetails({ lipColour: "#ff0000", lipLinerColour: "#00ff00" });
    applySkinDetails();
    expect(skinUniforms.uLipAmt.value).toBe(0.6);
    expect([skinUniforms.uLipColour.value.r, skinUniforms.uLipColour.value.g]).toEqual([1, 0]);
    expect([skinUniforms.uLipLinerAuto.value, skinUniforms.uLipLinerColour.value.g]).toEqual([0, 1]);
    setSkinDetails({ lipColour: "", lipLiner: 0, lipLinerColour: "", lipGloss: 1 });
  });

  it("checks stored and linked values field by field", () => {
    expect(sanitizeSkinDetails({ blush: 9, freckles: -1, moles: 40.4, moleSeed: "x", pores: "deep", variation: 7, veins: -2, extra: 1 })).toEqual({
      blush: 1, freckles: 0, moles: MAX_MOLES, moleSize: 0.4, moleSeed: 1, pores: 1.3, underEye: 1.15, variation: 2, veins: 0, eyeRims: 0.45,
      wrinkles: 0, expression: 1, sun: 0, sunSpots: 0, capillaries: 0.1, oiliness: 1, sweat: 0, grime: 0,
      lipColour: "", lipOpacity: 0.85, lipLiner: 0, lipLinerColour: "", lipGloss: 1,
      microDetail: 1, lipLines: 0.6, blushColour: "", blushSpread: 0, eyeLiner: 0, eyeLinerWing: 0.5, eyeLinerColour: "#1c1517", eyeShadow: 0, eyeShadowColour: "#7a5a52",
      lashLength: 1, lashCurl: 0, lashDensity: 1,
      philtrum: 1, cupidBow: 1, mouthLine: 1, underLip: 0.35, collarbone: 0.7, jawShadow: 1, earDetail: 1, browFullness: 0.5, lashNeat: 0.6,
    });
    // the face form (philtrum, jaw shadow, ears …), eyebrow fullness and neat lashes are clamped
    expect(sanitizeSkinDetails({ philtrum: 9, underLip: 9, collarbone: -1, browFullness: 7, lashNeat: 3 })).toMatchObject({ philtrum: 2, underLip: 1.5, collarbone: 0, browFullness: 2, lashNeat: 1 });
    // lip makeup: colours are "#rrggbb" or nothing, amounts are clamped
    expect(sanitizeSkinDetails({ lipColour: "#C23B3B", lipOpacity: 4, lipLiner: -1, lipLinerColour: "red", lipGloss: 9 })).toMatchObject({
      lipColour: "#c23b3b", lipOpacity: 1, lipLiner: 0, lipLinerColour: "", lipGloss: 2,
    });
    // a link from before tone variation and veins existed gets their defaults
    expect(sanitizeSkinDetails({ blush: 0.2 })).toMatchObject({ variation: 1.3, veins: 0.5 });
    expect(sanitizeSkin({ mode: "photo", amount: 2, scale: 1, keepTone: "yes" })).toEqual({ mode: "tile", amount: 1, scale: 15, keepTone: true });
    expect(sanitizeHair({ amount: -3 })).toEqual({ amount: 0 });
  });
});
