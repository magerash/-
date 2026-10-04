"""Locate image pixels on the site: ray from a registered frame -> point cloud / ground plane.

  python pipeline/locate.py plot c4_024125 420,260 600,250 ...
Prints, for each pixel, the ground-plane hit (u, v) and the first reconstructed point along the
ray (u, v, height above ground, distance). Used to place annotated features; the same maths
backs the viewer's "locate in photo" tool.
"""
from __future__ import annotations

import json
import math
import sys

import numpy as np

from common import project_dir


def q2m(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def load(pid):
    pdir = project_dir(pid)
    site = json.loads((pdir / "site.json").read_text())
    buf = np.frombuffer((pdir / "site" / "points.bin").read_bytes(),
                        dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    P = np.c_[buf["x"], buf["y"], buf["z"]].astype(float)
    return site, P


def ray(site, cam, px, py, w=854, h=480):
    """World ray for a pixel of the undistorted frame (three.js camera convention)."""
    f = (h / 2) / math.tan(math.radians(cam["fovY"] / 2))
    d_cam = np.array([(px - w / 2) / f, -(py - h / 2) / f, -1.0])
    R = q2m(cam["quat"])
    d = R @ d_cam
    return np.array(cam["pos"]), d / np.linalg.norm(d)


def locate(site, P, cam, px, py, radius=0.12):
    o, d = ray(site, cam, px, py)
    t = site["terrain"]
    # ground plane y = h0 + gu*x + gv*(-z): solve o + s d on it
    n = np.array([-t["gu"], 1.0, t["gv"]])
    c0 = np.array([0.0, t["h0"], 0.0])
    denom = d @ n
    ground = None
    if abs(denom) > 1e-6:
        s = ((c0 - o) @ n) / denom
        if s > 0:
            g = o + s * d
            ground = (round(g[0], 2), round(-g[2], 2), round(s, 1))
    rel = P - o
    along = rel @ d
    perp = np.linalg.norm(rel - np.outer(along, d), axis=1)
    m = (along > 0.4) & (perp < radius * np.maximum(1, along / 4))
    hit = None
    if m.any():
        idx = np.nonzero(m)[0]
        first = idx[np.argsort(along[idx])[: max(3, len(idx) // 10)]]
        p = np.median(P[first], axis=0)
        hg = p[1] - (t["h0"] + t["gu"] * p[0] + t["gv"] * (-p[2]))
        hit = (round(p[0], 2), round(-p[2], 2), round(hg, 2), round(float(np.median(along[first])), 1), int(m.sum()))
    return ground, hit


if __name__ == "__main__":
    pid, fid = sys.argv[1], sys.argv[2]
    site, P = load(pid)
    cam = next(c for c in site["cameras"] if c["id"] == fid)
    print(f"{fid} at u={cam['pos'][0]:.1f} v={-cam['pos'][2]:.1f}")
    for arg in sys.argv[3:]:
        x, y = map(float, arg.split(","))
        g, hit = locate(site, P, cam, x, y)
        print(f"  px({x:.0f},{y:.0f}) ground(u,v,dist)={g}  first-point(u,v,h,dist,n)={hit}")
