# Architecture — Waypoint

Synthesis doc (Karpaty LLM-Wiki). Product, stack, modules, data flow, persistence,
evolution plan, and tests. Kept current; session "raw material" lives in `journal/`.

## 1. Product

**Waypoint** is a beautiful website + installable PWA for planning your life in weeks.
The user enters name, birth date, and a target lifespan and sees a square grid of every
week of their life (one cell = one week, one row = one year; ~90×52 ≈ 4,680 cells) with
the current week highlighted. They name **past chapters**, **plan future blocks** by
selecting start/end weeks (each plan can carry an "if-[when/where]-then-I'll" intention),
and **compare against curated historical lifemaps**, aligned by age.

Brand metaphor: a small **boat steered by a human at the helm** — taking your course
instead of drifting down the river. Inspirations: Tim Urban's *Your Life in Weeks* /
*The Tail End* / the Panic-Monster procrastination framework; Oliver Burkeman's *Four
Thousand Weeks*. Framing principle: **reflection + agency, never memento-mori dread**.
(Full research: `specs/research_life-in-weeks.md` and the `specs/research_*` set.)

## 2. Stack

- **Next.js 16 (App Router) + React 19 + TypeScript** (`create-next-app`).
- **Tailwind CSS v4** (`@tailwindcss/postcss`, `@import "tailwindcss"` in `globals.css`,
  `@theme` tokens). No `tailwind.config.ts` by default in v4.
- **State:** Zustand, persisted to **IndexedDB via `idb-keyval`**.
- **PWA:** Serwist (`@serwist/next`) — app-shell precache, cache-first.
- **No backend.** Fully client-side; data is local with JSON export/import and a
  URL-encoded read-only share link.

## 3. Modules & data flow

```
app/            App Router: layout, onboarding flow, /map (the grid), manifest.ts, sw.ts
components/     WeekGrid, WeekCell, BlockEditor, Legend, FamousPicker, Onboarding/*, ui/*
lib/            weeks.ts (date↔week math), store.ts (Zustand+idb), exportImport.ts,
                share.ts (URL-hash codec), famous.ts (load bundled lifemaps)
data/famous/    ford.json, edison.json, einstein.json, davinci.json, curie.json (CC0/Wikidata)
```

**Flow:** onboarding writes `profile` → store derives `totalWeeks = targetAgeYears*52`
and `currentWeekIndex = floor((now − birthDate)/7d)` (`lib/weeks.ts`) → `WeekGrid` renders
DOM cells once, painting state from `blocks` via CSS classes → user edits create/update
`LifeBlock`s → store persists to IndexedDB (debounced) → famous overlays map a
`FamousLifeMap` onto the grid **by age**. See `code-map.md` for per-file detail.

## 4. Rendering decision (why plain DOM)

~4,680 cells render fine as DOM `<button>`s; Canvas only pays off >100k cells and would
force re-implementing hit-testing/focus/a11y. One **delegated** listener on the grid
container; cell appearance driven by CSS classes/variables so state changes touch few
nodes. No virtualization. (Evidence: `specs/research_tech-and-dataviz.md`.)

## 5. Persistence

- **IndexedDB via `idb-keyval`** (single `lifemap` document; async, future-proof).
- Call `navigator.storage.persist()` on load (iOS evicts script storage after ~7 days
  of non-use) — which makes **JSON export a data-safety requirement**, not a nicety.
- **Export/import:** Blob download + file `<input>`. File System Access API is a
  Chromium-only progressive enhancement.
- **Share:** read-only state encoded in the URL hash (no server).
- **Migrations:** `LifeMap.version` gates a migration step on load.

## 6. Key decisions (rationale)

The full decision log with alternatives is in `journal/2026-06-22-research-and-scaffold.md`.
Headlines: name = **Waypoint**; famous roster = **historical figures first** (Ford,
Edison, Einstein, da Vinci, Curie) for lowest publicity-rights risk, facts-only, no
photos/logos, non-affiliation disclaimer (`specs/research_famous-people-and-legal.md`);
storage = IndexedDB+`idb-keyval`; PWA = Serwist; rendering = plain DOM; UX = reflection +
agency with if-then intentions as the headline feature; **no git/repo yet** (build in env
first); logo = hand-built SVG (Fal MCP here is docs-only).

## 7. Evolution plan

MVP milestones M0–M6 and the deferred backlog (community/accounts + backend, modern
famous figures after legal review, months view / "tail end" countdowns, poster export,
reminders, repo+deploy) are tracked in `specs/implementation-roadmap.md`.

## 8. Tests

Target: unit tests for `lib/weeks.ts` (week-index math, leap handling, current-week for a
known DOB) and `lib/share.ts`/`exportImport.ts` (round-trip). Per Karpaty discipline,
**each journal chunk ends with the green-test count + an e2e scenario.** Test runner TBD
(Vitest recommended for Next 16 + TS). _Current: 0 (none written yet)._
