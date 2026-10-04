"""Top-down renders of the reconstruction in site coordinates (for checking and annotating).

  python pipeline/render_debug.py plot [--hmin 0.3] [--hmax 9] [--px 0.05]
Writes work/debug_rgb.png (true colours) and work/debug_height.png (height above terrain),
both with a 5 m grid labelled in site meters (u across, v road->forest), the plot boundary,
the camera path and the existing elements from site.json.
"""
from __future__ import annotations

import json
import sys

import cv2
import numpy as np

from common import project_dir


def main(pid: str, hmin=0.3, hmax=9.0, px=0.05):
    pdir = project_dir(pid)
    site = json.loads((pdir / "site.json").read_text())
    buf = np.frombuffer((pdir / "site" / "points.bin").read_bytes(), dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    u, v, h = buf["x"].astype(float), -buf["z"].astype(float), buf["y"].astype(float)
    t = site["terrain"]
    hag = h - (t["h0"] + t["gu"] * u + t["gv"] * v)
    W, D = site["plot"]["width"], site["plot"]["depth"]
    u0, u1, v0, v1 = -12, W + 12, -10, D + 14
    nx, ny = int((u1 - u0) / px), int((v1 - v0) / px)
    X = ((u - u0) / px).astype(int)
    Y = ((v1 - v) / px).astype(int)
    ok = (X >= 0) & (X < nx) & (Y >= 0) & (Y < ny)
    for mode in ("rgb", "height"):
        img = np.full((ny, nx, 3), 245, np.uint8)
        acc = np.zeros((ny, nx, 3), float)
        cnt = np.zeros((ny, nx), float)
        if mode == "rgb":
            sel = ok & (hag > -0.6) & (hag < 12)
            col = np.c_[buf["b"], buf["g"], buf["r"]][sel].astype(float)
        else:
            sel = ok & (hag > hmin) & (hag < hmax)
            z = np.clip((hag[sel] - hmin) / (hmax - hmin), 0, 1)
            cm = cv2.applyColorMap((z * 255).astype(np.uint8)[:, None], cv2.COLORMAP_TURBO)[:, 0, :]
            col = cm.astype(float)
        np.add.at(acc, (Y[sel], X[sel]), col)
        np.add.at(cnt, (Y[sel], X[sel]), 1)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        m = cnt > 0
        img[m] = (acc[m] / cnt[m][:, None]).astype(np.uint8)
        dil = cv2.dilate(img, k) if mode == "height" else img
        img = np.where(m[:, :, None], img, np.where(cv2.dilate(m.astype(np.uint8), k)[:, :, None] > 0, dil, img))
        # grid
        for gu in range(int(np.ceil(u0 / 5) * 5), int(u1) + 1, 5):
            x = int((gu - u0) / px)
            cv2.line(img, (x, 0), (x, ny - 1), (120, 120, 120) if gu % 10 else (60, 60, 60), 1)
            cv2.putText(img, f"u{gu}", (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
        for gv in range(int(np.ceil(v0 / 5) * 5), int(v1) + 1, 5):
            y = int((v1 - gv) / px)
            cv2.line(img, (0, y), (nx - 1, y), (120, 120, 120) if gv % 10 else (60, 60, 60), 1)
            cv2.putText(img, f"v{gv}", (2, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
        P = lambda uu, vv: (int((uu - u0) / px), int((v1 - vv) / px))  # noqa: E731
        for e in site["plot"]["edges"]:
            cv2.line(img, P(*e["a"]), P(*e["b"]), (30, 30, 200), 2)
        ent = site["plot"]["entrance"]
        cv2.line(img, P(ent["u"] - 2, 0), P(ent["u"] + 2, 0), (0, 200, 255), 4)
        cams = site["cameras"]
        for a, b in zip(cams, cams[1:]):
            if a["clip"] == b["clip"]:
                cv2.line(img, P(a["pos"][0], -a["pos"][2]), P(b["pos"][0], -b["pos"][2]), (200, 80, 200), 1)
        for c in cams[::25]:
            cv2.putText(img, f"{c['clip']}:{c['t']:.0f}", P(c["pos"][0], -c["pos"][2]), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (150, 0, 150), 1)
        for el in site.get("elements", []):
            pts = np.array([P(*q) for q in el["footprint"]], np.int32)
            cv2.polylines(img, [pts], True, (0, 140, 0) if el["provenance"] == "reconstructed" else (0, 140, 220), 1)
            c = pts.mean(0).astype(int)
            cv2.putText(img, el["id"], (int(c[0]), int(c[1])), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 1)
        out = pdir / "work" / f"debug_{mode}.png"
        cv2.imwrite(str(out), img)
        print(out, img.shape)


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0] if a else "plot",
         float(a[a.index("--hmin") + 1]) if "--hmin" in a else 0.3,
         float(a[a.index("--hmax") + 1]) if "--hmax" in a else 9.0,
         float(a[a.index("--px") + 1]) if "--px" in a else 0.05)
