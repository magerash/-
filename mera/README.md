# Mera — your plot, to scale

Mera turns an ordinary phone video of a land plot, and the narration recorded with it, into a
true-scale, textured 3D model you can look around in the browser. It opens on the place as it
was filmed: ground, walls, fences and the forest edge are textured from the footage, nothing
else in the way. Owners try out what to build as their own variants, compare them side by side
and download the site or any variant as a textured glTF/GLB or OBJ that opens at metric scale in
Blender or SketchUp.

How each thing was located, accuracy, the raw 3D points, the camera path and the narration are
all there, as layers that start switched off.

```
video(s) + voice ─► keyframes ─► transcript ─► facts ─► SfM (COLMAP) ─► site ─► layout ─► textures ─► model ─► browser
                    sharpness     GigaAM +     entrance,  cameras +      gravity,  verified   ground,     glTF
                    + coverage    Whisper      forest …   sparse cloud   fences    placements walls …     (meters)
```

## Run it

Requirements: Python 3.11, Node 20+, ffmpeg, ~2 GB disk for models.

```bash
make setup                      # pip + npm deps, downloads speech models and the COLMAP vocab tree
cp ~/videos/*.mp4 data/projects/plot/inputs/          # drop video(s) and any voice recordings
echo '{"name":"My plot","plot":{"width":[48,49],"depth":[50,50]}}' > data/projects/plot/project.json
make pipeline                   # ~60 min on a 4-core CPU for ~9 min of 480p video
make run                        # http://127.0.0.1:8765
```

With no survey present, the app opens a **Survey a plot** form where you upload files and enter
the plot size, and it shows the pipeline's progress live.

After editing the verified layout (`data/projects/<id>/layout.json`), `make model` rebuilds the
placements, textures and the textured model (a couple of minutes).

### A copy to open without the server

```bash
make share      # -> data/projects/plot/share: index.html, assets/, data/
```

This builds the app in static mode (`VITE_STATIC=1`) and packs the site data, the textured model
with its images, transcript, point cloud and 110 of the frames (every frame cited as evidence plus
cameras spread along the walk) next to it. Any static host can serve the folder. `index.html`
holds only the page content, so a host that adds its own document skeleton can serve it as is. In
this mode each viewer's variants are kept in the host's per-person store when it offers one
(claude.ai artifacts do), otherwise in the browser, and exports go through the host's save prompt
(3D files arrive zipped).

Footage-derived data (`data/projects/*`) and models are git-ignored on purpose. This repository is
public and the footage shows people, cars and a private property.

## Using it

* **Site**: the model, plus a side panel with the plot's size, area and fall, and everything on
  it grouped as buildings, yard, garden and trees. Click anything in the model or the list to fly
  to it and see what it is.
* **Layers** (L): names, plot dimensions, grid, video frames (where each frame was shot; open one
  and **look through it** to check the model against the footage), narration (the video author's
  remarks pinned where they were said, with the transcript), accuracy (a band as wide as each
  thing's position uncertainty, coloured by how it is known), the raw 3D points, and survey notes
  (how each thing was located, with its frames, scale checks and where the video and the supplied
  figures differ). All start off; **Hide all** clears them.
* **Plan**: nothing is generated for you. Press **New variant**, then add buildings from the list
  or describe them in English or Russian, e.g. *"a two-storey house near the forest, a garage and
  a sauna by the road"*. Each new building gets a spot inside the plot that respects the setbacks
  (SP 53.13330 defaults, editable), the existing structures and trees, and the buildings you
  already placed. Drag a building to move it, **R** rotates it, **Delete** removes it. Checks cover
  setbacks, sanitary distances, the forest fire buffer (advisory), car access, the largest open
  lawn, walking distances and what has to be cleared; trees under a new building are cleared.
* **Compare**: press ⊞ on two to four variants to see them in synchronized 3D views, with
  today's site as a baseline, plus a table of the numbers that decide.
* **Measure** (M): click two points; clicks snap to plot and building corners.
* **Walk** (3): eye height 1.65 m above the fitted terrain, WASD or the arrow keys.
* **Export**: the site or any variant as a textured GLB, as OBJ + MTL + textures in a zip with a
  units README, or the point cloud as PLY. After each export the app opens the file again and
  reports its fence extents and texture count.

## How it works

| Stage | What | Code |
|---|---|---|
| Keyframes | 8 fps candidates; sharpness, exposure and optical-flow parallax pick the frames | `pipeline/ingest.py` |
| Transcript | Silero VAD → GigaAM v2 (Russian) and Whisper large-v3-turbo; disagreements kept | `pipeline/transcribe.py` |
| Facts | Bilingual keyword grammar for entrance, forest, slope, sauna, sheds … with timestamps | `pipeline/facts.py` |
| SfM | pycolmap, one RADIAL camera per clip with an ultra-wide prior, sequential + vocabulary-tree matching, sub-models merged by Sim3 | `pipeline/sfm.py`, `pipeline/merge_models.py` |
| Site | Gravity, terrain plane from the camera track, reconstruction-frame site data (`site_recon.json`) | `pipeline/build_site.py` |
| Layout | The verified placements (`layout.json`: every structure, tree and fence line with the frames and narration that place it) mapped onto the supplied plot outline by a bilinear warp of the measured fence quad; sizes keep the reconstruction's scale | `pipeline/layout.py` |
| Textures | Ground orthophoto (median of the best views per pixel, occlusion-tested) blended into lawn, soil and gravel grain cut from the frames; walls rectified from the sharpest frontal frames; fences and the forest edge projected from frames; seamless tiles for the surroundings | `pipeline/texture.py` |
| Model | Simple geometry in meters written as glTF with embedded geometry and JPEG/PNG textures; photo surfaces unlit, roofs and plain objects take soft overcast light; trees as trunk + open crown | `pipeline/model.py` |
| Placement tools | Cast a picked pixel into the cloud or onto the local ground; least-squares point from rays in several frames | `pipeline/locate.py`, `pipeline/triangulate.py` |
| Planner | Brief parser → buildings; simulated annealing places only new ones; A* paths; rule checks marked *marginal* when they pass by less than the survey error | `web/src/plan/*` |
| Viewer | React + three.js (react-three-fiber); the glTF model with picking and variant clearing; detail layers on top | `web/src/scene/*` |
| Export | Built from the same glTF minus the scenery: GLB via GLTFExporter, OBJ + MTL + textures, PLY, then an in-browser re-import | `web/src/export/exporters.ts` |
| Verify | trimesh and real Blender (bpy) re-import: fence extents to ±1 cm, textures present | `pipeline/verify_export.py` |

## Tests

```bash
cd web && npx vitest run                    # parser, placement, variants, geometry, and the corrected placements on the real plot
python pipeline/test_build_site.py          # synthetic checks of the site-builder geometry
make run & (cd web && npx playwright test)  # browser journeys on the real survey
python pipeline/verify_export.py file.glb file_obj.zip points.ply --site data/projects/plot/site.json
```

The journeys cover first open (a real picture, every layer off, no labels or pins, the narration
never attributed to the owner), toggling every layer and back, clicking the corrected structures
in the model, measuring the road side, walking, making and comparing variants on the corrected
site, and exporting textured GLB and OBJ that are re-imported in trimesh and Blender.

See `docs/REPORT.md` for what changed, how each placement was checked against the frames, and the
verification results.
