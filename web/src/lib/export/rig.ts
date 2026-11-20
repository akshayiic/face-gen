/**
 * The mouth rig for the speaking .glb: the app's own mouth shapes (visemes.json, the presets the lip sync drives) baked
 * as glTF morph targets on top of the character as exported.
 *
 * Each shape is put on the live face through the same morph layers the lip sync and blinks write ("viseme", "blink"),
 * scaled by this face's own limits (animCaps visemeCap), and the whole model's geometry is built again and compared with
 * the shape-free build: whatever moved becomes that target's deltas. So everything tied to the skin follows: the lips,
 * jaw, teeth and tongue, and also strand and shell beards round the mouth and lashes on a blink. Scalp hair is skipped
 * (no mouth shape reaches the scalp).
 *
 * Target names follow the Oculus / Ready Player Me viseme set (viseme_aa, viseme_PP, …) plus ARKit's jawOpen and
 * eyeBlinkLeft / eyeBlinkRight, so the file drops into the usual three.js, Unity and Blender lip-sync tooling. Weight
 * 1 = the shape as the app makes it at full strength. Tweak here: RIG_SHAPES.
 */
import { BufferAttribute, type BufferGeometry, Float32BufferAttribute, Matrix3, Matrix4, type Mesh, Vector3 } from "three";

import { type Weights, visemePreset, visemes } from "@/lib/data";
import { LIPSYNC } from "@/lib/lipsync/tuning";
import { visemeCap } from "@/lib/morphs/animCaps";
import { morphs } from "@/lib/morphs/store";

export interface RigShape {
  name: string;
  layer: "viseme" | "blink";
  weights: () => Weights;
}

const scaled = (w: Weights, k: number): Weights => Object.fromEntries(Object.entries(w).map(([t, v]) => [t, v * k]));
const viseme = (id: string, k = 1) => () => scaled(visemePreset(id), k * visemeCap(id));
const withoutTongue = (w: Weights): Weights => Object.fromEntries(Object.entries(w).filter(([t]) => !t.startsWith("tongue")));

/**
 * The exported shapes. The app's 11 visemes map one to one; kk (k, g) is the d/t shape with the tongue down, as the
 * lip sync makes it (a "back" cue); nn shares the d/t/n/l shape; RR is the rounded U at the app's r strength.
 */
export const RIG_SHAPES: RigShape[] = [
  { name: "viseme_PP", layer: "viseme", weights: viseme("pp") },
  { name: "viseme_FF", layer: "viseme", weights: viseme("ff") },
  { name: "viseme_TH", layer: "viseme", weights: viseme("th") },
  { name: "viseme_DD", layer: "viseme", weights: viseme("dd") },
  { name: "viseme_kk", layer: "viseme", weights: () => withoutTongue(viseme("dd")()) },
  { name: "viseme_CH", layer: "viseme", weights: viseme("ch") },
  { name: "viseme_SS", layer: "viseme", weights: viseme("ss") },
  { name: "viseme_nn", layer: "viseme", weights: viseme("dd") },
  { name: "viseme_RR", layer: "viseme", weights: viseme("u", LIPSYNC.rPeak) },
  { name: "viseme_aa", layer: "viseme", weights: viseme("aa") },
  { name: "viseme_E", layer: "viseme", weights: viseme("e") },
  { name: "viseme_I", layer: "viseme", weights: viseme("i") },
  { name: "viseme_O", layer: "viseme", weights: viseme("o") },
  { name: "viseme_U", layer: "viseme", weights: viseme("u") },
  { name: "jawOpen", layer: "viseme", weights: () => ({ ...visemes.roles.jawOpen }) },
  { name: "eyeBlinkLeft", layer: "blink", weights: () => ({ ...visemes.roles.blinkLeft }) },
  { name: "eyeBlinkRight", layer: "blink", weights: () => ({ ...visemes.roles.blinkRight }) },
];

