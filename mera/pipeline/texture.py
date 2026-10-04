"""Bake photo textures for the site model from the registered video frames.

    python pipeline/texture.py plot [ground|facades|fences|forest|all]

Everything is projected in the reconstruction frame, where the camera poses are exact, and
written as images plus a manifest (site/tex/tex.json) that pipeline/model.py turns into the
textured glTF. Surfaces:
  ground   orthophoto of the plot and its surroundings, laid out on the plot's own grid
  facades  each wall of each building, rectified from the frame that sees it best
  fences   a rectified strip of each fence type, tiled along the fence
  forest   the forest edge behind the back fence, rectified onto a vertical plane, sky cut out
Where no frame sees a surface, model.py falls back to materials made from crops of the footage.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

from common import project_dir
from layout import Warp, circle, rect

IMG_W, IMG_H = 854, 480
PHONE = 1.46


# ---------- cameras ----------

def q2m(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


class Cam:
    def __init__(self, c, imgdir: Path):
        self.id = c["id"]
        self.o = np.array(c["pos"], float)
        self.R = q2m(c["quat"])
        self.f = (IMG_H / 2) / math.tan(math.radians(c["fovY"] / 2))
        self.approx = bool(c.get("approx"))
        self.path = imgdir / f"{self.id}.jpg"
        self._img = None

    @property
    def fwd(self):
        return self.R @ np.array([0, 0, -1.0])

    def project(self, P):
        """World points (N,3) -> pixel x, y and depth along the view axis."""
        pc = (P - self.o) @ self.R
        z = -pc[:, 2]
        zs = np.where(z > 1e-3, z, 1e-3)
        return IMG_W / 2 + self.f * pc[:, 0] / zs, IMG_H / 2 - self.f * pc[:, 1] / zs, z

    def image(self):
        if self._img is None:
            self._img = cv2.imread(str(self.path))
        return self._img

    def drop(self):
        self._img = None


def sample(img, x, y):
    """Bilinear sample (N,) pixel coords -> (N,3) uint8."""
    n = len(x)
    cols = 1024
    rows = (n + cols - 1) // cols
    mx = np.zeros(rows * cols, np.float32); my = np.zeros(rows * cols, np.float32)
    mx[:n] = x; my[:n] = y
    out = cv2.remap(img, mx.reshape(rows, cols), my.reshape(rows, cols), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    return out.reshape(-1, 3)[:n]


# ---------- site in the reconstruction frame ----------

class Site:
    def __init__(self, pid: str):
        self.pdir = project_dir(pid)
        self.rec = json.loads((self.pdir / "site_recon.json").read_text())
        self.lay = json.loads((self.pdir / "layout.json").read_text())
        F = self.lay["fences"]
        st = self.lay["stated"]
        self.rec_quad = [F["road"]["a"], F["road"]["b"], F["right"]["b"], F["left"]["a"]]
        self.model_quad = [[0.0, 0.0], [st["road"], 0.0], [st["forest"], st["depth"]], [0.0, st["depth"]]]
        self.W = Warp(self.rec_quad, self.model_quad)
        t = self.rec["terrain"]
        self.t = t
        imgdir = self.pdir / "site" / "undistorted"
        self.cams = [Cam(c, imgdir) for c in self.rec["cameras"] if (imgdir / f"{c['id']}.jpg").exists()]
        # the merged right-front sub-model sits low: ground there follows the camera heights
        cu = np.array([c.o[0] for c in self.cams]); cv_ = np.array([-c.o[2] for c in self.cams])
        ch = np.array([c.o[1] for c in self.cams])
        self._cu, self._cv = cu, cv_
        self._dh = ch - PHONE - self.plane(cu, cv_)
        self.buildings = self._buildings()
        fr = json.loads((self.pdir / "frames.json").read_text())["frames"]
        sh = {f["id"]: f["sharpness"] for f in fr}
        med = float(np.median(list(sh.values())))
        self.sharp = {k: min(1.5, v / med) for k, v in sh.items()}
        tx = self.lay.get("textures", {})
        self.tex_override = tx.get("walls", {})
        self.bad_frames = set(tx.get("avoidFrames", []))
        self.fallback = tx.get("fallback", {})
        self.out = self.pdir / "site" / "tex"
        self.out.mkdir(parents=True, exist_ok=True)

    def plane(self, u, v):
        return self.t["h0"] + self.t["gu"] * u + self.t["gv"] * v

    def ground(self, u, v, sigma=3.5):
        """Ground height under (u, v) in the reconstruction frame."""
        u = np.atleast_1d(u).astype(float); v = np.atleast_1d(v).astype(float)
        out = np.empty_like(u)
        for i in range(0, len(u), 20000):
            du = u[i:i + 20000, None] - self._cu[None]
            dv = v[i:i + 20000, None] - self._cv[None]
            w = np.exp(-(du * du + dv * dv) / (2 * sigma * sigma))
            corr = (w * self._dh).sum(1) / (w.sum(1) + 0.3)
            out[i:i + 20000] = self.plane(u[i:i + 20000], v[i:i + 20000]) + corr
        return out

    def _buildings(self):
        """Occluders: footprints (reconstruction frame) of everything taller than the phone."""
        occ = []
        for e in self.lay["elements"]:
            if e["height"] < 1.5:
                continue
            fp = circle(e["center"], e["size"][0]) if e.get("round") else rect(e["center"], e["size"], math.radians(e.get("rot", 0)))
            occ.append((e["id"], np.array(fp, float), e.get("ridge", e["height"])))
        return occ


def segments_hit_poly(p0, p1, poly):
    """Does each 2D segment p0[i]->p1[i] cross the convex polygon (or end inside it)? Vectorised SAT-lite."""
    n = len(poly)
    hit = np.zeros(len(p0), bool)
    # segment-edge intersections
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]
        d1 = p1 - p0
        e = b - a
        den = d1[:, 0] * e[1] - d1[:, 1] * e[0]
        with np.errstate(divide="ignore", invalid="ignore"):
            t = ((a[0] - p0[:, 0]) * e[1] - (a[1] - p0[:, 1]) * e[0]) / den
            s = ((a[0] - p0[:, 0]) * d1[:, 1] - (a[1] - p0[:, 1]) * d1[:, 0]) / den
        hit |= (den != 0) & (t > 0.02) & (t < 0.98) & (s >= 0) & (s <= 1)
    return hit


def inside_poly(pts, poly):
    n = len(poly)
    sign = None
    ok = np.ones(len(pts), bool)
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]
        c = (b[0] - a[0]) * (pts[:, 1] - a[1]) - (b[1] - a[1]) * (pts[:, 0] - a[0])
        s = c >= 0
        if sign is None:
            sign = s
        else:
            ok &= s == sign
    return ok


# ---------- ground orthophoto ----------

GROUND_EXTENT = (-10.0, -10.0, 58.0, 62.0)  # plot coordinates: u0, v0, u1, v1
GROUND_PX = 0.04  # metres per pixel


def bake_ground(S: Site, K: int = 5):
    u0, v0, u1, v1 = GROUND_EXTENT
    nx, ny = int(round((u1 - u0) / GROUND_PX)), int(round((v1 - v0) / GROUND_PX))
    us = u0 + (np.arange(nx) + 0.5) * GROUND_PX
    vs = v1 - (np.arange(ny) + 0.5) * GROUND_PX  # image row 0 = far (forest) edge
    MU, MV = np.meshgrid(us, vs)
    q = np.c_[MU.ravel(), MV.ravel()]
    # photo texture only inside the fences: beyond them the frames see fence boards, not ground
    inplot = inside_poly(q, shrink(np.array(S.model_quad), -0.15))
    sel = np.nonzero(inplot)[0]
    p = S.W.inv(q[sel])  # reconstruction (u, v) of each plot pixel
    g = S.ground(p[:, 0], p[:, 1])
    P = np.c_[p[:, 0], g, -p[:, 1]]
    N = len(P)
    W_ = np.zeros((N, K), np.float32)  # top-K views per pixel, sorted by weight
    C_ = np.zeros((N, K, 3), np.uint8)
    occluders = [poly for _, poly, _ in S.buildings]
    for k, cam in enumerate(S.cams):
        cu, cv_ = cam.o[0], -cam.o[2]
        near = (np.abs(p[:, 0] - cu) < 8.5) & (np.abs(p[:, 1] - cv_) < 8.5)
        idx = np.nonzero(near)[0]
        if len(idx) == 0:
            continue
        x, y, z = cam.project(P[idx])
        ok = (z > 0.8) & (x > 4) & (x < IMG_W - 4) & (y > IMG_H * 0.35) & (y < IMG_H - 3)
        idx, x, y = idx[ok], x[ok], y[ok]
        if len(idx) == 0:
            continue
        d = np.linalg.norm(P[idx] - cam.o, axis=1)
        dep = np.arcsin(np.clip((cam.o[1] - P[idx, 1]) / d, -1, 1))
        ok = (d < 8.0) & (dep > math.radians(14))
        idx, x, y, d, dep = idx[ok], x[ok], y[ok], d[ok], dep[ok]
        if len(idx) == 0:
            continue
        p0 = np.repeat([[cu, cv_]], len(idx), 0)
        vis = np.ones(len(idx), bool)
        for poly in occluders:
            vis &= ~segments_hit_poly(p0, p[idx], poly) & ~inside_poly(p[idx], poly)
        idx, x, y, d, dep = idx[vis], x[vis], y[vis], d[vis], dep[vis]
        if len(idx) == 0:
            continue
        edge = np.minimum(np.minimum(x, IMG_W - x) / 60, 1) * np.minimum((IMG_H - y) / 30, 1)
        w = (np.sin(dep) ** 1.5) / (0.5 + d) * edge * (0.2 if cam.approx else 1.0)
        col = sample(cam.image(), x, y)
        cam.drop()
        # insert into the sorted top-K lists
        Wi, Ci = W_[idx], C_[idx]
        pos = (Wi > w[:, None]).sum(1)  # insertion slot
        keep = pos < K
        r = np.nonzero(keep)[0]
        for slot in range(K - 1, -1, -1):
            m = keep & (pos <= slot)
            if slot > 0:
                shift = m & (pos < slot)
                Wi[shift, slot] = Wi[shift, slot - 1]
                Ci[shift, slot] = Ci[shift, slot - 1]
            put = keep & (pos == slot)
            Wi[put, slot] = w[put]
            Ci[put, slot] = col[put]
        W_[idx], C_[idx] = Wi, Ci
        if k % 150 == 0:
            print(f"  ground: {k}/{len(S.cams)} frames", flush=True)
    n = (W_ > 0).sum(1)
    out = np.zeros((N, 3), np.float32)
    one = n == 1
    out[one] = C_[one, 0]
    two = n == 2
    out[two] = C_[two, :2].mean(1)
    many = n >= 3
    # median of the best views: anything standing up (cars, people, posts) lands in different
    # places in different views and drops out; flat ground agrees
    for m in range(3, K + 1):
        sel_m = n == m
        out[sel_m] = np.median(C_[sel_m, :m].astype(np.float32), axis=1)
    img = np.zeros((ny * nx, 3), np.uint8)
    img[sel] = out.clip(0, 255).astype(np.uint8)
    mask = np.zeros(ny * nx, np.uint8)
    mask[sel[n > 0]] = 255
    img = img.reshape(ny, nx, 3); mask = mask.reshape(ny, nx)
    cv2.imwrite(str(S.out / "ground_raw.png"), img)
    cv2.imwrite(str(S.out / "ground_mask.png"), mask)
    cv2.imwrite(str(S.out / "ground_count.png"), (np.bincount(sel, weights=n, minlength=ny * nx).reshape(ny, nx) * 40).clip(0, 255).astype(np.uint8))
    print(f"ground: {nx}x{ny} px, covered {mask.mean() / 2.55:.0f}% of the image, {(n > 0).mean() * 100:.0f}% of the plot")
    return img, mask


def shrink(poly, d):
    """Offset a convex polygon inward by d (negative grows it)."""
    c = poly.mean(0)
    out = []
    n = len(poly)
    lines = []
    for k in range(n):
        a, b = poly[k], poly[(k + 1) % n]
        e = (b - a) / np.linalg.norm(b - a)
        nrm = np.array([-e[1], e[0]])
        if np.dot(c - a, nrm) < 0:
            nrm = -nrm
        lines.append((a + nrm * d, e))
    for k in range(n):
        (a1, e1), (a2, e2) = lines[k - 1], lines[k]
        A = np.array([e1, -e2]).T
        t = np.linalg.solve(A, a2 - a1)
        out.append(a1 + e1 * t[0])
    return np.array(out)


# ---------- facades ----------

FACADE_PX = 64  # pixels per metre
WALLED = ("house", "veranda", "sauna", "woodshed", "utility-cabin", "teal-cabin")


def wall_faces(e):
    """Walls of a rectangular element in the reconstruction frame.
    Returns (name, a, b, outward normal (u, v), heights at a and b, top height) per wall."""
    c = np.array(e["center"], float)
    w, d = e["size"][0] / 2, e["size"][1] / 2
    ang = math.radians(e.get("rot", 0))
    co, si = math.cos(ang), math.sin(ang)
    loc = [(-w, -d), (w, -d), (w, d), (-w, d)]
    P = [c + np.array([x * co - y * si, x * si + y * co]) for x, y in loc]
    eave = e["height"]
    ridge = e.get("ridge", eave)
    roof = e.get("roof", "flat")
    names = ["south", "east", "north", "west"]
    out = []
    for k in range(4):
        a, b = P[k], P[(k + 1) % 4]
        t = (b - a) / np.linalg.norm(b - a)
        n = np.array([t[1], -t[0]])  # outward for counter-clockwise corners
        ha = hb = eave
        top = eave
        if roof == "gable":
            along_u = e.get("ridgeAxis", "u") == "u"
            gable_wall = (names[k] in ("east", "west")) if along_u else (names[k] in ("south", "north"))
            if gable_wall:
                top = ridge
        elif roof == "shed":
            # shed roofs fall toward the road (front); the high side stands at the back
            high = {"south": eave, "north": ridge}
            if names[k] in high:
                ha = hb = top = high[names[k]]
            elif names[k] == "east":
                ha, hb, top = eave, ridge, ridge
            else:
                ha, hb, top = ridge, eave, ridge
        out.append((names[k], a, b, n, ha, hb, top))
    return out


def bake_facades(S: Site):
    manifest = {}
    occ_all = S.buildings
    overrides = {}
    for e in S.lay["elements"]:
        if e["id"] not in WALLED:
            continue
        related = {e["id"], e.get("parent")} | {x["id"] for x in S.lay["elements"] if x.get("parent") == e["id"]}
        occ = [poly for oid, poly, _ in occ_all if oid not in related]
        faces = {}
        for name, a, b, n, ha, hb, top in wall_faces(e):
            L = float(np.linalg.norm(b - a))
            Wpx, Hpx = max(8, int(L * FACADE_PX)), max(8, int(top * FACADE_PX))
            gs = np.linspace(0, 1, Wpx)
            hs = np.linspace(top, 0, Hpx)
            GU, GH = np.meshgrid(gs, hs)
            uv = a[None] + (b - a)[None] * GU.ravel()[:, None]
            base = S.ground(uv[:, 0], uv[:, 1])
            P = np.c_[uv[:, 0], base + GH.ravel(), -uv[:, 1]]
            mid2 = (a + b) / 2
            midP = np.array([mid2[0], float(S.ground([mid2[0]], [mid2[1]])[0]) + top / 2, -mid2[1]])
            n3 = np.array([n[0], 0.0, -n[1]])
            scored = []
            for cam in S.cams:
                vv = midP - cam.o
                dist = float(np.linalg.norm(vv))
                cosang = float(-(vv / dist) @ n3)
                if cosang < 0.45 or dist < 1.2 or dist > 20:
                    continue
                if cam.id in S.bad_frames:
                    continue
                sub = P[:: max(1, len(P) // 400)]
                x, y, z = cam.project(sub)
                inside = (z > 0.3) & (x > 2) & (x < IMG_W - 2) & (y > 2) & (y < IMG_H - 2)
                frac = inside.mean()
                if frac < 0.15:
                    continue
                p0 = np.repeat([[cam.o[0], -cam.o[2]]], len(sub), 0)
                vis = np.ones(len(sub), bool)
                for poly in occ:
                    vis &= ~segments_hit_poly(p0, np.c_[sub[:, 0], -sub[:, 2]], poly)
                # the camera must stand on the outside of this wall
                side = (np.array([cam.o[0], -cam.o[2]]) - a) @ n
                if side <= 0.2:
                    continue
                score = frac * (vis & inside).mean() * cosang ** 1.5 / (1 + dist / 6) * (0.3 if cam.approx else 1.0) * S.sharp.get(cam.id, 0.5)
                scored.append((score, cam))
            scored.sort(key=lambda t: -t[0])
            want = S.tex_override.get(f"{e['id']}.{name}")
            if want:
                byid = {c.id: c for c in S.cams}
                scored = [(9.0, byid[f]) for f in want if f in byid] + scored
            img = np.zeros((len(P), 3), np.float32)
            have = np.zeros(len(P), bool)
            used = []
            for score, cam in scored[:6]:
                if have.all():
                    break
                x, y, z = cam.project(P)
                ok = ~have & (z > 0.3) & (x > 1) & (x < IMG_W - 1) & (y > 1) & (y < IMG_H - 1)
                p0 = np.repeat([[cam.o[0], -cam.o[2]]], len(P), 0)
                for poly in occ:
                    ok &= ~segments_hit_poly(p0, np.c_[P[:, 0], -P[:, 2]], poly)
                if ok.sum() < 0.03 * len(P):
                    continue
                img[ok] = sample(cam.image(), x[ok], y[ok])
                cam.drop()
                have |= ok
                used.append(cam.id)
            im = img.reshape(Hpx, Wpx, 3).astype(np.uint8)
            hv = have.reshape(Hpx, Wpx)
            if hv.any() and not hv.all():
                im = cv2.inpaint(im, (~hv).astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
            fn = f"wall_{e['id']}_{name}.jpg"
            if hv.any():
                cv2.imwrite(str(S.out / fn), im, [cv2.IMWRITE_JPEG_QUALITY, 85])
            faces[name] = {"file": fn if hv.any() else None, "frames": used, "coverage": round(float(hv.mean()), 2),
                           "length": round(L, 3), "top": top, "ha": ha, "hb": hb}
            print(f"  {e['id']:14s} {name:5s} {Wpx}x{Hpx} coverage {hv.mean():.2f} from {used[:3]}")
        manifest[e["id"]] = faces
    return manifest


# ---------- seamless tiles, fences, materials ----------

def seamless(img, axis="both"):
    """Make an image tile without visible seams by blending it with a half-shifted copy."""
    img = img.astype(np.float32)
    H, W = img.shape[:2]
    wx = np.sin(np.pi * (np.arange(W) + 0.5) / W) ** 2
    wy = np.sin(np.pi * (np.arange(H) + 0.5) / H) ** 2
    if axis == "x":
        r = np.roll(img, W // 2, axis=1)
        w = wx[None, :, None]
    else:
        r = np.roll(np.roll(img, W // 2, axis=1), H // 2, axis=0)
        w = (np.minimum(wx[None, :], wy[:, None]))[..., None]
    return (img * w + r * (1 - w)).clip(0, 255).astype(np.uint8)


def rectify_plane(S: Site, cam: Cam, a, b, height, px=FACADE_PX):
    """Vertical rectangle from a to b (reconstruction u, v), ground to `height`, seen by cam."""
    a = np.array(a, float); b = np.array(b, float)
    L = float(np.linalg.norm(b - a))
    Wpx, Hpx = int(L * px), int(height * px)
    GU, GH = np.meshgrid(np.linspace(0, 1, Wpx), np.linspace(height, 0, Hpx))
    uv = a[None] + (b - a)[None] * GU.ravel()[:, None]
    base = S.ground(uv[:, 0], uv[:, 1])
    P = np.c_[uv[:, 0], base + GH.ravel(), -uv[:, 1]]
    x, y, z = cam.project(P)
    col = sample(cam.image(), x, y)
    cam.drop()
    ok = ((z > 0.3) & (x > 0) & (x < IMG_W) & (y > 0) & (y < IMG_H)).reshape(Hpx, Wpx)
    return col.reshape(Hpx, Wpx, 3), ok, L


def bake_fences(S: Site):
    byid = {c.id: c for c in S.cams}
    out = {}
    for name, f in S.lay["textures"]["fences"].items():
        if "same" in f or "from" in f:
            continue
        cam = byid[f["frame"]]
        im, ok, L = rectify_plane(S, cam, f["a"], f["b"], f["height"])
        if not ok.all():
            im = cv2.inpaint(im, (~ok).astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
        if name != "gate":
            im = seamless(im, "x")
        fn = f"fence_{name}.jpg"
        cv2.imwrite(str(S.out / fn), im, [cv2.IMWRITE_JPEG_QUALITY, 85])
        out[name] = {"file": fn, "length": round(L, 3), "height": f["height"], "frame": f["frame"]}
        print(f"  fence {name}: {im.shape[1]}x{im.shape[0]} from {f['frame']}")
    for name, f in S.lay["textures"]["fences"].items():
        if "same" in f:
            out[name] = dict(out[f["same"]])
        if "from" in f:  # a clean stretch of another fence image
            src = out[f["from"]]
            im = cv2.imread(str(S.out / src["file"]))
            x0, x1 = (int(im.shape[1] * c) for c in f["crop"])
            fn = f"fence_{name}.jpg"
            cv2.imwrite(str(S.out / fn), seamless(im[:, x0:x1], "x"), [cv2.IMWRITE_JPEG_QUALITY, 85])
            out[name] = {"file": fn, "length": round(src["length"] * (f["crop"][1] - f["crop"][0]), 3), "height": src["height"], "frame": src["frame"]}
    return out


def bake_materials(S: Site):
    """Seamless wall materials cut from clean, near-frontal parts of frames."""
    out = {}
    for name, m in S.lay["textures"]["materials"].items():
        src = cv2.imread(str(S.pdir / "frames" / f"{m['frame']}.jpg"))
        x0, y0, x1, y1 = m["box"]
        tile = seamless(src[y0:y1, x0:x1], "x")
        fn = f"mat_{name}.jpg"
        cv2.imwrite(str(S.out / fn), tile, [cv2.IMWRITE_JPEG_QUALITY, 88])
        out[name] = {"file": fn, "width": m["width"], "height": round(m["width"] * tile.shape[0] / tile.shape[1], 3)}
    fb = cv2.imread(str(S.out / "fence_boards.jpg"))
    if fb is not None:
        cv2.imwrite(str(S.out / "mat_boards.jpg"), fb, [cv2.IMWRITE_JPEG_QUALITY, 88])
        out["boards"] = {"file": "mat_boards.jpg", "width": round(fb.shape[1] / FACADE_PX, 3), "height": round(fb.shape[0] / FACADE_PX, 3)}
    return out


# ---------- forest edge ----------

FOREST_PX = 0.05


def building_mask(S: Site, cam: Cam):
    """Pixels of this frame covered by a modelled structure (so they never land on the backdrop)."""
    m = np.zeros((IMG_H, IMG_W), np.uint8)
    for e in S.lay["elements"]:
        top = 2.8 if e["kind"] == "trampoline" else e.get("ridge", e["height"])
        if top < 1.0:
            continue
        fp = circle(e["center"], e["size"][0]) if e.get("round") else rect(e["center"], e["size"], math.radians(e.get("rot", 0)))
        fp = np.array(fp, float)
        c = fp.mean(0)
        fp = c + (fp - c) * (1.5 if e["kind"] == "trampoline" else 1.15)  # a little margin
        g = S.ground(fp[:, 0], fp[:, 1])
        P = np.vstack([np.c_[fp[:, 0], g - 0.2, -fp[:, 1]], np.c_[fp[:, 0], g + top + 0.4, -fp[:, 1]]])
        x, y, z = cam.project(P)
        front = z > 0.5
        if front.sum() < 3:
            continue
        if not front.all():
            # part of it is behind the camera: it fills the near side of the view
            xs = np.r_[x[front], np.where(x[front] < IMG_W / 2, -IMG_W, 2 * IMG_W)]
            ys = np.r_[y[front], y[front]]
            x, y = xs, ys
        else:
            x, y = x, y
        hull = cv2.convexHull(np.c_[x, y].clip(-4 * IMG_W, 4 * IMG_W).astype(np.int32))
        cv2.fillConvexPoly(m, hull, 255)
    return m


def offset_fill(img, have, holes):
    """Fill holes with forest copied from the same rows a little to the side (real texture, no smear)."""
    out = img.copy()
    todo = holes.copy()
    src = have.copy()
    for dx in (24, -24, 48, -48, 96, -96, 192, -192, 384, -384):
        sh_img = np.roll(img, dx, axis=1)
        sh_ok = np.roll(src, dx, axis=1)
        take = todo & sh_ok
        out[take] = sh_img[take]
        todo &= ~take
        if not todo.any():
            break
    if todo.any():
        out = cv2.inpaint(out, todo.astype(np.uint8) * 255, 5, cv2.INPAINT_TELEA)
    # soften the seams of the copied blocks a little
    soft = cv2.GaussianBlur(out, (0, 0), 1.2)
    seam = cv2.dilate(holes.astype(np.uint8), np.ones((3, 3), np.uint8)) - cv2.erode(holes.astype(np.uint8), np.ones((3, 3), np.uint8))
    out[seam > 0] = soft[seam > 0]
    return out


def bake_forest(S: Site):
    """The forest edge on two vertical planes (behind the back fence, and behind the back part of
    the left fence), projected from frames that look across the plot toward it. Pixels where a
    modelled building stands in front are skipped, the sky is cut out."""
    cfg = S.lay["textures"]["forest"]
    F = S.lay["fences"]
    vb = F["forest"]["a"][1] + cfg["behind"]
    ul = F["left"]["a"][0] - cfg["behind"]
    H = cfg["height"]
    planes = {"back": (np.array([-30.0, vb]), np.array([62.0, vb]), np.array([0.0, 1.0]))}
    px = 0.1
    out = {}
    for name, (a, b, look) in planes.items():
        L = float(np.linalg.norm(b - a))
        Wpx, Hpx = int(L / px), int(H / px)
        GU, GH = np.meshgrid(np.linspace(0, 1, Wpx), np.linspace(H, 0, Hpx))
        uv = a[None] + (b - a)[None] * GU.ravel()[:, None]
        hgt = GH.ravel()
        P = np.c_[uv[:, 0], S.plane(uv[:, 0], uv[:, 1]) + hgt, -uv[:, 1]]
        best = np.zeros(len(P), np.float32)
        col = np.zeros((len(P), 3), np.uint8)
        lk = np.array([look[0], 0.0, -look[1]])
        for cam in S.cams:
            if cam.approx:
                continue
            facing = float(cam.fwd @ lk)
            if facing < 0.45:
                continue
            cu, cv_ = cam.o[0], -cam.o[2]
            dist = (vb - cv_) if name == "back" else (cu - ul)
            if dist < cfg["minDist"] or dist > cfg["maxDist"]:
                continue
            x, y, z = cam.project(P)
            ok = (z > 1) & (x > 3) & (x < IMG_W - 3) & (y > 3) & (y < IMG_H - 3) & (hgt > 1.6)
            if not ok.any():
                continue
            bm = building_mask(S, cam)
            xi, yi = x.clip(0, IMG_W - 1).astype(int), y.clip(0, IMG_H - 1).astype(int)
            ok &= bm[yi, xi] == 0
            w = facing ** 2 / (1 + dist / 25) * np.minimum(np.minimum(x, IMG_W - x) / 100, 1) * S.sharp.get(cam.id, 0.5)
            better = ok & (w > best)
            if better.any():
                col[better] = sample(cam.image(), x[better], y[better])
                cam.drop()
                best[better] = w[better]
        img = col.reshape(Hpx, Wpx, 3)
        have = (best > 0).reshape(Hpx, Wpx)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        sky = (hsv[..., 2] > 160) & (hsv[..., 1] < 50)
        solid = have & ~sky
        # fill small gaps (behind removed buildings) from the surrounding forest
        holes = (~have) & ((cv2.dilate(have.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0) | (GH.reshape(Hpx, Wpx) < 10))
        img = offset_fill(img, have, holes)
        alpha = (solid | holes).astype(np.float32)
        alpha[GH.reshape(Hpx, Wpx) < 1.6] = 1.0  # bottom band hides behind the fence anyway
        alpha = cv2.morphologyEx(alpha, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        alpha = cv2.morphologyEx(alpha, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        alpha = cv2.erode(alpha, np.ones((2, 2), np.uint8))
        # pull edge colours toward the forest's own dark tone so no sky halo shows
        dark = cv2.GaussianBlur(img * alpha[..., None], (0, 0), 3) / np.maximum(cv2.GaussianBlur(alpha, (0, 0), 3)[..., None], 1e-3)
        edge = (cv2.dilate(alpha, np.ones((3, 3), np.uint8)) - cv2.erode(alpha, np.ones((3, 3), np.uint8)))[..., None]
        img = (img * (1 - edge) + dark * edge).clip(0, 255).astype(np.uint8)
        rgba = np.dstack([img, (alpha * 255).astype(np.uint8)])
        fn = f"forest_{name}.png"
        cv2.imwrite(str(S.out / fn), rgba)
        am, bm_ = S.W.fwd([a, b])
        out[name] = {"file": fn, "a": am.round(3).tolist(), "b": bm_.round(3).tolist(), "height": H,
                     "coverage": round(float(have.mean()), 2)}
        print(f"  forest {name}: {Wpx}x{Hpx}, seen {have.mean():.0%}")
    return out


# ---------- ground composite ----------

def poly_mask(S: Site, poly_model, nx, ny, feather_m=0.25):
    u0, v0, u1, v1 = GROUND_EXTENT
    pts = np.array([[(p[0] - u0) / GROUND_PX, (v1 - p[1]) / GROUND_PX] for p in poly_model], np.int32)
    m = np.zeros((ny, nx), np.uint8)
    cv2.fillPoly(m, [pts], 255)
    k = max(1, int(feather_m / GROUND_PX)) * 2 + 1
    return cv2.GaussianBlur(m.astype(np.float32) / 255, (k, k), 0)


def tile_to(tile, ny, nx):
    reps = (ny // tile.shape[0] + 1, nx // tile.shape[1] + 1, 1)
    return np.tile(tile, reps)[:ny, :nx]


def bomb(tile, ny, nx, cell, seed=0):
    """Cover ny x nx with randomly shifted, rotated and flipped copies of tile, feathered together,
    so the surface has the tile's grain without a visible repeat grid."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((ny, nx, tile.shape[2]), np.float32)
    wsum = np.zeros((ny, nx), np.float32)
    big = np.tile(tile, (3, 3, 1)).astype(np.float32)
    th, tw = tile.shape[:2]
    win = cell * 2
    wy = np.sin(np.pi * (np.arange(win) + 0.5) / win) ** 2
    wk = wy[:, None] * wy[None, :]
    for y in range(-cell, ny, cell):
        for x in range(-cell, nx, cell):
            oy, ox = rng.integers(0, th), rng.integers(0, tw)
            p = big[oy:oy + win, ox:ox + win]
            if p.shape[0] < win or p.shape[1] < win:
                p = np.tile(tile, (win // th + 2, win // tw + 2, 1))[:win, :win].astype(np.float32)
            p = np.rot90(p, rng.integers(0, 4))
            if rng.random() < 0.5:
                p = p[:, ::-1]
            y0, x0 = max(0, y), max(0, x)
            y1, x1 = min(ny, y + win), min(nx, x + win)
            acc[y0:y1, x0:x1] += p[y0 - y:y1 - y, x0 - x:x1 - x] * wk[y0 - y:y1 - y, x0 - x:x1 - x, None]
            wsum[y0:y1, x0:x1] += wk[y0 - y:y1 - y, x0 - x:x1 - x]
    return acc / np.maximum(wsum[..., None], 1e-6)


def grain(img, sigma=6):
    """Zero-mean detail (luminance) of a texture crop."""
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    return (g - cv2.GaussianBlur(g, (0, 0), sigma))[..., None]


def compose_ground(S: Site, site_model: dict):
    raw = cv2.imread(str(S.out / "ground_raw.png")).astype(np.float32)
    mask = cv2.imread(str(S.out / "ground_mask.png"), 0)
    cnt = cv2.imread(str(S.out / "ground_count.png"), 0)
    ny, nx = mask.shape
    n = cnt.astype(np.float32) / 40
    fr = S.pdir / "frames"
    def crop(fid, x, y, w, h, scale):
        im = cv2.imread(str(fr / f"{fid}.jpg"))[y:y + h, x:x + w]
        return cv2.resize(im, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    els = {e["id"]: e for e in site_model["elements"]}
    plotpoly = site_model["plot"]["polygon"]
    u0, v0, u1, v1 = GROUND_EXTENT
    pq = np.array(plotpoly)
    # region masks
    m_plot = poly_mask(S, plotpoly, nx, ny, 0.1)
    m_back = poly_mask(S, [[u0, pq[2][1] + 0.1], [u1, pq[2][1] + 0.1], [u1, v1], [u0, v1]], nx, ny, 0.5)
    m_left = poly_mask(S, [[u0, 28.0], [-0.1, 28.0], [-0.1, v1], [u0, v1]], nx, ny, 0.8)
    m_road = poly_mask(S, [[u0, v0], [u1, v0], [u1, -0.6], [u0, -0.6]], nx, ny, 0.4)
    m_soil = np.zeros((ny, nx), np.float32)
    for eid in ("tilled", "beds", "flowerbeds"):
        if eid in els:
            m_soil = np.maximum(m_soil, poly_mask(S, els[eid]["footprint"], nx, ny, 0.6) * (0.8 if eid != "tilled" else 0.95))
    m_gravel = poly_mask(S, els["parking"]["footprint"], nx, ny, 0.8) * 0.7 if "parking" in els else np.zeros((ny, nx), np.float32)
    # colours: the photo's own colour, spread smoothly into unseen parts
    have = ((mask > 0) & (n >= 2)).astype(np.float32)
    m_park = np.zeros((ny, nx), np.float32)
    if "parking" in els:  # parked cars never agree between frames: neither their photo nor their colour is used
        fp = np.array(els["parking"]["footprint"]); c0 = fp.mean(0)
        m_park = poly_mask(S, (c0 + (fp - c0) * 1.35).tolist(), nx, ny, 1.0)
        have *= (m_park < 0.05)
    def spread(sig_m):
        k = sig_m / GROUND_PX
        w = cv2.GaussianBlur(have, (0, 0), k)
        c = cv2.GaussianBlur(raw * have[..., None], (0, 0), k) / np.maximum(w[..., None], 1e-4)
        return c, w
    c1, w1 = spread(1.5)
    c2, w2 = spread(5.0)
    # the lawn colour is the grass as filmed (green pixels only, not soil or shadow)
    b_, g_, r_ = raw[..., 0], raw[..., 1], raw[..., 2]
    grass = (have > 0) & (m_plot > 0.99) & (m_soil < 0.1) & (g_ > r_ + 4) & (g_ > b_ + 12) & (g_ > 70)
    lawn = np.median(raw[grass], axis=0)
    a1 = np.clip(w1 * 2, 0, 1)[..., None]
    a2 = np.clip(w2 * 3, 0, 1)[..., None]
    colour = lawn[None, None] * (1 - a2) + c2 * a2
    colour = colour * (1 - a1) + c1 * a1
    def mix(col, m, target):
        return col * (1 - m[..., None]) + np.array(target, np.float32)[None, None] * m[..., None]
    soil_col = np.median(raw[(have > 0) & (m_soil > 0.9)], axis=0) if (m_soil > 0.9).any() else np.array([70, 75, 80])
    colour = mix(colour, m_soil * (1 - a1[..., 0] * 0.7), soil_col)
    colour = mix(colour, m_gravel / 0.7 * 0.9, [112, 122, 126])
    floor_col = cv2.imread(str(fr / "c2_000000.jpg"))[330:470, 40:420].reshape(-1, 3).mean(0)
    colour = mix(colour, np.maximum(m_back, m_left), floor_col)
    colour = mix(colour, m_road, [118, 124, 128])
    # grain from crops of the footage, scattered without a repeat grid
    g_lawn = bomb(grain(crop("c1_082000", 0, 380, 850, 100, 0.35)), ny, nx, 48, 1) * 0.75
    g_soil = bomb(grain(crop("c1_042000", 250, 330, 360, 140, 0.45)), ny, nx, 40, 2)
    g_floor = bomb(grain(crop("c2_000000", 120, 330, 300, 140, 0.5)), ny, nx, 40, 3)
    g_gravel = bomb(grain(crop("c1_052625", 360, 380, 300, 90, 0.4)), ny, nx, 40, 4)
    g = g_lawn * 0.9
    for gm, m in ((g_soil, m_soil), (g_gravel, m_gravel), (g_floor * 0.55, np.maximum(m_back, m_left)), (g_gravel * 0.7, m_road)):
        g = g * (1 - m[..., None]) + gm * m[..., None]
    base = colour + g * 1.1
    # the photo where frames agree, softly
    alpha = np.where(n >= 3, 0.85, np.where(n >= 2, 0.25, 0.0)).astype(np.float32) * (mask > 0)
    alpha *= 1 - m_park
    alpha = cv2.erode(alpha, np.ones((5, 5), np.uint8))
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.8 / GROUND_PX)[..., None]
    out = base * (1 - alpha) + raw * alpha
    img = out.clip(0, 255).astype(np.uint8)
    cv2.imwrite(str(S.out / "ground.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 86])
    # tiles for the ground beyond the texture, cut from the composite itself so they match its edges
    def tile(name, uu, vv, axis="both"):
        x0, x1 = int((uu[0] - u0) / GROUND_PX), int((uu[1] - u0) / GROUND_PX)
        y0, y1 = int((v1 - vv[1]) / GROUND_PX), int((v1 - vv[0]) / GROUND_PX)
        t = seamless(img[y0:y1, x0:x1], axis)
        cv2.imwrite(str(S.out / f"tile_{name}.jpg"), t, [cv2.IMWRITE_JPEG_QUALITY, 88])
        return {"file": f"tile_{name}.jpg", "size": round((uu[1] - uu[0]), 2)}
    tiles = {"lawn": tile("lawn", (50.0, 57.5), (8.0, 15.5)),
             "floor": tile("floor", (8.0, 15.5), (54.0, 61.5)),
             "road": tile("road", (22.0, 31.0), (-9.4, -1.2), "x")}
    print(f"ground composite {nx}x{ny}, lawn colour {lawn[::-1].round()}")
    return {"file": "ground.jpg", "extent": list(GROUND_EXTENT), "px": GROUND_PX, "tiles": tiles,
            "road": [-10.0, -0.6], "forestFrom": {"back": float(pq[2][1]), "left": 28.0}}


def main(pid: str, what: str = "all"):
    S = Site(pid)
    print(f"{len(S.cams)} frames with poses")
    man_path = S.out / "tex.json"
    man = json.loads(man_path.read_text()) if man_path.exists() else {}
    if what in ("ground", "all"):
        bake_ground(S)
    if what in ("facades", "all"):
        man["facades"] = bake_facades(S)
        for key, mat in S.fallback.items():
            eid, wall = key.split(".")
            if eid in man["facades"] and wall in man["facades"][eid]:
                man["facades"][eid][wall]["material"] = mat
    if what in ("fences", "all"):
        man["fences"] = bake_fences(S)
        man["materials"] = bake_materials(S)
    if what in ("forest", "all"):
        man["forest"] = bake_forest(S)
    if what in ("compose", "ground", "all"):
        man["ground"] = compose_ground(S, json.loads((S.pdir / "site.json").read_text()))
    man_path.write_text(json.dumps(man, indent=1))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "plot", sys.argv[2] if len(sys.argv) > 2 else "all")
