"""Assemble a self-contained copy of one survey for sharing as a static page.

    python pipeline/make_share.py plot [--photos 200]

Expects the static web build in web/dist-static (`make share` builds it). Writes
data/projects/<id>/share/: index.html (page content, no document skeleton, so a host may wrap it),
the app's assets, and data/ with the site model, transcript, point cloud and a subset of the
photos. The output holds footage-derived data, so it stays in the git-ignored project folder.
"""
import argparse
import base64
import json
import re
import shutil
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parent.parent
FRAME_RX = re.compile(r"c\d+_\d{6}")


def pick_frames(site: dict, n: int) -> list[str]:
    """Every frame the model cites as evidence, then cameras evenly along the walk up to n."""
    cited = set(FRAME_RX.findall(json.dumps({k: v for k, v in site.items() if k != "cameras"})))
    cams = [c["id"] for c in site["cameras"]]
    keep = [c for c in cams if c in cited]
    rest = [c for c in cams if c not in cited]
    want = max(0, n - len(keep))
    if want and rest:
        step = len(rest) / want
        keep += [rest[int(i * step)] for i in range(min(want, len(rest)))]
    order = {c: i for i, c in enumerate(cams)}
    return sorted(set(keep), key=lambda c: order[c])


def jpeg(src: Path, dst: Path, quality: int) -> None:
    im = cv2.imread(str(src))
    if im is None:
        raise FileNotFoundError(src)
    dst.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dst), im, [cv2.IMWRITE_JPEG_QUALITY, quality])


def page_from_build(html: str, title: str) -> str:
    """Keep only the tags that load the app; the host supplies the document skeleton."""
    styles = re.findall(r'<link rel="stylesheet"[^>]*>', html)
    scripts = re.findall(r'<script type="module"[^>]*></script>', html)
    preloads = re.findall(r'<link rel="modulepreload"[^>]*>', html)
    return "\n".join([f"<title>{title}</title>", *styles, *preloads, '<div id="root"></div>', *scripts]) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pid")
    ap.add_argument("--photos", type=int, default=200)
    ap.add_argument("--quality", type=int, default=72)
    a = ap.parse_args()

    proj = ROOT / "data" / "projects" / a.pid
    build = ROOT / "web" / "dist-static"
    out = proj / "share"
    if not (build / "index.html").exists():
        raise SystemExit("web/dist-static is missing: run `make share`")
    if out.exists():
        shutil.rmtree(out)
    (out / "data" / "site").mkdir(parents=True)

    site = json.loads((proj / "site.json").read_text())
    frames = pick_frames(site, a.photos)
    keep = set(frames)
    site["cameras"] = [c for c in site["cameras"] if c["id"] in keep]
    if site.get("pointcloud"):
        # page hosts serve text and images, not raw binaries: ship the cloud as base64 text
        src = proj / site["pointcloud"]["url"]
        site["pointcloud"]["url"] = site["pointcloud"]["url"] + ".b64.txt"
        (out / "data" / site["pointcloud"]["url"]).write_text(base64.b64encode(src.read_bytes()).decode())
    (out / "data" / "site.json").write_text(json.dumps(site, ensure_ascii=False, separators=(",", ":")))

    fr = json.loads((proj / "frames.json").read_text())
    fr["frames"] = [f for f in fr["frames"] if f["id"] in keep]
    (out / "data" / "frames.json").write_text(json.dumps(fr, separators=(",", ":")))
    shutil.copy(proj / "transcript.json", out / "data" / "transcript.json")

    for f in frames:
        jpeg(proj / "frames" / f"{f}.jpg", out / "data" / "frames" / f"{f}.jpg", a.quality)
        und = proj / "site" / "undistorted" / f"{f}.jpg"
        if und.exists():
            jpeg(und, out / "data" / "site" / "undistorted" / f"{f}.jpg", a.quality)

    shutil.copytree(build / "assets", out / "assets")
    title = site.get("name", "Plot").strip()
    title = title[:1].upper() + title[1:]
    (out / "index.html").write_text(page_from_build((build / "index.html").read_text(), title))

    files = [p for p in out.rglob("*") if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    print(f"{out}: {len(files)} files, {size / 1e6:.1f} MB, {len(frames)} photos")


if __name__ == "__main__":
    main()
