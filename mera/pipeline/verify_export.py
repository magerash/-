"""Re-import exported files in independent tools and check they come back textured at metric scale.

  python pipeline/verify_export.py <file.glb|file_obj.zip|points.ply> [...] [--site data/projects/plot/site.json]

For each file:
  * trimesh (independent glTF/OBJ parser): extents of the Fences group and the textures it found
  * Blender (bpy, if installed): real Blender import with default settings; fence extents in
    Blender units with the scene unit system metric, scale 1.0, and the images it loaded
The fence extents must equal the plot outline's bounding box from the site model (fences are
zero-thickness photo panels on the boundary), and there must be textures.
"""
from __future__ import annotations

import json
import sys
import tempfile
import zipfile
from pathlib import Path


def expected_from_site(site_path: Path):
    site = json.loads(site_path.read_text())
    poly = site["plot"].get("polygon") or [e["a"] for e in site["plot"]["edges"]]
    us, vs = [p[0] for p in poly], [p[1] for p in poly]
    return max(us) - min(us), max(vs) - min(vs), {e["id"]: e["modelLength"] for e in site["plot"]["edges"]}


def unpack(path: Path, tmp: Path) -> Path:
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            z.extractall(tmp)
        return next(tmp.glob("*.obj"))
    return path


def is_fence(name: str) -> bool:
    return name.startswith("Fences/") or name.startswith("fence_") or name.startswith("entrance-gate")


def check_obj_text(path: Path):
    """Minimal independent OBJ reader: fence vertices by `o` name, texture coordinates, MTL maps on disk."""
    lo, hi, cur, objs, vts = None, None, "", 0, 0
    for line in path.read_text().splitlines():
        if line.startswith("o "):
            cur = line[2:]
            objs += 1
        elif line.startswith("vt "):
            vts += 1
        elif line.startswith("v ") and is_fence(cur):
            x, y, z = map(float, line.split()[1:4])
            lo = [x, y, z] if lo is None else [min(lo[0], x), min(lo[1], y), min(lo[2], z)]
            hi = [x, y, z] if hi is None else [max(hi[0], x), max(hi[1], y), max(hi[2], z)]
    mtl = next(path.parent.glob("*.mtl"), None)
    maps = set()
    if mtl:
        for line in mtl.read_text().splitlines():
            if line.startswith("map_Kd "):
                maps.add(line.split(None, 1)[1].strip())
    present = sum((path.parent / m).is_file() for m in maps)
    if lo is None:
        return None
    return {"x": hi[0] - lo[0], "z": hi[2] - lo[2], "objects": objs, "uv": vts, "textures": present, "missing": len(maps) - present}


def check_trimesh(path: Path):
    import trimesh

    if path.suffix == ".obj":
        return check_obj_text(path)
    scene = trimesh.load(str(path), force="scene")
    lo, hi = None, None
    images = set()
    for node in scene.graph.nodes_geometry:
        T, gname = scene.graph[node]
        g = scene.geometry[gname]
        mat = getattr(g.visual, "material", None)
        img = getattr(mat, "baseColorTexture", None) if mat is not None else None
        if img is not None:
            images.add(id(img))
        parents = getattr(scene.graph.transforms, "parents", {})
        chain, n = [str(node)], node
        while n in parents:  # walk up to see whether this node sits in the Fences group
            n = parents[n]
            chain.append(str(n))
        if not any(c == "Fences" or is_fence(c) for c in chain):
            continue
        gg = g.copy()
        gg.apply_transform(T)
        b = gg.bounds
        lo = b[0] if lo is None else [min(a, c) for a, c in zip(lo, b[0])]
        hi = b[1] if hi is None else [max(a, c) for a, c in zip(hi, b[1])]
    if lo is None:
        return None
    return {"x": hi[0] - lo[0], "z": hi[2] - lo[2], "objects": len(scene.graph.nodes_geometry), "textures": len(images)}


