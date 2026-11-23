/**
 * The realism tools on the real head (public/models/head.glb): picking the skin under a ray, the fine-shape fields and
 * the sculpt offset (where they move the skin, and that the mouth's and eyes' seams stay put), the refresher carrying the
 * offset into the shape followers read, and the stored values (marks, fine shape, the sculpt's text, the new skin and
 * camera settings) checked field by field.
 */
import { readFileSync } from "node:fs";

import { type Mesh, PerspectiveCamera, Vector2, Vector3 } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { beforeAll, describe, expect, it } from "vitest";

import { headSpaceMatrix } from "@/lib/age";
import { sanitizeFinish } from "@/lib/finishSettings";
import { sanitizeMarks } from "@/lib/marks";
import { NormalRefresher } from "@/lib/morphs/normals";
import { bindSculpt, decodeSculpt, encodeSculpt, sanitizeFine, setFine } from "@/lib/sculpt";
import { sanitizeSkinDetails } from "@/lib/skinDetails";
import { pickSkin } from "@/lib/skinPick";
import { MAX_MARKS } from "@/lib/skinShader";
import { bindSkinSurface, skinShape } from "@/lib/skinSurface";

let skin: Mesh;
const others: Mesh[] = [];
const refresher = new NormalRefresher();

beforeAll(async () => {
  const buf = readFileSync("public/models/head.glb");
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), "");
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!(o as Mesh).isMesh) return;
    if ((o.parent?.name || o.name) === "skin") skin = o as Mesh;
    else others.push(o as Mesh);
  });
  refresher.add(skin);
  bindSkinSurface(skin, refresher);
  bindSculpt(skin, refresher, others);
}, 30_000);

/** Rest head-space mm of skin vertex i. */
const restMm = (i: number) => new Vector3().fromBufferAttribute(skin.geometry.getAttribute("position"), i).applyMatrix4(headSpaceMatrix(skin)).multiplyScalar(1000);
/** The offset at vertex i, head mm. */
const offsetMm = (i: number) => {
  const a = skin.geometry.getAttribute("aSculpt");
  const m = headSpaceMatrix(skin);
  m.setPosition(0, 0, 0);
  return new Vector3(a.getX(i), a.getY(i), a.getZ(i)).applyMatrix4(m).multiplyScalar(1000);
};
const nearestVertex = (p: Vector3) => {
  let best = Infinity, id = 0;
  const n = skin.geometry.getAttribute("position").count;
  for (let i = 0; i < n; i++) {
    const d = restMm(i).distanceToSquared(p);
    if (d < best) [best, id] = [d, i];
  }
  return id;
};

describe("picking the skin", () => {
  it("finds the face under a ray from the front, on the rest skin, facing the camera", () => {
    const cam = new PerspectiveCamera(20, 1, 0.05, 10);
    cam.position.set(0, 0.29, 1.2);
    cam.lookAt(0, 0.29, 0);
    cam.updateMatrixWorld();
    const hit = pickSkin(new Vector2(0, 0), cam)!;
    expect(hit).not.toBeNull();
    expect(Math.abs(hit.rest.x)).toBeLessThan(2); // the middle of the face
    expect(hit.rest.z).toBeGreaterThan(100); // its front (the nose bridge sticks out furthest)
    expect(hit.restNormal.z).toBeGreaterThan(0.5); // towards the camera
  });
});

