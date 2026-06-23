# Glossary

- **Week index** — a week's absolute position counted from birth, 0-based.
  `currentWeekIndex = floor((now − birthDate) / 7 days)`.
- **Total weeks** — `targetAgeYears × 52` (canonical Wait-But-Why grid: one row = one
  year = 52 weeks; we use 52, not the literal 52.18, to match the convention).
- **Cell** — one square in the grid = one week of life.
- **Block** — a named span of consecutive weeks. Two kinds:
  - **Chapter** (`kind: 'past'`) — a labelled era already lived (e.g. "University").
  - **Plan** (`kind: 'plan'`) — a future commitment over a selected week range, with an
    optional **intention**.
- **Intention** — an "if-[when/where]-then-I'll" implementation intention attached to a
  Plan (Gollwitzer); the highest-leverage follow-through device.
- **LifeMap** — the user's whole document: profile + blocks + settings.
- **FamousLifeMap** — a bundled, read-only life of a notable person, modelled as dated
  factual blocks, each citing a Wikidata source.
- **Age-aligned overlay** — rendering a FamousLifeMap on the user's grid by **week-from-
  birth** (age), enabling "by my current age, they had…" comparisons.
- **App shell** — the static HTML/CSS/JS the service worker precaches so the app loads
  offline; user data lives separately in IndexedDB.

## Inspirations (proper nouns)

- **Your Life in Weeks** — Tim Urban / Wait But Why essay (2014); the genre's origin.
- **The Tail End** — Tim Urban essay (2015) on remaining units of experience.
- **Instant Gratification Monkey / Rational Decision-Maker / Panic Monster** — Urban's
  procrastination characters.
- **Four Thousand Weeks** — Oliver Burkeman (2021); "accept finitude, choose what
  matters."
- **Memento mori** — the contemplative tradition of remembering mortality.
