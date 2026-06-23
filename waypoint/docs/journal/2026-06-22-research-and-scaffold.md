# 2026-06-22 — Research, scope decisions, scaffold & wiki bootstrap

First session. Established the product, ran deep research, made the foundational
decisions, scaffolded the Next.js app, and bootstrapped this Karpaty LLM-Wiki.

## What was done

- **Deep research** (5-angle fan-out, web-search + adversarial verification):
  competitive landscape, UX & behavioral psychology, tech & data-viz, famous-people
  data + legal, and Tim Urban framework + market/positioning. Reports →
  `specs/research_*` (+ `specs/research_life-in-weeks.md` synthesis).
- **Scope** chosen with the user: MVP = personal map **+** curated famous lifemaps,
  fully client-side; stack Next.js + TS + Tailwind + PWA; name **Waypoint**; roster =
  historical figures first.
- **Scaffold:** `create-next-app` → Next 16.2.9, React 19, Tailwind v4, App Router,
  TypeScript, ESLint. Project at `waypoint/`.
- **Wiki bootstrap:** restructured `docs/` to the Karpaty LLM-Wiki layout (this file
  pattern), reconciled from the City-Forma reference the user provided.

## How it's built (state at end of session)

Only the CNA scaffold exists (`app/layout.tsx`, `app/page.tsx`, `app/globals.css`). No
feature code yet. Planned module layout is in `code-map.md`; data flow + decisions in
`architecture.md`.

## Decisions & why

- **D-001 Name = Waypoint.** Literal "life in weeks / 4000 weeks" names are crowded &
  partly trademarked; chose a distinctive navigation name on the boat metaphor.
  _Alts: Helm, Tiller, Headway._ _Watch-out: "Waypoint" is somewhat generic (cf.
  HashiCorp) — verify domain/trademark before commercial launch._
- **D-002 Famous lifemaps from day one** — feasible with bundled data, no backend.
- **D-003 Roster = historical figures first** (Ford, Edison, Einstein, da Vinci, Curie)
  — lowest publicity-rights exposure; modern/protected-state figures (Jobs, Musk, Elvis,
  MJ) deferred pending legal review. All facts-only, no photos/logos, non-affiliation
  disclaimer. (`specs/research_famous-people-and-legal.md`)
- **D-004 Stack = Next.js App Router + TS + Tailwind + PWA** — pairs with v0/Vercel.
- **D-005 Rendering = plain DOM cells**, no Canvas, no virtualization — ~4,680 nodes is
  trivial; DOM gives hover/click/range-select + a11y free. (`research_tech-and-dataviz`)
- **D-006 Storage = IndexedDB via `idb-keyval` + JSON export/import** — async,
  future-proof; export is a data-safety requirement (iOS ~7-day eviction).
- **D-007 PWA = Serwist (`@serwist/next`)** — next-pwa is stale; app-shell precache.
- **D-008 Famous data = Wikidata (CC0)** via SPARQL; avoid CC BY-SA prose.
- **D-009 UX = reflection + agency**, not dread (Cozzolino; TMT backfire failed to
  replicate); if-then implementation intentions are the headline feature (Gollwitzer
  d≈0.65); gentle trust-first onboarding; forgiving SDT gamification.
- **D-010 No git / no repo yet** — build in env first (user instruction); repo+push is
  opt-in later.
- **D-011 Logo = hand-built SVG** — the Fal MCP in this session is documentation-only
  (no image-gen tool); SVG is crisper at favicon size. Mockups still delegated to v0.

## Next

- M0 finish: brand the layout/metadata, add Serwist + `app/manifest.ts` + SVG boat
  favicon. Then M1 (`lib/types.ts`, `lib/weeks.ts`, `lib/store.ts` with idb-keyval).
- Resolve v0 mockup generation (MCP call needs approval).
- Reconcile docs naming/structure if the live City-Forma repo reveals finer Karpaty
  conventions (it was provided as a single README; folder pattern replicated).

## Tests

**Green: 0** (no runner yet). Plan: add Vitest; first targets are `lib/weeks.ts`
(current-week index for a known DOB; total-weeks; row/col mapping) and
`lib/share.ts`/`exportImport.ts` round-trips. e2e scenario (manual until then): onboard
with a test DOB → grid renders `targetAge×52` cells with the correct current week.
