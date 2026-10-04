"""Re-import exported files in independent tools and check they come back at metric scale.

  python pipeline/verify_export.py <file.glb|file_obj.zip> [...] [--site data/projects/plot/site.json]

For each file:
  * trimesh (independent glTF/OBJ parser) - bounding box of the Boundary objects
  * Blender (bpy, if installed) - real Blender import with default settings; object dimensions in
    Blender units with the scene unit system set to metric, scale 1.0
The boundary extents must equal the site model's plot size (plus the 5 cm fence thickness).
"""
from __future__ import annotations

import json
import sys
import tempfile
import zipfile
from pathlib import Path


def expected_from_site(site_path: Path):
    site = json.loads(site_path.read_text())
    us = [p for e in site["plot"]["edges"] for p in (e["a"][0], e["b"][0])]
    vs = [p for e in site["plot"]["edges"] for p in (e["a"][1], e["b"][1])]
    t = site["terrain"]
    # fence panels are 1.6 m tall boxes centred on each edge midpoint (they follow the slope per edge)
    mids = [((e["a"][0] + e["b"][0]) / 2, (e["a"][1] + e["b"][1]) / 2) for e in site["plot"]["edges"]]
    hs = [t["h0"] + t["gu"] * u + t["gv"] * v for u, v in mids]
    fence = max(hs) - min(hs) + 1.6
    # fence boxes are 5 cm thick and centred on the line
    return max(us) - min(us) + 0.05, max(vs) - min(vs) + 0.05, fence, {e["id"]: e["modelLength"] for e in site["plot"]["edges"]}


def unpack(path: Path, tmp: Path) -> Path:
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            z.extractall(tmp)
        return next(tmp.glob("*.obj"))
    return path


def check_obj_text(path: Path):
    """Minimal independent OBJ reader: vertices grouped by `o` name (trimesh renames OBJ objects)."""
    lo, hi, cur, objs = None, None, "", 0
    for line in path.read_text().splitlines():
        if line.startswith("o "):
            cur = line[2:]
            objs += 1
        elif line.startswith("v ") and cur.startswith("Boundary"):
            x, y, z = map(float, line.split()[1:4])
            lo = [x, y, z] if lo is None else [min(lo[0], x), min(lo[1], y), min(lo[2], z)]
            hi = [x, y, z] if hi is None else [max(hi[0], x), max(hi[1], y), max(hi[2], z)]
    if lo is None:
        return None
    return {"x": hi[0] - lo[0], "y_up": hi[1] - lo[1], "z": hi[2] - lo[2], "objects": objs}


def check_trimesh(path: Path):
    import trimesh

    if path.suffix == ".obj":
        return check_obj_text(path)

    scene = trimesh.load(str(path), force="scene")
    lo, hi = None, None
    names = []
    for name, geom in scene.geometry.items():
        names.append(name)
    for node in scene.graph.nodes_geometry:
        T, gname = scene.graph[node]
        n = str(node) + " " + str(gname)
        if "Boundary" not in n:
            continue
        g = scene.geometry[gname].copy()
        g.apply_transform(T)
        b = g.bounds
        lo = b[0] if lo is None else [min(a, c) for a, c in zip(lo, b[0])]
        hi = b[1] if hi is None else [max(a, c) for a, c in zip(hi, b[1])]
    if lo is None:  # OBJ through trimesh may flatten object names into geometry keys
        for gname, g in scene.geometry.items():
            if "Boundary" in gname:
                b = g.bounds
                lo = b[0] if lo is None else [min(a, c) for a, c in zip(lo, b[0])]
                hi = b[1] if hi is None else [max(a, c) for a, c in zip(hi, b[1])]
    if lo is None:
        return None
    return {"x": hi[0] - lo[0], "y_up": hi[1] - lo[1], "z": hi[2] - lo[2], "objects": len(names)}


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
    xs, ys, zs = [], [], []
    count = 0
    buildings = {}
    for ob in bpy.context.scene.objects:
        if ob.type == "MESH" and ob.name.startswith("New_") and ob.name.endswith("_walls"):
            bb = [ob.matrix_world @ mathutils.Vector(v) for v in ob.bound_box]
            buildings[ob.name[:-6]] = (max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb))
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        count += 1
        name = ob.name + " " + (ob.parent.name if ob.parent else "")
        if "Boundary" not in name:
            continue
        for v in ob.bound_box:
            w = ob.matrix_world @ mathutils.Vector(v)
            xs.append(w.x)
            ys.append(w.y)
            zs.append(w.z)
    if not xs:
        return {"objects": count, "boundary": None}
    return {"x": max(xs) - min(xs), "y": max(ys) - min(ys), "z_up": max(zs) - min(zs), "objects": count,
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
    W, D, F, edges = expected_from_site(site)
    print(f"expected boundary extents: {W:.3f} x {D:.3f} m incl. 5 cm fence thickness, fence span {F:.2f} m (edges {edges})")
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
                okt = abs(t["x"] - W) < 0.01 and abs(t["z"] - D) < 0.01 and abs(t["y_up"] - F) < 0.01
                ok_all &= okt
                print(f"  {'obj-text' if p.suffix == '.obj' else 'trimesh '}: boundary {t['x']:.3f} x {t['z']:.3f} m (fence height {t['y_up']:.2f} m)  {'OK' if okt else 'MISMATCH'}")
            if b:
                if b.get("boundary", 1) is None:
                    print(f"  blender : {b['objects']} meshes, boundary objects not found by name")
                    ok_all = False
                else:
                    okb = abs(b["x"] - W) < 0.01 and abs(b["y"] - D) < 0.01 and abs(b["z_up"] - F) < 0.01
                    ok_all &= okb
                    print(f"  blender : boundary {b['x']:.3f} x {b['y']:.3f} m, fence {b['z_up']:.2f} m tall (Z-up), "
                          f"{b['objects']} meshes, units {b['unit_system']}  {'OK' if okb else 'MISMATCH'}")
                    for name, (bx, by) in b.get("buildings", {}).items():
                        print(f"            {name}: walls {bx:.2f} x {by:.2f} m in Blender")
            elif b is None:
                print("  blender : bpy not installed, skipped")
    print("\nALL OK" if ok_all else "\nSOME CHECKS FAILED")
    sys.exit(0 if ok_all else 1)


if __name__ == "__main__":
    main()
