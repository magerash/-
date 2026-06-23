# Roadmap & Status

_Status legend: ⬜ not started · 🟡 in progress · ✅ done._

## Milestones (MVP)

- 🟡 **M0 — Design + scaffold.** Scaffold ✅; boat SVG favicon ✅. Serwist PWA ⬜.
  v0 mockups pending tool approval 🟡.
- ✅ **M1 — Data/persistence.** Data model, Zustand store, `idb-keyval` persistence,
  `navigator.storage.persist()`, JSON export/import. _(`lib/`)_
- 🟡 **M2 — Grid.** DOM grid, square layout, cell states, current-week highlight, hover
  tooltip, roving-tabindex a11y ✅. Still: `aria-live` range announcement, visual QA.
- ✅ **M3 — Onboarding.** Gentle name / DOB / target-age flow (animated reveal = basic).
- ✅ **M4 — Blocks.** Past chapters + range-selected future plans with if-then intention;
  legend/sidebar/editor.
- ✅ **M5 — Famous lifemaps.** 5 figures (Einstein, Curie, Ford, Edison, da Vinci),
  age-aligned overlay, "at your age they were…" callout, disclaimer.
- 🟡 **M6 — Polish + share.** Theming ✅, export/import ✅, URL-hash share ✅. Still: PWA
  install/offline (Serwist), mobile QA, export-as-image, read-only shared viewer, tests.

## Deferred / "next improvements" backlog

- **Community & accounts** (needs a backend): publish/share user lifemaps, browse a
  community gallery. The biggest post-MVP feature.
- **Modern famous figures** (Jobs, Musk, Elvis, Michael Jackson, etc.) — only after
  legal review; facts-only + disclaimer (see decisions D-003).
- **More units of time** ("life in months", "the tail end" countdowns — books left,
  summers left, times you'll see your parents) à la Tim Urban.
- **Richer milestone modeling from Wikidata** via live SPARQL + a build-time importer.
- **Designed/printable poster export** (physical upsell pattern proven by WBW / Daily
  Stoic).
- **Gentle reminders / weekly check-in** (SDT-aligned, forgiving — never shaming).
- **Repo + deploy:** create the new GitHub repo and first push (opt-in, on request);
  deploy to Vercel.

## Open questions

- Reconcile this `docs/` layout with the real **Karpaty memory system** from City-Forma
  (could not be read — out of GitHub scope this session).
- Confirm v0 mockup generation (MCP call needs approval).
