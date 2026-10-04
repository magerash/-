# Mera — your plot, to scale

Mera turns an ordinary phone video of a land plot, plus the owner's spoken description, into a
true-scale 3D site model you can walk around in the browser. You can describe what you want to
build in plain words, get variants placed on the land within setback rules, compare them, and
download any of them as glTF/GLB or OBJ that opens at metric scale in Blender or SketchUp.

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
make pipeline                   # ~30-45 min on a 4-core CPU for ~9 min of 480p video
make run                        # http://127.0.0.1:8765
```

You can also start from the browser: with no survey present, the app opens a **Survey a plot**
form where you upload files and enter the plot size, and it shows the pipeline's progress live.

Footage-derived data (`data/projects/*`) and models are git-ignored on purpose. This repository is
public and the footage shows people, cars and a private property.

## Using it

* **Site**: what the land is. You get plot dimensions next to the owner's figures, slope, how
  the scale was established, independent scale checks, every item with its provenance, and the
  owner's remarks pinned where they were said. Click a remark or a camera to see the source
  frame, then use **Look through this photo** to check the model against reality.
* **Plan**: type a brief in English or Russian, e.g. *"a two-storey house near the forest, a
  garage and a sauna by the road"*. Mera shows how it understood the brief (editable), generates
  up to four genuinely different placements, and checks each against setbacks (SP 53.13330
  defaults, editable). It also reports sanitary distances, the forest fire buffer (advisory),
  car access, the largest open lawn, walking distances, and what has to be cleared. Drag a
  building to move it, press **R** to rotate it, and the checks update when you let go.
* **Compare**: up to four variants in synchronized 3D views, with today's site as a baseline,
  plus a table of the numbers that decide.
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
| SfM | pycolmap: one RADIAL camera per clip with an ultra-wide prior (owner: "0.6x"), sequential + vocabulary-tree matching, global mapper | `pipeline/sfm.py` |
| Site model | Gravity from camera up refined by vertical wall planes; fence lines from near-ground structure outside the walking path; road/forest side from where the camera pointed when the owner said "entrance" / "forest"; one similarity scale fitted to the owner's dimensions; terrain plane from the camera track; buildings refitted to wall points | `pipeline/build_site.py` |
| Planner | Brief parser → program; simulated annealing with hard setbacks; diverse selection; A* paths; rule checks marked *marginal* when they pass by less than the survey error | `web/src/plan/*` |
| Viewer | React + three.js (react-three-fiber), matte massing, provenance styling, uncertainty halos | `web/src/scene/*` |
| Export | GLB (glTF is meters, Y-up), OBJ+MTL writer, PLY, then in-browser re-import | `web/src/export/exporters.ts` |
| Verify | trimesh + real Blender (bpy) re-import, checks the boundary to ±1 cm | `pipeline/verify_export.py` |

Analyst annotations: `data/projects/<id>/annotations.json` holds the element list (kind, label,
approximate footprint, evidence frames, transcript lines). Positions were read off the
reconstruction and the frames. The pipeline refits buildings to the wall points and downgrades
anything without enough 3D support to *inferred*. Rerun with `make site`.

## Tests

```bash
cd web && npx vitest run        # brief parser + solver unit tests
make run & cd web && npx playwright test   # browser journeys on the real survey
```

The journeys cover:
* loading the model
* orbit, plan and walk navigation, and aligning with a source photo
* measuring the road boundary (snapped corner to corner)
* describing a build, then getting and comparing variants
* exporting GLB and OBJ and re-importing them in trimesh and Blender

See `docs/REPORT.md` for what was reconstructed versus inferred, accuracy, and verification results.
