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

  it("checks stored and linked values field by field", () => {
    expect(sanitizeSkinDetails({ blush: 9, freckles: -1, moles: 40.4, moleSeed: "x", pores: "deep", variation: 7, veins: -2, extra: 1 })).toEqual({
      blush: 1, freckles: 0, moles: MAX_MOLES, moleSize: 0.4, moleSeed: 1, pores: 1, underEye: 1, variation: 2, veins: 0,
      wrinkles: 0, expression: 1, sun: 0, sunSpots: 0, capillaries: 0, oiliness: 1, sweat: 0, grime: 0,
    });
    // a link from before tone variation and veins existed gets their defaults
    expect(sanitizeSkinDetails({ blush: 0.2 })).toMatchObject({ variation: 1, veins: 0.4 });
    expect(sanitizeSkin({ mode: "photo", amount: 2, scale: 1, keepTone: "yes" })).toEqual({ mode: "tile", amount: 1, scale: 15, keepTone: true });
    expect(sanitizeHair({ amount: -3 })).toEqual({ amount: 0 });
  });
});
