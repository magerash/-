"""Merge incremental SfM sub-models into one coordinate frame.

Phone video with electronic stabilisation often makes the incremental mapper stop and restart,
leaving several locally good sub-models. They see the same scene, so feature matches between an
image of model A and an image of model B link A's 3D points to B's. From those 3D-3D
correspondences we estimate a similarity transform per pair (RANSAC + Umeyama), keep the
strongest links (maximum spanning tree from the largest model) and bring every model into the
reference frame. Output: work/sfm/merged.npz with cameras and points, plus a report.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict

import numpy as np
import pycolmap

from common import Progress, project_dir


def umeyama(src, dst):
    mu_s, mu_d = src.mean(0), dst.mean(0)
    xs, xd = src - mu_s, dst - mu_d
    cov = xd.T @ xs / len(src)
    U, S, Vt = np.linalg.svd(cov)
    D = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        D[2, 2] = -1
    R = U @ D @ Vt
    var = (xs**2).sum() / len(src)
    s = np.trace(np.diag(S) @ D) / var
    t = mu_d - s * R @ mu_s
    return s, R, t


def ransac_sim3(A, B, thr, iters=3000, rng=None):
    rng = rng or np.random.default_rng(0)
    best = None
    n = len(A)
    for _ in range(iters):
        idx = rng.choice(n, 3, replace=False)
        try:
            s, R, t = umeyama(A[idx], B[idx])
        except np.linalg.LinAlgError:
            continue
        if not np.isfinite(s) or s <= 0:
            continue
        r = np.linalg.norm((s * (R @ A.T)).T + t - B, axis=1)
        inl = r < thr
        if best is None or inl.sum() > best[0].sum():
            best = (inl, s, R, t)
    if best is None or best[0].sum() < 12:
        return None
    inl = best[0]
    s, R, t = umeyama(A[inl], B[inl])
    r = np.linalg.norm((s * (R @ A.T)).T + t - B, axis=1)
    inl = r < thr
    return {"s": s, "R": R, "t": t, "inliers": int(inl.sum()), "ratio": float(inl.mean()), "rmse": float(np.sqrt((r[inl] ** 2).mean()))}


def model_extent(rec):
    C = np.array([img.projection_center() for img in rec.images.values() if img.has_pose])
    return float(np.linalg.norm(np.percentile(C, 90, axis=0) - np.percentile(C, 10, axis=0))) + 1e-9


def main(pid: str, models_dir: str = "models", min_images: int = 8) -> None:
    prog = Progress(pid)
    work = project_dir(pid) / "work" / "sfm"
    base = work / models_dir
    recs = {}
    for d in sorted(base.iterdir()):
        if d.is_dir():
            r = pycolmap.Reconstruction(str(d))
            if r.num_reg_images() >= min_images:
                recs[int(d.name)] = r
    prog.update("reconstruct", "running", f"merging {len(recs)} sub-models", 0.92)
    # image id -> list of (model, {point2D idx: point3D id})
    obs = defaultdict(list)
    for k, r in recs.items():
        for img in r.images.values():
            if not img.has_pose:
                continue
            m = {}
            for i, p2 in enumerate(img.points2D):
                if p2.has_point3D():
                    m[i] = p2.point3D_id
            obs[img.image_id].append((k, m))
    db = pycolmap.Database.open(work / "database.db")
    pair_ids, geoms = db.read_two_view_geometries()
    db.close()
    corr = defaultdict(lambda: ([], []))  # (a, b) -> (pts in a, pts in b)

    def add(ka, ma, kb, mb, matches):
        if ka == kb:
            return
        A, B = corr[(ka, kb)]
        ra, rb = recs[ka], recs[kb]
        for fa, fb in matches:
            pa, pb = ma.get(int(fa)), mb.get(int(fb))
            if pa is not None and pb is not None:
                A.append(ra.points3D[pa].xyz)
                B.append(rb.points3D[pb].xyz)

    for pidx, g in zip(pair_ids, geoms):
        i1, i2 = pycolmap.pair_id_to_image_pair(pidx)
        m = g.inlier_matches
        if m is None or len(m) == 0 or i1 not in obs or i2 not in obs:
            continue
        for ka, ma in obs[i1]:
            for kb, mb in obs[i2]:
                add(ka, ma, kb, mb, m)
                add(kb, mb, ka, ma, m[:, ::-1])
    # images registered in two models: the same feature observed in both
    for iid, lst in obs.items():
        for ka, ma in lst:
            for kb, mb in lst:
                if ka != kb:
                    same = np.array([(f, f) for f in ma if f in mb])
                    if len(same):
                        add(ka, ma, kb, mb, same)

    links = {}
    ext = {k: model_extent(r) for k, r in recs.items()}
    for (a, b), (A, B) in corr.items():
        if a > b or len(A) < 40:
            continue
        A, B = np.array(A), np.array(B)
        res = ransac_sim3(A, B, thr=0.015 * ext[b])
        # weak links mis-place whole sub-models; require broad support (shared images give thousands)
        if res and res["inliers"] >= 200 and res["ratio"] > 0.3:
            links[(a, b)] = res
    # maximum spanning tree from the largest model
    ref = max(recs, key=lambda k: recs[k].num_reg_images())
    T = {ref: (1.0, np.eye(3), np.zeros(3))}  # model -> sim3 into ref frame
    report = {"reference": ref, "models": {k: recs[k].num_reg_images() for k in recs}, "links": [], "unmerged": []}
    while True:
        best = None
        for (a, b), res in links.items():
            for src, dst, inv in ((a, b, False), (b, a, True)):
                if dst in T and src not in T:
                    if best is None or res["inliers"] > best[3]["inliers"]:
                        best = (src, dst, inv, res)
        if best is None:
            break
        src, dst, inv, res = best
        s, R, t = res["s"], res["R"], res["t"]
        if inv:  # we have a->b, need b->a
            s, R, t = 1 / s, R.T, -(R.T @ t) / s
        s2, R2, t2 = T[dst]
        T[src] = (s2 * s, R2 @ R, s2 * (R2 @ t) + t2)
        report["links"].append({"model": src, "via": dst, "inliers": res["inliers"], "ratio": round(res["ratio"], 2),
                                "rmse_rel": round(res["rmse"] / ext[dst if not inv else src], 4)})
    report["unmerged"] = [k for k in recs if k not in T]
    # assemble cameras and points in the reference frame
    cams, pts, cols, errs, srcm = [], [], [], [], []
    seen = set()
    order = sorted(T, key=lambda k: -recs[k].num_reg_images())
    for k in order:
        s, R, t = T[k]
        r = recs[k]
        for img in r.images.values():
            if not img.has_pose or img.name in seen:
                continue
            seen.add(img.name)
            cfw = img.cam_from_world()
            Rc = cfw.rotation.matrix()
            C = img.projection_center()
            cam = r.cameras[img.camera_id]
            cams.append({"name": img.name, "C": (s * R @ C + t).tolist(), "R": (Rc @ R.T).tolist(),
                         "w": cam.width, "h": cam.height, "params": list(map(float, cam.params)), "model": cam.model.name, "src": k})
        for p in r.points3D.values():
            if p.track.length() < 3 or p.error > 2.5:
                continue
            pts.append(s * R @ p.xyz + t)
            cols.append(p.color)
            errs.append(p.error)
            srcm.append(k)
    out = work / "merged.npz"
    np.savez_compressed(out, pts=np.array(pts), rgb=np.array(cols, dtype=np.uint8), err=np.array(errs), src=np.array(srcm),
                        cams=json.dumps(cams))
    report["cameras"] = len(cams)
    report["points"] = len(pts)
    (work / "merge_report.json").write_text(json.dumps(report, indent=1))
    prog.update("reconstruct", "done", f"{len(cams)} frames in one frame from {len(T)} of {len(recs)} sub-models, {len(pts)} points", 1.0)
    print(json.dumps({k: v for k, v in report.items() if k != "links"}, indent=1))
    for lk in report["links"]:
        print(lk)


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0] if a else "plot", a[1] if len(a) > 1 else "models")
