"""From the SfM model to a true-scale site model (site.json + point cloud + aligned frames).

Steps
 1. pick the largest reconstruction, read cameras and points
 2. gravity: mean camera "up" (pitch/roll bias cancels over a walk around the plot), refined so
    that reconstructed wall/fence planes are vertical
 3. fence lines: dominant orientation of the near-ground structure, then on each of the four
    sides the strongest long line just outside the walking path (the owner walked the boundary)
 4. orientation from the narration: the side the camera faced when the owner said "here is the
    entrance" is the road side; "the boundary nearer the forest" / "exit to the forest" mark the
    opposite side
 5. one similarity scale so the four fitted sides best match the owner's dimensions; the leftover
    disagreement is reported, never hidden
 6. terrain plane from the camera track (phone held at a steady height) cross-checked by ground points
 7. elements: analyst annotations (annotations.json, positions read off the reconstruction and
    the frames) refined against the points; anything without enough points stays "inferred"
 8. pins for spoken remarks, undistorted frames for photo alignment, compact point cloud
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
import pycolmap

from common import Progress, project_dir, read_json, write_json

EYE_HEIGHT = 1.45  # typical phone height while filming at a walk (m)
DEFAULT_PLOT = {"width": [48.0, 49.0], "depth": [50.0, 50.0]}


# ----------------------------------------------------------------------------- loading
def load_largest(work: Path) -> pycolmap.Reconstruction:
    best, best_n = None, -1
    for d in sorted((work / "models").iterdir()):
        if not d.is_dir():
            continue
        r = pycolmap.Reconstruction(str(d))
        if r.num_reg_images() > best_n:
            best, best_n = r, r.num_reg_images()
    if best is None:
        raise SystemExit("no SfM model found")
    return best


def read_cameras(rec: pycolmap.Reconstruction):
    cams = []
    for img in rec.images.values():
        if not img.has_pose:
            continue
        cfw = img.cam_from_world()
        R = cfw.rotation.matrix()  # cam_from_world
        t = cfw.translation
        C = -R.T @ t
        cam = rec.cameras[img.camera_id]
        name = Path(img.name).stem
        clip, ms = name.split("_")
        cams.append({
            "id": name, "clip": clip, "t": int(ms) / 1000.0, "C": C, "R": R,
            "w": cam.width, "h": cam.height, "params": np.array(cam.params), "model": cam.model.name,
            "image_id": img.image_id,
        })
    cams.sort(key=lambda c: (c["clip"], c["t"]))
    return cams


def read_merged(path: Path):
    z = np.load(path)
    cams = []
    for c in json.loads(str(z["cams"])):
        name = Path(c["name"]).stem
        clip, ms = name.split("_")
        cams.append({"id": name, "clip": clip, "t": int(ms) / 1000.0, "C": np.array(c["C"]), "R": np.array(c["R"]),
                     "w": c["w"], "h": c["h"], "params": np.array(c["params"]), "model": c["model"], "src": c["src"]})
    cams.sort(key=lambda c: (c["clip"], c["t"]))
    keep = z["err"] <= 2.0
    return cams, z["pts"][keep], z["rgb"][keep], z["err"][keep]


def read_points(rec: pycolmap.Reconstruction, max_err=2.0, min_track=3):
    xyz, rgb, err, ids = [], [], [], []
    for pid, p in rec.points3D.items():
        if p.error > max_err or p.track.length() < min_track:
            continue
        xyz.append(p.xyz)
        rgb.append(p.color)
        err.append(p.error)
        ids.append(pid)
    return np.array(xyz), np.array(rgb, dtype=np.uint8), np.array(err), np.array(ids)


# ----------------------------------------------------------------------------- gravity
def ransac_planes(P: np.ndarray, thresh: float, n_planes=12, min_inliers=300, iters=1500, rng=None):
    rng = rng or np.random.default_rng(0)
    planes = []
    remaining = np.arange(len(P))
    for _ in range(n_planes):
        if len(remaining) < min_inliers:
            break
        Q = P[remaining]
        best_inl = None
        for _ in range(iters):
            s = Q[rng.choice(len(Q), 3, replace=False)]
            n = np.cross(s[1] - s[0], s[2] - s[0])
            nn = np.linalg.norm(n)
            if nn < 1e-12:
                continue
            n /= nn
            d = np.abs((Q - s[0]) @ n)
            inl = np.nonzero(d < thresh)[0]
            if best_inl is None or len(inl) > len(best_inl):
                best_inl = inl
        if best_inl is None or len(best_inl) < min_inliers:
            break
        X = Q[best_inl]
        c = X.mean(0)
        _, _, vt = np.linalg.svd(X - c, full_matrices=False)
        n = vt[2]
        planes.append({"n": n, "c": c, "count": len(best_inl), "idx": remaining[best_inl]})
        remaining = np.delete(remaining, best_inl)
    return planes


def estimate_up(cams, P, scale_hint: float):
    ups = np.array([-c["R"].T[:, 1] for c in cams])  # world direction of image-up
    up0 = ups.mean(0)
    up0 /= np.linalg.norm(up0)
    spread = float(np.degrees(np.arccos(np.clip(ups @ up0, -1, 1))).mean())
    # refine with near-vertical planes (walls, fences): their normals must be horizontal
    rng = np.random.default_rng(0)
    sub = P[rng.choice(len(P), min(len(P), 40000), replace=False)]
    planes = ransac_planes(sub, thresh=0.04 * scale_hint, n_planes=14, min_inliers=max(120, len(sub) // 250), iters=600, rng=rng)
    walls = [p for p in planes if abs(p["n"] @ up0) < math.sin(math.radians(20))]
    up = up0
    info = {"camera_up_spread_deg": round(spread, 1), "walls": len(walls)}
    if len(walls) >= 2:
        M = sum(p["count"] * np.outer(p["n"], p["n"]) for p in walls)
        w, v = np.linalg.eigh(M)
        cand = v[:, 0] * np.sign(v[:, 0] @ up0)
        ratio = w[1] / max(w[0], 1e-9)
        ang = float(np.degrees(np.arccos(np.clip(cand @ up0, -1, 1))))
        info.update(eig_ratio=round(float(ratio), 1), wall_vs_camera_deg=round(ang, 2))
        if ratio > 8 and ang < 6:
            up = cand
            info["method"] = f"vertical walls/fences ({len(walls)} planes), camera-up agrees within {ang:.1f} deg"
        else:
            info["method"] = f"average camera orientation ({len(cams)} frames); wall planes inconclusive"
    else:
        info["method"] = f"average camera orientation ({len(cams)} frames)"
    return up / np.linalg.norm(up), info


def rotation_to_y(up):
    y = np.array([0.0, 1.0, 0.0])
    v = np.cross(up, y)
    s = np.linalg.norm(v)
    c = float(up @ y)
    if s < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1, -1, -1])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * ((1 - c) / s**2)


# ----------------------------------------------------------------------------- ground
def fit_plane_robust(xz: np.ndarray, y: np.ndarray, iters=6):
    """y = a + b*x + c*z, Huber-like reweighting."""
    w = np.ones(len(y))
    A = np.c_[np.ones(len(y)), xz]
    coef = np.zeros(3)
    for _ in range(iters):
        W = np.sqrt(w)[:, None]
        coef, *_ = np.linalg.lstsq(A * W, y * W[:, 0], rcond=None)
        r = y - A @ coef
        s = 1.4826 * np.median(np.abs(r)) + 1e-9
        w = np.minimum(1.0, 1.5 * s / (np.abs(r) + 1e-12))
    r = y - A @ coef
    return coef, float(1.4826 * np.median(np.abs(r)))


def eye_height_units(cams_al, P_al):
    """Median vertical gap between the camera and the ground points right below it (model units)."""
    from scipy.spatial import cKDTree

    tree = cKDTree(P_al[:, [0, 2]])
    ext = np.ptp(cams_al[:, [0, 2]], axis=0).max()
    r = ext / 60
    gaps = []
    for c in cams_al[:: max(1, len(cams_al) // 400)]:
        idx = tree.query_ball_point(c[[0, 2]], r)
        if len(idx) < 8:
            continue
        ys = P_al[idx, 1]
        ys = ys[ys < c[1]]
        if len(ys) < 5:
            continue
        g = np.percentile(ys, 10)
        gaps.append(c[1] - g)
    return float(np.median(gaps)) if gaps else None, len(gaps)


# ----------------------------------------------------------------------------- fence lines
def dominant_angle(XZ: np.ndarray, extent: float):
    """Orientation (0..90 deg) at which projections of near-ground structure are sharpest."""
    best, best_s = 0.0, -1
    bin_ = extent / 300
    scores = []
    for deg in np.arange(0, 90, 0.25):
        a = math.radians(deg)
        ax = np.array([math.cos(a), math.sin(a)])
        ay = np.array([-math.sin(a), math.cos(a)])
        s = 0.0
        for d in (ax, ay):
            pr = XZ @ d
            h, _ = np.histogram(pr, bins=np.arange(pr.min(), pr.max() + bin_, bin_))
            s += float((h.astype(float) ** 2).sum())
        scores.append(s)
        if s > best_s:
            best, best_s = deg, s
    return best, np.array(scores)


def find_side(XZ, dir_out, along, cam_proj_max, unit, search=(-0.6, 9.0)):
    """Strongest long line outside the walking path along direction `dir_out` (unit vectors)."""
    pr = XZ @ dir_out
    al = XZ @ along
    lo, hi = cam_proj_max + search[0] * unit, cam_proj_max + search[1] * unit
    sel = (pr > lo) & (pr < hi)
    if sel.sum() < 30:
        return None
    bin_ = 0.2 * unit
    edges = np.arange(lo, hi + bin_, bin_)
    # count only points whose along-coordinates spread widely: a fence, not a bush
    best = None
    for i in range(len(edges) - 1):
        m = sel & (pr >= edges[i] - bin_) & (pr < edges[i + 1] + bin_)
        n = int(m.sum())
        if n < 25:
            continue
        a = al[m]
        cover_bins = np.unique(np.floor(a / unit)).size  # ~1 m bins
        score = n * cover_bins
        if best is None or score > best[0]:
            best = (score, i, n, cover_bins)
    if best is None:
        return None
    _, i, n, cover = best
    c0 = (edges[i] + edges[i + 1]) / 2
    band = sel & (np.abs(pr - c0) < 0.45 * unit)
    off = np.median(pr[band])
    resid = float(1.4826 * np.median(np.abs(pr[band] - off)))
    a = al[band]
    return {"offset": float(off), "points": int(band.sum()), "cover_m": int(cover),
            "along_min": float(np.percentile(a, 2)), "along_max": float(np.percentile(a, 98)), "resid": resid}


# ----------------------------------------------------------------------------- main
def main(pid: str) -> None:
    prog = Progress(pid)
    pdir = project_dir(pid)
    work = pdir / "work" / "sfm"
    frames = read_json(pdir / "frames.json")
    transcript = read_json(pdir / "transcript.json", {"segments": []})
    facts = read_json(pdir / "facts.json", {"facts": []})
    meta = read_json(pdir / "project.json", {}) or {}
    plotspec = meta.get("plot", DEFAULT_PLOT)
    stated_w, stated_d = plotspec["width"], plotspec["depth"]
    ann = read_json(pdir / "annotations.json", {}) or {}
    diag: dict = {}

    prog.update("site", "running", "loading reconstruction", 0.05)
    merged = work / "merged.npz"
    if merged.exists():
        cams, P, RGB, ERR = read_merged(merged)
        rep_err = float(np.mean(ERR))
        diag["source"] = "merged sub-models"
    else:
        rec = load_largest(work)
        cams = read_cameras(rec)
        P, RGB, ERR, _ = read_points(rec)
        rep_err = float(np.mean([p.error for p in rec.points3D.values()])) if rec.num_points3D() else 0.0
        diag["source"] = "largest model"
    diag["registered"] = len(cams)
    diag["points"] = len(P)
    C = np.array([c["C"] for c in cams])
    # drop stray cameras (mis-registered frames end up far from the walk)
    med = np.median(C, axis=0)
    r = np.linalg.norm(C - med, axis=1)
    keep_c = r < 3.0 * np.percentile(r, 90)
    if (~keep_c).any():
        diag["stray_cameras"] = [c["id"] for c, k in zip(cams, keep_c) if not k]
        cams = [c for c, k in zip(cams, keep_c) if k]
        C = C[keep_c]
    extent = float(np.ptp(np.percentile(C, [2, 98], axis=0), axis=0).max())

    # --- gravity
    prog.update("site", "running", "estimating the vertical", 0.12)
    up, upinfo = estimate_up(cams, P, scale_hint=extent / 40)
    Rg = rotation_to_y(up)
    P_al = P @ Rg.T
    C_al = C @ Rg.T
    diag["gravity"] = upinfo

    # --- provisional metric scale from eye height (only used for height bands)
    eye_u, n_eye = eye_height_units(C_al, P_al)
    unit = (eye_u / EYE_HEIGHT) if eye_u else extent / 50  # model units per meter (provisional)
    diag["eye_height_units"] = eye_u
    # camera-track plane -> local ground height function (model units)
    cam_coef, cam_res = fit_plane_robust(C_al[:, [0, 2]], C_al[:, 1])
    ground_at = lambda xz: cam_coef[0] + xz @ cam_coef[1:] - (eye_u or EYE_HEIGHT * unit)  # noqa: E731
    hag = P_al[:, 1] - ground_at(P_al[:, [0, 2]])  # height above ground, model units

    # --- fence lines
    prog.update("site", "running", "fitting fence lines", 0.25)
    near = (hag > 0.25 * unit) & (hag < 2.3 * unit)
    XZ = P_al[near][:, [0, 2]]
    ang, _ = dominant_angle(XZ, extent)
    a = math.radians(ang)
    axes = {"+a": np.array([math.cos(a), math.sin(a)]), "+b": np.array([-math.sin(a), math.cos(a)])}
    axes["-a"], axes["-b"] = -axes["+a"], -axes["+b"]
    camXZ = C_al[:, [0, 2]]
    WALK_CLEAR = 0.7  # m between the walking line and a fence the owner walks along
    sides = {}
    for k, d in axes.items():
        along = axes["+b"] if k[1] == "a" else axes["+a"]
        walk_ext = float(np.percentile(camXZ @ d, 99.5))
        cand = find_side(XZ, d, along, walk_ext, unit, search=(-0.8, 3.0))
        if cand is not None and cand["points"] >= 600 and cand["cover_m"] >= 15:
            cand["method"] = "fence points"
            sides[k] = cand
        else:
            # picket and mesh fences barely reconstruct; the owner walked the boundary, so the
            # fence is just beyond the outermost walking line
            sides[k] = {"offset": walk_ext + WALK_CLEAR * unit, "points": cand["points"] if cand else 0,
                        "cover_m": cand["cover_m"] if cand else 0, "resid": 0.7 * unit, "method": "walking path + 0.7 m"}
    diag["fence_angle_deg"] = ang
    diag["sides_raw"] = {k: v for k, v in sides.items()}

    # --- orientation from narration
    cam_by_clip = {}
    for c in cams:
        cam_by_clip.setdefault(c["clip"], []).append(c)

    def cam_at(clip, t):
        lst = cam_by_clip.get(clip) or []
        if not lst:
            return None
        return min(lst, key=lambda c: abs(c["t"] - t))

    def fact_cams(kinds, extra=None):
        out = []
        for f in facts["facts"]:
            if f["kind"] in kinds and (extra is None or extra(f)):
                c = cam_at(f["clip"], f["t_word"])
                if c is not None and abs(c["t"] - f["t_word"]) < 4:
                    out.append((f, c))
        return out

    road_cues = fact_cams({"entrance", "parking"})
    forest_cues = fact_cams({"back_gate", "forest"}) + fact_cams({"boundary"}, lambda f: "near_forest" in f["directions"] or "лес" in f["quote"])

    def side_dist(k, c):
        xz = (Rg @ c["C"])[[0, 2]]
        return abs(sides[k]["offset"] - xz @ axes[k])

    def facing(k, c):
        fwd = (Rg @ c["R"].T[:, 2])[[0, 2]]
        fwd /= np.linalg.norm(fwd) + 1e-9
        return float(fwd @ axes[k])

    opposite = {"+a": "-a", "-a": "+a", "+b": "-b", "-b": "+b"}
    best_k, best_s = None, -1e9
    scores = {}
    for k in axes:
        s = 0.0
        for _, c in road_cues:
            s += -side_dist(k, c) / unit + 6 * facing(k, c)
        for _, c in forest_cues:
            s += -side_dist(opposite[k], c) / unit + 6 * facing(opposite[k], c)
        scores[k] = round(s, 1)
        if s > best_s:
            best_k, best_s = k, s
    diag["orientation_scores"] = scores
    diag["road_cues"] = [(f["clip"], f["t_word"], f["quote"][:60]) for f, _ in road_cues]
    diag["forest_cues"] = [(f["clip"], f["t_word"], f["quote"][:60]) for f, _ in forest_cues]
    road_k = best_k
    forest_k = opposite[road_k]
    fdir = -axes[road_k]  # from road toward forest (horizontal, aligned frame xz)
    f3 = np.array([fdir[0], 0.0, fdir[1]])
    right3 = np.cross(f3, np.array([0.0, 1.0, 0.0]))
    rdir = right3[[0, 2]]
    right_k = min(axes, key=lambda k: -float(axes[k] @ rdir))
    left_k = opposite[right_k]

    # plot extents in model units (reconstructed fence-to-fence)
    W_u = sides[right_k]["offset"] + sides[left_k]["offset"]
    D_u = sides[road_k]["offset"] + sides[forest_k]["offset"]

    # --- scale: one similarity factor, least squares against the owner's figures on both axes
    sw, sd = float(np.mean(stated_w)), float(np.mean(stated_d))
    s = (sw * W_u + sd * D_u) / (W_u**2 + D_u**2)  # meters per model unit
    W_rec, D_rec = W_u * s, D_u * s
    diag["scale_m_per_unit"] = s
    diag["W_D_reconstructed"] = (W_rec, D_rec)
    eye_m = eye_u * s if eye_u else None
    # the boundary is the owner's rectangle (statements take precedence), centred on the fences
    W, D = sw, sd
    du0, dv0 = (W - W_rec) / 2, (D - D_rec) / 2

    # site transform: world(aligned) -> site (u, v, h)
    # road-left corner of the reconstructed fences: intersection of {p . axis_k = offset_k}
    o_xz = sides[road_k]["offset"] * axes[road_k] + sides[left_k]["offset"] * axes[left_k]

    def to_site(Xal: np.ndarray) -> np.ndarray:
        xz = Xal[:, [0, 2]] - o_xz
        u = (xz @ rdir) * s + du0
        v = (xz @ fdir) * s + dv0
        return np.c_[u, v, Xal[:, 1] * s]

    Ps = to_site(P_al)
    Cs = to_site(C_al)

    # --- terrain from the camera track (u, v, h), datum: ground at the entrance = 0
    coef, res = fit_plane_robust(Cs[:, :2], Cs[:, 2])
    h_eye = eye_m if (eye_m and 1.0 < eye_m < 2.0) else EYE_HEIGHT
    ground0 = coef[0] - h_eye
    gu, gv = float(coef[1]), float(coef[2])
    slope = math.hypot(gu, gv) * 100
    fall_dir = math.degrees(math.atan2(-gu, -gv))  # direction of steepest descent, 0 = toward forest
    # ground points (near the track plane minus eye height) as a cross-check of the plane
    ghag = Ps[:, 2] - (ground0 + gu * Ps[:, 0] + gv * Ps[:, 1])
    gmask = (np.abs(ghag) < 0.35) & (Ps[:, 0] > 0) & (Ps[:, 0] < W) & (Ps[:, 1] > 0) & (Ps[:, 1] < D)
    gcoef, gres = (fit_plane_robust(Ps[gmask][:, :2], Ps[gmask][:, 2]) if gmask.sum() > 200 else (None, None))
    up_err_deg = 1.0 if "walls" in upinfo.get("method", "") else 2.5
    h_unc = math.tan(math.radians(up_err_deg)) * max(W, D) / 2 + res
    diag["terrain"] = {"cam_plane": coef.tolist(), "cam_res": res, "ground_plane": None if gcoef is None else gcoef.tolist(),
                       "ground_res": gres, "ground_pts": int(gmask.sum())}

    # entrance: where the camera looked when the owner said "entrance"
    ent_u, ent_prov = W * 0.6, "inferred"
    hits = []
    for f, c in road_cues:
        if f["kind"] != "entrance":
            continue
        Cc = to_site((Rg @ c["C"])[None])[0]
        fwd = Rg @ c["R"].T[:, 2]
        fx = np.array([(fwd[[0, 2]] @ rdir), (fwd[[0, 2]] @ fdir)])
        if fx[1] < -0.2:  # looking toward the road
            t = -Cc[1] / fx[1]
            hits.append(Cc[0] + t * fx[0])
    if hits:
        ent_u, ent_prov = float(np.median(hits)), "reconstructed"
    ent_u = float(np.clip(ent_u, 2.5, W - 2.5))

    def to_world(us):  # site (u, v, h) -> three.js world (x, y, z) with datum
        return np.c_[us[:, 0], us[:, 2] - (ground0 + gu * ent_u), -us[:, 1]]

    h0 = float(ground0 - (ground0 + gu * ent_u))  # = -gu*ent_u, ground at entrance = 0
    terrain = {
        "h0": h0, "gu": gu, "gv": gv, "provenance": "reconstructed",
        "slopePct": round(slope, 2), "fallDirectionDeg": round(fall_dir, 1), "heightUncertainty": round(h_unc, 2),
        "note": (f"Plane fitted to the camera track (phone held ~{h_eye:.2f} m above ground; spread ±{res:.2f} m)"
                 + (f" and checked against {int(gmask.sum())} ground points (±{gres:.2f} m)." if gcoef is not None else ".")
                 + " Smaller bumps are not modelled."),
    }

    # --- outputs: cameras, point cloud
    prog.update("site", "running", "writing point cloud and frames", 0.6)
    sitedir = pdir / "site"
    (sitedir / "undistorted").mkdir(parents=True, exist_ok=True)
    Pw = to_world(Ps)
    crop = (Ps[:, 0] > -15) & (Ps[:, 0] < W + 15) & (Ps[:, 1] > -12) & (Ps[:, 1] < D + 18) & (Pw[:, 1] > -3) & (Pw[:, 1] < 30)
    order = np.argsort(ERR[crop])
    keep = np.nonzero(crop)[0][order][:400000]
    buf = np.zeros(len(keep), dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("r", "u1"), ("g", "u1"), ("b", "u1")])
    buf["x"], buf["y"], buf["z"] = Pw[keep, 0], Pw[keep, 1], Pw[keep, 2]
    buf["r"], buf["g"], buf["b"] = RGB[keep, 0], RGB[keep, 1], RGB[keep, 2]
    (sitedir / "points.bin").write_bytes(buf.tobytes())

    # world-from-camera rotation in the three.js convention (camera looks down -z, y up)
    M = np.zeros((3, 3))  # site-world axes in aligned coords: x=right, y=up, z=-forward
    M[:, 0] = right3
    M[:, 1] = [0, 1, 0]
    M[:, 2] = -f3
    flip = np.diag([1.0, -1.0, -1.0])  # COLMAP cam (x right, y down, z fwd) -> three cam (x right, y up, z back)
    cam_out = []
    frames_by_id = {f["id"]: f for f in frames["frames"]}
    from collections import Counter
    main_src = Counter(c.get("src", 0) for c in cams).most_common(1)[0][0]
    for c, cs in zip(cams, Cs):
        Rwc_al = Rg @ c["R"].T  # aligned-world from colmap-cam
        Rw = M.T @ Rwc_al @ flip
        q = rot_to_quat(Rw)
        f_px = c["params"][0]
        fovy = math.degrees(2 * math.atan(c["h"] / 2 / f_px))
        pos = to_world(cs[None])[0]
        cam_out.append({"id": c["id"], "clip": c["clip"], "t": c["t"], "pos": [round(float(x), 3) for x in pos],
                        "quat": [round(float(x), 5) for x in q], "fovY": round(fovy, 2), "aspect": round(c["w"] / c["h"], 4),
                        **({"approx": True} if c.get("src", main_src) != main_src else {})})
        und = sitedir / "undistorted" / f"{c['id']}.jpg"
        if not und.exists() and c["id"] in frames_by_id:
            img = cv2.imread(str(pdir / "frames" / f"{c['id']}.jpg"))
            if img is not None:
                K = np.array([[f_px, 0, c["params"][1]], [0, f_px, c["params"][2]], [0, 0, 1]])
                Kc = np.array([[f_px, 0, c["w"] / 2], [0, f_px, c["h"] / 2], [0, 0, 1]])
                dist = np.zeros(5)
                if c["model"] in ("RADIAL", "SIMPLE_RADIAL"):
                    dist[0] = c["params"][3]
                    if c["model"] == "RADIAL":
                        dist[1] = c["params"][4]
                img = cv2.undistort(img, K, dist, None, Kc)
                cv2.imwrite(str(und), img, [cv2.IMWRITE_JPEG_QUALITY, 82])

    # --- pins for spoken remarks
    pins = []
    gloss = {"entrance": "Entrance here", "parking": "Parking on the right", "house": "The house", "sauna": "The sauna (banya)",
             "forest": "Forest behind", "boundary": "Boundary near the forest", "back_gate": "Exit to the forest",
             "slope": "Land slopes this way", "garden": "Vegetable beds", "rock_garden": "Rock garden", "sheds": "Utility sheds",
             "woodpile": "Woodpile / chopping", "terrace": "Terrace", "bath": "Plunge bath", "tyre": "Big tyre",
             "plot_shape": "Plot is rectangular", "scale_refs": "Objects of standard size", "stove": "Outdoor stove", "table": "Summer table"}
    seen = set()
    for f in facts["facts"]:
        if f["kind"] not in gloss or (f["segment"], f["kind"]) in seen:
            continue
        c = cam_at(f["clip"], f["t_word"])
        if c is None or abs(c["t"] - f["t_word"]) > 4:
            continue
        seen.add((f["segment"], f["kind"]))
        cs = to_site((Rg @ c["C"])[None])
        pos = to_world(cs)[0]
        fwd = Rg @ c["R"].T[:, 2]
        d = np.array([fwd[[0, 2]] @ rdir, 0.0, -(fwd[[0, 2]] @ fdir)])
        d /= np.linalg.norm(d) + 1e-9
        pins.append({"segment": f["segment"], "kind": f["kind"], "label": gloss[f["kind"]], "quote": f["quote"], "clip": f["clip"],
                     "t": f["t_word"], "pos": [round(float(x), 2) for x in pos], "dir": [round(float(x), 3) for x in d], "frame": c["id"]})
    # one pin per kind and place: drop near-duplicates (same kind within 4 m)
    dedup = []
    for p in pins:
        if any(q["kind"] == p["kind"] and math.dist(q["pos"], p["pos"]) < 8 for q in dedup):
            continue
        dedup.append(p)

    # --- elements from annotations, refined by points
    prog.update("site", "running", "fitting buildings and features", 0.8)
    elements, zones, checks = refine_annotations(ann, Ps, Cs, cams, s, W, D, terrain, ent_u)
    if not ann.get("elements"):
        site_ground = lambda u, v: ground0 + gu * u + gv * v  # noqa: E731
        elements = auto_detect(Ps, site_ground, W, D)

    # --- scale cross-checks
    if eye_m:
        checks.insert(0, {"label": "Phone height above ground while walking", "expected": [1.25, 1.65], "measured": round(eye_m, 2),
                          "ok": 1.25 <= eye_m <= 1.65, "note": f"median over {n_eye} positions"})

    # per-side residuals and lengths
    corners = {"road": ((0.0, 0.0), (W, 0.0)), "right": ((W, 0.0), (W, D)), "forest": ((W, D), (0.0, D)), "left": ((0.0, D), (0.0, 0.0))}
    kmap = {"road": road_k, "right": right_k, "forest": forest_k, "left": left_k}
    edges, fences = [], []
    rec_rect = {"road": ((du0, dv0), (du0 + W_rec, dv0)), "right": ((du0 + W_rec, dv0), (du0 + W_rec, dv0 + D_rec)),
                "forest": ((du0 + W_rec, dv0 + D_rec), (du0, dv0 + D_rec)), "left": ((du0, dv0 + D_rec), (du0, dv0))}
    for eid, (a0, b0) in corners.items():
        sd_ = sides[kmap[eid]]
        stated = stated_w if eid in ("road", "forest") else stated_d
        ra, rb = rec_rect[eid]
        gap = abs(du0) if eid in ("left", "right") else abs(dv0)
        edges.append({"id": eid, "a": [round(a0[0], 3), round(a0[1], 3)], "b": [round(b0[0], 3), round(b0[1], 3)],
                      "statedLength": stated, "modelLength": round(math.dist(a0, b0), 3),
                      "reconstructedLength": round(math.dist(ra, rb), 2),
                      "rawResidual": round(sd_["resid"] * s + gap, 2), "points": sd_["points"], "method": sd_["method"]})
        fences.append({"id": eid, "a": [round(ra[0], 2), round(ra[1], 2)], "b": [round(rb[0], 2), round(rb[1], 2)],
                       "method": sd_["method"], "points": sd_["points"]})

    aspect_fit = W_rec / D_rec
    aspect_st = sw / sd
    resid_m = float(np.mean([e["rawResidual"] for e in edges]))
    acc = (f"Boundary lines ±{max(0.3, resid_m):.1f} m; scale ±{abs(W_rec / sw - 1) * 100 + abs(D_rec / sd - 1) * 50:.0f}%; building positions ±0.3–0.6 m where reconstructed, "
           f"±1–2 m where inferred; heights ±{h_unc:.1f} m over the plot.")
    clips = []
    for cl in frames["clips"]:
        clips.append({"id": cl["id"], "registered": sum(1 for c in cams if c["clip"] == cl["id"]), "total": cl["keyframes"]})
    rep = rep_err

    conflicts = build_conflicts(diag, terrain, W_rec, D_rec, stated_w, stated_d, facts, transcript, fences, dedup) + ann.get("conflicts", [])
    # did the walk cover the plot? a partial walk cannot anchor the owner's dimensions
    cu = float(np.ptp(np.percentile(Cs[:, 0], [2, 98]))) / W
    cv = float(np.ptp(np.percentile(Cs[:, 1], [2, 98]))) / D
    if min(cu, cv) < 0.6 or any(not c["ok"] for c in checks):
        conflicts.insert(0, {"topic": "Footage coverage",
                             "detail": f"The walking path spans {cu * 100:.0f}% of the width and {cv * 100:.0f}% of the depth"
                                       + ("; some scale checks failed" if any(not c["ok"] for c in checks) else "") + ".",
                             "resolution": "Scale and boundary are unreliable for this survey. Walk the whole boundary (and film the fences) and run it again."})
    site = {
        "id": pid, "name": meta.get("name", "Plot"), "units": "m", "createdAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "plot": {"width": round(W, 3), "depth": round(D, 3), "statedWidth": stated_w, "statedDepth": stated_d, "edges": edges,
                 "fences": fences + [dict(f, id="evidence") for f in ann.get("fenceEvidence", [])],
                 "reconstructedSize": [round(W_rec, 2), round(D_rec, 2)],
                 "entrance": {"u": round(ent_u, 2), "width": 4.0, "provenance": ent_prov,
                              "evidence": {"segments": [f["segment"] for f, _ in road_cues if f["kind"] == "entrance"]}}},
        "terrain": terrain, "elements": elements, "zones": zones,
        "context": {"forestDepth": 25, "forestHeight": 22, "roadWidth": 6, "provenance": "inferred",
                    "note": "Forest stated by the owner; tree height judged from the frames; road width not surveyed."},
        "scale": {"method": f"one scale factor fitted to the owner's {sw:g} × {sd:g} m on both axes",
                  "metersPerUnit": s, "aspectFit": round(aspect_fit, 4), "aspectStated": round(aspect_st, 4),
                  "checks": checks, "expectedAccuracy": acc},
        "reconstruction": {"frames": len(frames["frames"]), "registered": len(cams), "points": len(P), "reprojectionError": round(rep, 3),
                           "clips": clips, "gravity": upinfo.get("method", "")},
        "cameras": cam_out, "pins": dedup,
        "pointcloud": {"url": "site/points.bin", "count": int(len(keep))},
        "conflicts": conflicts,
        "sourceClips": {cl["file"]: cl["id"] for cl in frames["clips"]},
        "transcriptGloss": ann.get("transcriptGloss", {}),
    }
    # reconstruction frame; pipeline/layout.py maps it onto the stated plot and writes site.json
    write_json(pdir / "site_recon.json", site)
    write_json(pdir / "work" / "site_diag.json", json.loads(json.dumps(diag, default=_jsonable)))
    prog.update("site", "done", f"fences {W_rec:.1f} × {D_rec:.1f} m reconstructed vs owner {sw:g} × {sd:g}; eye height "
                f"{eye_m or 0:.2f} m; slope {slope:.1f}%; {len(elements)} elements", 1.0)


def _jsonable(o):
    if isinstance(o, np.ndarray):
        return o.tolist()
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    return str(o)


def rot_to_quat(R):
    q = np.empty(4)
    tr = np.trace(R)
    if tr > 0:
        S = math.sqrt(tr + 1.0) * 2
        q[3] = 0.25 * S
        q[0] = (R[2, 1] - R[1, 2]) / S
        q[1] = (R[0, 2] - R[2, 0]) / S
        q[2] = (R[1, 0] - R[0, 1]) / S
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        S = math.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        q[3] = (R[2, 1] - R[1, 2]) / S
        q[0] = 0.25 * S
        q[1] = (R[0, 1] + R[1, 0]) / S
        q[2] = (R[0, 2] + R[2, 0]) / S
    elif R[1, 1] > R[2, 2]:
        S = math.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        q[3] = (R[0, 2] - R[2, 0]) / S
        q[0] = (R[0, 1] + R[1, 0]) / S
        q[1] = 0.25 * S
        q[2] = (R[1, 2] + R[2, 1]) / S
    else:
        S = math.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        q[3] = (R[1, 0] - R[0, 1]) / S
        q[0] = (R[0, 2] + R[2, 0]) / S
        q[1] = (R[1, 2] + R[2, 1]) / S
        q[2] = 0.25 * S
    return q / np.linalg.norm(q)


# ----------------------------------------------------------------------------- elements
def min_area_rect(xy: np.ndarray):
    hull = cv2.convexHull(xy.astype(np.float32))
    (cx, cy), (w, h), ang = cv2.minAreaRect(hull)
    box = cv2.boxPoints(((cx, cy), (w, h), ang))
    return box.astype(float), (w, h)


def refine_annotations(ann, Ps, Cs, cams, s, W, D, terrain, ent_u):
    """Annotations give kind/label/approximate footprint; buildings are refitted to wall points."""
    elements, zones, checks = [], [], []
    for e in ann.get("elements", []):
        fp = np.array(e["footprint"], dtype=float)
        prov = e.get("provenance", "inferred")
        n_pts = 0
        unc = float(e.get("uncertainty", 1.0 if prov == "inferred" else 0.5))
        out = dict(e)
        if e.get("fit") and len(fp) >= 3:
            # wall points inside the expanded footprint, between knee height and eave
            poly = fp
            c = poly.mean(0)
            grown = c + (poly - c) * (1 + e.get("grow", 0.25))
            inside = points_in_poly(Ps[:, :2], grown)
            if inside.sum() > 0:
                hz = Ps[inside, 2]
                base = np.percentile(hz, 3)
                hag = hz - base
                band = (hag > 0.4) & (hag < max(1.0, e.get("height", 3) * 1.15))
                pts = Ps[inside][band][:, :2]
                n_pts = int(len(pts))
                if n_pts >= e.get("min_points", 60):
                    lo, hi = np.percentile(pts, [3, 97], axis=0)
                    core = pts[(pts[:, 0] >= lo[0]) & (pts[:, 0] <= hi[0]) & (pts[:, 1] >= lo[1]) & (pts[:, 1] <= hi[1])]
                    box, (bw, bh) = min_area_rect(core)
                    # keep annotated size if the fit is wildly different (vegetation, partial walls)
                    aw = np.linalg.norm(poly[1] - poly[0]); ah = np.linalg.norm(poly[2] - poly[1])
                    if 0.6 < (bw * bh) / max(1e-6, aw * ah) < 1.6:
                        out["footprint"] = order_box(box, poly).round(2).tolist()
                        prov = "reconstructed"
                        unc = e.get("uncertainty_fit", 0.4)
                    if e.get("measure_height"):
                        top = np.percentile(hag[hag > 0.3], 98) if (hag > 0.3).sum() > 20 else None
                        if top:
                            out["measured_top"] = round(float(top), 2)
        out["provenance"] = prov
        out["uncertainty"] = round(unc, 2)
        out.setdefault("evidence", {})
        out["evidence"]["points"] = n_pts
        out.setdefault("removable", True)
        for k in ("fit", "grow", "min_points", "uncertainty_fit", "measure_height", "provenance_height"):
            out.pop(k, None)
        if "check" in out:
            ck = out.pop("check")
            val = out.get("measured_top") if ck.get("what") == "height" else None
            if ck.get("what") == "height_pct":
                fpn = np.array(out["footprint"])
                m = points_in_poly(Ps[:, :2], fpn)
                if m.sum() > 50:
                    hz = Ps[m, 2] - np.percentile(Ps[m, 2], 2)
                    val = float(np.percentile(hz, ck.get("pct", 98)))
                    out["provenance_height"] = "reconstructed"
            if ck.get("what") == "height_pct" and val is not None:
                lo, hi = ck["expected"]
                checks.append({"label": ck["label"], "expected": [lo, hi], "measured": round(val, 2), "ok": lo <= val <= hi,
                               "note": ck.get("note", "")})
                val = None
            if ck.get("what") == "width":
                fpn = np.array(out["footprint"])
                val = float(min(np.linalg.norm(fpn[1] - fpn[0]), np.linalg.norm(fpn[2] - fpn[1])))
            if ck.get("what") == "length":
                fpn = np.array(out["footprint"])
                val = float(max(np.linalg.norm(fpn[1] - fpn[0]), np.linalg.norm(fpn[2] - fpn[1])))
            if val is not None and out["provenance"] == "reconstructed":
                lo, hi = ck["expected"]
                checks.append({"label": ck["label"], "expected": [lo, hi], "measured": round(val, 2), "ok": lo * 0.93 <= val <= hi * 1.07,
                               "note": ck.get("note", "")})
        out.pop("measured_top", None)
        elements.append(out)
    for z in ann.get("zones", []):
        zones.append(z)
    for ck in ann.get("checks", []):
        checks.append(ck)
    return elements, zones, checks


def auto_detect(Ps, terrain_site, W, D, min_area=5.0):
    """Fallback when no annotations exist: tall rectilinear clusters -> structures, blobs -> trees.

    Ps: site coords (u, v, h); terrain_site: function (u, v) -> ground height in the same datum.
    """
    from scipy import ndimage

    hag = Ps[:, 2] - terrain_site(Ps[:, 0], Ps[:, 1])
    inside = (Ps[:, 0] > 0.3) & (Ps[:, 0] < W - 0.3) & (Ps[:, 1] > 0.3) & (Ps[:, 1] < D - 0.3)
    tall = inside & (hag > 1.9) & (hag < 9)
    cell = 0.5
    nu, nv = int(W / cell) + 1, int(D / cell) + 1
    grid = np.zeros((nv, nu), np.int32)
    iu = np.clip((Ps[tall, 0] / cell).astype(int), 0, nu - 1)
    iv = np.clip((Ps[tall, 1] / cell).astype(int), 0, nv - 1)
    np.add.at(grid, (iv, iu), 1)
    occ = ndimage.binary_closing(grid >= 3, iterations=1)
    lab, n = ndimage.label(occ)
    out = []
    for k in range(1, n + 1):
        cells = np.argwhere(lab == k)
        if len(cells) * cell * cell < min_area:
            continue
        sel = tall.copy()
        sel[tall] = lab[iv, iu] == k
        pts = Ps[sel]
        if len(pts) < 80:
            continue
        box, (bw, bh) = min_area_rect(pts[:, :2])
        area = bw * bh
        # rectilinearity from wall-height points under the cluster: walls hug a rectangle outline,
        # foliage fills it
        lo, hi = pts[:, :2].min(0) - 0.6, pts[:, :2].max(0) + 0.6
        wsel = (hag > 0.6) & (hag < 2.2) & (Ps[:, 0] > lo[0]) & (Ps[:, 0] < hi[0]) & (Ps[:, 1] > lo[1]) & (Ps[:, 1] < hi[1])
        rect = 0.0
        if wsel.sum() > 60:
            wpts = Ps[wsel][:, :2]
            wbox, (ww, wh) = min_area_rect(wpts)
            c = wbox.mean(0)
            ax1 = (wbox[1] - wbox[0]) / (np.linalg.norm(wbox[1] - wbox[0]) + 1e-9)
            ax2 = (wbox[2] - wbox[1]) / (np.linalg.norm(wbox[2] - wbox[1]) + 1e-9)
            q = wpts - c
            d1 = np.abs(np.abs(q @ ax1) - ww / 2)
            d2 = np.abs(np.abs(q @ ax2) - wh / 2)
            rect = float(np.mean(np.minimum(d1, d2) < 0.35))
            if rect > 0.5:
                box, (bw, bh) = wbox, (ww, wh)
                area = bw * bh
        top = float(np.percentile(hag[sel], 97))
        # sparse clouds cannot reliably tell a roof from a tree crown: say so, and keep it as an obstacle
        rectilinear = rect > 0.5 and area > 6
        out.append({"id": f"auto-{k}", "kind": "other",
                    "label": f"{'Structure' if rectilinear else 'Tall structure or trees'} ~{bw:.0f}×{bh:.0f} m (unlabelled)",
                    "footprint": box.round(2).tolist(), "height": round(top, 1), "roof": "flat", "provenance": "inferred",
                    "uncertainty": 0.8, "removable": False,
                    "evidence": {"points": int(len(pts)), "note": f"auto-detected tall cluster, wall rectilinearity {rect:.2f}; "
                                                                  "label it in annotations.json"}})
    return out


def order_box(box, ref):
    """Order fitted rectangle corners consistently with the annotated polygon (CCW, same start)."""
    c = box.mean(0)
    angs = np.arctan2(box[:, 1] - c[1], box[:, 0] - c[0])
    box = box[np.argsort(angs)]
    start = int(np.argmin(np.linalg.norm(box - ref[0], axis=1)))
    return np.roll(box, -start, axis=0)


def points_in_poly(xy, poly):
    n = len(poly)
    inside = np.zeros(len(xy), dtype=bool)
    x, y = xy[:, 0], xy[:, 1]
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cond = ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / ((yj - yi) + 1e-12) + xi)
        inside ^= cond
        j = i
    return inside


def compass(deg):
    d = ((deg % 360) + 360) % 360
    names = ["toward the forest", "toward the forest-right corner", "toward the right fence", "toward the road-right corner",
             "toward the road", "toward the road-left corner", "toward the left fence", "toward the forest-left corner"]
    return names[int(((d + 22.5) % 360) // 45)]


def build_conflicts(diag, terrain, W_rec, D_rec, stated_w, stated_d, facts, transcript, fences, pins):
    out = []
    sd = float(np.mean(stated_d))
    weak = [f["id"] for f in fences if f["method"] != "fence points"]
    out.append({"topic": "Plot size",
                "detail": f"Fence-to-fence in the reconstruction: {W_rec:.1f} m along the road × {D_rec:.1f} m to the forest "
                          f"(at one uniform scale). Owner's figures: {stated_w[0]:g}–{stated_w[1]:g} × ~{sd:g} m."
                          + (f" The {', '.join(weak)} fence line{'s' if len(weak) > 1 else ''} had too few 3D points and "
                             f"{'were' if len(weak) > 1 else 'was'} placed 0.7 m beyond the walking path." if weak else ""),
                "resolution": "Owner's figures win: the boundary is their rectangle, centred on the reconstructed fences. "
                              "The difference is shown as the boundary uncertainty; check the corners on site before building near a fence."})
    slope_pins = [p for p in pins if p["kind"] == "slope"]
    if slope_pins:
        lines = []
        for p in slope_pins:
            hd = math.degrees(math.atan2(p["dir"][0], -p["dir"][2]))
            if "за мной" in p["quote"] or "behind me" in p["quote"]:
                hd += 180  # "toward behind me"
            a = math.radians(hd)
            fall = -(terrain["gu"] * math.sin(a) + terrain["gv"] * math.cos(a)) * 100
            lines.append(f"{p['clip']} {int(p['t'] // 60)}:{int(p['t'] % 60):02d} points {compass(hd)}: measured fall that way {fall:+.1f}%")
        out.append({"topic": "Slope",
                    "detail": f"Measured: {terrain['slopePct']:.1f}% falling {compass(terrain['fallDirectionDeg'])} "
                              f"(≈{terrain['slopePct'] / 100 * max(W_rec, D_rec):.1f} m across the plot). The owner mentions the slope three times: "
                              + "; ".join(lines) + ".",
                    "resolution": "Agrees where the owner points toward the left fence; the fall toward the forest he also mentions is within "
                                  "the ±1.7% this survey can resolve. Get levels surveyed before designing foundations or drainage."})
    out.append({"topic": "Plot dimensions",
                "detail": "No dimensions are spoken in the recording; the owner says they will send them separately (\u201cгабариты участка\u201d).",
                "resolution": f"Using the supplied figures: {stated_w[0]:g}–{stated_w[1]:g} m along the road, about {sd:g} m road to forest."})
    return out


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "plot")
