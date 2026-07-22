# Daily — Project Reference

Personal lifestyle web app for Francois: workout tracking, kitchen/recipes, budget, and
habit/notes tracking. No build step, deployed via GitHub Pages from `main` at
sourgits.github.io/workout-tracker.

This file has been out of sync with the app before (an old written description said "4 tabs,
single HTML file" long after the app outgrew that). Trust what's actually in the repo over any
older summary — re-grep before assuming a fact from here is still true if it looks surprising.

## Stack

- Vanilla HTML/CSS/JS — no framework, no bundler, no npm build step.
- Entry point `index.html`. Styles split into six files, loaded in this order (cascade order
  matters, don't reorder the `<link>` tags): `css/base.css`, `css/layout.css`, `css/workout.css`,
  `css/nutrition-modals.css`, `css/budget-home.css`, `css/kitchen-extras.css`. Split from one
  `style.css` partway through the project (commit `52f32d0`).
- All logic in one `js/app.js` (~10,000 lines).
- PWA: `manifest.json` + `service-worker.js`, installable to iOS/Android home screen,
  `display: standalone`.
- Optional cross-device sync: Firebase Realtime Database + Google Auth. localStorage is the
  source of truth; Firebase mirrors it when signed in.
- Chart.js (cdnjs), Tabler Icons (jsdelivr), Google Fonts — Manrope (UI) + Space Grotesk
  (numerals/wordmark).

## Navigation (restructured many times over the project's life — this is current as of 2026-07-21)

- **Mobile bottom nav** (`#bottom-nav`, 4 fixed tabs): Home, Budget, Log, Stats.
- **Mobile hamburger menu** (`#side-menu`, list populated dynamically in JS): Kitchen, Accounts,
  Plans, Notes, Exercise Library, Settings.
- **Desktop** (`#desktop-sidebar`, ≥1024px): all of the above as one persistent left sidebar,
  plus an inline quick-settings popover instead of a separate Settings screen.

## What's in each area

- **Home** — dashboard of widget cards, each independently show/hideable via
  Settings → Home Layout. Today's session hero, weekly budget snapshot, calorie card,
  savings/CC balance, notes bubble, habits.
- **Log** (was "Train") — workout logging. Training split type is user-editable, not hardcoded
  to a fixed split. Log sets (weight/reps, warmup toggle, ± sign for negative-load exercises),
  swap an exercise from the library mid-session, exercise library management (custom
  exercises/groups, assisted/negative toggle per exercise), drag-to-reorder, done-check with
  auto-collapse, per-day session notes, rest timer (sticky bar + fullscreen, timestamp-based so
  it keeps correct time if the phone locks or the app backgrounds), session timer, optional
  effort rating (Easy/Moderate/Hard/Brutal), optional hours-worked tracking.
- **Stats** — Overview + History / Training / Body / Nutrition / Finance sub-tabs. Per-exercise
  history view, swap-aware personal records, progress charts, 8-week consistency grid,
  body-weight log/chart, budget charts.
- **Kitchen** — Recipe Book (9 preloaded + custom), Shopping List (from recipes + pantry
  staples), Spice & Pantry Tracker, cooking mode with per-step timers, favourites/recently
  cooked. Firebase-synced.
- **Budget** — weekly tracker. Income sources, savings target, and fixed/variable categories are
  all user-configurable now — see "Known history" below, these used to be hardcoded to
  Francois's specific numbers and were deliberately made dynamic. Credit-card balance tracking,
  comprehensive 8-section CSV export, collapsible sections, monthly/yearly charts.
- **Accounts** — net-worth tracking across accounts; added after Budget, migrated from the old
  savings/CC logs.
- **Plans** — import/export, streak tracking, plus an "HTML plan" type (import any HTML file,
  view it in a sandboxed iframe).
- **Notes** — date-tracked notes, fullscreen view, optional home-screen bubble.
- **Settings** — dark/light theme (warm gray dark palette, deliberately not pure black), personal
  info + Mifflin-St Jeor TDEE calculator (Bulk/Maintain/Cut), daily calorie log with midnight
  reset, dynamic per-muscle-group day colours, full data backup export/import, Home Layout
  widget toggles.

## Design tokens (`css/base.css`)

```
--radius-card: 22px    --radius-hero: 24px    --radius-pill: 14px    --radius: 16px
--font-ui: 'Manrope'   --font-num: 'Space Grotesk'
--accent: #FF6B35 (--accent-rgb for rgba() use)
--positive / --success: #52B788   --danger: #E74C3C   --purple: #6366f1
--bg / --card / --card-border / --card-top / --text / --text-2 / --text-3 / --muted / --border
```

Light values live in `:root` as defaults; `[data-theme="dark"]` overrides colour tokens only
(dark `--bg: #080808`, `--card` becomes a translucent white gradient "glass" look — never a
pure-black card surface).

## Known history worth knowing before touching these areas

- **iOS cold-launch layout glitch**: `100dvh` mis-computes at cold launch on iOS standalone
  PWAs (black gap / shifted content until a rotation). Fixed by giving `#app` a
  `position:fixed; inset:0` shell instead of `100dvh`. Don't reintroduce `dvh` sizing on the
  app shell.
- **Status bar**: `apple-mobile-web-app-status-bar-style` is deliberately `"black"` (opaque),
  not `"black-translucent"` — translucent forces white status-bar icons in every theme
  (unreadable in light mode) and previously caused the safe-area value to race on cold launch.
  `theme-color` is kept in sync with the live `--bg` at runtime via `applyTheme()` in
  `js/app.js`. If a screen's top spacing looks off, check whether it's still adding
  `env(safe-area-inset-top)` padding that the opaque bar has already reserved —
  `#app-header` in `css/layout.css` is the reference implementation that got this right;
  several other sticky sub-headers hadn't been brought in line as of 2026-07-21.
- **Three separate collapse/expand systems exist side by side**: generic `.card.collapsed` +
  `.card-collapse-header/body`, `.ex-card.collapsed` (a fully separate ruleset in
  `workout.css`), and `.bud-collapsed`/`.bud-toggle` (budget-only, different naming
  entirely). Know which one a given screen uses — they don't share logic, and merging them
  is a bigger job than it looks.
- **`js/app.js` builds some class names via string concatenation** (e.g. the Kitchen
  recipe-tile card: `` `kit-card kit-c-${category}${sel}` ``). Grep for both the literal class
  name and for concatenation patterns before renaming or removing any CSS class — a plain
  find-replace can miss these.
- **Card and button CSS grew one class per feature area**, not from a shared base — expect
  near-duplicate patterns (e.g. multiple independent "hero card" implementations with slightly
  different padding/gradient values) rather than one canonical definition per component type.
- **Specific hero-card gotchas** confirmed while consolidating these (2026-07-21, see
  `Prompts/08-*`): `.card.hero-card` (Home) is a NEUTRAL card, not an accent one — its
  background is `var(--card)`, so don't assume every "hero" class wants white text.
  `.log-day-hero-card`'s gradient/shadow are set INLINE per-training-day in `js/app.js`
  (~line 1979), not in CSS — a fixed CSS gradient there would fight the dynamic day-colour
  system. The Budget tab's actual weekly hero card (the one Francois sees every week) is
  `#budget-hero-card` — an ID with inline styles in `index.html` — NOT the `.budget-hero-card`
  class; that class is only used by the onboarding mini-hero / Settings → Appearance theme
  preview. A CSS-only consolidation can't reach the real one without touching markup.

## Workflow

- Francois is not a developer. He runs prompts from the `Prompts/` folder
  (`NN-MODEL-slug.md`, numbered sequentially, tagged with the model it's meant for) through
  Claude Code himself. That folder is both the changelog of every past session and the format
  to match for new prompts: codebase context → spec (with exact code where possible) →
  a numbered verification checklist he can eyeball on his phone.
- Single git repo, deployed via GitHub Pages from `main`.
