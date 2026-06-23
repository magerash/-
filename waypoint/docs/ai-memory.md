# AI Memory & Onboarding — Waypoint

How any AI tool or human connects to this wiki. **The wiki is canonical**; tool-local
memory holds only a *short pointer* to it, never a copy.

## Onboarding (read in this order)

1. `README.md` — the doc map, the "concept → where to look" index, and the journal
   changelog. Start here.
2. `architecture.md` — product, stack, modules, data flow, persistence, evolution, tests.
3. `glossary.md` — domain terms (week index, block/chapter/plan, lifemap, …).
4. `specs/` — feature statements + the product research (`research_*`).
5. `code-map.md` — where each piece of code lives (by "chunk").
6. `journal/` (newest first) — the dated "raw material" of each session.

## Memory principle (Karpaty)

> Memory = **synthesis**, not raw retrieval. The journal chunk captures a session's raw
> material; the synthesis docs (`architecture`/`code-map`/`glossary`/`design-system`) are
> kept current. Search the wiki with `grep` + reading this directory.

## For tool-local long-term memory

Store a single pointer, e.g.:

> *Project Waypoint ("Life in Weeks" PWA). Memory wiki: `waypoint/docs/` (Karpaty
> LLM-Wiki). Read `docs/README.md` first. Update protocol: add a `journal/YYYY-MM-DD-*.md`
> chunk + refresh synthesis docs + index rows after every feature/iteration.*

Do **not** duplicate wiki content into tool memory — it goes stale. Link, don't copy.

## Update protocol (must follow)

See `README.md` → "Update protocol" and `llm-wiki-playbook.md`. In short: after each
feature/iteration → new journal chunk (what/how/why + "next" + green-test count) →
update affected synthesis docs → add index/changelog rows.
