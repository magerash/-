"""Mera API + static host.

  GET  /api/projects                       list surveys
  POST /api/projects                       create a survey {name}
  POST /api/projects/{pid}/upload          add video / voice files (multipart)
  POST /api/projects/{pid}/run             run the reconstruction pipeline in the background
  GET  /api/projects/{pid}/job             live pipeline progress
  GET  /api/projects/{pid}/site            site model (meters)
  GET  /api/projects/{pid}/transcript      narration transcript
  GET  /api/projects/{pid}/frames          keyframe manifest
  GET  /api/projects/{pid}/facts           extracted spoken facts
  GET/PUT /api/projects/{pid}/variants     saved planning variants
  GET  /api/projects/{pid}/files/{path}    frames, thumbnails, point cloud
Everything else serves the built web app (web/dist).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
PROJECTS = ROOT / "data" / "projects"
DIST = ROOT / "web" / "dist"
PIPELINE = ROOT / "pipeline" / "run.py"
ALLOWED = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm", ".wav", ".m4a", ".mp3", ".ogg", ".opus", ".flac", ".aac"}
PID_RX = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")

app = FastAPI(title="Mera")
_running: dict[str, subprocess.Popen] = {}


def pdir(pid: str) -> Path:
    if not PID_RX.match(pid):
        raise HTTPException(400, "bad project id")
    d = PROJECTS / pid
    if not d.exists():
        raise HTTPException(404, "no such project")
    return d


def jread(path: Path):
    if not path.exists():
        raise HTTPException(404, f"{path.name} not available yet")
    return JSONResponse(json.loads(path.read_text()))


@app.get("/api/projects")
def list_projects():
    out = []
    if PROJECTS.exists():
        for d in sorted(PROJECTS.iterdir()):
            if not d.is_dir():
                continue
            meta = json.loads((d / "project.json").read_text()) if (d / "project.json").exists() else {}
            inputs = [p.name for p in (d / "inputs").iterdir()] if (d / "inputs").exists() else []
            job = json.loads((d / "job.json").read_text()) if (d / "job.json").exists() else None
            out.append({"id": d.name, "name": meta.get("name", d.name), "inputs": inputs,
                        "hasSite": (d / "site.json").exists(), "job": job,
                        "running": d.name in _running and _running[d.name].poll() is None})
    return out


@app.post("/api/projects")
async def create_project(req: Request):
    body = await req.json()
    name = str(body.get("name") or "My plot")[:80]
    plot = {}
    try:  # owner's plot dimensions: the scale anchor for the reconstruction
        w = [float(x) for x in body.get("width", [])][:2]
        d = [float(x) for x in body.get("depth", [])][:2]
        if len(w) == 2 and len(d) == 2 and all(5 <= x <= 1000 for x in w + d):
            plot = {"width": sorted(w), "depth": sorted(d)}
    except (TypeError, ValueError):
        raise HTTPException(400, "width/depth must be [min, max] in meters")
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:30] or "plot"
    pid, k = slug, 2
    while (PROJECTS / pid).exists():
        pid, k = f"{slug}-{k}", k + 1
    (PROJECTS / pid / "inputs").mkdir(parents=True)
    meta = {"name": name, "created": time.time()}
    if plot:
        meta["plot"] = plot
    (PROJECTS / pid / "project.json").write_text(json.dumps(meta))
    return {"id": pid, "name": name}


@app.post("/api/projects/{pid}/upload")
async def upload(pid: str, files: list[UploadFile]):
    d = pdir(pid) / "inputs"
    saved = []
    for f in files:
        name = Path(f.filename or "file").name
        if Path(name).suffix.lower() not in ALLOWED:
            raise HTTPException(400, f"unsupported file type: {name}")
        with open(d / name, "wb") as out:
            while chunk := await f.read(1 << 20):
                out.write(chunk)
        saved.append(name)
    return {"saved": saved}


@app.post("/api/projects/{pid}/run")
def run(pid: str):
    d = pdir(pid)
    if pid in _running and _running[pid].poll() is None:
        return {"status": "already running"}
    if not any((d / "inputs").iterdir()):
        raise HTTPException(400, "upload a video first")
    log = open(d / "pipeline.log", "w")
    _running[pid] = subprocess.Popen([sys.executable, str(PIPELINE), pid], stdout=log, stderr=subprocess.STDOUT,
                                     cwd=str(PIPELINE.parent))
    return {"status": "started"}


@app.get("/api/projects/{pid}/job")
def job(pid: str):
    d = pdir(pid)
    state = json.loads((d / "job.json").read_text()) if (d / "job.json").exists() else {"stages": {}}
    p = _running.get(pid)
    state["running"] = bool(p and p.poll() is None)
    if p and p.poll() not in (None, 0):
        tail = (d / "pipeline.log").read_text().splitlines()[-12:] if (d / "pipeline.log").exists() else []
        state["error"] = "\n".join(tail)
    return state


@app.get("/api/projects/{pid}/site")
def site(pid: str):
    return jread(pdir(pid) / "site.json")


@app.get("/api/projects/{pid}/transcript")
def transcript(pid: str):
    return jread(pdir(pid) / "transcript.json")


@app.get("/api/projects/{pid}/frames")
def frames(pid: str):
    return jread(pdir(pid) / "frames.json")


@app.get("/api/projects/{pid}/facts")
def facts(pid: str):
    return jread(pdir(pid) / "facts.json")


@app.get("/api/projects/{pid}/variants")
def get_variants(pid: str):
    p = pdir(pid) / "variants.json"
    return JSONResponse(json.loads(p.read_text()) if p.exists() else {"variants": []})


@app.put("/api/projects/{pid}/variants")
async def put_variants(pid: str, req: Request):
    body = await req.json()
    if not isinstance(body, dict) or not isinstance(body.get("variants"), list):
        raise HTTPException(400, "expected {variants: [...]}")
    p = pdir(pid) / "variants.json"
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(body, ensure_ascii=False))
    tmp.replace(p)
    return {"ok": True, "count": len(body["variants"])}


@app.get("/api/projects/{pid}/files/{path:path}")
def files(pid: str, path: str):
    base = pdir(pid).resolve()
    target = (base / path).resolve()
    if base not in target.parents or not target.is_file():
        raise HTTPException(404)
    if target.parts[len(base.parts)] not in {"frames", "thumbs", "site"}:
        raise HTTPException(403)
    return FileResponse(target, headers={"Cache-Control": "public, max-age=3600"})


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{rest:path}")
    def spa(rest: str):
        f = (DIST / rest).resolve()
        if rest and DIST.resolve() in f.parents and f.is_file():
            return FileResponse(f)
        return FileResponse(DIST / "index.html")
