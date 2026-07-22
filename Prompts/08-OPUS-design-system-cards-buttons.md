# PROMPT 8 — Design System: Card Hierarchy + Button Consistency

## CODEBASE CONTEXT

Multi-file app: `index.html`, `css/base.css`, `css/layout.css`, `css/workout.css`,
`css/nutrition-modals.css`, `css/budget-home.css`, `css/kitchen-extras.css`, `js/app.js`
(~9,950 lines). Vanilla JS + CSS, no frameworks. Dark mode via `[data-theme="dark"]` on `<html>`.

Existing shared tokens (`css/base.css`):
```
--radius-card:22px; --radius-hero:24px; --radius-pill:14px; --radius:16px;
--card; --card-border; --card-top; --accent; --accent-rgb; --danger; --border; --muted;
--text; --text-2; --text-3;
```

## WHY THIS PROMPT EXISTS

An audit of the CSS found roughly 40 card-related classes and 55 button-related classes spread
across the 6 CSS files, mostly defined independently per feature area instead of sharing a base.
Concretely, as of 2026-07-21:

- Four separate "hero card" implementations that are near-identical but not quite:
  `.budget-hero-card` (budget-home.css), `.hero-workout-card` (kitchen-extras.css),
  `.kitchen-hero-card` (kitchen-extras.css), `.log-day-hero-card` (workout.css) — same
  gradient/shadow formula, but different padding (18/20/22px), different margins, different
  gradient stop percentages.
- A different hero pattern on Home: `.card.hero-card` (a modifier combined with the base
  `.card` class, with its own dark-mode override at `budget-home.css:181-182`).
- A fourth elevated variant, `.card.weekly-review-card`, with its own glass/blur treatment.
- Base `.card` is defined once (`budget-home.css:2`) but several card-like components
  (`.stat-card`, `.sum-card`, `.tdee-card`, `.kit-card`) don't consistently reuse its
  background/border/radius — some redefine it from scratch with slightly different values.
- Buttons have no shared base class at all — ~55 one-off classes prefixed per feature
  (`.ob-btn-*`, `.wt-*-btn`, `.kit-*-btn`, `.rt-*-btn`, `.bud-*-btn`, `.acct-*-btn`, etc.) with
  inconsistent heights, radii, and font weights for what are functionally the same 4 kinds of
  button.

This is why the app can feel slightly "off" even though no single screen looks broken —
adjacent screens use very-similar-but-not-identical elevation and button treatments.

## GUARDRAIL — DO NOT RENAME EXISTING CLASSES

`js/app.js` builds markup via string concatenation in places, including at least one dynamic
class string: `` `kit-card kit-c-${category}${sel}` ``. Renaming or removing an existing class
name risks silently breaking a render function that a text search won't obviously catch.

**Required approach: consolidate the CSS, not the class names.** Where multiple classes should
look identical, combine them into one grouped CSS selector — e.g.:
```css
.card-hero, .budget-hero-card, .hero-workout-card, .kitchen-hero-card, .log-day-hero-card {
  /* shared rules */
}
```
so every existing element automatically picks up the shared styling. Do not edit any
`class="..."` attribute in `index.html` or `js/app.js` as part of this prompt — only touch the
CSS files. It's fine to ADD a new class name (e.g. `.card-hero`) as the canonical name going
forward, as long as nothing existing is removed or renamed.

## OUT OF SCOPE — DO NOT TOUCH

Three different collapse/expand mechanisms exist in the codebase: generic `.card.collapsed` +
`.card-collapse-*`, `.ex-card.collapsed` (its own full redefinition in `workout.css`), and
`.bud-collapsed`/`.bud-toggle` (budget-only, entirely separate naming). Leave all three exactly
as-is. This prompt is about static visual appearance only (background / border / radius /
shadow / padding / margin / color) — not toggle behaviour or any JS logic. Do not rename, merge,
or refactor any collapse-related class or function.

## PART 1 — Card hierarchy: 4 tiers

First, re-audit every card class yourself (`grep -n "card" css/*.css`, cross-checked against
`js/app.js` for dynamically-assigned classes) to build the authoritative list — treat the
inventory above as a starting point, not exhaustive. Sort every card into one of these 4 tiers
and consolidate its CSS into the matching shared rule, keeping any genuinely-unique per-card
override (icon layout, specific text size, etc.) as a small addendum rule written AFTER the
shared one.

### Tier 1 — Hero (`.card-hero`)
The single most important card on a screen — max one visible at a time. Today's workout day,
the kitchen "cook now" suggestion, the budget weekly snapshot, the Home balance card.

Consolidate `.budget-hero-card`, `.hero-workout-card`, `.kitchen-hero-card`,
`.log-day-hero-card`, and `.card.hero-card` onto one shared geometry rule (use the most common
existing values as canonical — 20px padding, 16px bottom margin):
```css
.card-hero, .budget-hero-card, .hero-workout-card, .kitchen-hero-card, .log-day-hero-card,
.card.hero-card {
  border-radius: var(--radius-hero);
  padding: 20px 20px 16px;
  margin-bottom: 16px;
  position: relative;
  overflow: hidden;
  color: #fff;
}
```
If the accent-gradient background is meant to be identical across all of them (check visually
first — `.card.hero-card` may be intentionally a lighter Home-specific tint), unify that too:
```css
.card-hero, .budget-hero-card, .hero-workout-card, .kitchen-hero-card, .log-day-hero-card {
  background: linear-gradient(150deg, rgba(var(--accent-rgb),.9), rgba(var(--accent-rgb),.6) 55%, rgba(var(--accent-rgb),.4));
  box-shadow: 0 16px 40px rgba(var(--accent-rgb),.3);
}
```

