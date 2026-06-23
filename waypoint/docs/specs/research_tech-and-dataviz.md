# Research — Tech & Data-Visualization (2026-06-22)

> For a Next.js + Tailwind PWA rendering ~4,000–5,200 week cells (~90×52). Method:
> WebSearch + WebFetch; MDN/Next.js docs returned 403 to automated fetch, so grid-role
> specifics come from MDN/W3C-aligned snippets + reputable 2024–2026 blogs.

## 1. Rendering ~5,000 cells: DOM vs SVG vs Canvas
Plain **DOM is comfortably fine** and the right default. SVG/DOM "works beautifully up
to a few thousand elements"; Canvas is for >100K cells / heavy continuous redraw
([SVG vs Canvas 2025/26](https://www.svggenie.com/blog/svg-vs-canvas-vs-webgl-performance-2025);
[AG Grid DOM virtualisation](https://www.ag-grid.com/javascript-data-grid/dom-virtualisation/)).
Interactivity (per-cell hover tooltip, click, range-select) **favors DOM** — Canvas
would force re-implementing hit-testing, focus, a11y ([LogRocket Canvas](https://blog.logrocket.com/when-to-use-html5s-canvas-ce992b100ee8/)).
Virtualization is unnecessary at 5K nodes. **Tips:** event delegation (one listener on
the container, read `data-week`); render once and drive appearance via CSS classes/
variables so state changes touch few nodes.

## 2. Responsive square-cell CSS Grid
`grid-template-columns: repeat(52, minmax(0, 1fr))` + `aspect-ratio: 1` on cells
([CSS-IRL](https://css-irl.info/aspect-ratio-cells/); [CSS-Tricks](https://css-tricks.com/aspect-ratios-grid-items/)).
Use `minmax(0,1fr)` (the `0` prevents overflow on narrow screens). Tailwind:
`grid grid-cols-[repeat(52,minmax(0,1fr))] gap-px` + `aspect-square` cells. Year labels
via a left gutter column; on mobile allow horizontal scroll for the grid region.

## 3. Local-first storage (no backend)
**IndexedDB via a thin wrapper, not localStorage** — async, transactional, structured,
not capped at ~5–10MB ([ShiftAsia](https://shiftasia.com/community/localstorage-vs-indexeddb-choosing-the-right-solution-for-your-web-application/)).
Wrapper: **Dexie.js** for schema/queries/`useLiveQuery`; **idb / idb-keyval** for a tiny
promise wrapper ([PkgPulse 2026](https://www.pkgpulse.com/guides/dexie-vs-localforage-vs-idb-indexeddb-browser-storage-2026)).
For this app, `idb-keyval` is enough. **Honest caveat:** for a single small JSON blob
localStorage would also work — IndexedDB is the more future-proof choice, not strictly
mandatory. **Portability:** implement **JSON export/import** (Blob download +
`<input type=file>`); File System Access API (`showSaveFilePicker`) is **Chromium-only**
→ progressive enhancement only.

## 4. PWA installability & offline (2025/2026)
**Use Serwist (`@serwist/next`), not next-pwa** (stale ~2 yrs, webpack-only; Next 16
defaults to Turbopack, which Serwist supports) ([Serwist](https://serwist.pages.dev/docs/next/getting-started);
[LogRocket Next 16 PWA](https://blog.logrocket.com/nextjs-16-pwa-offline-support/)).
Add a manifest (`app/manifest.ts` — name, icons, `display: standalone`, theme/background
color), a SW entry, and `@serwist/next` wires precache + generates `public/sw.js`.
**Caching:** mostly-static → **precache the app shell, cache-first**; user data lives in
IndexedDB so offline "just works."
**iOS limitations (flag):** install is manual (Share → Add to Home Screen); push needs
an installed PWA (iOS 16.4+); and **script-writable storage can be evicted after ~7 days
of non-use** unless `navigator.storage.persist()` (Safari 17+) ([MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide);
[Brainhub](https://brainhub.eu/library/pwa-on-ios)). → **JSON export is a data-safety
requirement, not a nicety.**

## 5. Accessibility checklist (dense grid)
- **Roles:** container `role="grid"`, year `role="row"`, week `role="gridcell"`; add
  `columnheader`/`rowheader` for week-number/year labels ([MDN grid role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/grid_role)).
- **Keyboard nav via roving tabindex:** exactly one cell `tabindex="0"`, others `-1`;
  Arrows move, Home/End jump, Enter/Space select ([roving tabindex](https://rajeev.dev/mastering-keyboard-navigation-with-roving-tabindex-in-grids)).
- **Selection:** `aria-selected="true"`; expose range start/end via `aria-live`.
- **Labels:** per-cell `aria-label` ("Week 23, age 35, lived").
- **prefers-reduced-motion:** disable hover/selection transitions.
- **Contrast:** never encode state by color alone (add border/pattern/icon); meet WCAG.

## RECOMMENDED STACK
- **Rendering:** plain DOM cells (`<button>`), rendered once, no Canvas, no
  virtualization; single delegated listener; CSS-class/variable-driven state.
- **Layout:** CSS Grid `repeat(52, minmax(0,1fr))` + `aspect-ratio:1`; horizontal-scroll
  fallback on mobile.
- **Storage:** IndexedDB via **idb-keyval** (Dexie if richer queries later) + **JSON
  export/import**; File System Access API as Chromium-only enhancement.
- **PWA:** **Serwist (`@serwist/next`)**, `app/manifest.ts`, app-shell precache
  (cache-first); call `navigator.storage.persist()`; surface JSON export prominently.
- **A11y:** grid/row/gridcell roles, roving-tabindex arrow nav, `aria-selected`,
  descriptive labels, `aria-live` for range selection, reduced-motion, non-color state.

**Version-sensitive flags:** Serwist-vs-next-pwa status, iOS storage-eviction behavior,
and File System Access API support all shift over time — re-check at implementation. The
exact ARIA attribute list should be confirmed against the live MDN grid-role page.
