# PROMPT 16 — Log Page: Lighter Green + Slightly Taller Collapsed/Done Exercise Row

## CODEBASE CONTEXT

Screenshots (desktop, dark mode, Log tab): Francois circled the collapsed "Shoulder Press Plate
Loaded" row twice — the green is "too faded and dark," and the row itself "feels out of place"
next to the full-height exercise cards below it.

This is the `.ex-card.collapsed.done` combo — per CLAUDE.md, one of three separate
collapse/expand systems in this codebase (`.ex-card.collapsed` is its own ruleset in
workout.css, unrelated to the generic `.card.collapsed` or budget's `.bud-collapsed`). Current
rules (css/workout.css):
```css
.ex-card.done{opacity:0.75;border-color:rgba(82,183,136,.35)}                          /* 21 */
[data-theme="dark"] .ex-card.done{background:linear-gradient(180deg, rgba(82,183,136,.30), rgba(82,183,136,.10));box-shadow:inset 0 1px 0 rgba(255,255,255,.14)}  /* 22 */
...
.ex-card.collapsed{padding:7px 12px;margin-bottom:6px;border-radius:12px}               /* 59 */
...
.ex-card.collapsed.done .ex-mini-progress{color:var(--positive)}                       /* 67 */
```
The 0.75 opacity on `.ex-card.done` (line 21) is a deliberate earlier choice to visually
de-emphasize finished exercises (see the comment above line 19) — that's fine on a full expanded
card with plenty of other content around it, but on the collapsed single-line strip it stacks
with the already-low-alpha green gradient and reads as murky/hard to read, which is the actual
complaint. Line 67 already shows the precedent for a `.ex-card.collapsed.done`-scoped override
living in this codebase, so this prompt follows that same pattern rather than touching the
shared `.done` rule (which would also change the look of expanded completed cards — not what was
asked).

## TASK

### 1. Lighter green, collapsed+done only (dark theme)
Add this new rule near the existing collapsed-specific block, right after line 67:
```css
[data-theme="dark"] .ex-card.collapsed.done{
  opacity:0.95;
  background:linear-gradient(180deg, rgba(82,183,136,.45), rgba(82,183,136,.22));
}
```
Higher specificity than line 22 (`.ex-card.collapsed.done` vs `.ex-card.done`) so it wins
automatically regardless of where it sits in the file — placing it in the collapsed block is
just for readability/grouping, matching how line 67 already groups a collapsed+done override
there.

### 2. Slightly taller collapsed row
Change line 59 from:
```css
.ex-card.collapsed{padding:7px 12px;margin-bottom:6px;border-radius:12px}
```
to:
```css
.ex-card.collapsed{padding:10px 14px;margin-bottom:6px;border-radius:12px}
```
Small bump only — Francois asked for "a tiny bit," not a redesign. If it still feels cramped
after this, that's a follow-up with a fresh screenshot, not a bigger pass now.

## OUT OF SCOPE

- Expanded (non-collapsed) done-card look — untouched. The existing 0.75 opacity + subtler
  gradient stays exactly as it is there; that's the deliberate "de-emphasize what's already
  finished" choice mentioned above, separate from the collapsed-strip legibility problem this
  prompt fixes.
- Light theme's collapsed+done look (css/workout.css:23 is the light equivalent of line 22) —
  not confirmed broken by a screenshot, left alone. Flag it if it also looks off once you check.
- `.ex-mini-progress` colour, `.exercise-done-check` icon size (line 68) — no reported issue with
  either, both unaffected by this change.

## VERIFICATION — for Francois to check (dark mode, Log tab)

1. Complete an exercise so it collapses → the green should read noticeably lighter/brighter than
   before, with the exercise name easy to read against it.
2. The collapsed row should look a little taller/less squished next to the full exercise cards
   below it — still clearly more compact than an open card, just not as cramped.
3. Expand a completed exercise back open → looks exactly the same as before this prompt
   (unaffected — this fix only touches the collapsed strip).
4. Switch to light theme → collapsed+done row unchanged from before this prompt (not part of
   this fix, flag separately if it needs the same treatment).