### Tier 2 — Standard (`.card`)
The everyday content card — already exists (`budget-home.css:2`). Make `.ex-card`, `.stat-card`,
`.sum-card`, `.session-card`, `.settings-card`, `.tdee-card`, `.psw-card`, `.se-day-card` all
inherit its background/border/radius/shadow via a grouped selector rather than redefining those
properties themselves. Where one currently sets its own background/border-radius to the SAME
value as `.card`, delete the duplicate declaration and add that class to the shared selector
list instead. Where a value is genuinely different, leave it as a targeted override written
after the shared rule.

### Tier 3 — Compact (`.card-compact`, new)
Smaller nested tiles / grid items that sit inside a Tier-2 card or a grid — check `js/app.js` to
confirm which specific usages apply (some class names, like `.kit-card`, are used for more than
one purpose): `.ob-mini-card`, the recipe-tile grid version of `.kit-card`, `.stats-split-card`.
Smaller radius (`var(--radius)`, 16px), tighter padding (12–14px), no colored shadow — a plain
1px border or none.

### Tier 4 — Inline (`.card-inline`, new)
Flat list rows with no elevation: `.rt-lap-row`, individual settings rows, history rows. Bottom
border only, no background/shadow/radius. Apply where a component is currently faking elevation
with padding/background it doesn't need.

## PART 2 — Button system: 4 variants

Same consolidation approach — grouped selectors, no renames. Sort the ~55 button classes into:

**`.btn-primary`** — filled accent, the one main call-to-action per screen/modal:
`.ob-btn-primary`, `.wt-save-btn`, `.wt-log-btn`, `.kit-start-cooking-btn`,
`.settings-save-btn`, `.sav-update-btn`, `.check-btn`.
```css
.btn-primary { height:44px; padding:0 20px; border-radius:12px; border:none; background:var(--accent); color:#fff; font-size:15px; font-weight:700; cursor:pointer; -webkit-tap-highlight-color:transparent; }
```

**`.btn-secondary`** — outlined, secondary action: `.ob-btn-block`, `.ob-btn-inline`,
`.lib-edit-btn`, `.bud-edit-btn`, `.home-edit-btn`, `.hist-toggle-btn`.
```css
.btn-secondary { height:44px; padding:0 20px; border-radius:12px; border:1.5px solid var(--border); background:transparent; color:var(--text); font-size:15px; font-weight:600; cursor:pointer; -webkit-tap-highlight-color:transparent; }
```

**`.btn-ghost`** — icon-only, transparent, circular tap target: `.ex-collapse-btn`,
`.rt-expand-btn`, `.kit-menu-btn`, `.swap-btn`, nav/header icon buttons.
```css
.btn-ghost { width:36px; height:36px; border-radius:50%; border:none; background:transparent; color:var(--muted); display:flex; align-items:center; justify-content:center; cursor:pointer; -webkit-tap-highlight-color:transparent; }
```

**`.btn-danger`** — destructive: `.delete-btn`, `.delete-cat-btn`, `.delete-sub-btn`,
`.wt-del-btn`, `.ex-del-btn`, `.set-delete-btn`, `.lib-del-btn`.
```css
.btn-danger { color:var(--danger); background:transparent; border:1.5px solid var(--danger); border-radius:12px; height:44px; padding:0 20px; font-size:15px; font-weight:600; cursor:pointer; -webkit-tap-highlight-color:transparent; }
```

Add each existing button class to the grouped selector for its matching variant. Where an
existing button's size genuinely needs to differ (full-width, or a smaller inline one), keep
that as a targeted override after the shared rule — don't force every button to identical
dimensions if the current layout depends on a specific size.

## PART 3 — Final consistency pass

After Parts 1–2, do a visual sweep for the "some things feel out of place" complaint
specifically:
- No more than one Tier-1 hero card visible on any single screen.
- Margin-bottom between stacked cards is consistent within each screen — check that Home, Log,
  Kitchen, Budget, Stats, and Settings each use one spacing value, not a mix of 12/14/16px.
- Corner radius is consistent within a tier across every screen — grep for hardcoded
  `border-radius:` px values that aren't using a `var(--radius*)` token and flag/fix any that
  should be.

## VERIFICATION — for Francois to eyeball on his phone

1. Home, Log, Kitchen, Budget, Stats, Settings — each hero card (today's day, cook-now
   suggestion, budget snapshot) still looks the same as before, just now sharing one CSS rule.
2. Standard cards (exercise cards, session cards, settings cards, stat cards) still look
   visually the same as before — this should be a no-op unless something was genuinely
   inconsistent, in which case it now matches its siblings.
3. All buttons app-wide: primary buttons (Save, Start, Log Set) are the same weight/color
   everywhere; delete/remove buttons all use the same red-outline treatment; icon-only buttons
   (collapse chevrons, menu, swap) are all the same size circle.
4. Check both dark mode AND light mode, especially the hero cards and the glass/blur Home cards.
5. Nothing that used to work (collapsing cards, swiping, tapping buttons) changed behaviour —
   this prompt should only touch `.css` files, never `onclick`/JS logic.
6. Spend a minute on each of the 8 nav destinations (Home, Log, Stats, Kitchen, Budget,
   Accounts, Plans, Notes) and confirm nothing visually broke.
