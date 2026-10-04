# Mera - plot survey and planning. See README.md.
PID ?= plot
PORT ?= 8765
PY ?= python3

setup:            ## install Python + web deps and download offline models (~1.6 GB)
	$(PY) -m pip install -r requirements.txt
	cd web && npm ci
	./pipeline/fetch_models.sh

pipeline:         ## run the full reconstruction for data/projects/$(PID)/inputs
	cd pipeline && $(PY) run.py $(PID)

site:             ## rebuild only the site model (after editing annotations.json)
	cd pipeline && $(PY) run.py $(PID) --from site

build:            ## build the web app into web/dist
	cd web && npm run build

run: build        ## serve the app + API on http://127.0.0.1:$(PORT)
	$(PY) -m uvicorn server.app:app --host 127.0.0.1 --port $(PORT)

dev:              ## API on :$(PORT) and Vite dev server on :5173 (proxying /api)
	($(PY) -m uvicorn server.app:app --host 127.0.0.1 --port $(PORT) &) ; cd web && npx vite

test:             ## unit tests + browser journeys (server must be running)
	cd web && npx vitest run && npx playwright test

verify:           ## re-import exported files in trimesh and Blender: make verify FILES="a.glb b_obj.zip"
	$(PY) pipeline/verify_export.py $(FILES) --site data/projects/$(PID)/site.json

.PHONY: setup pipeline site build run dev test verify
