# Mera: build report for the "plot by the forest" survey

## Source material

* 5 phone clips: 854 × 480, 24 fps, HEVC, 9 min 16 s in total. They were shot on the 0.6× ultra-wide lens (the owner says so at 0:10 in clip 1) with electronic stabilisation.
* Voice: the narration is the clips' own audio, in Russian. No separate voice file was supplied, and the pipeline would have used one first if it had been.
* The owner supplied the plot size separately: 48–49 m along the road and about 50 m from the road to the forest. The recording does not state it (clip 4 at 0:21: "я тебе напишу габариты участка", "I'll write you the plot dimensions").

## What the pipeline did

| Stage | Result |
|---|---|
| Keyframes | 1,554 frames selected from 4,444 candidates (8 fps) by sharpness, exposure and parallax. 561 blurred candidates were rejected. |
| Transcript | 72 speech segments. Language detected as Russian. GigaAM v2 gave the primary text, with Whisper large-v3-turbo kept as a second reading. English glosses are an analyst translation. |
| Facts | 46 mentions across 22 feature kinds, including entrance, forest, slope, house, sauna, sheds, parking, woodpile and back gate, plus build intents ("сделай здесь бассейн", "хочет тут что-то построить"). Each fact is pinned to the camera pose at the moment it was said. |
| SfM | SIFT features with sequential and vocabulary-tree matching. GLOMAP (global) registered every frame but folded the scene into a "tent" and threw a cluster of cameras away, so it was rejected. Incremental mapping on every second keyframe with loosened thresholds gave a 539-frame main model. Two more sub-models were merged in through 70k and 30k 3D–3D correspondences, giving **611 frames in one frame, 85k points, 0.52 px mean reprojection error**. Weaker links were refused. |
| Site model | The vertical comes from the mean camera orientation (it agrees with the walking-track plane to within 1.8°). Fence lines, uniform scale, terrain, the owner's boundary, 17 elements, 34 voice pins and 611 photo-aligned cameras. |

The reconstruction was checked by projecting COLMAP's own points back through the exported cameras. For main-model frames they land within 0.3–0.7 px median, so "Look through this photo" is exact for those frames. The 72 frames from merged sub-models have camera directions that can be off by 1.5–11°, so the viewer labels them "approximate pose".

## Reconstructed vs inferred

**Reconstructed (fitted to 3D points from the video):**
* **Forest-side fence:** 11,400 points in a straight line. This also sets the plot's orientation.
* **House:** 11.0 × 10.5 m footprint from 2,400 wall points. Its points reach 6.4 m, consistent with a log house with an attic storey.
* **Glazed veranda:** front wall line; its frame tops out at 2.8 m.
* **Sauna (banya):** 5.7 × 7.5 m from 5,500 points. The owner names it in clip 4 at 1:36.
* **Woodshed and two cabins** along the back fence.
* **Terrain:** a plane through the camera track (phone at 1.46 m, spread ±0.23 m), checked against 34,000 ground points (±0.21 m). It falls 2.8%, mostly toward the left fence, which is about 1.4 m across the plot.

**Inferred (seen in frames and narration, placed by casting picked pixels into the reconstruction, ±1–2.5 m):**
greenhouse, IBC tank, blue barrels, dug field, raised-bed area, parking, rock garden, trampoline, tractor tyre, sauna terrace, the door to the forest, the forest mass (about 22 m tall) and the road. These are drawn translucent with dashed outlines and an uncertainty halo.

**Stated (owner):**
* The boundary rectangle, 48.5 × 50 m.
* "The corner where we will place something" (clip 2, 1:29–1:50; clip 3, 0:08).
* The slope.
* The plot being rectangular.

**Not modelled:** individual trees and beds, small objects, the interiors. There is no dense mesh: a CPU-only container cannot run dense multi-view stereo. The points and the source photos are the visual evidence.

## Scale and accuracy

