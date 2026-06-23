# Waypoint — project wiki (LLM Wiki)

Synthesized project memory in Andrej Karpathy's "LLM Wiki" pattern: compiled knowledge
paged into context on demand. **Memory = synthesis, not raw retrieval (not RAG).** Search
the wiki by `grep` + reading this directory. (Same system as the *City-Forma* project.)

**Waypoint** is a website + installable PWA for planning your life in weeks: enter your
name, birth date, and target lifespan; see a square grid of every week of your life with
the current week highlighted; name past chapters; plan future blocks by selecting
start/end weeks (with if-then intentions); and compare against curated historical
lifemaps. Fully client-side. Brand: steer your own boat instead of drifting.

## Update protocol (mandatory)

**After every feature/iteration**, update both the code knowledge and the session record
— this is not optional, or the wiki goes stale.

1. **Session chunk.** Create `journal/YYYY-MM-DD-topic.md`: what was done, how it's built,
   decisions & why + a "Next" block + the **green-test count** and an e2e scenario. One
   chunk per feature/iteration.
2. **Code synthesis.** Update affected docs: `code-map.md` (paths/chunks),
   `architecture.md` (modules/flows/stack), `glossary.md` (terms), `design-system.md`
   (UI), `specs/*` (feature status & decisions).
3. **Indexes.** Add a row to the [journal/changelog](#journal--changelog) below; for new
   concepts add a row to [concept → where to look](#concept--where-to-look).
4. **Tool memory.** If a fact must survive between sessions, store a *short pointer* to
   this wiki in your AI tool's long-term memory (not a copy). Convention: `ai-memory.md`.

> Karpaty principle: the journal chunk captures a session's raw material; the synthesis
> docs are kept current. Memory is synthesis, not a dump of logs.

## Document map

| Doc | About |
|---|---|
| [architecture.md](architecture.md) | Product, stack, modules, data flow, persistence, decisions, evolution, tests |
| [code-map.md](code-map.md) | Code "chunks": `app/` shell, `lib/` logic, `components/`, `data/famous/` |
| [glossary.md](glossary.md) | Domain terms: week index, block / chapter / plan, intention, lifemap, age-aligned overlay… |
| [design-system.md](design-system.md) | UI conventions: palette, typography, cells/grid, components, motion, a11y |
| [specs/](specs/) | Feature statements + research ([0001-mvp-life-in-weeks.md](specs/0001-mvp-life-in-weeks.md), [implementation-roadmap.md](specs/implementation-roadmap.md), `research_*`) |
| [ai-memory.md](ai-memory.md) | How any AI tool/human onboards to the wiki |
| [llm-wiki-playbook.md](llm-wiki-playbook.md) | The Karpaty memory system: what we built + how to deploy it elsewhere |
| journal/ | Dated session chunks (daily-log pattern) — the raw material of each iteration |

## Concept → where to look

| I want to understand… | See |
|---|---|
| What the product is & the stack | architecture.md → §1–2 |
| Week math (current week, total weeks, row/col) | glossary.md; `lib/weeks.ts` (code-map.md) |
| Why plain DOM (not Canvas) for the grid | architecture.md → §4; specs/research_tech-and-dataviz.md |
| Data model (LifeMap / LifeBlock / FamousLifeMap) | glossary.md; specs/0001-mvp-life-in-weeks.md |
| Persistence / export / share | architecture.md → §5; `lib/store.ts`, `lib/exportImport.ts`, `lib/share.ts` |
| Famous lifemaps: data source & legal safety | specs/research_famous-people-and-legal.md; `data/famous/` |
| UX framing (reflection not dread; if-then intentions) | specs/research_ux-and-psychology.md; design-system.md |
| Competitors & differentiation | specs/research_competitive-landscape.md |
| Tim Urban / Burkeman inspiration; naming | specs/research_tim-urban-and-market.md |
| MVP feature scope & acceptance | specs/0001-mvp-life-in-weeks.md |
| Roadmap, milestones, backlog | specs/implementation-roadmap.md |
| Palette / typography / components | design-system.md |
| How an AI tool connects to this wiki | ai-memory.md |
| Deploy this wiki system in another project | llm-wiki-playbook.md |

## Journal / changelog

After each update — a dated chunk (what / how / decisions + green-test count). Newest on top.

| Date | Chunk | Topic |
|---|---|---|
| 2026-06-22 | [journal/2026-06-22-core-app-build.md](journal/2026-06-22-core-app-build.md) | Core MVP: `lib/` (types, weeks, store+idb, export/import, share, famous), components (WeekGrid, Onboarding, BlockEditor, LifeMapView), boat favicon + palette, 5 historical lifemaps. **Build green; serves HTTP 200.** 0 tests (no runner yet). |
| 2026-06-22 | [journal/2026-06-22-research-and-scaffold.md](journal/2026-06-22-research-and-scaffold.md) | Deep research (5 angles), scope decisions (name=Waypoint, historical roster, stack), `create-next-app` scaffold (Next 16/React 19/Tailwind v4), and Karpaty wiki bootstrap. **0 green tests** (no runner yet). |

## Coverage status

- **Deep:** product research (5 angles synthesized in `specs/research_*`) and the
  foundational decisions (`architecture.md` §6; journal chunk).
- **Overview:** architecture & code-map describe the *planned* module layout — most code
  is not yet written (scaffold stage).
- **Journal:** 1 chunk so far (2026-06-22).
- **AI-tool memory:** keep a short pointer to this wiki (`ai-memory.md`); the wiki is
  canonical, not local copies.

_Last updated: 2026-06-22._
