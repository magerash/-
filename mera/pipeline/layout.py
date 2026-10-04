"""Map the verified layout onto the stated plot and write the site model the app reads.

    python pipeline/layout.py plot

Inputs: site_recon.json (reconstruction frame, from build_site.py) and layout.json (every
structure, tree and fence line in that frame, each with how it was checked against the frames).

The reconstruction is not uniformly scaled: fence to fence it is wider and shallower than the
plot dimensions that were supplied. The fences are what the structures stand against, so the
real fence outline (measured in the reconstruction) is mapped onto the stated outline with a
bilinear warp. Positions follow the warp, so everything keeps its place relative to the fences;
sizes keep the reconstruction's own metric scale, which the phone-height and ridge checks
confirm. Cameras, narration pins and the point cloud are carried across with the same warp so
the detail layers stay in register.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np

from common import project_dir, write_json

ROUND_SIDES = 16


# ---------- warp ----------

def bilinear(Q, s, t):
    """Q: corners (FL, FR, BR, BL) as 4x2; s along the road (0 left..1 right), t toward the forest."""
    s = np.asarray(s, float)[..., None]
    t = np.asarray(t, float)[..., None]
    return (1 - s) * (1 - t) * Q[0] + s * (1 - t) * Q[1] + s * t * Q[2] + (1 - s) * t * Q[3]


def inv_bilinear(Q, p, iters=12):
    p = np.atleast_2d(np.asarray(p, float))
    lo, hi = Q.min(0), Q.max(0)
    s = (p[:, 0] - lo[0]) / (hi[0] - lo[0])
    t = (p[:, 1] - lo[1]) / (hi[1] - lo[1])
    for _ in range(iters):
        r = bilinear(Q, s, t) - p
        ds = (1 - t)[:, None] * (Q[1] - Q[0]) + t[:, None] * (Q[2] - Q[3])
        dt = (1 - s)[:, None] * (Q[3] - Q[0]) + s[:, None] * (Q[2] - Q[1])
        det = ds[:, 0] * dt[:, 1] - ds[:, 1] * dt[:, 0]
        s = s - (r[:, 0] * dt[:, 1] - r[:, 1] * dt[:, 0]) / det
        t = t - (ds[:, 0] * r[:, 1] - ds[:, 1] * r[:, 0]) / det
    return s, t


class Warp:
    def __init__(self, rec_quad, model_quad):
        self.R = np.asarray(rec_quad, float)
        self.M = np.asarray(model_quad, float)

    def fwd(self, p):
        s, t = inv_bilinear(self.R, p)
        return bilinear(self.M, s, t)

    def inv(self, q):
        s, t = inv_bilinear(self.M, q)
        return bilinear(self.R, s, t)

    def yaw(self, p, h=0.5):
        """Rotation (radians, counter-clockwise in u-v) the warp applies around point p."""
        p = np.asarray(p, float)
        du = self.fwd([p + [h, 0]])[0] - self.fwd([p - [h, 0]])[0]
        dv = self.fwd([p + [0, h]])[0] - self.fwd([p - [0, h]])[0]
        a1 = math.atan2(du[1], du[0])
        a2 = math.atan2(dv[1], dv[0]) - math.pi / 2
        return (a1 + a2) / 2


# ---------- helpers ----------

def rect(center, size, ang):
    c, s = math.cos(ang), math.sin(ang)
    w, d = size[0] / 2, size[1] / 2
    pts = [(-w, -d), (w, -d), (w, d), (-w, d)]
    return [[round(center[0] + x * c - y * s, 3), round(center[1] + x * s + y * c, 3)] for x, y in pts]


def circle(center, diam, n=ROUND_SIDES):
    r = diam / 2
    return [[round(center[0] + r * math.cos(2 * math.pi * k / n), 3), round(center[1] + r * math.sin(2 * math.pi * k / n), 3)] for k in range(n)]


def yaw_quat(q, ang):
    """Pre-multiply a world-from-camera quaternion (x, y, z, w) by a rotation about world +y.
    A counter-clockwise turn in the u-v plane is a turn about +y in three.js (x = u, z = -v)."""
    x, y, z, w = q
    hy, hw = math.sin(ang / 2), math.cos(ang / 2)
    # (0, hy, 0, hw) * (x, y, z, w)
    return [hw * x + hy * z, hw * y + hy * w, hw * z - hy * x, hw * w - hy * y]


def lerp(a, b, f):
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]


def edge_len(a, b):
    return math.hypot(b[0] - a[0], b[1] - a[1])


# ---------- main ----------

def build(pid: str) -> dict:
    pdir = project_dir(pid)
    rec = json.loads((pdir / "site_recon.json").read_text())
    lay = json.loads((pdir / "layout.json").read_text())
    F = lay["fences"]
    rec_quad = [F["road"]["a"], F["road"]["b"], F["right"]["b"], F["left"]["a"]]  # FL, FR, BR, BL
    st = lay["stated"]
    model_quad = [[0.0, 0.0], [st["road"], 0.0], [st["forest"], st["depth"]], [0.0, st["depth"]]]
    W = Warp(rec_quad, model_quad)

    # ---- plot ----
    mq = model_quad
    edges = []
    spec = [("road", mq[0], mq[1], [48.0, 49.0], "road"), ("right", mq[1], mq[2], [50.0, 50.0], "right"),
            ("forest", mq[2], mq[3], [48.0, 49.0], "forest"), ("left", mq[3], mq[0], [50.0, 50.0], "left")]
    for eid, a, b, stated, key in spec:
        f = F[key]
        edges.append({
            "id": eid, "a": a, "b": b, "statedLength": stated, "modelLength": round(edge_len(a, b), 2),
            "reconstructedLength": round(edge_len(f["a"], f["b"]), 2), "rawResidual": f["uncertainty"],
            "method": "fence boards and frames", "style": f["style"], "how": f["how"],
        })
    # where the right fence changes from mesh to boards (model v)
    rf = F["right"]
    if "switch" in rf:
        tsw = (rf["switch"] - rf["a"][1]) / (rf["b"][1] - rf["a"][1])
        edges[1]["switchAt"] = round(tsw, 3)

    # where the left fence changes from dark pickets (front) to boards (back), model v
    lf = F["left"]
    if "switchV" in lf:
        a_v, b_v = mq[3][1], mq[0][1]
        edges[3]["switchAt"] = round((a_v - lf["switchV"]) / (a_v - b_v), 3)
        edges[3]["how"] = lf["how"] + " " + lf.get("styleHow", "")

    ent = lay["entrance"]
    ent_m = W.fwd([[ent["u"], F["road"]["a"][1]]])[0]

    # ---- elements ----
    by_id = {e["id"]: e for e in lay["elements"]}
    out_el = []
    placed_centers = {}
    for e in lay["elements"]:
        c_rec = np.array(e["center"], float)
        if e.get("parent"):
            par = by_id[e["parent"]]
            pc_rec = np.array(par["center"], float)
            yaw = W.yaw(pc_rec)
            off = c_rec - pc_rec
            co, si = math.cos(yaw), math.sin(yaw)
            c_m = placed_centers[e["parent"]] + np.array([off[0] * co - off[1] * si, off[0] * si + off[1] * co])
        elif e.get("anchor"):
            # the named face stands on a fence: map that face, keep the depth behind it
            yaw = W.yaw(c_rec)
            n = {"north": (0, 1), "south": (0, -1), "east": (1, 0), "west": (-1, 0)}[e["anchor"]]
            half = (e["size"][0] if n[0] else e["size"][1]) / 2
            face_m = W.fwd([c_rec + np.array(n) * half])[0]
            co, si = math.cos(yaw), math.sin(yaw)
            nm = np.array([n[0] * co - n[1] * si, n[0] * si + n[1] * co])
            c_m = face_m - nm * half
        else:
            yaw = W.yaw(c_rec)
            c_m = W.fwd([c_rec])[0]
        placed_centers[e["id"]] = c_m
        ang = math.radians(e.get("rot", 0)) + yaw
        fp = circle(c_m, e["size"][0]) if e.get("round") else rect(c_m, e["size"], ang)
        el = {
            "id": e["id"], "kind": e["kind"], "label": e["label"], "detail": e.get("detail", ""),
            "footprint": fp, "center": [round(c_m[0], 3), round(c_m[1], 3)], "size": e["size"],
            "angle": round(math.degrees(ang), 3), "height": e["height"],
            "provenance": e["provenance"], "uncertainty": e["uncertainty"],
            "evidence": e.get("evidence", {}), "how": e.get("how", ""),
            "removable": e["id"] not in ("house", "veranda", "sauna", "sauna-terrace", "utility-cabin", "forest-door"),
        }
        for k in ("ridge", "roof", "ridgeAxis", "storeys", "glazed", "door", "outside", "round", "parent", "anchor"):
            if k in e:
                el[k] = e[k]
        out_el.append(el)

    trees = []
    for t in lay["trees"]:
        p = W.fwd([t["at"]])[0]
        trees.append({"id": t["id"], "species": t["species"], "at": [round(p[0], 3), round(p[1], 3)],
                      "height": t["height"], "crown": t["crown"], "how": t["how"], "provenance": "located"})

    zones = []
    for z in lay.get("zones", []):
        poly = W.fwd(z["polygon"]).round(3).tolist()
        zones.append({"id": z["id"], "label": z["label"], "polygon": poly, "provenance": "narration",
                      "note": z["note"], "evidence": {"segments": z.get("segments", [])}})

    # ---- terrain: the reconstruction's plane, re-expressed in plot coordinates ----
    t0 = rec["terrain"]
    gu_, gv_ = np.meshgrid(np.linspace(-5, 55, 25), np.linspace(-5, 56, 25))
    q = np.c_[gu_.ravel(), gv_.ravel()]
    p = W.inv(q)
    h = t0["h0"] + t0["gu"] * p[:, 0] + t0["gv"] * p[:, 1]
    A = np.c_[np.ones(len(q)), q]
    h0, gu, gv = np.linalg.lstsq(A, h, rcond=None)[0]
    slope = math.hypot(gu, gv) * 100
    terrain = dict(t0)
    terrain.update({"h0": float(h0), "gu": float(gu), "gv": float(gv), "slopePct": round(slope, 2),
                    "fallDirectionDeg": round(math.degrees(math.atan2(-gu, -gv)), 1)})

    # ---- cameras, pins ----
    cams = []
    for c in rec["cameras"]:
        pu, pv = c["pos"][0], -c["pos"][2]
        m = W.fwd([[pu, pv]])[0]
        yaw = W.yaw([pu, pv])
        cams.append({**c, "pos": [round(m[0], 4), c["pos"][1], round(-m[1], 4)], "quat": yaw_quat(c["quat"], yaw)})
    pins = []
    for pn in rec["pins"]:
        pu, pv = pn["pos"][0], -pn["pos"][2]
        m = W.fwd([[pu, pv]])[0]
        yaw = W.yaw([pu, pv])
        d = pn["dir"]
        co, si = math.cos(yaw), math.sin(yaw)
        du, dv = d[0], -d[2]
        nd = [du * co - dv * si, d[1], -(du * si + dv * co)]
        pins.append({**pn, "pos": [round(m[0], 3), pn["pos"][1], round(-m[1], 3)], "dir": nd})

    # ---- point cloud ----
    pc = None
    src = pdir / "site" / "points.bin"
    if src.exists():
        dt = [("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")]
        buf = np.frombuffer(src.read_bytes(), dtype=dt).copy()
        m = W.fwd(np.c_[buf["x"], -buf["z"]])
        buf["x"] = m[:, 0]
        buf["z"] = -m[:, 1]
        (pdir / "site" / "points_model.bin").write_bytes(buf.tobytes())
        pc = {"url": "site/points_model.bin", "count": int(len(buf))}

    # ---- how far the warp moves things (for the report) ----
    shift = np.linalg.norm(W.fwd(q) - q, axis=1)
    rec_w = [edge_len(F["road"]["a"], F["road"]["b"]), edge_len(F["forest"]["a"], F["forest"]["b"])]
    rec_d = [edge_len(F["left"]["a"], F["left"]["b"]), edge_len(F["right"]["a"], F["right"]["b"])]

    site = {
        "id": rec["id"], "name": rec["name"], "units": "m", "createdAt": rec["createdAt"],
        "plot": {
            "width": st["road"], "depth": st["depth"], "statedWidth": [48.0, 49.0], "statedDepth": [50.0, 50.0],
            "polygon": model_quad, "edges": edges,
            "reconstructedSize": [round(float(np.mean(rec_w)), 2), round(float(np.mean(rec_d)), 2)],
            "entrance": {"u": round(float(ent_m[0]), 2), "width": ent["width"], "provenance": "located",
                         "evidence": {"note": ent["how"]}},
            "note": st["note"],
        },
        "terrain": terrain,
        "elements": out_el,
        "trees": trees,
        "forest": lay.get("forest"),
        "zones": zones,
        "context": {"forestDepth": lay["forest"]["depth"], "forestHeight": lay["forest"]["height"], "roadWidth": 6,
                    "provenance": "inferred", "note": "Forest behind the back fence and the back of the left fence; road width not surveyed."},
        "scale": {**rec["scale"], "method": (
            "Positions: the fence outline measured in the reconstruction is mapped onto the supplied plot outline "
            f"(road {st['road']} m, forest {st['forest']} m, depth {st['depth']} m). Sizes: the reconstruction's own scale, "
            "confirmed by the phone height while walking and the building heights.")},
        "warp": {"recQuad": rec_quad, "modelQuad": model_quad, "maxShift": round(float(shift.max()), 2),
                 "reconstructedWidth": [round(x, 2) for x in rec_w], "reconstructedDepth": [round(x, 2) for x in rec_d]},
        "reconstruction": rec["reconstruction"],
        "cameras": cams,
        "pins": pins,
        "pointcloud": pc,
        "conflicts": conflicts(st, rec_w, rec_d),
        "sourceClips": rec.get("sourceClips", {}),
        "transcriptGloss": rec.get("transcriptGloss", {}),
        "model": {"url": "site/model.gltf.json"},
    }
    return site


def conflicts(st, rec_w, rec_d):
    return [
        {"topic": "Plot outline",
         "detail": f"Fence to fence the reconstruction measures {rec_w[0]:.1f} m along the road, {rec_w[1]:.1f} m along the forest and "
                   f"{np.mean(rec_d):.1f} m deep. The supplied figures are 48-49 m wide and about 50 m deep.",
         "resolution": "The supplied figures set the outline (road side 49 m, forest side 48 m, 50 m deep). Every structure keeps its "
                       "position relative to the fences it was measured against. Check the corners on site before building near a fence."},
        {"topic": "Slope",
         "detail": "The ground falls about 2.8% toward the left fence (about 1.4 m across the plot), from the phone height along the walk. "
                   "The narration mentions a fall 'toward behind me' and 'that way'.",
         "resolution": "Shown as a plane. Have levels surveyed before designing foundations or drainage."},
        {"topic": "Right-front quarter of the reconstruction",
         "detail": "That part of the walk was joined from a separate sub-model and sits 1.5-2.5 m too low, so heights there are unreliable. "
                   "Positions in it were measured from the camera's own height above the ground instead.",
         "resolution": "Greenhouse, tank, tyre and beds there carry about 1 m uncertainty."},
    ]


def main(pid: str) -> None:
    site = build(pid)
    write_json(project_dir(pid) / "site.json", site)
    print(f"site.json: {len(site['elements'])} elements, {len(site['trees'])} trees, warp moves points up to {site['warp']['maxShift']} m")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "plot")
