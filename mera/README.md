# Mera — your plot, to scale

Mera turns an ordinary phone video of a land plot, plus the owner's spoken description, into a
true-scale 3D site model you can walk around in the browser. You make your own building variants,
adding buildings from a list or in plain words; Mera puts each new building inside the plot within
the setback rules and checks the layout as you move things. Compare variants side by side and
download the site or any variant as glTF/GLB or OBJ that opens at metric scale in Blender or SketchUp.

Its character is meant to be honest and calm: every object says whether it was **reconstructed**
from the video, **stated** by the owner, or **inferred**, uncertain positions carry visible halos,
and the source frames are one click away. You can put the 3D camera exactly where the phone was
and compare the model with the photo.

```
video(s) + voice ─► keyframes ─► transcript ─► spoken facts ─► SfM (COLMAP) ─► site model ─► browser
                    sharpness     GigaAM +      entrance,       cameras +       gravity, fence lines,
                    + coverage    Whisper       forest side,     sparse cloud    scale to owner's plot,
                                                slope …                          terrain, elements, pins
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

You can also start from the browser: with no survey present, the app opens a **Survey a plot**
form where you upload files and enter the plot size, and it shows the pipeline's progress live.

### A copy to open without the server

```bash
make share      # -> data/projects/plot/share: index.html, assets/, data/
```

This builds the app in static mode (`VITE_STATIC=1`) and packs the site model, transcript, point
cloud and 200 of the photos (every frame cited as evidence plus cameras spread along the walk)
next to it. Any static host can serve the folder. `index.html` holds only the page content, so a
host that adds its own document skeleton can serve it as is. In this mode each viewer's variants
are kept in the host's per-person store when it offers one (claude.ai artifacts do), otherwise in
the browser, and exports go through the host's save prompt (3D files arrive zipped). The folder
contains footage-derived data, so it stays in the git-ignored project directory.

Footage-derived data (`data/projects/*`) and models are git-ignored on purpose. This repository is
public and the footage shows people, cars and a private property.

## Using it

* **Site**: what the land is. You get plot dimensions next to the owner's figures, slope, how
  the scale was established, independent scale checks, every item with its provenance, and the
  owner's remarks pinned where they were said. Click a remark or a camera to see the source
  frame, then use **Look through this photo** to check the model against reality.
* **Plan**: nothing is generated for you. Press **New variant**, then add buildings from the list
  or describe them in English or Russian, e.g. *"a two-storey house near the forest, a garage and
  a sauna by the road"*. Each new building gets a spot inside the plot that respects the setbacks
  (SP 53.13330 defaults, editable) and the buildings you already placed; existing ones never move.
  Drag a building to move it, press **R** to rotate it and **Delete** to remove it, or change its
  type, size and storeys in the list. Checks cover setbacks, sanitary distances, the forest fire
  buffer (advisory), car access, the largest open lawn, walking distances and what has to be
  cleared. Duplicate a variant to try an alternative; variants are saved with the project.
* **Compare**: press ⊞ on two to four variants to see them in synchronized 3D views, with
  today's site as a baseline, plus a table of the numbers that decide.
* **Measure** (M): click two points. Clicks snap to plot and building corners, and the tool
  reports horizontal distance and height difference.
* **Walk** (3): eye height 1.65 m above the fitted terrain. Use WASD or the arrow keys.
* **Sun**: shadows stay off until you say where north is, because the footage can't tell.
* **Export**: the site or any variant as GLB, as OBJ+MTL in a zip with a units README, or the
  point cloud as PLY. After each export the app re-imports the file and reports its measured size.

## How it works

| Stage | What | Code |
|---|---|---|
| Keyframes | 8 fps candidates. Laplacian sharpness, exposure, LK optical-flow parallax; the sharpest frame wins once the camera has moved enough | `pipeline/ingest.py` |
| Transcript | Silero VAD → GigaAM v2 (Russian) and Whisper large-v3-turbo; disagreements kept | `pipeline/transcribe.py` |
| Facts | Bilingual keyword grammar for entrance, forest, slope, sauna, sheds … with timestamps | `pipeline/facts.py` |
| SfM | pycolmap: one RADIAL camera per clip with an ultra-wide prior (owner: "0.6x"), sequential + vocabulary-tree matching, incremental mapping on every 2nd keyframe with loosened thresholds for stabilised phone video | `pipeline/sfm.py` |
| Merge | Sub-models joined by Sim3 from 3D–3D correspondences (feature matches across models); weak links refused | `pipeline/merge_models.py` |
| Site model | Gravity from camera up refined by vertical wall planes; fence lines from near-ground structure outside the walking path; road/forest side from where the camera pointed when the owner said "entrance" / "forest"; one similarity scale fitted to the owner's dimensions; terrain plane from the camera track; buildings refitted to wall points | `pipeline/build_site.py` |
| Planner | Brief parser → buildings; simulated annealing places only the newly added ones around those already placed, with hard setbacks; A* paths; rule checks marked *marginal* when they pass by less than the survey error | `web/src/plan/*` |
| Viewer | React + three.js (react-three-fiber), matte massing, provenance styling, uncertainty halos | `web/src/scene/*` |
| Export | GLB (glTF is meters, Y-up), OBJ+MTL writer, PLY, then in-browser re-import | `web/src/export/exporters.ts` |
| Verify | trimesh + real Blender (bpy) re-import, checks the boundary to ±1 cm | `pipeline/verify_export.py` |

Analyst annotations: `data/projects/<id>/annotations.json` holds the element list (kind, label,
approximate footprint, evidence frames, transcript lines), English glosses of the narration and
site-specific open questions. Positions were read off the reconstruction and found with
`pipeline/locate.py` (pick a pixel in a registered frame, then cast its ray into the point cloud).
The pipeline refits buildings to the wall points and keeps anything without 3D support as
*inferred*. Rerun with `make site`. Without annotations, tall point clusters become unlabelled
obstacles ("tall structure or trees").

## Tests

```bash
cd web && npx vitest run                    # parser, placement, variant editing, geometry + example briefs on the real plot
python pipeline/test_build_site.py          # synthetic checks of the site-builder geometry
make run & (cd web && npx playwright test)  # browser journeys on the real survey
python pipeline/verify_export.py file.glb file_obj.zip points.ply --site data/projects/plot/site.json
```

The journeys cover:
* loading the model
* orbit, plan and walk navigation, and aligning with a source photo
* measuring the road boundary (snapped corner to corner)
* making two variants (in words, from the list, removing with Delete), then comparing them
* exporting GLB and OBJ and re-importing them in trimesh and Blender

See `docs/REPORT.md` for what was reconstructed versus inferred, accuracy, and verification results.
