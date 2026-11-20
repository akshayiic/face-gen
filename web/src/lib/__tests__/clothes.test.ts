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
      const layers = root.getObjectByName("clothes")!.children as Mesh[];
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
        for (const mesh of root.getObjectByName("clothes")!.children as Mesh[]) {
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

  it("a link's clothes are checked field by field", () => {
    expect(sanitizeClothes({ style: "cape", colour: "red", fit: 9, fabric: "satin" })).toMatchObject({ style: "none", colour: "#1d3f9e", fit: 1, fabric: "satin" });
  });
});
