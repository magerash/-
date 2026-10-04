# Mera: report for the "plot by the forest" survey

## What changed in this round

The model used to read like an internal working file: grey massing, halos, labels, owner-attributed
remarks and the point cloud all on screen at once. Three placements were also wrong. This round
turns it into a finished product.

* **Default view.** The plot opens as a textured model from the road side: ground, walls, fences,
  gate and the forest edge carry the footage, roofs and plain objects take soft overcast light (it
  was filmed on an overcast day), and trees are a trunk with an open crown. Nothing else shows.
* **Detail layers.** Names, plot dimensions, grid, video frames, narration, accuracy, 3D points and
  survey notes are layers in one menu, all off on first open. Survey notes add how each thing was
  located, its frames, scale checks and where the video and the supplied figures differ.
* **Narration.** It is the video author's, and the app says so everywhere ("What the video's
  author says", "The video's author · c3 0:33"). Nothing calls it the owner's.
* **Placements.** Every structure, tree and fence line was re-checked against the frames and the
  narration; see below. The corrected layout lives in `data/projects/plot/layout.json`, one entry
  per thing with the frames and transcript lines that place it.
* **Removed rather than hidden:** the procedural massing, legend, sun panel, owner-remark pins as a
  default, the first-run card, and the old helper scripts that drove the old UI.
* **Kept:** true scale, Plan (variants in words or from the list, drag, rotate, checks), Compare,
  Measure, Walk, look-through-a-frame, and exports, which are now textured.

## The three known errors

Coordinates in the notes are in the reconstruction's own frame (u across the plot from the left
fence, v from the road toward the forest), before the fence quad is mapped onto the supplied
49/48 × 50 m outline.

**1. The terrace is in front of the sauna, not on the house side.**
The deck shows as a layer of points 0.35–0.45 m above the ground between v 36.0 and the sauna's
front wall, with lawn-only points east of u 34.3 and steps at its west end at u 27.6 (c2_080000,
c2_083125). The author walks across it in clip 4 (c4_092625 to c4_119500), and in clip 3 at 0:33
says the sauna's other side has "a terrace with a tree in it and a bathtub". The tree's trunk base
was triangulated on the deck from c4_089375 (7 m away) and c4_092625 (3.4 m); the two agree within
0.5 m. In the model the terrace spans the sauna's whole front, meets its front wall and stays clear
of the house (`web/src/plan/realsite.test.ts` checks all three).

**2. The trees at the left corner are inside the boundary.**
The cause was the boundary, not the trees: the left side had been placed on the author's walking
path, about 3 m inside the real fence. The fence was re-measured from fence-board points at
u −3.75 to −4.25 (front and middle) and −4.75 to −5.0 (back), and the ground hits at the back-left
corner in c2_000000. The six back-left birches were then located from their trunk bases in
c1_119000 and c2_000000 (2.1–5.8 m from the camera), and the front-left birch and pine were
triangulated from c1_057875, c1_062125 and c1_065000 (rays within 0.2 m). Every one is now inside
the fence; the front-left birch is 2.6 m inside it.

**3. The utility cabin stands behind the sauna on its left, mostly outside the back fence.**
In clip 2 at 1:03–1:05 the author stands at (27.5, 48.3) facing north and looks through an open
door into a shelved cabin (c2_064625), saying "another cabin here, just a doorway". Points 1–2 m
high cluster at u 26–28, v 49.5–51.5, beyond the back fence at v 48.7. The model stands the cabin
with its door wall on the fence line and the rest beyond it, behind the left half of the sauna, and
the fence opens where the cabin wall takes its place. The plank door to the forest is just west of
it (c2_067875; "here is the exit to the forest, this door", clip 2 1:06). The passage between the
sauna and the fence that the author walks through (c2_087250 to c2_098125) also moved the sauna's
back wall from v 49.0 to 47.5.

No separate reference photo came with this round, so the frames above served as the reference.

## Everything else, re-checked

