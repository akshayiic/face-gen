"""Transfer a scanned face's maps onto this app's head UV layout (Blender, headless).

    blender -b --factory-startup -P pipeline/blender/bake_scan.py -- \
        --target head.glb --source scan.obj \
        --albedo scan_albedo.png --normal scan_normal.png --roughness scan_rough.png --cavity scan_cavity.png \
        --out out/scan --size 4096 [--fit] [--extrusion 0.006] [--ray 0.02]

`--target`: this app's head with its UVs: the .glb from the app's "Export .glb" with a neutral face (or any glTF/OBJ/FBX
whose mesh named "skin", else the biggest mesh, is the head). `--source`: the scan (OBJ, FBX, glTF/GLB) with its own UVs
and maps. The two must overlap in space: the scan wrapped onto the head (R3DS Wrap, or by hand in Blender), or at least
lined up; `--fit` lines the scan's bounding box up with the head's (same centre and height) for a rough start.

Each map is baked from the scan to the head (Cycles "selected to active": a ray from each head texel, `--extrusion`
metres out, looking `--ray` metres in for the scan's surface), and written in the head's UV layout:
  skin_albedo.png  (sRGB)  → the app's Skin texture, "painted map (UV)", Keep tone off
  skin_normal.png  (16-bit, tangent space of the head) → Scanned skin maps → Normal map
  skin_rough.png   (linear) → Roughness map
  skin_cavity.png  (linear) → Cavity map
Any map not given is skipped. Texels the rays miss keep a neutral value (mid grey, flat normal).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy  # type: ignore
from mathutils import Vector  # type: ignore


def args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="bake_scan.py")
    p.add_argument("--target", required=True)
    p.add_argument("--source", required=True)
    for m in ("albedo", "normal", "roughness", "cavity"):
        p.add_argument(f"--{m}")
    p.add_argument("--out", default="out/scan")
    p.add_argument("--size", type=int, default=4096)
    p.add_argument("--extrusion", type=float, default=0.006)
    p.add_argument("--ray", type=float, default=0.02)
    p.add_argument("--fit", action="store_true")
    p.add_argument("--samples", type=int, default=4)
    return p.parse_args(argv)


def load(path: str) -> list:
    """Import a model; returns the new mesh objects."""
    before = set(bpy.data.objects)
    ext = Path(path).suffix.lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        raise SystemExit(f"can't read {path}: use GLB, glTF, OBJ or FBX")
    return [o for o in bpy.data.objects if o not in before and o.type == "MESH"]


def pick_head(meshes: list):
    for o in meshes:
        if o.name.lower().startswith("skin") or (o.parent and o.parent.name.lower().startswith("skin")):
            return o
    return max(meshes, key=lambda o: len(o.data.vertices))


def join(meshes: list):
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    return meshes[0]


def bounds(o):
    pts = [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def fit(source, target) -> None:
    """Scale and move the scan so its bounding box has the head's centre and height (a rough start only)."""
    slo, shi = bounds(source)
    tlo, thi = bounds(target)
    k = (thi.z - tlo.z) / max(1e-9, shi.z - slo.z)
    source.scale = source.scale * k
    bpy.context.view_layer.update()
    slo, shi = bounds(source)
    source.location += (tlo + thi) / 2 - (slo + shi) / 2
    bpy.context.view_layer.update()


def image_node(nodes, path: str, colour: bool):
    n = nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(path)
    n.image.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    return n


def source_material(source, path: str, kind: str):
    """The scan shows one map: as emission (colour, roughness, cavity) or through a normal map node (normal)."""
    m = bpy.data.materials.new(f"scan_{kind}")
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    tex = image_node(nodes, path, colour=(kind == "albedo"))
    if kind == "normal":
        nm = nodes.new("ShaderNodeNormalMap")
        bsdf = nodes.new("ShaderNodeBsdfDiffuse")
        links.new(tex.outputs["Color"], nm.inputs["Color"])
        links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
        links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    else:
        em = nodes.new("ShaderNodeEmission")
        links.new(tex.outputs["Color"], em.inputs["Color"])
        links.new(em.outputs["Emission"], out.inputs["Surface"])
    source.data.materials.clear()
    source.data.materials.append(m)


def target_image(target, name: str, size: int, colour: bool, neutral):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=not colour)
    img.colorspace_settings.name = "sRGB" if colour else "Non-Color"
    img.generated_color = neutral
    m = bpy.data.materials.new(f"head_{name}")
    m.use_nodes = True
    nodes = m.node_tree.nodes
    for n in list(nodes):
        if n.type != "OUTPUT_MATERIAL":
            nodes.remove(n)
    node = nodes.new("ShaderNodeTexImage")
    node.image = img
    nodes.active = node  # Cycles bakes into the active image node
    target.data.materials.clear()
    target.data.materials.append(m)
    return img


def bake(kind: str, target, source, a) -> None:
    path = getattr(a, kind)
    if not path:
        return
    source_material(source, path, kind)
    colour = kind == "albedo"
    neutral = (0.5, 0.5, 1.0, 1.0) if kind == "normal" else (0.5, 0.5, 0.5, 1.0) if kind != "cavity" else (1.0, 1.0, 1.0, 1.0)
    img = target_image(target, f"skin_{kind}", a.size, colour, neutral)
    bpy.ops.object.select_all(action="DESELECT")
    source.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bake_type = "NORMAL" if kind == "normal" else "EMIT"
    bpy.ops.object.bake(type=bake_type, use_selected_to_active=True, cage_extrusion=a.extrusion, max_ray_distance=a.ray,
                        normal_space="TANGENT", margin=16, use_clear=False)
    names = {"albedo": "skin_albedo.png", "normal": "skin_normal.png", "roughness": "skin_rough.png", "cavity": "skin_cavity.png"}
    out = Path(a.out) / names[kind]
    out.parent.mkdir(parents=True, exist_ok=True)
    # saved as stored (Image.save: no view transform; data maps stay linear, the colour map stays sRGB)
    img.filepath_raw = str(out.resolve())
    img.file_format = "PNG"
    img.save()
    print(f"[bake_scan] wrote {out}")


def main() -> None:
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = a.samples
    scene.cycles.device = "CPU"
    scene.display_settings.display_device = "sRGB"
    scene.view_settings.view_transform = "Standard"  # the colour map as painted, no filmic curve
    target = pick_head(load(a.target))
    target.name = "head"
    source = join(load(a.source))
    source.name = "scan"
    if not target.data.uv_layers:
        raise SystemExit("the head has no UVs: use the app's exported .glb (it has them)")
    if not source.data.uv_layers:
        raise SystemExit("the scan has no UVs: its maps can't be read")
    if a.fit:
        fit(source, target)
    for kind in ("albedo", "normal", "roughness", "cavity"):
        bake(kind, target, source, a)


main()
