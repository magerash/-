# LLM-Wiki Playbook — the "Karpaty" memory system

What we implemented here, and how to deploy the same system in another project. Named
after Andrej Karpathy's "LLM Wiki" idea: **compiled knowledge that is paged into context
on demand. Memory is synthesis, not a raw log dump (and not RAG).** (Pattern adopted from
the *City-Forma* project at the user's request.)

## What it is

A `docs/` folder that is the project's durable, synthesized memory:

```
docs/
  README.md              wiki index: doc map · "concept → where to look" · journal/changelog · coverage status · update protocol
  architecture.md        product, stack, modules, data flow, persistence, evolution, tests
  code-map.md            code "chunks": module → responsibility (navigate code, not line-by-line)
  glossary.md            domain terms
  design-system.md       UI conventions: palette, typography, components, motion, a11y
  ai-memory.md           how any AI tool/human onboards to the wiki (link, don't copy)
  llm-wiki-playbook.md   this file
  specs/                 feature statements + research (research_*.md, implementation-roadmap.md)
  journal/               dated session "chunks" (YYYY-MM-DD-topic.md) — the raw material
```

## The update protocol (mandatory, after every feature/iteration)

1. **Session chunk.** Create `journal/YYYY-MM-DD-topic.md`: *what was done, how it's
   built, decisions & why* + a **"Next"** block + the **green-test count** and an e2e
   scenario. One chunk per feature/iteration. (Newest goes to the top of the changelog
   table.)
2. **Code synthesis.** Update affected docs: `code-map.md` (new/changed paths & chunks),
   `architecture.md` (if modules/flows/stack changed), `glossary.md` (new terms),
   `design-system.md` (if UI changed), `specs/*` (feature status & decisions).
3. **Indexes.** Add a row to README's **journal/changelog** table; for new concepts add a
   row to README's **"concept → where to look"** index.
4. **Tool memory.** If a fact must survive between sessions, store a short pointer in the
   AI tool's long-term memory (see `ai-memory.md`) — a link to the wiki, not a copy.

**Principle:** the journal chunk is the session's raw material; the synthesis docs stay
current. Memory is synthesis, not a swamp of logs.

## How to deploy in a new project

1. Create the `docs/` skeleton above; write `architecture.md` + `glossary.md` from
   whatever is known; stub `code-map.md`/`design-system.md`.
2. Seed `specs/` with the product research and an `implementation-roadmap.md`.
3. Write the first `journal/` chunk capturing the bootstrap.
4. Put the doc map, concept index, and an (empty) journal/changelog table in `README.md`,
   plus the update protocol.
5. Add `ai-memory.md` and this playbook. From then on, follow the update protocol.

## Notes for Waypoint

- Language: **English** (the product and prior research are English). City-Forma's wiki
  is Russian — same *system*, different language; switchable on request.
- Tests: Waypoint will follow the "green-test count per chunk" discipline once a runner
  is added (Vitest recommended).
