"""Triangulate a feature seen in two or more registered frames.

  python pipeline/triangulate.py plot c4_089375:115,200 c4_092625:60,300 [...]
Each argument is frame:x,y in the undistorted frame. Prints the least-squares point closest to
all rays in site coordinates (u, v, height above the fitted terrain) and each ray's miss distance.
Used with locate.py when auditing where structures stand.
"""
from __future__ import annotations

import sys

import numpy as np

from locate import load, ray


def triangulate(site, picks):
    cams = {c["id"]: c for c in site["cameras"]}
    A = np.zeros((3, 3)); b = np.zeros(3); rays = []
    for fid, (x, y) in picks:
        o, d = ray(site, cams[fid], x, y)
        M = np.eye(3) - np.outer(d, d)
        A += M; b += M @ o; rays.append((o, d))
    p = np.linalg.solve(A, b)
    miss = [float(np.linalg.norm((np.eye(3) - np.outer(d, d)) @ (p - o))) for o, d in rays]
    t = site["terrain"]
    u, v = p[0], -p[2]
    return u, v, p[1] - (t["h0"] + t["gu"] * u + t["gv"] * v), miss


if __name__ == "__main__":
    site, _ = load(sys.argv[1])
    picks = []
    for a in sys.argv[2:]:
        fid, xy = a.split(":")
        x, y = map(float, xy.split(","))
        picks.append((fid, (x, y)))
    u, v, h, miss = triangulate(site, picks)
    print(f"u={u:.2f} v={v:.2f} h={h:.2f}  ray misses (m): {', '.join(f'{m:.2f}' for m in miss)}")
