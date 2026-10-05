# Running Mera on Windows

## Look at the model, plan variants, export (5 minutes)

1. Install **Python 3.11 or newer** from https://www.python.org/downloads/ and tick
   "Add python.exe to PATH" in the installer.
2. Unpack the archive parts (`mera-part01-app.zip`, `mera-part02-…`, …) all into the same folder
   with a short path, e.g. `C:\Projects` (right-click › Extract All… › `C:\Projects`). Every part
   contains a `mera` folder, so they merge into `C:\Projects\mera`. Part 1 alone runs the app; the
   others add the video frames, the original videos and the 3D reconstruction.
3. Double-click **`start-windows.bat`**. The first run creates `.venv` and installs three
   Python packages; then the browser opens http://127.0.0.1:8765.
   Close the black window to stop the app.

The web app is already built (`web\dist`), so Node.js is not needed for this.

The same by hand, in PowerShell:

```powershell
cd C:\Projects\mera
py -3 -m venv .venv
.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install fastapi uvicorn python-multipart
python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
```

## Change the web app

Install **Node.js 20 LTS** (https://nodejs.org/), then:

```powershell
cd web
npm ci
npm run dev          # http://localhost:5173, live reload; keep the server above running for /api
npm run build        # rebuild web\dist for start-windows.bat
npx vitest run       # unit tests
```

Browser journeys: `npx playwright install chromium`, start the server, then `npx playwright test`.

## Rebuild textures and the model after editing the layout

`data\projects\plot\layout.json` holds every placement. After editing it:

```powershell
pip install -r requirements.txt
cd pipeline
python run.py plot --from layout     # placements, textures, model (~2 min)
```

## Run the whole pipeline from videos (use WSL)

Reconstruction needs COLMAP, ffmpeg, speech models and bash scripts, so run it in WSL 2:

```powershell
wsl --install -d Ubuntu      # once, then restart Windows and open "Ubuntu"
```

In Ubuntu:

```bash
sudo apt update && sudo apt install -y python3.11 python3.11-venv python3-pip nodejs npm ffmpeg make
cd /mnt/c/Projects/mera      # the folder you unpacked
make setup                   # Python and npm packages, ~1.6 GB of speech and matching models
make pipeline                # ~60 min for this footage on 4 cores
make run                     # then open http://127.0.0.1:8765 in Windows
```

The parts named `reconstruction` hold the finished 3D reconstruction
(`data\projects\plot\work\sfm`, without the 1.6 GB matching database). With them unpacked,
`make site` and `make model` work without re-running the reconstruction.

## Check an exported file

```powershell
pip install trimesh pillow
python pipeline\verify_export.py C:\Users\you\Downloads\plot_site.glb --site data\projects\plot\site.json
```

It re-imports the file and checks the fence extents (49 x 50 m) and textures. Blender's Python
module (`pip install bpy`, Python 3.11) adds the same check inside real Blender.