/** Below this (metres) a vertex has not moved: a mesh whose every vertex stays put gets no target for the shape. */
const STILL = 1e-5;
const IDENTITY = new Matrix4();

/** Put a shape on the live face (its layer was zeroed by holdStill); returns the undo. */
export function applyShape(shape: RigShape): () => void {
  const w = shape.weights();
  for (const [t, v] of Object.entries(w)) morphs.setLayerValue(shape.layer, t, v);
  return () => {
    for (const t of Object.keys(w)) morphs.setLayerValue(shape.layer, t, 0);
  };
}

/** A mesh's positions in its parent's space as floats (decodes 16-bit strand positions, applies the mesh's own matrix). */
export function placedPositions(mesh: Mesh): Float32Array {
  const attr = mesh.geometry.attributes.position as BufferAttribute;
  mesh.updateMatrix();
  const out = new Float32Array(attr.count * 3);
  const v = new Vector3();
  for (let i = 0; i < attr.count; i++) v.fromBufferAttribute(attr, i).applyMatrix4(mesh.matrix).toArray(out, i * 3);
  return out;
}

/** One target on one mesh: position deltas, and normal deltas where the mesh has normals worth moving. */
export interface Target {
  name: string;
  position: Float32Array;
  normal?: Float32Array;
}

/** `shaped` − `base`, or null when nothing moved past STILL. */
export function delta(base: Float32Array, shaped: Float32Array): Float32Array | null {
  if (base.length !== shaped.length) return null;
  const d = new Float32Array(base.length);
  let moved = false;
  for (let i = 0; i < base.length; i++) {
    d[i] = shaped[i] - base[i];
    if (Math.abs(d[i]) > STILL) moved = true;
  }
  return moved ? d : null;
}

/** Face normals of `positions` over `geometry`'s triangles, summed per vertex and normalised (computeVertexNormals). */
export function normalsFor(geometry: BufferGeometry, positions: Float32Array): Float32Array {
  const g = geometry.clone();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.deleteAttribute("normal");
  g.computeVertexNormals();
  const out = (g.attributes.normal.array as Float32Array).slice();
  g.dispose();
  return out;
}

/**
 * Give `mesh` its targets: float positions in its parent's space (a quantised strand chunk is decoded, its transform
 * baked in, so the deltas and the base share one space), then a morph attribute per target, relative, named for the
 * target so GLTFExporter writes the names (extras.targetNames).
 */
export function attachTargets(mesh: Mesh, base: Float32Array, targets: Target[]): void {
  if (!targets.length) return;
  const g = mesh.geometry;
  const pos = g.attributes.position as BufferAttribute;
  if (!(pos.array instanceof Float32Array) || pos.normalized || !mesh.matrix.equals(IDENTITY)) {
    g.setAttribute("position", new Float32BufferAttribute(base, 3));
    const normal = g.attributes.normal as BufferAttribute | undefined;
    if (normal) {
      const nm = new Matrix3().getNormalMatrix(mesh.matrix);
      const v = new Vector3();
      const n = new Float32Array(normal.count * 3);
      for (let i = 0; i < normal.count; i++) v.fromBufferAttribute(normal, i).applyMatrix3(nm).normalize().toArray(n, i * 3);
      g.setAttribute("normal", new Float32BufferAttribute(n, 3));
    }
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
  }
  g.morphTargetsRelative = true;
  const withNormals = !!g.attributes.normal && targets.every((t) => t.normal);
  g.morphAttributes.position = targets.map((t) => named(new Float32BufferAttribute(t.position, 3), t.name));
  if (withNormals) g.morphAttributes.normal = targets.map((t) => named(new Float32BufferAttribute(t.normal!, 3), t.name));
  mesh.updateMorphTargets();
  mesh.morphTargetInfluences = targets.map(() => 0);
}

const named = <T extends BufferAttribute>(a: T, name: string): T => {
  a.name = name;
  return a;
};
