/**
 * Clothes fitted on the real head (public/models/head.glb at rest): every style builds, its collar hugs the neck in
 * every direction (a far skin hit once made flat panels stand up behind the shoulders), and no column folds back in.
 */
import { readFileSync } from "node:fs";

import type { Mesh, Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { beforeAll, describe, expect, it } from "vitest";

import { CLOTHES_STYLES, mountClothes, sanitizeClothes, setClothes } from "@/lib/clothes";

const COLUMNS = 120, ROWS = 64;
let root: Object3D;

/** The garment grids (columns × rows); the blazer's sleeves and lapels, and the earrings, are separate parts. */
const garments = () => (root.getObjectByName("clothes")!.children as Mesh[]).filter((c) => c.isMesh && c.name !== "clothes_sleeves" && c.name !== "clothes_lapels");

beforeAll(async () => {
  const buf = readFileSync("public/models/head.glb");
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), "");
  root = gltf.scene.getObjectByName("head") ?? gltf.scene;
  mountClothes(root);
});

describe("clothes", { timeout: 30_000 }, () => {
  it("None leaves the head bare", () => {
    setClothes({ style: "none" });
    expect(root.getObjectByName("clothes")!.children).toHaveLength(0);
  });

  for (const { id } of CLOTHES_STYLES.filter((s) => s.id !== "none")) {
    it(`${id}: hugs the neck and hangs down`, () => {
      setClothes({ style: id, neckline: 1, fit: 1 });
      const layers = garments();
      expect(layers.length).toBeGreaterThan(0);
      for (const mesh of layers) {
        const p = mesh.geometry.attributes.position;
        expect(p.count).toBe(COLUMNS * ROWS);
        for (let i = 0; i < COLUMNS; i++) {
          const r = (j: number) => Math.hypot(p.getX(i * ROWS + j), p.getZ(i * ROWS + j));
          const top = i * ROWS;
          if (p.getY(top) > 0.1) expect(r(0), `column ${i}: the collar stands off the neck`).toBeLessThan(0.17);
          for (let j = 1; j < ROWS; j++) {
            expect(r(j), `column ${i} row ${j}: folds back in`).toBeGreaterThanOrEqual(r(j - 1) - 0.006);
            expect(p.getY(top + j)).toBeLessThan(p.getY(top + j - 1) + 1e-6);
          }
        }
      }
    });
  }

  it("fits other head shapes too (long and short necks, big and small heads)", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const meshes: Mesh[] = [];
    root.traverse((o) => (o as Mesh).morphTargetDictionary && meshes.push(o as Mesh));
    for (let face = 0; face < 6; face++) {
      const weights = Object.fromEntries(Array.from({ length: 24 }, (_, k) => [`head_${String(k).padStart(3, "0")}`, rand() * 1.2]));
      for (const m of meshes) for (const [t, w] of Object.entries(weights)) if (m.morphTargetDictionary![t] !== undefined) m.morphTargetInfluences![m.morphTargetDictionary![t]] = w;
      for (const style of ["turtleneck", "tee", "shirt", "blazer"] as const) {
        setClothes({ style: "none" });
        setClothes({ style });
        for (const mesh of garments()) {
          const p = mesh.geometry.attributes.position;
          for (let i = 0; i < COLUMNS; i++) {
            if (p.getY(i * ROWS) < 0.1) continue; // a jacket's opening
            expect(Math.hypot(p.getX(i * ROWS), p.getZ(i * ROWS)), `face ${face} ${style} column ${i}`).toBeLessThan(0.17);
          }
        }
      }
    }
    for (const m of meshes) m.morphTargetInfluences!.fill(0);
  });

  it("a blazer has sleeves hanging at both sides and a lapel on each side of the opening", () => {
    setClothes({ style: "blazer", neckline: 0, fit: 0, shoulders: 0 });
    const parts = root.getObjectByName("clothes")!.children as Mesh[];
    const sleeves = parts.find((m) => m.name === "clothes_sleeves")!;
    const lapels = parts.find((m) => m.name === "clothes_lapels")!;
    expect(sleeves && lapels).toBeTruthy();
    for (const mesh of [sleeves, lapels]) {
      const a = mesh.geometry.attributes.position.array as Float32Array;
      expect(a.every(Number.isFinite)).toBe(true);
    }
    // sleeves: one each side of the body, from the shoulder down past the chest
    const sp = sleeves.geometry.attributes.position;
    let left = 0, right = 0, low = Infinity, high = -Infinity;
    for (let i = 0; i < sp.count; i++) {
      if (sp.getX(i) < -0.1) left++;
      if (sp.getX(i) > 0.1) right++;
      low = Math.min(low, sp.getY(i));
      high = Math.max(high, sp.getY(i));
    }
    expect(left).toBeGreaterThan(100);
    expect(right).toBe(left);
    expect(low).toBeLessThan(-0.3);
    expect(high).toBeGreaterThan(0.05);
    // lapels: both sides, in front of the neck's axis, between the button and the collar
    const lp = lapels.geometry.attributes.position;
    let lx = 0, rx = 0;
    for (let i = 0; i < lp.count; i++) {
      expect(lp.getZ(i)).toBeGreaterThan(0);
      if (lp.getX(i) < 0) lx++;
      else rx++;
    }
    expect(lx).toBe(rx);
  });

  it("earrings sit on the lobes, both sides, and go with any garment", () => {
    setClothes({ style: "none", earrings: "pearl" });
    const pieces = (root.getObjectByName("clothes")!.children as Object3D[]).filter((c) => c.name === "earring");
    expect(pieces).toHaveLength(2);
    const [a, b] = pieces;
    expect(a.position.x * b.position.x).toBeLessThan(0); // one each side
    for (const p of pieces) {
      expect(Math.abs(p.position.x)).toBeGreaterThan(0.07);
      expect(Math.abs(p.position.x)).toBeLessThan(0.1);
      expect(p.position.y).toBeGreaterThan(0.235);
      expect(p.position.y).toBeLessThan(0.265); // the lobe, not the middle of the ear
    }
    setClothes({ earrings: "hoop" });
    expect((root.getObjectByName("clothes")!.children as Object3D[]).filter((c) => c.name === "earring")).toHaveLength(2);
    setClothes({ style: "none", earrings: "none" });
    expect(root.getObjectByName("clothes")!.children).toHaveLength(0);
  });

  it("a link's clothes are checked field by field", () => {
    expect(sanitizeClothes({ style: "cape", colour: "red", fit: 9, fabric: "satin" })).toMatchObject({ style: "none", colour: "#1d3f9e", fit: 1, fabric: "satin" });
  });

  it("the collar and earrings are checked too", () => {
    expect(sanitizeClothes({ collar: 9, earrings: "pearl" })).toMatchObject({ collar: 1, earrings: "pearl" });
    expect(sanitizeClothes({ earrings: "crown" })).toMatchObject({ earrings: "none", collar: 0.3 });
  });
});
