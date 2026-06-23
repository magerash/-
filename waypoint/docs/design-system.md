# Design System — Waypoint

Synthesis doc (Karpaty LLM-Wiki). UI conventions: palette, typography, components,
motion, accessibility. Update whenever UI/palette/components change. _Status: defined;
implementation pending. High-fidelity mockups delegated to v0 (pending tool approval)._

## Brand

Metaphor: a small boat with a human at the helm — steering, not drifting. Tone: calm,
hopeful, reflective. **Never** morbid or pressuring.

## Palette — "open water / dawn"

Tokens live in `app/globals.css` via Tailwind v4 `@theme`. Proposed:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f7f5f0` (warm sand) | `#0b1b2b` (deep navy) | page background |
| `--surface` | `#ffffff` | `#10263a` | cards/panels |
| `--text` | `#13212e` | `#e8eef3` | body text |
| `--muted` | `#5b6b78` | `#9fb2c0` | secondary text, future weeks |
| `--sea` | `#2a9d8f` (teal) | `#3fb9a9` | past chapters, primary accent |
| `--current` | `#e9a23b` (amber) | `#f4b860` | **current week** (warm focus) |
| `--plan` | `#5a8dee` (horizon blue) | `#7aa6f5` | future plan blocks |
| `--border` | `#e3ddd1` | `#23415a` | hairlines, cell gaps |

Category colors (blocks): education, career, family, health, project, other — derive a
calm 6-hue set from the palette; never rely on color alone (pair with label/border/icon).

## Typography

- **Headings:** a humanist/refined face (the boat/journey tone). Body: clean sans.
  Scaffold ships Geist; revisit during the design pass.
- Excellent legibility at tiny cell sizes; numerals tabular where counts are shown.

## Cells & grid

- Square cells via CSS Grid `repeat(52, minmax(0,1fr))` + `aspect-square`, `gap-px`.
- Cell states (visual + non-color cue): **lived** (filled `--sea`-tint), **current**
  (`--current`, subtle pulse, ring), **future/empty** (outline only), **in a block**
  (block color), **selecting range** (dashed), **famous overlay** (patterned/striped).
- Year labels in a left gutter; horizontal scroll for the grid on narrow mobile.

## Components & layout

Collapsible side panel for blocks/legend/famous picker (KPI-card style for
weeks-lived/ahead). Tooltips on hover/focus: "Week N · Age X · date". Modal/sheet for the
block editor and the if-then intention prompt. Empty/first-run and share/export states.

## Motion & accessibility

- Respect `prefers-reduced-motion` (disable pulse/transitions).
- `role="grid"`/`row`/`gridcell`, roving tabindex (one tab stop), arrow-key nav,
  `aria-selected`, `aria-live` for range-selection announcements, descriptive
  `aria-label` per cell. Meet WCAG contrast for text and cell borders.
