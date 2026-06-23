# Research — Famous-People Data Sourcing & Legal/Ethical (2026-06-22)

> **General information only, not legal advice.** Method: WebSearch (WebFetch blocked
> 403 on direct URLs), cross-checked across Cornell LII, FindLaw, ABA, INTA, major law
> firms, Wikidata, Creative Commons. Confirm statute specifics with counsel.

## 1. Data sources, licensing & verification
- **Wikidata** — strongest structured source. All structured data is **CC0** (public
  domain; no attribution, commercial-safe) ([Wikidata:Licensing](https://www.wikidata.org/wiki/Wikidata:Licensing)).
  Useful properties: **P569** birth, **P570** death, **P69** educated at, **P106**
  occupation, **P108** employer, **P39** position held, **P800** notable work; date
  qualifiers **P580** start, **P582** end. Query the SPARQL endpoint at
  `https://query.wikidata.org/sparql`.
- **Wikipedia / DBpedia** — richer prose but **CC BY-SA** (attribution + ShareAlike),
  which can "infect" how narrative text must be presented. Use for verification, don't
  reproduce prose.
- **Verification:** prefer Wikidata statements that carry references; cross-check dates
  against Wikipedia + an independent authority. Treat unreferenced dates as provisional.

## 2. Modeling a life into "blocks"
Pull the person's QID → query milestone properties → bucket dated events into canonical
life-stage blocks: **Childhood** (P569 + birthplace), **Education** (P69 + start/end
qualifiers), **Early career** (first P108/P39), **Founding/major venture**, **Major
works** (P800), **Legacy/death** (P570). Store a source reference per block. Keep blocks
to verifiable, dated, factual events — this doubles as the legal safe-harbor.

## 3. Legal/ethical considerations
- **Right of publicity — living people (e.g. Musk):** protects against unauthorized
  *commercial* use of identity, but **factual biographical info is generally usable**
  (First-Amendment-protected) ([Cornell LII](https://www.law.cornell.edu/wex/publicity);
  [FindLaw](https://corporate.findlaw.com/litigation-disputes/right-of-publicity.html)).
  Risk = implying **endorsement/sponsorship**, or fiction-as-fact. Laws vary by state.
- **Postmortem publicity rights — vary dramatically by state:**
  - **California (Civ. Code §3344.1):** **70 years** post-death; expanded (AB 1836) to AI
    replicas ([FindLaw](https://codes.findlaw.com/ca/civil-code/civ-sect-3344-1/)).
  - **Tennessee (PRPA 1984, "ELVIS Act" 2024):** life + ≥**10 years**, then indefinite
    while commercially exploited; the ELVIS Act **narrowed** the news exemption
    ([Rothman Roadmap](https://rightofpublicityroadmap.com/state_page/tennessee/)).
  - **New York (§50-f, 2020):** **40 years**, only for deaths on/after 2021-05-29, with
    educational/newsworthy exceptions ([DWT](https://www.dwt.com/insights/2020/12/new-york-post-mortem-right-of-publicity)).
  - **Some states have no postmortem right at all** — a state-by-state patchwork.
- **Defamation / false light:** generally **does not survive death**; estates usually
  can't sue. For living public figures, **actual malice** is a high bar and **truth is a
  complete defense** → factual accuracy is the best protection.
- **Trademark / implied endorsement:** Lanham Act §43(a) bars uses likely to confuse as
  to affiliation/sponsorship → using a **logo/brand mark** suggesting endorsement risks a
  false-endorsement claim.

## 4. Practical risk mitigation
- Present only **factual, dated, publicly documented** milestones — no fabrication.
- **Cite a source** per fact (aids verification + the "educational/factual" posture).
- Clear **disclaimer**: "Educational/informational; not affiliated with or endorsed by
  the individuals featured or their estates."
- **Avoid implied endorsement**; **avoid copyrighted photos and company logos** (text
  only, or CC0/PD imagery).
- Be most cautious with **living people and recently deceased people in protective
  states** (CA, TN, NY); long-dead historical figures carry the lowest risk.

## RECOMMENDED safe approach (MVP)
- **Data:** build on **Wikidata (CC0)** via SPARQL; use Wikipedia/DBpedia only for
  verification; do not reproduce CC BY-SA prose.
- **Presentation:** **text-only, dated, factual blocks**, each with a cited reference;
  neutral encyclopedic tone; **no logos, no licensed photos, no endorsement framing**; a
  standing non-affiliation disclaimer.
- **Selection:** favor **long-deceased historical figures** (Ford, Edison, Einstein, da
  Vinci, Curie) for MVP; flag living people (Musk) and protective-state figures (Elvis/
  TN, CA-domiciled) for legal review before any non-factual or merchandising use.
