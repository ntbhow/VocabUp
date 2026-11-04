# Redesign audit — 2026-11-04

Severity: high = risks task correctness; medium = creates friction or excludes an interaction mode; low = presentation inconsistency.

| Severity / heuristic | Before | After | Evidence / verification |
| --- | --- | --- | --- |
| Medium — match user expectations | Deck title launched review; library was in an options menu | Titles and shortcuts open the library; labeled review action starts studying | Browser asserts `/decks/1/cards` after title click and exercises separate review flow |
| High — error prevention | Repeated ratings could submit overlapping requests | Ref lock and disabled ratings while saving | Double-click fixture produces exactly one review request |
| Medium — error recovery | Save controls lacked pending feedback | Pending save disabled; failed save retains dialog and values | Failed POST then successful retry, success status asserted |
| Medium — recognition over recall | No deck-index search | Search names and descriptions with distinct no-results state | All three viewport sizes search, clear and recover |
| Medium — visibility of system status | Progress started at 8%; deck bars inferred mastery from due count | Review starts at actual zero; unsupported deck bar removed | Code inspection and front/answer screenshots |
| Medium — mobile task efficiency | Word table squeezed columns; full analysis preceded words | Stacked word rows, collapsed native analysis disclosure | Compared expanded and collapsed library in browser; mobile screenshot inspected |
| Medium — keyboard access | Editor lacked dialog semantics; menus remained open on Escape/outside click | Named dialog, Tab containment, dismissable menu | Browser asserts focus remains inside editor after Tab from final control |
| Medium — consistency | English review grades inside Vietnamese UI | Học lại / Khó / Nhớ được / Dễ | Reveal, rate and completion workflow checked |
| Low — visual hierarchy | Purple ornamental hero, independent metric cards, repeated create tile | Paper/green palette, compact metrics, explicit next action | Desktop, tablet, phone, auth and dark captures inspected |
| Medium — responsive resilience | Long labels squeezed sidebar counts; narrow table broke words | Nonshrinking counts, wrapping labels, stacked phone rows | Long Vietnamese, Chinese, accented Latin and unbroken text fixture; no horizontal overflow |
| Medium — request ordering | Old card-search responses could replace newer results | Request sequence discards stale responses | Code review; no API changes |

## Executed checks

- `npm run build -w frontend`: TypeScript and production Vite build pass.
- `node scripts/check-redesign.mjs`: intercepted API fixture checks; Edge/Chromium desktop 1440×1000, tablet 820×1180, phone 390×844. Checks dashboard, deck library, analysis disclosure, search, keyboard reveal, rating/completion, duplicate submission, form failure/retry, first use, dark theme, touch menu, focus containment, profile rendering, invalid email, login, loading, and long content. No runtime exceptions; screenshot helper asserts no horizontal overflow.
- `node scripts/check-ui-refresh.mjs`: login and registration at the same three viewport classes; no overflow or runtime exceptions.
- `git diff --check`: no whitespace errors.
- Screenshots: `artifacts/redesign/` and `artifacts/ui-refresh/`. Final visual pass corrected the narrow tablet grid, mobile word layout, sidebar count wrapping, legacy contrast colors and repeated dashboard creation tile.
- Performance: no additional runtime library, generated media or remote font dependency. Production bundle size is reported by the build; this is not a measured field-performance or low-end-device benchmark.

## Limits / follow-up release validation

These are local frontend fixture tests, not live database or integration certification. Authentication UI is exercised with mocked responses; cookie security and server authorization are unchanged and are not re-certified by this run. CSV/APKG persistence, image providers, exports, populated statistics charts, and admin mutations need the existing integration suite against an isolated test database before a production release. No credentials, paid services, deployment or real user data were used.

Accessibility work covers semantic labels, keyboard focus, primary palette contrast, responsive text and reduced motion. No screen-reader certification, full automated WCAG audit, physical iOS/Android test, or cross-browser Safari/Firefox run is claimed. Existing admin-specific styles and advanced data visualizations still contain legacy hardcoded colors; their full visual migration is outside the learner-flow implementation delivered here.

Measured WCAG relative-luminance contrast: light muted/surface 5.19:1; light muted/canvas 4.71:1; white/primary 6.79:1; dark muted/surface 7.56:1; dark primary-button text/background 8.10:1. These are palette measurements, not an exhaustive rendered-element audit.
