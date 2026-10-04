"""Structure-from-motion on the selected keyframes (COLMAP via pycolmap, CPU).

  * one shared RADIAL camera per clip (same phone lens per clip); the owner says the footage was
    shot on the 0.6x ultra-wide lens, so the focal prior is ~96 deg horizontal FOV instead of
    COLMAP's 45 deg default
  * pairs = sequential neighbours inside each clip + vocabulary-tree retrieval across all clips,
    which is what stitches the separate walks into one model
  * incremental mapping on every 2nd keyframe (GLOMAP global mapping is available but folded
    this footage; see map_only)
Output: <project>/work/sfm/{database.db, models/<k>/}
"""
from __future__ import annotations

import math
import shutil
import sys
import time

import pycolmap

from common import MODELS, Progress, project_dir, read_json

ULTRAWIDE_HFOV_DEG = 96.0


def map_only(pid: str, mapper: str = "incremental", stride: int = 2, out_name: str | None = None) -> None:
    """Re-run only the mapping step on the existing database (features + matches kept)."""
    prog = Progress(pid)
    work = project_dir(pid) / "work" / "sfm"
    db = work / "database.db"
    database = pycolmap.Database.open(db)
    names = sorted(img.name for img in database.read_all_images())
    database.close()
    # every `stride`-th keyframe per clip: plenty of overlap at ~1.4 frames/s, half the mapping cost
    by_clip: dict[str, list[str]] = {}
    for n in names:
        by_clip.setdefault(n.split("/")[0], []).append(n)
    subset = [n for lst in by_clip.values() for n in lst[::stride]]
    out = work / (out_name or "models")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    t0 = time.time()
    prog.update("reconstruct", "running", f"incremental mapping of {len(subset)} keyframes", 0.6)
    opts = pycolmap.IncrementalPipelineOptions()
    opts.image_names = subset
    opts.ba_refine_principal_point = False
    opts.multiple_models = True
    opts.extract_colors = True
    # Phone ultra-wide video with electronic stabilisation: per-frame crop/warp means slightly
    # inconsistent intrinsics and low inlier ratios on grass/foliage. Loosen registration and
    # filtering so the walk is not split into many small models.
    m = opts.mapper
    m.abs_pose_min_num_inliers = 15
    m.abs_pose_min_inlier_ratio = 0.12
    m.abs_pose_max_error = 16.0
    m.filter_max_reproj_error = 8.0
    m.init_min_num_inliers = 60
    m.init_min_tri_angle = 8.0
    m.max_reg_trials = 6
    opts.min_num_matches = 12
    recs = pycolmap.incremental_mapping(db, work / "images", out, opts)
    summary = sorted(((k, r.num_reg_images(), r.num_points3D()) for k, r in recs.items()), key=lambda s: -s[1])
    for k, n, p in summary:
        print("model", k, n, p, flush=True)
    prog.update("reconstruct", "done",
                f"SfM: {len(summary)} model(s); largest {summary[0][1]}/{len(subset)} frames, {summary[0][2]} points "
                f"({time.time() - t0:.0f}s)" if summary else "SfM produced no model", 1.0)


def main(pid: str, mapper: str = "incremental") -> None:
    prog = Progress(pid)
    pdir = project_dir(pid)
    frames = read_json(pdir / "frames.json")
    work = pdir / "work" / "sfm"
    imgdir = work / "images"
    if imgdir.exists():
        shutil.rmtree(imgdir)
    imgdir.mkdir(parents=True)
    names = []
    for f in frames["frames"]:
        d = imgdir / f["clip"]
        d.mkdir(exist_ok=True)
        (d / f"{f['id']}.jpg").symlink_to(pdir / "frames" / f"{f['id']}.jpg")
        names.append(f"{f['clip']}/{f['id']}.jpg")
    clip = frames["clips"][0]
    w, h = clip["width"], clip["height"]
    focal = (w / 2) / math.tan(math.radians(ULTRAWIDE_HFOV_DEG / 2))
    db = work / "database.db"
    if db.exists():
        db.unlink()

    t0 = time.time()
    prog.update("reconstruct", "running", f"SIFT features on {len(names)} keyframes", 0.02)
    reader = pycolmap.ImageReaderOptions()
    reader.camera_model = "RADIAL"
    reader.camera_params = f"{focal:.1f},{w / 2},{h / 2},0,0"
    ext = pycolmap.FeatureExtractionOptions()
    ext.sift.max_num_features = 6000
    pycolmap.extract_features(db, imgdir, image_names=names, camera_mode=pycolmap.CameraMode.PER_FOLDER,
                              reader_options=reader, extraction_options=ext)
    # mark the focal length as a trusted prior so BA starts from the ultra-wide geometry
    database = pycolmap.Database.open(db)
    for cam in database.read_all_cameras():
        cam.has_prior_focal_length = True
        database.update_camera(cam)
    database.close()

    prog.update("reconstruct", "running", f"sequential matching ({time.time() - t0:.0f}s)", 0.15)
    seq = pycolmap.SequentialPairingOptions()
    seq.overlap = 12
    seq.quadratic_overlap = True
    pycolmap.match_sequential(db, pairing_options=seq)

    vt = MODELS / "vocab_tree_faiss_flickr100K_words32K.bin"
    if vt.exists():
        prog.update("reconstruct", "running", f"cross-clip retrieval matching ({time.time() - t0:.0f}s)", 0.35)
        vto = pycolmap.VocabTreePairingOptions()
        vto.vocab_tree_path = vt
        vto.num_images = 40
        pycolmap.match_vocabtree(db, pairing_options=vto)

    if mapper == "incremental":
        # GLOMAP (global) folded this kind of forward-walking footage into a "tent" with stray
        # cameras; incremental mapping on every 2nd keyframe is slower but reliable.
        map_only(pid, "incremental", 2)
        return
    out = work / "models"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir()
    prog.update("reconstruct", "running", f"{mapper} mapping ({time.time() - t0:.0f}s)", 0.55)
    if mapper == "global":
        opts = pycolmap.GlobalPipelineOptions()
        recs = pycolmap.global_mapping(db, imgdir, out, opts)
    else:
        opts = pycolmap.IncrementalPipelineOptions()
        opts.ba_refine_principal_point = False
        recs = pycolmap.incremental_mapping(db, imgdir, out, opts)
    summary = []
    for k, r in recs.items():
        summary.append((k, r.num_reg_images(), r.num_points3D()))
        print(k, r.summary(), flush=True)
    summary.sort(key=lambda s: -s[1])
    prog.update("reconstruct", "running",
                f"SfM: {len(summary)} model(s); largest {summary[0][1]}/{len(names)} frames, "
                f"{summary[0][2]} points ({time.time() - t0:.0f}s)" if summary else "SfM produced no model", 0.8)


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--map-only" in a:
        map_only(a[0], "incremental", int(a[a.index("--stride") + 1]) if "--stride" in a else 2,
                 a[a.index("--out") + 1] if "--out" in a else None)
    else:
        main(a[0] if a else "plot", a[1] if len(a) > 1 else "incremental")
