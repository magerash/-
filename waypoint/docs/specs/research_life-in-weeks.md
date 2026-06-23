# Research Synthesis — "Life in Weeks" product (2026-06-22)

Combined findings from a five-angle deep-research pass. Detailed per-angle reports and
all citations are in the sibling files in this folder. Confidence flags and caveats are
preserved in those files.

## 1. Competitive landscape — the gap is real
Category origin: **Tim Urban's "Your Life in Weeks" (2014)** — a 90×52 = **4,680-box
grid**, one box = one week, one row = one year ([WBW](https://waitbutwhy.com/2014/05/life-weeks.html))
— plus **Oliver Burkeman's _Four Thousand Weeks_** ([Wikipedia](https://en.wikipedia.org/wiki/Four_Thousand_Weeks:_Time_Management_for_Mortals)).
- Web tools (Bryan Braun, weeksofyour.life, lifeweeks.app, ekn.io): free, local-only,
  **backward-looking** — shade weeks lived, future is blank.
- Mobile apps (Lifetime, Lifev, 4K Weeks, WeCroak): subscription monetization; loudest
  complaints = **aggressive paywalls** and the grid feeling **bleak**.
- **Two white spaces unfilled by any incumbent:** (1) **true future block-planning**;
  (2) **personal comparison to other people** (lifeweeks.app overlays world *events*,
  not people). These are exactly our differentiators.

## 2. UX & psychology — reflection, not dread
- Mortality framing cuts both ways. **Terror Management Theory** says death reminders
  can backfire — **but** that classic effect **largely failed to replicate** (Many Labs
  4, d≈0.03 vs claimed ~0.5, [Collabra](https://online.ucpress.edu/collabra/article/8/1/35271/168050/)).
  Reconciler = **Cozzolino**: *abstract* death → defense; *specific, personalized
  reflection* → gratitude, intrinsic goals ([PubMed](https://pubmed.ncbi.nlm.nih.gov/21742931/)).
  → **Always pair finitude with agency.**
- **Highest-leverage feature = implementation intentions** (if-then), Gollwitzer
  meta-analysis d≈0.65 ([review](https://www.tandfonline.com/doi/abs/10.1080/10463283.2024.2334563)).
- The grid is a **future-self-continuity device** (Hershfield, [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC3949005/)).
- **Tim Urban hook:** the Panic Monster only fires on deadlines → deadline-free life
  goals slip away forever. Gamify via **Self-Determination Theory**; **forgiving** streaks.

## 3. Tech — plain DOM is the right call
- ~5,200 cells render fine as **DOM** (`<button>`); Canvas only worth it >100k cells.
  One delegated listener; CSS-class-driven state.
- Layout: CSS Grid `repeat(52, minmax(0,1fr))` + `aspect-ratio:1`.
- Storage: **IndexedDB via `idb`** + **JSON export/import**; call
  `navigator.storage.persist()` (iOS evicts script storage after ~7 days).
- PWA: **Serwist (`@serwist/next`)**, app-shell precache cache-first.
- A11y: `role=grid`, roving tabindex, `aria-selected`, `aria-live`, reduced-motion,
  never color-only state.

## 4. Famous lifemaps — safe by construction
- Source = **Wikidata (CC0)** (P569 birth, P570 death, P69 education, P108 employer,
  P800 notable works); avoid CC BY-SA Wikipedia prose.
- Legal: factual biography is protected; risk = **implied endorsement** + **photos/
  logos**. Postmortem publicity rights vary wildly by state (CA §3344.1 = 70 yrs; TN
  "ELVIS Act"). → **facts-only, no photos/logos, cite sources, non-affiliation
  disclaimer; long-deceased figures first.** ([Cornell LII](https://www.law.cornell.edu/wex/publicity))

## Strategic conclusion
A **generous-free, local-first, beautiful** PWA that is **forward-looking**
(block-planning + if-then goals) and **comparative** (famous lifemaps), framed as
**reflection + agency**, with the **boat-you-steer** metaphor as the antidote to
drifting. Pick a distinctive name (literal terms are crowded/trademarked) → **Waypoint**.

_Method note: WebSearch worked; many WebFetch calls were blocked (403) on dynamic pages
and primary sources (App Store, waitbutwhy.com, MDN), so some specifics rest on search
snippets — flagged per-claim in the detailed files. Legal content is general
information, not legal advice._