| Thing | How it is known | How it was checked |
|---|---|---|
| House | measured in 3D, ±0.4 m | Walls fitted to 2,400 points; the gable with the attic window faces the road (c1_082000, c1_089000); the projected outline matches the walls in c1_089625 and c2_080000. |
| Glazed veranda | measured in 3D, ±0.4 m | Frame tops out at 2.8 m; the author walks through it in clip 4 1:08–1:23; the box matches its posts in c4_073250 and c4_076000. |
| Sauna | measured in 3D, ±0.4 m | West wall base matches c2_083125; back wall moved for the passage behind it; ridge turned east–west (gable on the east wall in c3_033750, straight eave over the door in c4_097250). |
| Woodshed | measured in 3D, ±0.5 m | Wall points; the woodpile shed in c2_046125; the author passes its east side in c2_053500–c2_057250. |
| Painted cabin | located in frames, ±0.8 m | Passed on its south side right after the walk behind the sauna; wall points at u 36.5–38.5, v 46–48.75. The old box here stood on the path the author walked. |
| Greenhouse | located in frames, ±1.0 m | West end triangulated from c1_042000 and c3_109375; about 4.5 m further from the road than before. |
| Water tank on a stand | located in frames, ±1.0 m | Triangulated from three views (rays agree within 0.3–1.3 m); it had been 5 m off. |
| Water barrels | located in frames, ±0.8 m | Bases 5 m from the camera in c3_093125. |
| Tractor tyre | located in frames, ±0.6 m | Ground 1.46 m under the camera (this quarter of the reconstruction sits low) and points on the tyre top; it had been 5 m off. |
| Trampoline | located in frames, ±0.7 m | Leg base 3 m from the camera in c1_113375, leg top triangulated with c1_099000; about 5 m further back than before. |
| Rock garden | located in frames, ±1.0 m | Outline matches the stones in c1_060125; "here is a small rock garden" (clip 1 1:01). |
| Sandbox | located in frames, ±0.6 m | Edge 1.8 m from the camera in c2_026625. |
| Plunge bathtub | approximate, ±1.0 m | At the front corner of the terrace (clip 3 0:30–0:40, frames not registered); placed against the located terrace edge. |
| Parking, vegetable field, raised beds, flower beds | approximate, ±1.5–2 m | Seen in c1_052625, c1_024125, c1_042000, c1_000000 and clip 3 1:11–1:32; extents approximate. |
| Other trees (8) | located in frames | Trunk bases in c4_089375/c4_092625 (terrace tree), c2_022750 (two by the house), c2_026625 (apple), c1_099000, c2_017875 (young pine), c2_112250 (two birches back right). |
| Fences | measured | Road: gate posts in c1_037375 and c1_032000 and picket points. Right: mesh on a base board at the front (c3_102625, c3_107000), boards at the back (c2_109500–c2_117375). Back: 11,400 points on the grey board fence. Left: as above; dark pickets at the front (c1_057875, c1_062125), boards along the forest (c1_119000). |
| Gate | located | Posts from c1_032000 and c1_037375. |

Removed: the "corner cabin" box in the back-right corner. The author films that corner as open
ground with old beehives (c2_114875, c2_117375), and the narration names it as the corner for
"something new", which the narration layer marks.

The fence lines measured in the video give 53.1 m along the road, 49.7 m along the forest and
46.4–46.6 m deep. They are mapped onto the supplied 49 / 48 × 50 m outline by a bilinear warp, so
everything keeps its position relative to the fences it was measured against; nothing moves by
more than 5.3 m. Sizes keep the reconstruction's own scale, which the phone height (1.46 m), the
house ridge (6.4 m) and the veranda (2.8 m) confirm.

## Texturing

* **Ground:** for each 4 cm cell, the median of the five best views that see it from at least 14°
  down and within 8 m, tested against the buildings for occlusion. It is used only where three or
  more views agree. Elsewhere the ground is the lawn colour measured from the green pixels, with
  grass, soil, gravel and forest-floor grain scattered from crops of the frames. Parked cars never
  agree between frames, so the parking area carries no photo and none of their colour.
