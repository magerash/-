"""Run the whole pipeline for one project:
ingest -> transcribe -> facts -> SfM -> site (reconstruction frame) -> layout -> texture -> model.

Usage: python pipeline/run.py <project-id> [--from STAGE]
Stages are idempotent; --from lets you redo the later ones (e.g. after editing layout.json:
`python pipeline/run.py plot --from layout`).
"""
from __future__ import annotations

import sys
import time
import traceback

import build_site
import layout
import model
import texture
import facts
import ingest
import merge_models
import sfm
import transcribe
from common import Progress, inputs

STAGES = ["ingest", "transcribe", "facts", "reconstruct", "site", "layout", "texture", "model"]


def main() -> None:
    args = sys.argv[1:]
    pid = args[0] if args else "plot"
    start = args[args.index("--from") + 1] if "--from" in args else "ingest"
    todo = STAGES[STAGES.index(start):]
    prog = Progress(pid)
    videos, voices = inputs(pid)
    if not videos:
        prog.update("ingest", "error", "no video in inputs/")
        raise SystemExit(1)
    t0 = time.time()
    for st in todo:
        try:
            prog.update(st, "running", "starting", 0.0)
            if st == "ingest":
                ingest.main(pid)
            elif st == "transcribe":
                transcribe.main(pid)
            elif st == "facts":
                facts.main(pid)
            elif st == "reconstruct":
                sfm.main(pid)  # features, matching, incremental mapping (may yield several sub-models)
                merge_models.main(pid, "models")  # bring sub-models into one frame
            elif st == "site":
                build_site.main(pid)  # reconstruction frame -> site_recon.json
            elif st == "layout":
                layout.main(pid)  # verified layout mapped onto the stated plot -> site.json
            elif st == "texture":
                texture.main(pid, "all")  # photo textures from the frames
            elif st == "model":
                model.main(pid)  # textured glTF
        except SystemExit:
            raise
        except Exception as e:  # keep the UI informed instead of dying silently
            prog.update(st, "error", f"{type(e).__name__}: {e}")
            traceback.print_exc()
            raise SystemExit(1)
    print(f"pipeline finished in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
