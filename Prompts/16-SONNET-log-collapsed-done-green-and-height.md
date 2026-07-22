# PROMPT 16 — Log Page: Fix a Real Opacity Bug, Then Brighter Green + Taller Collapsed Row

## UPDATE

Francois flagged this twice now (second screenshot: still "too dark," "too small when
minimised," and now also confirmed on mobile, not just desktop). Went looking for why a value
that was already supposedly bumped once before (see the workout.css comment below) still reads
too dark, and found the real cause — a genuine CSS bug, not just a taste tweak. This version
fixes that bug first, then applies a noticeably stronger brightness/height bump than a first
pass at this would have used, since "just a tiny bit" clearly undershot what was wanted.

## THE ACTUAL BUG (found via grep, not guessed)

Two different rules set the opacity of a completed exercise card, and they conflict:
```css
/* css/workout.css:21 — the "real", intentional rule */
.ex-card.done{opacity:0.75;border-color:rgba(82,183,136,.35)}

/* css/kitchen-extras.css:224-225 — leftover dead code that happens to also match .ex-card.done */
.exercise-card{border-radius:var(--radius-card)}
.ex-card.done,.exercise-card.completed{opacity:.5}
```
`.exercise-card` (as opposed to `.ex-card`) is never referenced anywhere in index.html or
js/app.js — confirmed via grep — it's dead CSS from an earlier naming convention, before the app
settled on `.ex-card`. It was never fully cleaned up, and at some point `.ex-card.done` got
bundled onto the same line as the dead `.exercise-card.completed` selector.

Both rules target `.ex-card.done` with identical specificity (two classes each), so it comes
down to load order. Per CLAUDE.md's documented CSS cascade order
(base → layout → workout → nutrition-modals → budget-home → **kitchen-extras**),
kitchen-extras.css loads last — so its `opacity:.5` silently wins over workout.css's intended
`opacity:0.75`, on every completed exercise card, expanded or collapsed, in both themes. The
workout.css comment above line 21 ("Opacity lifted from the old 0.4 so the green...") shows
someone already tried to fix this exact "too dark" complaint once — it just didn't work, because
this second conflicting rule wasn't touched and kept quietly overriding it back down.

## TASK

### 1. Remove the dead/conflicting rule
In css/kitchen-extras.css, delete both lines:
```css
.exercise-card{border-radius:var(--radius-card)}
.ex-card.done,.exercise-card.completed{opacity:.5}
```
`.exercise-card`/`.exercise-card.completed` have zero live references — confirm with one more
grep for `exercise-card` (not `ex-card`) across index.html/js/app.js before deleting, same as
any other dead-code removal, but it should come back empty. Deleting this lets workout.css:21's
real `opacity:0.75` apply cleanly everywhere for the first time — this alone should make the
**expanded** done-card state noticeably less dark too, as a side benefit, even though that
wasn't what was reported.

### 2. Brighter green, collapsed+done specifically (dark theme)
Add near the existing collapsed-specific block in css/workout.css, right after line 67
(`.ex-card.collapsed.done .ex-mini-progress{color:var(--positive)}`):
```css
[data-theme="dark"] .ex-card.collapsed.done{
  opacity:1;
  background:linear-gradient(180deg, rgba(82,183,136,.55), rgba(82,183,136,.30));
}
```
This is deliberately brighter than just restoring the "intended" 0.75/.30/.10 baseline from
task 1 — a collapsed single-line strip has much less area for the green to read on, so it needs
more contrast than a full expanded card to look equally "bright" at a glance. Higher specificity
than workout.css:22 (`.ex-card.collapsed.done` vs `.ex-card.done`), so it wins regardless of
where it sits in the file.

### 3. Taller collapsed row
Change css/workout.css:59 from:
```css
.ex-card.collapsed{padding:7px 12px;margin-bottom:6px;border-radius:12px}
```
to:
```css
.ex-card.collapsed{padding:12px 14px;margin-bottom:6px;border-radius:12px}
```
Bigger bump than "a tiny bit" this time — still visibly more compact than a fully expanded card
(which pads at 16px, workout.css:16), but a real, noticeable difference from today's 7px, not a
marginal one.

## OUT OF SCOPE

- Light theme's collapsed+done look — not given its own brightness override here, but task 1's
  bug fix (removing the opacity:.5 conflict) applies to light theme too, so it should already
  look better than before without a light-specific rule. Flag it with a screenshot if it still
  needs more after that.
- `.ex-mini-progress` colour, `.exercise-done-check` icon size (workout.css:68) — no reported
  issue with either, unaffected.
- Any other card that might also incidentally match a dead `.exercise-card`-style selector —
  this prompt only removes the one confirmed-dead rule above, not a broader dead-CSS audit.

## VERIFICATION — for Francois to check, on both mobile and desktop, both themes if you can

1. Complete an exercise so it collapses → green should now read clearly brighter, not muddy —
   check this is actually different from before, not just theoretically fixed.
2. The collapsed row should look meaningfully taller than before — a real difference at a
   glance, not something you have to squint to notice.
3. Expand a completed exercise back open → also slightly brighter than before (task 1's bug fix
   affects this state too) — should still clearly look "more subdued than an active card," just
   not murky-dark anymore.
4. Light theme → collapsed+done row should look at least somewhat better from task 1 alone; say
   so if it still needs its own explicit brightness bump like dark theme got.