* **Walls:** each face rectified from the sharpest near-frontal frame (manual choices where a
  person stood in front), falling back to seamless log, teal-paint or board materials cut from
  frames for faces the walk never saw squarely.
* **Fences and gate:** rectified from frames and made seamless along their length.
* **Forest edge:** projected from frames 14–75 m away onto a plane behind the back fence, sky cut
  out, buildings masked, gaps filled with forest copied from the same rows. A deeper solid layer
  and a canopy at treetop height keep it from reading as a wall from above.
* **Surroundings:** road, meadow and forest-floor tiles cut from the composite's own edges.

Higgsfield was offered for textures and models, but this container's network policy blocks its
upload and CDN hosts (upload.higgsfield.ai, d2ol7oe51mr4n9.cloudfront.net), so every texture comes
from the footage.

## Verification

* **Unit tests (vitest, 19):** parser, placement, variant editing and geometry; the five example
  briefs on the real plot place every building inside the boundary with no broken rules; and three
  tests for the corrected placements (terrace in front of the sauna and clear of the house; all
  eight corner trees inside the outline; the utility cabin more than 90% beyond the back fence with
  its door wall on the fence line, left of and behind the sauna).
* **Browser journeys (Playwright on the real survey, 5 of 5 passing):**
  1. First open: the canvas holds a real picture, every layer is off, there are no labels, pins or
     survey notes, and the page never says "owner".
  2. Layers: each one turns on (names, the "Road side · 49.0 m" dimension, pins and the author's
     transcript, survey notes, accuracy, grid, frames, 3D points); a frame opens from the utility
     cabin's card and the camera looks through it; **Hide all** clears everything.
  3. Clicking in the model selects the utility cabin beyond the back fence, the sauna terrace
     ("Part of Sauna"), a back-left birch and a fence.
  4. Measuring the road side snaps corner to corner and reads 49.0 m; walking works.
  5. Variants on the corrected site: Variant 1 from "a two-storey house near the forest, a garage
     and a sauna by the road", a shed added and deleted, Variant 2 with a house. Every new building
     is inside the plot and none clears the house, veranda, sauna, terrace or utility cabin. The
     two are compared, then Variant 1 is exported as GLB and OBJ.
* **Export re-import:**

  | File | trimesh / OBJ text | Blender 5.0 (bpy, defaults) |
  |---|---|---|
  | GLB (2.1 MB) | fences 49.000 × 50.000 m, 32 textures | fences 49.000 × 50.000 m, 32 images on 37 textured materials, metric |
  | OBJ zip (2.1 MB) | fences 49.000 × 50.000 m, 32 textures, 43,587 texture coordinates, no missing files | fences 49.000 × 50.000 m, 32 images |

  The proposed house, garage and sauna measure 8.00 × 9.00, 4.00 × 6.50 and 4.00 × 6.00 m in
  Blender. The PLY point cloud (83k points) lands in the same Z-up frame.
* **Phone width (390 px):** the whole plot fits, the panel stacks below, no sideways scroll.

## Limits

* Trees, the bathtub, beds and the parking are simplified shapes; positions of the approximate
  items carry ±1–2 m, which the accuracy layer shows.
* The right-front quarter of the reconstruction came from a separate sub-model that sits 1.5–2.5 m
  low; positions there were measured from the camera's own height above the ground.
* North is not known from the overcast footage, so there is no sun study.
* There is no dense mesh: a CPU-only container cannot run dense multi-view stereo.

## How to run

```bash
cd mera
make setup        # Python + npm deps, offline models
make pipeline     # data/projects/plot/inputs -> site model (~60 min on 4 CPU cores for this footage)
make model        # after editing layout.json: placements, textures and the textured model
make run          # http://127.0.0.1:8765
make test         # unit tests + browser journeys (with the server running)
make share        # static copy in data/projects/plot/share
```

`python pipeline/verify_export.py <files> --site data/projects/plot/site.json` re-checks any
exported file in trimesh and Blender. Footage-derived data stays in `data/projects/` and is not
committed (public repository).
