# 2026-06-22 — Core app build (onboarding → grid → blocks → famous compare)

Second chunk of the day. Built the working MVP slice on top of the scaffold.

## What was done

- **Domain & logic** (`lib/`): `types.ts`, `weeks.ts` (time↔week math, single source of
  truth), `store.ts` (Zustand + `idb-keyval`, debounced persistence, `storage.persist()`),
  `exportImport.ts`, `share.ts` (URL-hash codec), `famous.ts` (dated eras → week indices,
  age-aligned).
- **Components**: `WeekGrid` (DOM grid, delegated handlers, roving-tabindex a11y,
  memoized paint), `Onboarding` (gentle 5-step), `BlockEditor` (past chapter / future
  plan + if-then intention), `LifeMapView` (stats header, toolbar, legend, block list,
  famous-compare panel + disclaimer, toasts). `app/page.tsx` orchestrates hydrate →
  onboarding-or-map and adopts a shared map from the hash.
- **Brand**: boat `app/icon.svg`; "open water / dawn" palette tokens in `globals.css`;
  light/system/dark; reduced-motion guard.
- **Data**: 5 historical lifemaps (Einstein, Curie, Ford, Edison, da Vinci) as Wikidata-
  sourced dated eras, facts only.

## How it's built

State lives in a Zustand store persisted to IndexedDB (`waypoint.lifemap`). The grid
renders `targetAge×52` DOM `<button>`s once and paints state from a memoized array; a
single delegated listener handles click/hover, with roving-tabindex arrow-key nav. Future
"plan" blocks are created by range-selecting two weeks; famous lives overlay as
outline-colored eras aligned by age, driving an "at your age, they were…" callout.

## Decisions

- **Famous data authored as dated eras** (`from`/`to`), converted to week indices at load
  in `lib/famous.ts` — accurate to author, and "by age" alignment falls out for free.
- **Shared links adopt-if-empty**: a `#m=` map is imported only when there's no local map
  (no read-only viewer yet; avoids clobbering). Tracked as a backlog refinement.
- **Tailwind v4**: tokens via `@theme` in `globals.css` (no `tailwind.config.ts`).

## Next

- M0/M6 PWA: add Serwist (`@serwist/next`), `app/manifest.ts`, maskable icons, offline.
- Tests: add Vitest; cover `lib/weeks.ts` (current-week for a known DOB, total, row/col)
  and `share`/`exportImport` round-trips.
- Visual QA in a real browser (grid density, mobile horizontal scroll, dark mode); v0
  mockups still pending tool approval.
- Read-only shared-map viewer; "tail end" / months view; more figures after legal review.

## Tests

**Green: 0** (no runner yet). **Verification this chunk:** `npm run build` green
(compiled + TypeScript + static gen, Next 16 Turbopack); dev server returns HTTP 200 with
`Waypoint`, the hydration shell, and `icon.svg` in the HTML. _Manual e2e pending in a
browser:_ onboard with a test DOB → grid shows `targetAge×52` cells with the correct
current week → add a past chapter + a future plan → overlay Einstein → export/import JSON.
