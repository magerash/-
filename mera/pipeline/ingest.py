"""Keyframe extraction with sharpness- and coverage-aware selection.

Each clip is decoded at CANDIDATE_FPS. For every candidate we measure
  * sharpness  - variance of the Laplacian (motion blur / defocus kills it)
  * exposure   - mean luminance and clipped fraction
  * motion     - median Lucas-Kanade displacement against the last keyframe
A new keyframe is emitted once the camera has moved enough to give parallax (or feature
tracks are being lost); among the buffered candidates the sharpest one with sufficient
parallax wins. Standing still therefore yields no redundant frames, fast pans yield more.
Output: <project>/frames/*.jpg, <project>/thumbs/*.jpg, <project>/frames.json
"""
from __future__ import annotations

import subprocess
import sys

import cv2
import numpy as np

from common import Progress, ffprobe, inputs, project_dir, write_json

CANDIDATE_FPS = 8
FLOW_TRIGGER_PX = 56  # at 854 px width ~= 6.5% of the frame
MIN_PARALLAX_FRAC = 0.45
TRACK_LOSS = 0.55
THUMB_W = 320


def sharpness(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_32F, ksize=3).var())


def track(prev_gray, prev_pts, gray):
    if prev_pts is None or len(prev_pts) < 20:
        return 1e9, 0.0
    nxt, st, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, prev_pts, None, winSize=(21, 21), maxLevel=4)
    st = st.reshape(-1).astype(bool)
    if st.sum() < 10:
        return 1e9, 0.0
    d = np.linalg.norm((nxt - prev_pts).reshape(-1, 2)[st], axis=1)
    return float(np.median(d)), float(st.mean())


def frames_of(path, w, h):
    cmd = ["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"fps={CANDIDATE_FPS}", "-f", "rawvideo",
           "-pix_fmt", "bgr24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=w * h * 3 * 4)
    n = 0
    while True:
        buf = p.stdout.read(w * h * 3)
        if len(buf) < w * h * 3:
            break
        yield n / CANDIDATE_FPS, np.frombuffer(buf, np.uint8).reshape(h, w, 3)
        n += 1
    p.wait()


def main(pid: str) -> None:
    prog = Progress(pid)
    pdir = project_dir(pid)
    fdir, tdir = pdir / "frames", pdir / "thumbs"
    fdir.mkdir(exist_ok=True)
    tdir.mkdir(exist_ok=True)
    videos, _ = inputs(pid)
    manifest = {"candidate_fps": CANDIDATE_FPS, "clips": [], "frames": []}
    total = 0.0
    meta = []
    for v in videos:
        info = ffprobe(v)
        vs = next(s for s in info["streams"] if s["codec_type"] == "video")
        rot = 0
        for sd in vs.get("side_data_list", []):
            rot = int(sd.get("rotation", 0) or 0)
        meta.append((v, int(vs["width"]), int(vs["height"]), float(info["format"]["duration"]), rot))
        total += float(info["format"]["duration"])
    done = 0.0
    for ci, (v, w, h, dur, rot) in enumerate(meta):
        clip_id = f"c{ci + 1}"
        if abs(rot) in (90, 270):
            w, h = h, w  # ffmpeg auto-rotates on decode
        cands = []
        kf_gray = kf_pts = None
        buffer = []
        selected = []
        sharp_hist = []

        def emit(c):
            nonlocal kf_gray, kf_pts
            selected.append(c)
            kf_gray = c["gray"]
            kf_pts = cv2.goodFeaturesToTrack(kf_gray, 400, 0.01, 8)

        for t, img in frames_of(v, w, h):
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            small = cv2.resize(gray, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
            sh = sharpness(small)
            mean = float(gray.mean())
            clipped = float(((gray < 6) | (gray > 250)).mean())
            sharp_hist.append(sh)
            c = {"t": round(t, 3), "img": img, "gray": gray, "sharp": sh, "mean": mean, "clipped": clipped}
            cands.append({k: c[k] for k in ("t", "sharp", "mean", "clipped")})
            if kf_gray is None:
                if sh > 0.5 * np.median(sharp_hist[-24:]) or len(sharp_hist) > 12:
                    emit(c)
                continue
            flow, tracked = track(kf_gray, kf_pts, gray)
            c["flow"], c["tracked"] = flow, tracked
            buffer.append(c)
            if flow > FLOW_TRIGGER_PX or tracked < TRACK_LOSS:
                local_med = float(np.median(sharp_hist[-48:]))
                ok = [b for b in buffer if b["flow"] >= MIN_PARALLAX_FRAC * FLOW_TRIGGER_PX
                      and b["sharp"] >= 0.6 * local_med and 0.06 < b["mean"] / 255 < 0.94]
                pool = ok or buffer
                best = max(pool, key=lambda b: b["sharp"])
                emit(best)
                rest = buffer[buffer.index(best) + 1 :]
                buffer = []
                for b in rest:  # re-reference remaining candidates to the new keyframe
                    b["flow"], b["tracked"] = track(kf_gray, kf_pts, b["gray"])
                    buffer.append(b)
            if len(cands) % 40 == 0:
                prog.update("ingest", "running", f"{v.name}: {t:.0f}/{dur:.0f}s, {len(selected)} keyframes",
                            (done + t) / total)
        if buffer:
            best = max(buffer, key=lambda b: b["sharp"])
            if best["flow"] > MIN_PARALLAX_FRAC * FLOW_TRIGGER_PX:
                selected.append(best)
        med = float(np.median([c["sharp"] for c in cands])) if cands else 1.0
        for k, c in enumerate(selected):
            name = f"{clip_id}_{int(round(c['t'] * 1000)):06d}"
            cv2.imwrite(str(fdir / f"{name}.jpg"), c["img"], [cv2.IMWRITE_JPEG_QUALITY, 93])
            th = cv2.resize(c["img"], (THUMB_W, int(THUMB_W * h / w)), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(tdir / f"{name}.jpg"), th, [cv2.IMWRITE_JPEG_QUALITY, 80])
            manifest["frames"].append({
                "id": name, "clip": clip_id, "t": c["t"], "sharpness": round(c["sharp"] / med, 3),
                "flow_px": round(float(c.get("flow", 0.0)), 1), "exposure": round(c["mean"] / 255, 3),
            })
        manifest["clips"].append({
            "id": clip_id, "file": v.name, "width": w, "height": h, "duration": round(dur, 2),
            "candidates": len(cands), "keyframes": len(selected),
            "median_sharpness": round(med, 1),
            "rejected_blurry": int(sum(1 for c in cands if c["sharp"] < 0.6 * med)),
        })
        done += dur
        prog.update("ingest", "running", f"{v.name}: {len(selected)} keyframes from {len(cands)} candidates",
                    done / total)
    write_json(pdir / "frames.json", manifest)
    prog.update("ingest", "done", f"{len(manifest['frames'])} keyframes from {len(meta)} clips", 1.0)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "plot")
