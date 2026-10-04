"""Build the textured site model (glTF) from site.json and the baked photo textures.

    python pipeline/model.py plot

Writes site/model.gltf.json: glTF 2.0 JSON with the geometry buffer embedded and the textures
referenced as JPEG/PNG files under site/tex/. Units are metres, +Y up, the plot's road-left
corner at the origin (x = across the plot, -z = toward the forest), so the file opens at true
scale in any glTF viewer. Each structure is its own named node ("el:house", "tree:t-bl-1", ...)
so the app can pick, hide and label them. Photo-textured surfaces use KHR_materials_unlit: the
light is already in the photographs.
"""
from __future__ import annotations

import base64
import json
import math
import struct
import sys
from pathlib import Path

import cv2
import numpy as np

from common import project_dir

# colours measured in the frames (sRGB 0-255) for surfaces no frame textures directly
COLOURS = {
    "roof-house": (112, 98, 100),     # brown metal tile (c1_082000, c1_089000)
    "roof-sauna": (96, 94, 90),       # dark metal tile (c4_097250)
    "roof-shed": (98, 100, 92),       # weathered roofing (c2_043000)
    "deck": (84, 65, 56),             # wet deck boards (c4_092625)
    "barrel": (31, 122, 195),         # blue barrels (c3_093125)
    "greenhouse": (205, 210, 214),    # milky polycarbonate (c1_042000)
    "trampoline-rim": (64, 137, 140),  # teal pad (c1_113375)
    "tyre": (38, 38, 40),
    "tub": (200, 204, 206),
    "ibc": (206, 210, 204),
    "frame-dark": (40, 40, 42),
    "sand": (196, 178, 140),
    "wood": (120, 92, 66),
    "stone": (150, 146, 140),
    "outer": (92, 104, 70),
    # foliage, measured in the frames (c1_062125, c2_026625, c1_057875, c1_070125) and lifted
    # slightly because the crowns are lit in the model while the frames are exposed for the sky
    "leaves-birch": (150, 146, 82),
    "leaves-fruit": (104, 122, 66),
    "leaves-deciduous": (98, 116, 62),
    "leaves-conifer": (66, 86, 58),
    "leaves-pine": (64, 82, 64),
    "trunk-pine": (92, 70, 58),
    "post": (70, 52, 44),
}


