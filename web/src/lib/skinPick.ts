/**
 * What's under the pointer on the skin: a ray from the camera through the pointer, tested against the skin's triangles
 * as the face is shaped now (the CPU copy in lib/morphs/normals.ts, sculpting included), so placing a scar or a sculpt
 * stroke lands where the visitor sees the skin. Returns where that is on the REST skin too (template millimetres, the
 * skin shader's vRest), which is where marks are drawn, so they stay on the same bit of skin whatever the sliders do.
 *
 * Brute force over ~40k triangles (a few ms): fine for a click or a brush stroke's pointer moves.
 */
import { type Camera, Matrix4, Raycaster, Vector2, Vector3 } from "three";

import { skinShape, skinSurface } from "@/lib/skinSurface";

export type SkinHit = {
  /** the triangle and the barycentric weights of the hit in it */
  tri: number;
  bary: [number, number, number];
  /** its three vertices */
  verts: [number, number, number];
  /** where it is on the rest skin (template mm) and that triangle's outward normal there */
  rest: Vector3;
  restNormal: Vector3;
  /** where it is now, in the world (for a brush) */
  world: Vector3;
  /** the distance along the ray (world units) */
  distance: number;
};

const raycaster = new Raycaster();
const inv = new Matrix4();
const o = new Vector3();
const dir = new Vector3();
const e1 = new Vector3();
const e2 = new Vector3();
const p = new Vector3();
const q = new Vector3();
const t = new Vector3();

/** The skin's own triangles (beard shells append copies after them: lib/beardShells.ts). */
export function skinTriangles(): Uint16Array | Uint32Array | null {
  const g = skinSurface.mesh?.geometry;
  if (!g?.index) return null;
  return (g.index.array as Uint16Array | Uint32Array).subarray(0, (g.userData.baseIndexCount as number | undefined) ?? g.index.count);
}

/** Pointer (normalised device coordinates, −1..1) → the nearest skin under it, or null. */
export function pickSkin(ndc: Vector2, camera: Camera): SkinHit | null {
  const mesh = skinSurface.mesh;
  const shape = skinShape();
  const index = skinTriangles();
  if (!mesh || !shape || !index) return null;
  mesh.updateWorldMatrix(true, false);
  raycaster.setFromCamera(ndc, camera);
  inv.copy(mesh.matrixWorld).invert();
  o.copy(raycaster.ray.origin).applyMatrix4(inv);
  dir.copy(raycaster.ray.direction).transformDirection(inv); // unit length in the mesh's space
  const pos = shape.current;
  let best = Infinity, bestTri = -1, bu = 0, bv = 0;
  for (let f = 0; f < index.length; f += 3) {
    const a = index[f] * 3, b = index[f + 1] * 3, c = index[f + 2] * 3;
    e1.set(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
    e2.set(pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]);
    p.crossVectors(dir, e2);
    const det = e1.dot(p);
    if (Math.abs(det) < 1e-12) continue;
    const id = 1 / det;
    t.set(o.x - pos[a], o.y - pos[a + 1], o.z - pos[a + 2]);
    const u = t.dot(p) * id;
    if (u < 0 || u > 1) continue;
    q.crossVectors(t, e1);
    const v = dir.dot(q) * id;
    if (v < 0 || u + v > 1) continue;
    const d = e2.dot(q) * id;
    if (d > 0 && d < best) {
      best = d;
      bestTri = f / 3;
      bu = u;
      bv = v;
    }
  }
  if (bestTri < 0) return null;
  const verts: [number, number, number] = [index[bestTri * 3], index[bestTri * 3 + 1], index[bestTri * 3 + 2]];
  const bary: [number, number, number] = [1 - bu - bv, bu, bv];
  const rest = shape.rest;
  const m = skinSurface.toHead;
  const at = (arr: Float32Array, out: Vector3) =>
    out.set(0, 0, 0).addScaledVector(new Vector3().fromArray(arr, verts[0] * 3), bary[0])
      .addScaledVector(new Vector3().fromArray(arr, verts[1] * 3), bary[1])
      .addScaledVector(new Vector3().fromArray(arr, verts[2] * 3), bary[2]);
  const restPt = at(rest, new Vector3()).applyMatrix4(m).multiplyScalar(1000);
  const ra = new Vector3().fromArray(rest, verts[0] * 3).applyMatrix4(m);
  const rb = new Vector3().fromArray(rest, verts[1] * 3).applyMatrix4(m);
  const rc = new Vector3().fromArray(rest, verts[2] * 3).applyMatrix4(m);
  const restNormal = new Vector3().crossVectors(rb.sub(ra), rc.sub(ra)).normalize();
  // the side the camera sees is the outside: face the normal against the ray (in head space)
  if (restNormal.dot(dir.clone().transformDirection(m)) > 0) restNormal.negate();
  const world = at(pos, new Vector3()).applyMatrix4(mesh.matrixWorld);
  return { tri: bestTri, bary, verts, rest: restPt, restNormal, world, distance: world.distanceTo(raycaster.ray.origin) };
}
