"""Shared helpers for the Mera pipeline: paths, progress reporting, ffmpeg wrappers."""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
PROJECTS = ROOT / "data" / "projects"

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm"}
AUDIO_EXT = {".wav", ".m4a", ".mp3", ".ogg", ".opus", ".flac", ".aac"}


def project_dir(pid: str) -> Path:
    return PROJECTS / pid


def inputs(pid: str) -> tuple[list[Path], list[Path]]:
    """Return (videos, voice recordings) sorted by name, i.e. by capture time for phone files."""
    d = project_dir(pid) / "inputs"
    files = sorted(p for p in d.iterdir() if p.is_file())
    return [p for p in files if p.suffix.lower() in VIDEO_EXT], [p for p in files if p.suffix.lower() in AUDIO_EXT]


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1))
    os.replace(tmp, path)


def read_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text())


class Progress:
    """Writes pipeline progress to <project>/job.json so the UI can show it live."""

    STAGES = ["ingest", "transcribe", "facts", "reconstruct", "site"]

    def __init__(self, pid: str):
        self.path = project_dir(pid) / "job.json"
        self.state = read_json(self.path) or {"stages": {}}

    def update(self, stage: str, status: str, message: str = "", fraction: float | None = None) -> None:
        # several modules report into the same file: merge with what is on disk
        self.state = read_json(self.path) or self.state
        self.state.setdefault("stages", {})
        s = self.state["stages"].setdefault(stage, {})
        s.update(status=status, message=message, updated=time.time())
        if fraction is not None:
            s["fraction"] = round(fraction, 3)
        self.state["current"] = stage
        write_json(self.path, self.state)
        print(f"[{stage}] {status} {message}", flush=True)


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def extract_audio(src: Path, dst: Path, rate: int = 16000) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "1", "-ar", str(rate), "-f", "wav", str(dst)],
        check=True,
    )
    return dst