describe("fine shape and sculpt", () => {
  it("moves the skin where the slider is about, nowhere else, and leaves the seams alone", () => {
    setFine({ sliders: { nostrils: 1 } }, true);
    const wing = nearestVertex(new Vector3(22, 263, 120)); // the left nose wing
    const forehead = nearestVertex(new Vector3(0, 340, 120));
    expect(offsetMm(wing).x).toBeGreaterThan(0.8); // flared outwards (+x on the left)
    expect(offsetMm(forehead).length()).toBeLessThan(1e-3);
    // the CPU shape has it too once the head settles (hair, brows and glasses follow it)
    refresher.refresh(() => 0);
    const shape = skinShape()!;
    const p = skin.geometry.getAttribute("position");
    expect(Math.abs(shape.current[wing * 3] - p.getX(wing))).toBeGreaterThan(0);
    setFine({ sliders: { nostrils: 0 } }, true);
    expect(offsetMm(wing).length()).toBeLessThan(1e-3);

    // eye bags right under the lower lid: the lid's edge (on the eyeball) stays where it is
    setFine({ sliders: { eyeBags: 1, hoodedLids: 1 } }, true);
    const lidEdge = nearestVertex(new Vector3(32.5, 297.5, 112));
    const bag = nearestVertex(new Vector3(32.5, 290.5, 113));
    expect(offsetMm(bag).length()).toBeGreaterThan(offsetMm(lidEdge).length());
    setFine({ sliders: { eyeBags: 0, hoodedLids: 0 } }, true);
  });

  it("carries the offset into the live offsets followers sum, and swaps it when it changes", () => {
    setFine({ sliders: { nostrils: 0, eyeBags: 0, hoodedLids: 0 } }, true);
    const wing = nearestVertex(new Vector3(22, 263, 120));
    const ids = Int32Array.of(wing);
    const acc = new Float32Array(3);
    const last = new Map<string, number>();
    refresher.accumulateOffsets(skin, ids, () => 0, last, acc);
    expect(Math.hypot(...acc)).toBeLessThan(1e-9);
    setFine({ sliders: { nostrils: 1 } }, true);
    refresher.accumulateOffsets(skin, ids, () => 0, last, acc);
    const a = skin.geometry.getAttribute("aSculpt");
    expect(acc[0]).toBeCloseTo(a.getX(wing), 6);
    setFine({ sliders: { nostrils: 0 } }, true);
    refresher.accumulateOffsets(skin, ids, () => 0, last, acc);
    expect(Math.hypot(...acc)).toBeLessThan(1e-9);
  });
});

describe("stored values", () => {
  it("keeps marks in range and drops broken ones", () => {
    const m = sanitizeMarks([
      { type: "scar", at: [40, 268, 100], normal: [0, 0, 2], angle: 400, length: 500, width: 0, healed: 3, seed: 3.7 },
      { type: "tattoo", at: [0, 0, 0], normal: [0, 0, 1] },
      { type: "cut", at: [1, 2], normal: [0, 0, 1] },
      { type: "bruise", at: [0, 300, 100], normal: [0, 0, 0] },
    ]);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ type: "scar", normal: [0, 0, 1], angle: 180, length: 90, width: 0.3, healed: 1, seed: 4 });
    expect(sanitizeMarks(Array.from({ length: 30 }, () => ({ type: "cut", at: [0, 280, 100], normal: [0, 0, 1] })))).toHaveLength(MAX_MARKS);
    expect(sanitizeMarks("nope")).toEqual([]);
  });

  it("keeps the fine shape in range", () => {
    expect(sanitizeFine({ sliders: { nostrils: 3, chinCleft: -1, nope: 1, temples: 0 }, asymmetry: 2, asymSeed: -5 })).toEqual({
      sliders: { nostrils: 1 }, // chin cleft has no negative side; zeros are left out
      asymmetry: 1,
      asymSeed: 1,
    });
  });

  it("writes the sculpt as text and reads it back to 0.01 mm, only for the same head", () => {
    const s = Float32Array.from([0, 1.234, -5.678, 24.99, 0, -0.004]);
    const text = encodeSculpt(s);
    expect(text.startsWith("s1:")).toBe(true);
    const back = decodeSculpt(text, 2)!;
    for (let i = 0; i < s.length; i++) expect(back[i]).toBeCloseTo(s[i], 2);
    expect(decodeSculpt(text, 3)).toBeNull(); // another head's vertex count
    expect(decodeSculpt("s1:!!", 2)).toBeNull();
    expect(decodeSculpt("x", 2)).toBeNull();
  });

  it("checks the new skin details and camera settings", () => {
    const d = sanitizeSkinDetails({ wrinkles: 9, expression: -1, sun: 0.5, oiliness: 5, grime: "x" });
    expect(d).toMatchObject({ wrinkles: 1.5, expression: 0, sun: 0.5, oiliness: 2, grime: 0, sweat: 0, sunSpots: 0, capillaries: 0.1 });
    expect(sanitizeFinish({ light: "disco", clarity: 2, skin: -1 })).toMatchObject({ light: "studio", clarity: 1, skin: 0 });
    expect(sanitizeFinish({ light: "sun" }).light).toBe("sun");
  });
});
