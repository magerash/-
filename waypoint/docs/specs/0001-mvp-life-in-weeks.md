# Spec 0001 — MVP: Life-in-Weeks (Waypoint)

_Status: approved 2026-06-22. Source of truth for the MVP build. Research backing in the
sibling `research_*.md` files (synthesis: `research_life-in-weeks.md`); decisions in
`../architecture.md` §6 and `../journal/2026-06-22-research-and-scaffold.md`._

## Goal
A beautiful, installable PWA where a user maps their life in weeks, names past chapters,
plans future blocks, and compares against curated historical lifemaps — fully
client-side, no backend.

## User stories
1. As a new user, I'm guided through a gentle onboarding (welcome → name → birth date →
   target-age slider) ending in an animated reveal of my filled grid.
2. I see a square grid of every week of my life (~`targetAge × 52` cells), with the
   current week highlighted and a "weeks lived / weeks ahead" header.
3. I can name a **past chapter** by selecting a week range and giving it a title/color.
4. I can create a **future plan** by selecting a start→end week range, naming it, picking
   a category/color, and adding an optional "if-[when/where]-then-I'll" intention.
5. I can pick a **famous figure** and overlay their life aligned by age, with "at my age,
   they had…" callouts and a non-affiliation disclaimer.
6. My data persists locally; I can **export/import JSON** and copy a **read-only share
   link** (state encoded in the URL).
7. The app installs as a PWA and works offline.

## Data model
```ts
type LifeMap = {
  version: number;
  profile: { name: string; birthDate: string /* ISO */; targetAgeYears: number };
  blocks: LifeBlock[];
  settings: { theme: 'light'|'dark'|'system'; reducedMotion: boolean; intensity: 'gentle'|'full' };
};
type LifeBlock = {
  id: string; title: string;
  category?: 'education'|'career'|'family'|'health'|'project'|'other';
  color: string; startWeekIndex: number; endWeekIndex: number; // inclusive, weeks from birth
  kind: 'past'|'plan'; note?: string;
  intention?: { cue: string; action: string }; // if-then (plans)
};
type FamousLifeMap = { // bundled, read-only
  id: string; name: string; birthDate: string; deathDate?: string;
  blocks: { title: string; startWeekIndex: number; endWeekIndex: number; source: string }[];
};
```
Week math: `totalWeeks = targetAgeYears * 52`; `currentWeekIndex = floor((now − birth)/7d)`.
Famous overlays align **by age** (week-from-birth).

## Architecture (see research: tech-and-dataviz)
- **Rendering:** plain DOM `<button>` cells, rendered once; one delegated listener;
  CSS-class/variable-driven state. No Canvas, no virtualization.
- **Layout:** CSS Grid `repeat(52, minmax(0,1fr))` + `aspect-square`; year-label gutter;
  horizontal scroll on mobile.
- **State/storage:** Zustand + `idb-keyval` (IndexedDB); `navigator.storage.persist()`;
  JSON export/import; URL-hash share encoding.
- **PWA:** Serwist (`@serwist/next`), `app/manifest.ts`, app-shell precache cache-first.
- **A11y:** grid/row/gridcell roles, roving tabindex, `aria-selected`, `aria-live`,
  descriptive labels, reduced-motion, non-color state cues.

## Famous data (see research: famous-people-data-and-legal)
MVP roster: Henry Ford, Thomas Edison, Albert Einstein, Leonardo da Vinci, Marie Curie.
Source = **Wikidata (CC0)**; each block stores a source URL; **facts only, no photos/
logos**; standing non-affiliation disclaimer. Stored as `data/famous/*.json`.

## UX principles (see research: ux-and-psychology)
Reflection + agency (never just "weeks gone"); if-then intentions as the headline
feature; future-self vividness; gentle trust-first onboarding; SDT-aligned, forgiving
gamification; tone/intensity control and off-ramps.

## Out of scope (MVP) → backlog
Community/accounts/sharing of user maps (needs backend); modern famous figures (legal
review); months view / "tail end" countdowns; designed poster export; reminders.

## Acceptance / verification
- Grid renders `targetAge × 52` cells; current-week index correct for a test DOB.
- Create a past chapter + a future plan (range select) with an if-then prompt.
- Famous overlay aligns by age + shows "at my age" callout + disclaimer.
- JSON export → reimport round-trips identically.
- Keyboard-only roving nav + range select; meaningful screen-reader labels;
  `prefers-reduced-motion` honored.
- Lighthouse: PWA installable + offline (SW, manifest, icons); reload offline serves the
  shell; data persists.
