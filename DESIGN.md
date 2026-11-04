# VocabUp design system

## Product and direction

VocabUp serves Vietnamese-speaking learners who collect vocabulary and return for short spaced-repetition sessions. The primary sequence is dashboard → review → reveal → rate → completion. A second sequence is deck library → search / create / import / edit words. Preserve the existing session, permissions, scheduling and data contracts.

The new direction is a quiet study notebook: warm paper, green ink, editorial headings, practical sans-serif controls. It works in daylight and has a dark reading theme. The interface prioritizes recall and finding words. It does not use scroll-controlled video, animated scenery, or generated assets.

## Implementation

`frontend/src/notebook.css` owns the new semantic theme and responsive component treatments. It loads after legacy feature styles and theme controls. Feature-specific structure stays in the existing React components; no new runtime dependency was added. Existing admin feature layouts remain owned by the admin stylesheet. Future work should migrate remaining hardcoded legacy colors to these tokens rather than adding more overrides.

## Tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--canvas` | `#f4f3ec` | `#17231c` | Page background |
| `--surface` | `#fffef9` | `#202e26` | Forms, cards, dialogs |
| `--surface-2` | `#eeeee4` | `#29392f` | Subordinate surfaces |
| `--ink` | `#243c34` | `#e5ece4` | Primary text |
| `--muted` | `#607067` | `#b2c1b5` | Secondary text and placeholders |
| `--brand` | `#246650` | `#9acdb1` | Actions, focus, selected states |
| `--brand-soft` | `#e8f0e9` | `#293e32` | Selected navigation, review actions |
| `--line` | `#d9dfd5` | `#3e5044` | Separators |

Typography: Georgia/Times serif for headings and vocabulary; Segoe UI/sans-serif for controls and body copy. These local stacks avoid remote font requests and retain broad Unicode fallback. Main headings use 30–42px; review prompts and authentication headings can be larger. Body text is 15px with 1.55–1.8 line height. Inputs use 16px on phones. Do not truncate study terms or definitions. Headings wrap; counts remain on one line.

Spacing follows a 4px base: 8/12px within groups, 16/24px between related items, 32/48px between sections. Controls have 6–7px radii; surfaces 8–12px. Most buttons and deck actions have at least 44px hit areas. Focus uses a 3px brand outline with a 3px offset.

## Components and behavior

- **Navigation:** label and icon, `aria-current` on the active destination. Deck shortcuts and titles open the library. The explicit review button starts studying. A skip link exposes the main content to keyboard users.
- **Dashboard invitation:** first use offers deck creation; due words offer review; a caught-up session offers the library. The summary is a unified strip rather than four competing cards.
- **Deck card:** title, description, word/due counts, favorite, options, import, and a labeled review action. No inferred mastery bar: due counts do not establish mastery. Destructive actions stay in a confirmation flow.
- **Library:** searchable deck index; word library places the list before optional statistics. Native `details` reveals analysis. Phone word rows stack the term, meaning and actions rather than squeezing desktop columns.
- **Review:** immediate reveal, Vietnamese rating labels, honest zero-based progress, request lock and disabled ratings during persistence. Failed requests retain the current card. All scheduling remains server-owned.
- **Forms:** persistent labels, native required/type/length validation, disabled save while pending, preserved input on failure, explicit success status. Dialogs expose their role/name and contain Tab focus. Escape follows existing close behavior.
- **Menus:** dismiss on outside pointer interaction or Escape; Escape restores the trigger focus.

## States

| State | Treatment |
| --- | --- |
| Loading | Existing loader/skeleton; do not show a successful empty result while loading |
| Empty collection | Explain the next step and offer first creation |
| No search matches | Explain how to change or clear the query; do not suggest that the collection is empty |
| Success | Polite `role=status` confirmation |
| Error | `role=alert`; retain form data for retry |
| Disabled/pending | Disabled native control, no transform, existing label or “Đang lưu…” |
| Hover/pressed | Color or border feedback; subtle 0.98 press scale |
| Keyboard | Visible outline, labeled controls, dialog Tab containment |

## Motion and responsive rules

Repeated navigation and study-card changes have no entrance/flip duration. Occasional control feedback uses 140ms transitions. All animation and transitions are disabled for reduced motion. No animation library or video payload is needed.

At 1100px and below, deck grids and summaries use two columns and the decorative session note disappears. At 800px and below, existing mobile navigation applies. At 560px and below, decks become one column, word rows stack, and controls wrap. Test narrow phones, tablet widths, long unbroken text, Vietnamese diacritics, and mixed-script vocabulary. Do not encode meaning exclusively in color.

## Skill sources and selective application

Downloaded on 2026-11-04 under ignored `.design-skills/`:

- [Impeccable](https://github.com/pbakaus/impeccable), `f864521`: skill, new-work and craft-floor references; task-first layout, hierarchy, states and visual inspection. Its engine launcher could not initialize within the sandbox; direct repository/product inspection was used.
- [Emil Kowalski skills](https://github.com/emilkowalski/skills), `f1090be`: `emil-design-eng`; frequency-based motion decisions, responsive press feedback and clear states.
- [GSAP skills](https://github.com/greensock/gsap-skills), `aed9cfd`: `gsap-performance`; avoid unnecessary animation and layout work. GSAP was not added because native CSS covers the selected interactions.
- [Scroll World](https://github.com/oso95/scroll-world), `71cc36d`: reviewed for suitability. Paid generated-video pipelines and cinematic scroll interaction were excluded for this repeated-use learning product.

See `docs/REDESIGN_AUDIT.md` for evidence, checks and remaining limits.