def check_blender(path: Path):
    try:
        import bpy
        import mathutils
    except Exception:
        return None

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.unit_settings.scale_length = 1.0
    if path.suffix == ".glb":
        bpy.ops.import_scene.gltf(filepath=str(path))
    else:
        bpy.ops.wm.obj_import(filepath=str(path))
    xs, ys = [], []
    count = 0
    buildings = {}
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        count += 1
        if ob.name.startswith("New_") and "_walls" in ob.name:
            bb = [ob.matrix_world @ mathutils.Vector(v) for v in ob.bound_box]
            buildings[ob.name.split("_walls")[0]] = (max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb))
        names = [ob.name] + ([ob.parent.name] if ob.parent else [])
        if not any(n == "Fences" or is_fence(n) for n in names):
            continue
        for v in ob.bound_box:
            w = ob.matrix_world @ mathutils.Vector(v)
            xs.append(w.x)
            ys.append(w.y)
    images = [im for im in bpy.data.images if im.size[0] > 0]
    textured = sum(1 for m in bpy.data.materials if m.node_tree and any(n.type == "TEX_IMAGE" and n.image for n in m.node_tree.nodes))
    if not xs:
        return {"objects": count, "boundary": None}
    return {"x": max(xs) - min(xs), "y": max(ys) - min(ys), "objects": count, "images": len(images), "textured": textured,
            "unit_system": bpy.context.scene.unit_settings.system, "buildings": buildings}


def check_ply(path: Path):
    try:
        import bpy
    except Exception:
        return None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.ply_import(filepath=str(path))
    ob = next(o for o in bpy.context.scene.objects if o.type == "MESH")
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    return len(vs), max(v.x for v in vs) - min(v.x for v in vs), max(v.y for v in vs) - min(v.y for v in vs)


def main():
    args = sys.argv[1:]
    site = Path(args[args.index("--site") + 1]) if "--site" in args else Path(__file__).resolve().parent.parent / "data/projects/plot/site.json"
    files = [Path(a) for a in args if not a.startswith("--") and a != str(site)]
    W, D, edges = expected_from_site(site)
    print(f"expected fence extents: {W:.3f} x {D:.3f} m (plot outline; edges {edges})")
    ok_all = True
    for f in files:
        if f.suffix == ".ply":
            r = check_ply(f)
            print(f"\n{f.name}\n  blender : {r[0]:,} points, extent {r[1]:.1f} x {r[2]:.1f} m (plot plus surroundings)" if r else "  blender: skipped")
            continue
        with tempfile.TemporaryDirectory() as td:
            p = unpack(f, Path(td))
            t = check_trimesh(p)
            b = check_blender(p)
            print(f"\n{f.name}")
            if t:
                okt = abs(t["x"] - W) < 0.01 and abs(t["z"] - D) < 0.01 and t["textures"] > 0 and not t.get("missing")
                ok_all &= okt
                extra = f", {t['uv']:,} texture coordinates, {t['missing']} missing files" if "uv" in t else ""
                print(f"  {'obj-text' if p.suffix == '.obj' else 'trimesh '}: fences {t['x']:.3f} x {t['z']:.3f} m, {t['textures']} textures{extra}  {'OK' if okt else 'MISMATCH'}")
            else:
                ok_all = False
                print("  trimesh : fences not found")
            if b:
                if b.get("boundary", 1) is None:
                    print(f"  blender : {b['objects']} meshes, fence objects not found by name")
                    ok_all = False
                else:
                    okb = abs(b["x"] - W) < 0.01 and abs(b["y"] - D) < 0.01 and b["images"] > 0
                    ok_all &= okb
                    print(f"  blender : fences {b['x']:.3f} x {b['y']:.3f} m (Z-up), {b['objects']} meshes, {b['images']} images on "
                          f"{b['textured']} textured materials, units {b['unit_system']}  {'OK' if okb else 'MISMATCH'}")
                    for name, (bx, by) in b.get("buildings", {}).items():
                        print(f"            {name}: walls {bx:.2f} x {by:.2f} m in Blender")
            elif b is None:
                print("  blender : bpy not installed, skipped")
    print("\nALL OK" if ok_all else "\nSOME CHECKS FAILED")
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