Scale is one uniform factor fitted to the owner's 48.5 × 50 m on both axes. Three independent checks agree with it:

| Check | Measured | Expected |
|---|---|---|
| Phone height above ground while walking | 1.46 m | 1.25–1.65 m |
| House ridge for a log house with an attic storey | 6.38 m | 5.8–8.0 m |
| Glazed veranda height | 2.78 m | 2.5–3.0 m |

Fence to fence, the reconstruction measures **50.1 m along the road × 48.3 m to the forest**. Only the forest fence has dense points. The road, left and right fences (a picket fence behind parked cars and a chain-link mesh) barely reconstruct, so they are placed 0.7 m beyond the owner's walking line. The owner's rectangle is used for the boundary and centred on those lines. The two disagree by about 1.5 m per side, and the app shows this.

Expected accuracy:
* Boundary lines: ±1.4 m.
* Scale: ±5%.
* Reconstructed building positions: ±0.3–0.6 m.
* Inferred items: ±1–2.5 m.
* Height over the plot: ±1.3 m. The camera-based vertical is uncertain to about 1.5°.

Open points that the app raises with the owner:
* Near the back-right corner a board fence is reconstructed about 45 m from the left side, roughly 3.5 m inside the 48.5 m rectangle. Either the plot narrows (perhaps why "48–49 m") or the model drifts there.
* The owner says the land slopes "behind me" (toward the forest) and "that way" (toward the left fence). The measured fall agrees with the left-fence direction (2.8%). The fall toward the forest (0.9%) is within what the survey can resolve.

## Verification

* **Unit tests (vitest, 12 tests):**
  * The parser reads the reference brief in English and Russian, sizes, counts, keep/remove instructions and unknown words.
  * The solver respects every setback and is deterministic.
  * Convex overlap areas are correct.
  * All five example briefs on the real plot produce variants with **no broken rules**, every building inside the boundary.
* **Synthetic tests for the site builder:** gravity rotation, quaternion round-trip, fence recovery to ±0.2 m, robust plane fit.
* **Browser journeys (Playwright on the real survey, all passing):**
  1. Load: dimensions, scale checks and evidence are present.
  2. Navigate: orbit, plan, walk with WASD at 1.65 m, then open a remark and look through its photo.
  3. Measure: clicks near the two road corners snap to them and read **48.5 m** (accepted range 47.5–49.5 m).
  4. Plan and export: type "a two-storey house near the forest, a garage and a sauna by the road", get several variants (2–4, usually 4), compare them, export GLB and OBJ, and re-import both.
* **Re-import in independent tools:**
  * trimesh and **Blender 5.0 (bpy)** at default settings give boundary extents of 48.55 × 50.05 m (the 5 cm fence thickness included).
  * The proposed house, garage and sauna measure **8.00 × 9.00, 4.00 × 6.50 and 6.00 × 4.00 m** in Blender.
  * The PLY point cloud (83k points) lands on the same Z-up frame.
* **Interaction checks:**
  * Dragging a proposed building moves it on the ground and R rotates it; the checks update, for example flagging an overlap with the existing house.
  * Sun and shadows appear once north is set.
  * At phone width (390 px) the page doesn't scroll sideways.
* **Product path:** a fresh survey was created through the API, a 45 s clip uploaded and the whole pipeline run by the server. It produced a model and correctly flagged it as unreliable, because the walk covered 58% of the width and the phone-height check failed at 3.64 m.

## How to run

```bash
cd mera
make setup        # Python + npm deps, offline models (~1.6 GB from GitHub releases)
make pipeline     # data/projects/plot/inputs -> site model (~60 min on 4 CPU cores for this footage)
make run          # http://127.0.0.1:8765
```
Or open the app with no survey present and use **Survey a plot** (upload, then live progress).
`python pipeline/verify_export.py <files> --site data/projects/plot/site.json` re-checks any exported file.

Footage-derived data stays in `data/projects/` and is not committed (public repository).