def srgb_to_linear(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


class Gltf:
    def __init__(self):
        self.doc = {"asset": {"version": "2.0", "generator": "mera pipeline/model.py"},
                    "extensionsUsed": ["KHR_materials_unlit"], "scene": 0, "scenes": [{"name": "site", "nodes": []}],
                    "nodes": [], "meshes": [], "materials": [], "textures": [], "images": [], "samplers": [],
                    "accessors": [], "bufferViews": [], "buffers": []}
        self.bin = bytearray()
        self._img = {}
        self._mat = {}
        self._samp = {}

    # -- buffers --
    def _view(self, data: bytes, target=None):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        self.bin.extend(data)
        bv = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            bv["target"] = target
        self.doc["bufferViews"].append(bv)
        return len(self.doc["bufferViews"]) - 1

    def _acc(self, arr, comp, typ, target, minmax=False):
        bv = self._view(arr.tobytes(), target)
        a = {"bufferView": bv, "componentType": comp, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = arr.min(0).tolist()
            a["max"] = arr.max(0).tolist()
        self.doc["accessors"].append(a)
        return len(self.doc["accessors"]) - 1

    # -- materials --
    def sampler(self, repeat: bool):
        key = repeat
        if key not in self._samp:
            w = 10497 if repeat else 33071
            self.doc["samplers"].append({"magFilter": 9729, "minFilter": 9987, "wrapS": w, "wrapT": w})
            self._samp[key] = len(self.doc["samplers"]) - 1
        return self._samp[key]

    def texture(self, uri, repeat):
        key = (uri, repeat)
        if key not in self._img:
            name = uri.rsplit("/", 1)[-1]  # loaders carry it to texture.name, so exporters can find the source file
            self.doc["images"].append({"uri": uri, "name": name, "mimeType": "image/png" if uri.endswith(".png") else "image/jpeg"})
            self.doc["textures"].append({"source": len(self.doc["images"]) - 1, "sampler": self.sampler(repeat), "name": name})
            self._img[key] = len(self.doc["textures"]) - 1
        return self._img[key]

    def material(self, name, *, tex=None, repeat=False, colour=None, unlit=None, alpha=None, double=False, opacity=1.0):
        # surfaces carrying footage show it as filmed (unlit); plain-coloured things and roofs take
        # the soft overcast light, so their faces read as shapes rather than flat silhouettes
        if unlit is None:
            unlit = tex is not None
        key = (name, tex, repeat, colour, unlit, alpha, double, opacity)
        if key in self._mat:
            return self._mat[key]
        pbr = {"metallicFactor": 0.0, "roughnessFactor": 0.95}
        if tex:
            pbr["baseColorTexture"] = {"index": self.texture(tex, repeat)}
        c = [1.0, 1.0, 1.0] if colour is None else [srgb_to_linear(v) for v in colour]
        pbr["baseColorFactor"] = c + [opacity]
        m = {"name": name, "pbrMetallicRoughness": pbr}
        if unlit:
            m["extensions"] = {"KHR_materials_unlit": {}}
        if alpha:
            m["alphaMode"] = alpha
            if alpha == "MASK":
                m["alphaCutoff"] = 0.5
        if double:
            m["doubleSided"] = True
        self.doc["materials"].append(m)
        self._mat[key] = len(self.doc["materials"]) - 1
        return self._mat[key]

    # -- meshes / nodes --
    def mesh(self, name, prims):
        """prims: list of (positions, normals, uvs, indices, material)."""
        out = []
        for pos, nor, uv, idx, mat in prims:
            if len(idx) == 0:
                continue
            attrs = {"POSITION": self._acc(np.asarray(pos, np.float32), 5126, "VEC3", 34962, True),
                     "NORMAL": self._acc(np.asarray(nor, np.float32), 5126, "VEC3", 34962)}
            if uv is not None:
                attrs["TEXCOORD_0"] = self._acc(np.asarray(uv, np.float32), 5126, "VEC2", 34962)
            ind = self._acc(np.asarray(idx, np.uint32), 5125, "SCALAR", 34963)
            out.append({"attributes": attrs, "indices": ind, "material": mat})
        if not out:
            return None
        self.doc["meshes"].append({"name": name, "primitives": out})
        return len(self.doc["meshes"]) - 1

    def node(self, name, mesh=None, children=None, extras=None, parent=None):
        n = {"name": name}
        if mesh is not None:
            n["mesh"] = mesh
        if children:
            n["children"] = children
        if extras:
            n["extras"] = extras
        self.doc["nodes"].append(n)
        i = len(self.doc["nodes"]) - 1
        if parent is None:
            self.doc["scenes"][0]["nodes"].append(i)
        return i

    def write(self, path: Path):
        self.doc["buffers"] = [{"byteLength": len(self.bin),
                                "uri": "data:application/octet-stream;base64," + base64.b64encode(bytes(self.bin)).decode()}]
        path.write_text(json.dumps(self.doc, separators=(",", ":")))


# ---------- geometry helpers (plot coords u, v; world x = u, y = up, z = -v) ----------

class Prim:
    """Accumulates triangles for one material."""

    def __init__(self):
        self.p, self.n, self.t, self.i = [], [], [], []

    def quad(self, a, b, c, d, uva, uvb, uvc, uvd, normal=None):
        """a-b-c-d counter-clockwise seen from the front (world coords)."""
        base = sum(len(x) for x in self.p) if False else len(self.p)
        if normal is None:
            normal = np.cross(np.subtract(b, a), np.subtract(d, a))
            normal = normal / (np.linalg.norm(normal) + 1e-9)
        for v_, uv in ((a, uva), (b, uvb), (c, uvc), (d, uvd)):
            self.p.append(v_); self.n.append(normal); self.t.append(uv)
        self.i += [base, base + 1, base + 2, base, base + 2, base + 3]

    def tri(self, a, b, c, uva, uvb, uvc):
        base = len(self.p)
        nrm = np.cross(np.subtract(b, a), np.subtract(c, a))
        nrm = nrm / (np.linalg.norm(nrm) + 1e-9)
        for v_, uv in ((a, uva), (b, uvb), (c, uvc)):
            self.p.append(v_); self.n.append(nrm); self.t.append(uv)
        self.i += [base, base + 1, base + 2]

    def add(self, pos, nor, uv, idx):
        base = len(self.p)
        self.p += list(pos); self.n += list(nor); self.t += list(uv)
        self.i += [base + k for k in idx]

    def build(self, mat):
        return (np.array(self.p, np.float32).reshape(-1, 3), np.array(self.n, np.float32).reshape(-1, 3),
                np.array(self.t, np.float32).reshape(-1, 2), np.array(self.i, np.uint32), mat)


def W(u, v, y):
    return (float(u), float(y), float(-v))


class Site:
    def __init__(self, pid):
        self.pdir = project_dir(pid)
        self.s = json.loads((self.pdir / "site.json").read_text())
        self.lay = json.loads((self.pdir / "layout.json").read_text())
        self.tex = json.loads((self.pdir / "site" / "tex" / "tex.json").read_text())
        t = self.s["terrain"]
        self.h0, self.gu, self.gv = t["h0"], t["gu"], t["gv"]

    def h(self, u, v):
        return self.h0 + self.gu * u + self.gv * v


def corners(el):
    c = np.array(el["center"], float)
    w, d = el["size"][0] / 2, el["size"][1] / 2
    a = math.radians(el["angle"])
    co, si = math.cos(a), math.sin(a)
    return [c + np.array([x * co - y * si, x * si + y * co]) for x, y in ((-w, -d), (w, -d), (w, d), (-w, d))]


def roof_texture(path: Path, colour, rows=0.35):
    """Metal-tile roof in the measured colour: courses every 35 cm, faint vertical profile."""
    N = 256
    img = np.zeros((N, N, 3), np.float32)
    img[:] = np.array(colour[::-1], np.float32)
    yy = np.arange(N)
    course = (np.sin(yy / N * 2 * np.pi * 4) * 0.5 + 0.5) ** 6  # 4 courses per tile
    img *= (1 - 0.22 * course)[:, None, None]
    xx = np.arange(N)
    prof = 1 + 0.05 * np.sin(xx / N * 2 * np.pi * 8)
    img *= prof[None, :, None]
    rng = np.random.default_rng(7)
    img += rng.normal(0, 3, img.shape)
    cv2.imwrite(str(path), img.clip(0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 88])
    return rows * 4  # metres per tile


# ---------- builders ----------

def build_terrain(S: Site, G: Gltf):
    gx = S.tex["ground"]
    u0, v0, u1, v1 = gx["extent"]
    step = 2.0
    us = np.arange(u0, u1 + 1e-6, step)
    vs = np.arange(v0, v1 + 1e-6, step)
    pos, nor, uv, idx = [], [], [], []
    n_ = np.array([-S.gu, 1.0, S.gv]); n_ /= np.linalg.norm(n_)
    for j, v in enumerate(vs):
        for i, u in enumerate(us):
            pos.append(W(u, v, S.h(u, v))); nor.append(n_)
            uv.append(((u - u0) / (u1 - u0), (v1 - v) / (v1 - v0)))
    nu = len(us)
    for j in range(len(vs) - 1):
        for i in range(nu - 1):
            a, b, c, d = j * nu + i, j * nu + i + 1, (j + 1) * nu + i + 1, (j + 1) * nu + i
            idx += [a, b, c, a, c, d]
    mat = G.material("ground", tex="tex/" + gx["file"])
    m = G.mesh("terrain", [(np.array(pos), np.array(nor), np.array(uv), np.array(idx), mat)])
    G.node("terrain", m, extras={"kind": "terrain"})
    # the surroundings to the horizon: road, meadow and forest floor, tiled from the composite's own edges
    tiles = gx.get("tiles")
    if not tiles:
        return
    R = 320.0
    E = (u0, u1, v0, v1)
    pb = S.s["plot"]["polygon"]
    back_v = max(p[1] for p in pb)
    right_u = max(p[0] for p in pb)
    rv0, rv1 = gx.get("road", [-10.0, -0.6])
    regions = {
        "road": [(-R, R, rv0, rv1)],
        "lawn": [(-R, R, -R, rv0), (-R, 0.0, rv1, 28.0), (right_u, R, rv1, back_v)],
        "floor": [(-R, R, back_v, R), (-R, 0.0, 28.0, back_v)],
    }

    def minus(r, e):
        a0, a1, b0, b1 = r
        if a1 <= e[0] or a0 >= e[1] or b1 <= e[2] or b0 >= e[3]:
            return [r]
        out = []
        if a0 < e[0]: out.append((a0, e[0], b0, b1))
        if a1 > e[1]: out.append((e[1], a1, b0, b1))
        m0, m1 = max(a0, e[0]), min(a1, e[1])
        if b0 < e[2]: out.append((m0, m1, b0, e[2]))
        if b1 > e[3]: out.append((m0, m1, e[3], b1))
        return out

    P = Prim()
    prims = []
    for name, rects in regions.items():
        t = tiles[name]
        T = t["size"]
        P = Prim()
        for r in rects:
            for a0, a1, b0, b1 in minus(r, E):
                if a1 - a0 < 1e-3 or b1 - b0 < 1e-3:
                    continue
                if name == "road":  # one band across, tiled along the road
                    uv = lambda u, v: (u / T, (rv1 - v) / (rv1 - rv0))
                else:
                    uv = lambda u, v: (u / T, -v / T)
                c = [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
                P.quad(*[W(u, v, S.h(u, v) - 0.005) for u, v in c], *[uv(u, v) for u, v in c], normal=n_)
        prims.append(P.build(G.material(f"surroundings-{name}", tex="tex/" + t["file"], repeat=True)))
    m2 = G.mesh("outer-ground", prims)
    G.node("outer-ground", m2, extras={"kind": "scenery"})


def wall_heights(el, name):
    eave = el["height"]; ridge = el.get("ridge", eave); roof = el.get("roof", "flat")
    if roof == "gable":
        along_u = el.get("ridgeAxis", "u") == "u"
        gable = (name in ("east", "west")) if along_u else (name in ("south", "north"))
        return eave, eave, (ridge if gable else eave), gable
    if roof == "shed":
        return {"south": (eave, eave, eave, False), "north": (ridge, ridge, ridge, False),
                "east": (eave, ridge, ridge, False), "west": (ridge, eave, ridge, False)}[name]
    return eave, eave, eave, False


def build_building(S: Site, G: Gltf, el, parent_node_children):
    fac = S.tex.get("facades", {}).get(el["id"], {})
    mats = S.tex.get("materials", {})
    C = corners(el)
    base = min(S.h(c[0], c[1]) for c in C)
    names = ["south", "east", "north", "west"]
    prims = {}

    def prim_for(key, **kw):
        if key not in prims:
            prims[key] = (Prim(), G.material(key, **kw))
        return prims[key][0]

    for k, name in enumerate(names):
        a, b = C[k], C[(k + 1) % 4]
        L = float(np.linalg.norm(b - a))
        ha, hb, top, gable = wall_heights(el, name)
        info = fac.get(name, {})
        matname = info.get("material")
        sink = 0.25  # walls go a little into the ground so slopes never show a gap
        if info.get("file") and not matname:
            P = prim_for(f"wall:{el['id']}:{name}", tex="tex/" + info["file"])
            sx = lambda s: s
            tv = lambda h: (top - h) / top
        else:
            m = mats.get(matname or "boards") or mats.get("boards")
            P = prim_for(f"mat:{matname or 'boards'}", tex="tex/" + m["file"], repeat=True)
            sx = lambda s, L=L, m=m: s * L / m["width"]
            tv = lambda h, m=m: (m["height"] - h) / m["height"]
        y0 = base - sink
        A0, B0 = W(a[0], a[1], y0), W(b[0], b[1], y0)
        A1, B1 = W(a[0], a[1], base + ha), W(b[0], b[1], base + hb)
        P.quad(A0, B0, B1, A1, (sx(0), tv(-sink)), (sx(1), tv(-sink)), (sx(1), tv(hb)), (sx(0), tv(ha)))
        if gable:
            mid = (a + b) / 2
            Mt = W(mid[0], mid[1], base + top)
            P.tri(A1, B1, Mt, (sx(0), tv(ha)), (sx(1), tv(hb)), (sx(0.5), tv(top)))
    out = [p.build(m) for p, m in prims.values()]
    # roof
    roof = el.get("roof", "flat")
    rkey = "roof-house" if el["id"] in ("house", "veranda") else ("roof-sauna" if el["id"] == "sauna" else "roof-shed")
    rpath = S.pdir / "site" / "tex" / f"{rkey}.jpg"
    tile = roof_texture(rpath, COLOURS[rkey])
    rm = G.material(rkey, tex=f"tex/{rkey}.jpg", repeat=True, double=True, unlit=False)
    R = Prim()
    eave, ridge = el["height"], el.get("ridge", el["height"])
    oh = 0.35
    c = np.array(el["center"]); ang = math.radians(el["angle"])
    ex, ey = np.array([math.cos(ang), math.sin(ang)]), np.array([-math.sin(ang), math.cos(ang)])
    w, d = el["size"][0] / 2 + oh, el["size"][1] / 2 + oh
    def P2(x, y):
        return c + ex * x + ey * y
    if roof == "gable":
        along_u = el.get("ridgeAxis", "u") == "u"
        span = el["size"][1] / 2 if along_u else el["size"][0] / 2
        slope = (ridge - eave) / span
        drop = oh * slope
        if along_u:
            l, r_ = -w, w
            for sgn in (-1, 1):
                e1, e2 = P2(l, sgn * d), P2(r_, sgn * d)
                r1, r2 = P2(l, 0), P2(r_, 0)
                ye, yr = base + eave - drop, base + ridge
                q = [W(*e1, ye), W(*e2, ye), W(*r2, yr), W(*r1, yr)]
                if sgn > 0:
                    q = [q[1], q[0], q[3], q[2]]
                lu = (r_ - l) / tile; lv = math.hypot(d, ridge - eave + drop) / tile
                R.quad(*q, (0, lv), (lu, lv), (lu, 0), (0, 0))
        else:
            for sgn in (-1, 1):
                e1, e2 = P2(sgn * w, -d), P2(sgn * w, d)
                r1, r2 = P2(0, -d), P2(0, d)
                ye, yr = base + eave - drop, base + ridge
                q = [W(*e1, ye), W(*e2, ye), W(*r2, yr), W(*r1, yr)]
                if sgn < 0:
                    q = [q[1], q[0], q[3], q[2]]
                lu = 2 * d / tile; lv = math.hypot(w, ridge - eave + drop) / tile
                R.quad(*q, (0, lv), (lu, lv), (lu, 0), (0, 0))
    else:
        # shed (or flat): one plane from the front (low) edge to the back (high) edge
        hi = ridge if roof == "shed" else eave + 0.15
        lo = eave if roof == "shed" else eave + 0.15
        f1, f2, b2, b1 = P2(-w, -d), P2(w, -d), P2(w, d), P2(-w, d)
        R.quad(W(*f1, base + lo), W(*f2, base + lo), W(*b2, base + hi), W(*b1, base + hi),
               (0, 2 * d / tile), (2 * w / tile, 2 * d / tile), (2 * w / tile, 0), (0, 0))
    out.append(R.build(rm))
    mid = G.mesh(el["id"], out)
    return G.node(el["id"], mid, extras={"kind": el["kind"], "label": el["label"], "id": el["id"]})


def cylinder(P: Prim, c, r, y0, y1, seg=16, uv_scale=(1, 1), cap=True, rtop=None):
    rtop = r if rtop is None else rtop
    for k in range(seg):
        a0, a1 = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
        p0 = (c[0] + r * math.cos(a0), c[1] + r * math.sin(a0)); p1 = (c[0] + r * math.cos(a1), c[1] + r * math.sin(a1))
        q0 = (c[0] + rtop * math.cos(a0), c[1] + rtop * math.sin(a0)); q1 = (c[0] + rtop * math.cos(a1), c[1] + rtop * math.sin(a1))
        u0, u1 = k / seg * uv_scale[0], (k + 1) / seg * uv_scale[0]
        P.quad(W(*p1, y0), W(*p0, y0), W(*q0, y1), W(*q1, y1), (u1, uv_scale[1]), (u0, uv_scale[1]), (u0, 0), (u1, 0))
        if cap:
            P.tri(W(c[0], c[1], y1), W(*q1, y1), W(*q0, y1), (0.5, 0.5), (0.5, 0.5), (0.5, 0.5))


def box(P: Prim, c, size, ang, y0, y1):
    cs = corners({"center": c, "size": size, "angle": ang})
    for k in range(4):
        a, b = cs[k], cs[(k + 1) % 4]
        P.quad(W(*a, y0), W(*b, y0), W(*b, y1), W(*a, y1), (0, 1), (1, 1), (1, 0), (0, 0))
    P.quad(W(*cs[0], y1), W(*cs[1], y1), W(*cs[2], y1), W(*cs[3], y1), (0, 1), (1, 1), (1, 0), (0, 0))


def build_small(S: Site, G: Gltf, el):
    k, eid = el["kind"], el["id"]
    c = el["center"]
    base = S.h(*c)
    prims = []
    if eid == "sauna-terrace":
        gx = S.tex["ground"]
        u0, v0, u1, v1 = gx["extent"]
        top = Prim()
        cs = corners(el)
        uvf = lambda p: ((p[0] - u0) / (u1 - u0), (v1 - p[1]) / (v1 - v0))
        yt = max(S.h(*p) for p in cs) + el["height"]
        top.quad(*[W(*p, yt) for p in cs], *[uvf(p) for p in cs])
        prims.append(top.build(G.material("ground", tex="tex/" + gx["file"])))
        side = Prim()
        for i in range(4):
            a, b = cs[i], cs[(i + 1) % 4]
            side.quad(W(*a, S.h(*a) - 0.1), W(*b, S.h(*b) - 0.1), W(*b, yt), W(*a, yt), (0, 1), (1, 1), (1, 0), (0, 0))
        prims.append(side.build(G.material("deck-side", colour=COLOURS["deck"])))
    elif eid == "greenhouse":
        P = Prim()
        L, Wd = el["size"]
        r = Wd / 2
        ang = math.radians(el["angle"])
        ex, ey = np.array([math.cos(ang), math.sin(ang)]), np.array([-math.sin(ang), math.cos(ang)])
        cc = np.array(c)
        seg = 12
        hscale = el["height"] / r
        for i in range(seg):
            t0, t1 = math.pi * i / seg, math.pi * (i + 1) / seg
            for (x0, x1) in ((-L / 2, L / 2),):
                p = lambda x, t: cc + ex * x + ey * (r * math.cos(t))
                y = lambda t: base + r * math.sin(t) * hscale
                P.quad(W(*p(x0, t0), y(t0)), W(*p(x1, t0), y(t0)), W(*p(x1, t1), y(t1)), W(*p(x0, t1), y(t1)),
                       (0, 0), (1, 0), (1, 1), (0, 1))
        for x in (-L / 2, L / 2):
            for i in range(seg):
                t0, t1 = math.pi * i / seg, math.pi * (i + 1) / seg
                pc = cc + ex * x
                P.tri(W(*pc, base), W(*(cc + ex * x + ey * r * math.cos(t0)), base + r * math.sin(t0) * hscale),
                      W(*(cc + ex * x + ey * r * math.cos(t1)), base + r * math.sin(t1) * hscale), (0, 0), (0, 0), (0, 0))
        prims.append(P.build(G.material("greenhouse", colour=COLOURS["greenhouse"], alpha="BLEND", opacity=0.82, double=True)))
    elif eid == "water-tank":
        P = Prim(); F_ = Prim()
        box(P, [c[0], c[1]], [1.15, 0.95], el["angle"], base + 1.0, base + 2.15)
        for dx in (-0.55, 0.55):
            for dy in (-0.45, 0.45):
                cylinder(F_, (c[0] + dx, c[1] + dy), 0.04, base, base + 1.0, 6, cap=False)
        box(F_, [c[0], c[1]], [1.25, 1.05], el["angle"], base + 0.95, base + 1.0)
        prims += [P.build(G.material("ibc", colour=COLOURS["ibc"])), F_.build(G.material("frame-dark", colour=COLOURS["frame-dark"]))]
    elif eid == "barrels":
        P = Prim()
        ang = math.radians(el["angle"])
        for t in (-0.8, 0.0, 0.8):
            cylinder(P, (c[0] + t * math.cos(ang), c[1] + t * math.sin(ang)), 0.3, base, base + 0.9, 14)
        prims.append(P.build(G.material("barrel", colour=COLOURS["barrel"])))
    elif eid == "tyre":
        P = Prim()
        cylinder(P, c, 0.8, base, base + 0.6, 20, cap=False)
        cylinder(P, c, 0.42, base, base + 0.6, 16, cap=False)
        # top ring
        for i in range(20):
            a0, a1 = 2 * math.pi * i / 20, 2 * math.pi * (i + 1) / 20
            o0 = (c[0] + 0.8 * math.cos(a0), c[1] + 0.8 * math.sin(a0)); o1 = (c[0] + 0.8 * math.cos(a1), c[1] + 0.8 * math.sin(a1))
            i0 = (c[0] + 0.42 * math.cos(a0), c[1] + 0.42 * math.sin(a0)); i1 = (c[0] + 0.42 * math.cos(a1), c[1] + 0.42 * math.sin(a1))
            P.quad(W(*o0, base + 0.6), W(*o1, base + 0.6), W(*i1, base + 0.6), W(*i0, base + 0.6), (0, 0), (0, 0), (0, 0), (0, 0))
        prims.append(P.build(G.material("tyre", colour=COLOURS["tyre"], double=True)))
    elif eid == "trampoline":
        r = el["size"][0] / 2
        rim, mat, net, legs = Prim(), Prim(), Prim(), Prim()
        cylinder(rim, c, r + 0.15, base + 0.82, base + 0.95, 28, cap=False)
        cylinder(mat, c, r - 0.05, base + 0.86, base + 0.87, 28, cap=True)
        cylinder(net, c, r, base + 0.95, base + 2.6, 28, cap=False)
        for i in range(6):
            a = 2 * math.pi * i / 6
            cylinder(legs, (c[0] + r * math.cos(a), c[1] + r * math.sin(a)), 0.03, base, base + 2.6, 6, cap=False)
        prims += [rim.build(G.material("trampoline-rim", colour=COLOURS["trampoline-rim"], double=True)),
                  mat.build(G.material("frame-dark", colour=COLOURS["frame-dark"])),
                  net.build(G.material("trampoline-net", colour=(20, 20, 22), alpha="BLEND", opacity=0.35, double=True)),
                  legs.build(G.material("frame-dark", colour=COLOURS["frame-dark"]))]
    elif eid == "bathtub":
        P = Prim(); box(P, c, el["size"], el["angle"], base, base + 0.6)
        prims.append(P.build(G.material("tub", colour=COLOURS["tub"])))
    elif eid == "sandbox":
        P = Prim(); S_ = Prim()
        cs = corners(el)
        for i in range(4):
            a, b = cs[i], cs[(i + 1) % 4]
            P.quad(W(*a, base - 0.05), W(*b, base - 0.05), W(*b, base + 0.3), W(*a, base + 0.3), (0, 1), (1, 1), (1, 0), (0, 0))
        S_.quad(*[W(*p, base + 0.2) for p in cs], (0, 0), (1, 0), (1, 1), (0, 1))
        prims += [P.build(G.material("wood", colour=COLOURS["wood"], double=True)), S_.build(G.material("sand", colour=COLOURS["sand"]))]
    elif eid == "rockgarden":
        P = Prim()
        rng = np.random.default_rng(11)
        cs = corners(el)
        for i in range(9):
            s, t = rng.random(), rng.random()
            p = cs[0] + (cs[1] - cs[0]) * s + (cs[3] - cs[0]) * t
            r = 0.2 + 0.25 * rng.random()
            cylinder(P, p, r, base - 0.1, base + r * 0.7, 7, rtop=r * 0.5)
        prims.append(P.build(G.material("stone", colour=COLOURS["stone"])))
    elif eid == "forest-door":
        m = S.tex["materials"].get("boards")
        P = Prim()
        cs = corners(el)
        a, b = cs[0], cs[1]
        P.quad(W(*a, base), W(*b, base), W(*b, base + el["height"]), W(*a, base + el["height"]), (0, 1), (0.3, 1), (0.3, 0), (0, 0))
        prims.append(P.build(G.material("mat:boards", tex="tex/" + m["file"], repeat=True, double=True)))
    else:
        return None  # flat areas live in the ground texture
    mid = G.mesh(eid, prims)
    return G.node(eid, mid, extras={"kind": k, "label": el["label"], "id": eid})


def build_fences(S: Site, G: Gltf):
    fx = S.tex["fences"]
    edges = {e["id"]: e for e in S.s["plot"]["edges"]}
    ent = S.s["plot"]["entrance"]
    nodes = []

    def run(name, a, b, style, skip=None):
        f = fx[style]
        P = Prim()
        Pp = Prim()
        a = np.array(a, float); b = np.array(b, float)
        L = float(np.linalg.norm(b - a))
        if L < 0.05:
            return
        H = f["height"]
        dirv = (b - a) / L
        segs = [(0.0, L)]
        for s0, s1 in sorted(skip or []):  # openings: gate, door, a building wall standing in the fence line
            last = segs.pop()
            segs += [(last[0], max(last[0], s0)), (min(L, max(last[0], s1)), last[1])]
        for s0, s1 in segs:
            if s1 - s0 < 0.05:
                continue
            n = max(1, int(math.ceil((s1 - s0) / 2.5)))
            for i in range(n):
                t0 = s0 + (s1 - s0) * i / n; t1 = s0 + (s1 - s0) * (i + 1) / n
                p0, p1 = a + dirv * t0, a + dirv * t1
                y0, y1 = S.h(*p0), S.h(*p1)
                u0_, u1_ = t0 / f["length"], t1 / f["length"]
                P.quad(W(*p0, y0 - 0.15), W(*p1, y1 - 0.15), W(*p1, y1 + H), W(*p0, y0 + H),
                       (u0_, 1 + 0.15 / H), (u1_, 1 + 0.15 / H), (u1_, 0), (u0_, 0))
        mats = [P.build(G.material(f"fence:{style}", tex="tex/" + f["file"], repeat=True, double=True))]
        mid = G.mesh(f"fence-{name}", mats)
        nodes.append(G.node(f"fence_{name}", mid, extras={"kind": "fence", "style": style, "edge": name.split("-")[0]}))

    road = edges["road"]
    gate_s = (ent["u"] - ent["width"] / 2, ent["u"] + ent["width"] / 2)
    run("road", road["a"], road["b"], "picket", skip=[gate_s])
    # the gate itself, from its own frame
    g = fx["gate"]
    P = Prim()
    a = np.array([gate_s[1], 0.0]); b = np.array([gate_s[0], 0.0])
    ya, yb = S.h(*a), S.h(*b)
    P.quad(W(*a, ya - 0.1), W(*b, yb - 0.1), W(*b, yb + g["height"]), W(*a, ya + g["height"]), (0, 1), (1, 1), (1, 0), (0, 0))
    gm = G.mesh("gate", [P.build(G.material("gate", tex="tex/" + g["file"], double=True))])
    G.node("entrance-gate", gm, extras={"kind": "fence", "label": "Entrance gate", "edge": "road"})
    right = edges["right"]
    sw = right.get("switchAt", 0.5)
    mid_pt = np.array(right["a"]) + (np.array(right["b"]) - np.array(right["a"])) * sw
    run("right-front", right["a"], mid_pt, "mesh")
    run("right-back", mid_pt, right["b"], "boards-right")
    fe = edges["forest"]
    fa = np.array(fe["a"]); fb = np.array(fe["b"])
    along = lambda p: float(np.dot(np.array(p) - fa, (fb - fa) / np.linalg.norm(fb - fa)))
    skip = []
    for e in S.s["elements"]:
        if e["id"] == "forest-door":
            s_ = along(e["center"])
            skip.append((s_ - e["size"][0] / 2, s_ + e["size"][0] / 2))
        elif e.get("outside"):  # its front wall is the fence here (the utility cabin and its door)
            ss = sorted(along(c) for c in e["footprint"])
            skip.append((ss[0] + 0.05, ss[-1] - 0.05))
    run("forest", fe["a"], fe["b"], "boards", skip=skip)
    le = edges["left"]
    if le.get("switchAt"):
        mid_l = np.array(le["a"]) + (np.array(le["b"]) - np.array(le["a"])) * le["switchAt"]
        run("left-back", le["a"], mid_l, "boards-left")
        run("left-front", mid_l, le["b"], "picket-dark")
    else:
        run("left", le["a"], le["b"], "boards-left")
    return nodes


def build_forest(S: Site, G: Gltf):
    """The forest edge as photo planes: the one measured behind the back fence, and the same forest
    repeated deeper and darker, so gaps between the trees show more trees instead of open ground."""
    fo = S.tex.get("forest")
    if not fo or "back" not in fo:
        return
    f = fo["back"]
    a, b = np.array(f["a"], float), np.array(f["b"], float)
    H = f["height"]
    vb = a[1]
    # the deeper layer is solid below its treeline, so the gaps in the front layer show forest
    from texture import offset_fill
    rgba = cv2.imread(str(S.pdir / "site" / "tex" / f["file"]), cv2.IMREAD_UNCHANGED)
    solid = rgba[..., 3] > 127
    top = np.argmax(cv2.dilate(solid.astype(np.uint8), np.ones((1, 9), np.uint8)) > 0, axis=0)
    below = np.arange(rgba.shape[0])[:, None] >= cv2.blur(top[None].astype(np.float32), (25, 1))[0][None]
    rgb = offset_fill(rgba[..., :3], solid, below & ~solid)
    cv2.imwrite(str(S.pdir / "site" / "tex" / "forest_deep.png"), np.dstack([rgb, ((below | solid) * 255).astype(np.uint8)]))
    planes = [
        ("back", a, b, H, (0.0, 1.0), None, f["file"]),
        ("back-deep", a + np.array([-12.0, 9.0]), b + np.array([12.0, 9.0]), H + 3, (1.0, 0.0), (190, 196, 190), "forest_deep.png"),
    ]
    for name, pa, pbb, h, ur, tint, fn in planes:
        P = Prim()
        n = 8
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            p0, p1 = pa + (pbb - pa) * t0, pa + (pbb - pa) * t1
            y0, y1 = S.h(*p0) - 0.3, S.h(*p1) - 0.3
            u0_, u1_ = ur[0] + (ur[1] - ur[0]) * t0, ur[0] + (ur[1] - ur[0]) * t1
            P.quad(W(*p0, y0), W(*p1, y1), W(*p1, y1 + h), W(*p0, y0 + h), (u0_, 1), (u1_, 1), (u1_, 0), (u0_, 0))
        mat = G.material("forest" if tint is None else f"forest-{name}", tex="tex/" + fn, alpha="MASK", double=True, colour=tint)
        mid = G.mesh(f"forest-{name}", [P.build(mat)])
        G.node(f"forest_{name}", mid, extras={"kind": "scenery"})
    # the canopy behind, at treetop height, so from above the forest goes on instead of ending in a wall
    from texture import seamless
    rgba = cv2.imread(str(S.pdir / "site" / "tex" / f["file"]), cv2.IMREAD_UNCHANGED)
    h_, w_ = rgba.shape[:2]
    crop = rgba[int(h_ * 0.12):int(h_ * 0.5), int(w_ * 0.02):int(w_ * 0.36), :3]
    tile = (seamless(crop).astype(np.float32) * 0.78).clip(0, 255).astype(np.uint8)
    cv2.imwrite(str(S.pdir / "site" / "tex" / "tile_canopy.jpg"), tile, [cv2.IMWRITE_JPEG_QUALITY, 85])
    T = crop.shape[1] * 0.1  # metres per tile (the backdrop is 0.1 m per pixel)
    v0c, R = vb + 9.0, 300.0
    P = Prim()
    c = [(-R, v0c), (R, v0c), (R, v0c + R), (-R, v0c + R)]
    yc = lambda u, v: S.h(u, v) + H - 0.5
    P.quad(*[W(u, v, yc(u, v)) for u, v in c], *[(u / T, -v / T) for u, v in c], normal=(0.0, 1.0, 0.0))
    mid = G.mesh("forest-canopy", [P.build(G.material("forest-canopy", tex="tex/tile_canopy.jpg", repeat=True))])
    G.node("forest_canopy", mid, extras={"kind": "scenery"})


def crop_tile(S: Site, fid, box, out_name, axis="both", detail=False):
    """Seamless tile cut from a frame. detail=True keeps only the light/dark pattern on a near-white
    base, so a material colour (measured in the frames) sets the tone and the texture adds grain."""
    from texture import seamless
    im = cv2.imread(str(S.pdir / "frames" / f"{fid}.jpg"))
    x0, y0, x1, y1 = box
    t = seamless(im[y0:y1, x0:x1], axis)
    if detail:
        g = cv2.cvtColor(t, cv2.COLOR_BGR2GRAY).astype(np.float32)
        d = g - cv2.GaussianBlur(g, (0, 0), 8)
        t = cv2.cvtColor((225 + d * 1.1).clip(0, 255).astype(np.uint8), cv2.COLOR_GRAY2BGR)
    cv2.imwrite(str(S.pdir / "site" / "tex" / out_name), t, [cv2.IMWRITE_JPEG_QUALITY, 86])
    return "tex/" + out_name


def icosphere(subdiv=1):
    t = (1 + 5 ** 0.5) / 2
    v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
         (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    v = [np.array(x) / np.linalg.norm(x) for x in v]
    for _ in range(subdiv):
        nf, cache = [], {}
        def mid(a, b):
            k = tuple(sorted((a, b)))
            if k not in cache:
                m = v[a] + v[b]; v.append(m / np.linalg.norm(m)); cache[k] = len(v) - 1
            return cache[k]
        for a, b, c in f:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        f = nf
    return np.array(v), f


def crown(P: Prim, rng, V, F, cx, cv, cy, rx, ry, blobs):
    """Soft crown from a few jittered spheres (smooth normals, so it shades as one volume)."""
    for _ in range(blobs):
        off = rng.normal(0, rx * 0.28, 2)
        oy = rng.normal(0, ry * 0.18)
        rs = rx * (0.7 + 0.3 * rng.random())
        rys = ry * (0.7 + 0.3 * rng.random())
        jit = 1 + rng.normal(0, 0.07, len(V))
        pos = [W(cx + off[0] + p[0] * rs * j, cv + off[1] + p[2] * rs * j, cy + oy + p[1] * rys * j) for p, j in zip(V, jit)]
        nor = [(p[0], p[1], -p[2]) for p in V]
        uv = [((math.atan2(p[2], p[0]) / (2 * math.pi) + 0.5) * 3, (0.5 - math.asin(max(-1, min(1, p[1]))) / math.pi) * 2) for p in V]
        P.add(pos, nor, uv, [k for f in F for k in f])


def ellipsoid(P: Prim, V, F, cx, cv, cy, rx, ry, rng, jitter=0.04):
    jit = 1 + rng.normal(0, jitter, len(V))
    pos = [W(cx + p[0] * rx * j, cv + p[2] * rx * j, cy + p[1] * ry * j) for p, j in zip(V, jit)]
    nor = [(p[0] / rx, p[1] / ry, -p[2] / rx) for p in V]
    nor = [tuple(np.array(n) / np.linalg.norm(n)) for n in nor]
    uv = [((math.atan2(p[2], p[0]) / (2 * math.pi) + 0.5) * 2, 0.5 - p[1] * 0.5) for p in V]
    P.add(pos, nor, uv, [k for f in F for k in f])


def foliage_texture(S: Site, detail_tex: str, name: str, density: float, seed: int) -> str:
    """Leaf texture with holes: the grain is the footage crop, the alpha a periodic clumped mask,
    so crowns read as foliage with sky between the leaves rather than as solid balls."""
    N = 256
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(N)
    k2 = f[None, :] ** 2 + f[:, None] ** 2
    def noise(sigma):  # periodic: filtered in the frequency domain
        return np.real(np.fft.ifft2(np.fft.fft2(rng.normal(0, 1, (N, N))) * np.exp(-k2 * (2 * np.pi * sigma) ** 2 / 2)))
    n = noise(6) / noise(6).std() + 0.5 * noise(2.2) / noise(2.2).std()
    thr = np.quantile(n, 1 - density)
    alpha = np.clip((n - thr) * 3 + 0.5, 0, 1)
    rgb = cv2.resize(cv2.imread(str(S.pdir / "site" / detail_tex)), (N, N), interpolation=cv2.INTER_AREA)
    # leaves are darker toward the inside of each clump
    shade = np.clip(0.78 + 0.12 * (n - thr), 0.6, 1.05)[..., None]
    rgba = np.dstack([(rgb * shade).clip(0, 255).astype(np.uint8), (alpha * 255).astype(np.uint8)])
    out = f"foliage_{name}.png"
    cv2.imwrite(str(S.pdir / "site" / "tex" / out), rgba)
    return "tex/" + out


def cone(P: Prim, c, r, y0, y1, seg, uv_scale, rng, jitter=0.08):
    """Closed cone with a slightly irregular rim, for conifer crowns."""
    pos, nor, uv, idx = [], [], [], []
    radii = r * (1 + rng.normal(0, jitter, seg))
    for i in range(seg + 1):
        a = 2 * math.pi * i / seg
        rr = radii[i % seg]
        ca, sa = math.cos(a), math.sin(a)
        slope = r / (y1 - y0)
        n = np.array([ca, slope, -sa]); n /= np.linalg.norm(n)
        pos += [W(c[0] + ca * rr, c[1] + sa * rr, y0), W(c[0], c[1], y1)]
        nor += [tuple(n), tuple(n)]
        uv += [(i / seg * uv_scale[0], uv_scale[1]), (i / seg * uv_scale[0], 0)]
    for i in range(seg):
        a, b = 2 * i, 2 * i + 2
        idx += [a, b, a + 1, b, b + 1, a + 1]
    P.add(pos, nor, uv, idx)


def build_trees(S: Site, G: Gltf):
    """Trees as calm massing: a trunk with bark cut from the frames and a crown in the foliage
    colour measured for that species: an opaque core for volume and an open outer layer of
    leaves. It was filmed in autumn, so the birches are kept sparse. Positions and heights are
    the located ones."""
    birch_bark = crop_tile(S, "c1_119000", (648, 20, 690, 430), "bark_birch.jpg", "both")
    bark = crop_tile(S, "c2_026625", (500, 230, 540, 360), "bark.jpg", "both")
    leaves = crop_tile(S, "c2_026625", (400, 40, 620, 180), "leaves.jpg", detail=True)
    open_tex = {sp: foliage_texture(S, leaves, sp, d, k) for k, (sp, d) in
                enumerate((("birch", 0.4), ("deciduous", 0.6), ("fruit", 0.58), ("conifer", 0.72)))}
    rng = np.random.default_rng(5)
    V, F = icosphere(2)
    for t in S.s["trees"]:
        u, v = t["at"]
        base = S.h(u, v)
        H, cr = t["height"], t["crown"]
        sp = t["species"]
        trunk, core, shell = Prim(), Prim(), Prim()
        r = 0.09 if sp == "birch" else (0.1 if sp == "conifer" else 0.13)
        top_trunk = H * (0.9 if sp == "conifer" else (0.8 if sp == "birch" else 0.55))
        cylinder(trunk, (u, v), r, base - 0.1, base + top_trunk, 8, uv_scale=(1, H / 1.5), cap=False, rtop=r * 0.6)
        if sp == "conifer":
            cone(core, (u, v), cr * 0.62, base + H * 0.22, base + H * 0.96, 12, (2, 2), rng)
            cone(shell, (u, v), cr, base + H * 0.15, base + H, 14, (3, 3), rng)
        elif sp == "birch":
            ellipsoid(shell, V, F, u, v, base + H * 0.66, cr * 0.8, H * 0.3, rng, 0.06)
            ellipsoid(shell, V, F, u + 0.15, v - 0.1, base + H * 0.62, cr * 0.55, H * 0.22, rng, 0.06)
        else:
            cy = base + H * 0.62
            ellipsoid(core, V, F, u, v, cy, cr * 0.62, H * 0.24, rng, 0.05)
            crown(shell, rng, V, F, u, v, cy, cr * 0.95, H * 0.34, 3)
        lk = f"leaves-{sp}"
        col = COLOURS[lk]
        prims = [trunk.build(G.material("bark-birch" if sp == "birch" else "bark", tex=birch_bark if sp == "birch" else bark, repeat=True))]
        if core.i:
            prims.append(core.build(G.material(lk + "-core", tex=leaves, repeat=True, colour=tuple(int(c * 0.72) for c in col), unlit=False)))
        prims.append(shell.build(G.material(lk, tex=open_tex[sp], repeat=True, colour=col, unlit=False, alpha="MASK", double=True)))
        mid = G.mesh(t["id"], prims)
        G.node(f"tree_{t['id']}", mid, extras={"kind": "tree", "species": sp, "id": t["id"]})


def main(pid: str):
    S = Site(pid)
    G = Gltf()
    build_terrain(S, G)
    for el in S.s["elements"]:
        if el["id"] in ("house", "veranda", "sauna", "woodshed", "utility-cabin", "teal-cabin"):
            build_building(S, G, el, None)
        else:
            build_small(S, G, el)
    build_fences(S, G)
    build_forest(S, G)
    build_trees(S, G)
    out = S.pdir / "site" / "model.gltf.json"
    G.write(out)
    print(f"{out}: {len(G.doc['nodes'])} nodes, {len(G.doc['meshes'])} meshes, {len(G.doc['images'])} images, "
          f"geometry {len(G.bin) / 1e6:.2f} MB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "plot")
