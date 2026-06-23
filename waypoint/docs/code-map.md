# Code Map — Waypoint

Synthesis doc (Karpaty LLM-Wiki). Navigate the code by "chunks" (module → responsibility),
not line-by-line. Update this whenever paths/modules change. _Legend: ✅ implemented ·
🟡 partial · 📋 planned._

## App shell (`app/`)

- ✅ `layout.tsx` — root layout, Geist font, Waypoint metadata + `themeColor` viewport,
  `appleWebApp`. 📋 still: link the Serwist SW + manifest.
- ✅ `globals.css` — Tailwind v4 import; brand `@theme` tokens; light/system/dark via
  `:root` / `prefers-color-scheme` / `.light`/`.dark`; reduced-motion guard; current-week
  pulse keyframes.
- ✅ `page.tsx` — client orchestrator: `hydrate()` from IndexedDB, adopt a shared map from
  the URL hash if nothing local, then render `<Onboarding>` or `<LifeMapView>`.
- ✅ `icon.svg` — hand-built boat-at-the-helm favicon (Next auto-wires it).
- 📋 `manifest.ts` — web app manifest. 📋 `sw.ts` — Serwist service worker (M6/PWA).

## lib/ (pure logic — DOM-free where possible, unit-testable)

- ✅ `types.ts` — `LifeMap`, `LifeBlock`, `Profile`, `Settings`, `FamousLifeMap`,
  `Category`, `CATEGORY_META`, `BLOCK_PALETTE`, `WEEKS_PER_YEAR`, version constant.
- ✅ `weeks.ts` — **single source of truth for time**: `totalWeeks`, `currentWeekIndex`,
  `ageAtWeek`, `weekToRowCol`, `dateOfWeekStart`, `weekLabel`, `lifeStats`. Pure.
- ✅ `store.ts` — Zustand store + `idb-keyval` persistence (debounced), `hydrate()` with
  `navigator.storage.persist()`, block/profile/settings actions, migration hook.
- ✅ `exportImport.ts` — `exportLifeMap` (Blob download), `importLifeMapFromFile`,
  `isLifeMap` guard.
- ✅ `share.ts` — base64url(UTF-8) encode/decode of a `LifeMap`; `shareUrl`,
  `readShareFromHash`.
- ✅ `famous.ts` — loads bundled lifemaps, converts dated eras → week indices, aligns by
  age; `FAMOUS_LIFEMAPS`, `getFamous`, `eraAtWeek`.

## components/

- ✅ `WeekGrid.tsx` — DOM grid (`role=grid`, `display:contents` rows, year-label gutter);
  one delegated click/hover handler; roving-tabindex arrow-key nav + Enter; paints cell
  state (lived/current/block/overlay/pending) via a memoized array.
- ✅ `Onboarding.tsx` — gentle 5-step flow (welcome → name → DOB → target-age → reveal),
  boat mark, progress dots.
- ✅ `BlockEditor.tsx` — modal to create/edit a past chapter or future plan; auto-kind by
  range vs. current week; category/color; if-then intention for plans; delete.
- ✅ `LifeMapView.tsx` — main screen: stats header, toolbar (add/select range, theme,
  export/import/share, reset), grid, legend, block list, famous-compare panel
  ("at your age, they were…") + disclaimer, toast.
- 📋 `ui/*` — extract shared primitives later if needed.

## data/famous/ (read-only, CC0 from Wikidata — facts only, no photos/logos)

- ✅ `einstein.json`, `curie.json`, `ford.json`, `edison.json`, `davinci.json` — each
  authored as dated **eras** (`from`/`to`, `category`, `source` Wikidata URL); `lib/famous.ts`
  converts to week indices. Eras are approximate factual framings.
