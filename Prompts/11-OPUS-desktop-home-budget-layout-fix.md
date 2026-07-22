# PROMPT 11 — Fix: Home and Budget Desktop Layouts Are Dead CSS

## CODEBASE CONTEXT

Desktop layout (≥1024px) mostly lives in one `@media (min-width:1024px){...}` block in
`css/budget-home.css` (lines 199-307). The outer container fix works correctly — `#app` and
`#app-main>section` both drop their mobile `max-width:480px` cap on desktop (budget-home.css:
200, 204-205), so every tab's `<section>` genuinely becomes full-width on a desktop browser.

## THE BUG (confirmed by grep, not guessed)

Grepped `home-top-row`, `log-cols`, `log-left`, `log-right`, `budget-desktop-grid`,
`desktop-exercise-nav`, `kit-cols` across both `index.html` and `js/app.js`:

- `.log-cols` / `.log-left` / `.log-right` / `#desktop-exercise-nav` — **present and correctly
  wired.** They're static wrapper divs in `index.html` (~lines 96-101), and `js/app.js` (~line
  2051) populates `#desktop-exercise-nav`. This is why Log's exercise nav list works.
- `.kit-cols` — **present and correctly wired** as a static wrapper in `index.html` (~line 365).
  This is why Kitchen's two-column (list/detail) layout works.
- `.home-top-row` (the wrapper `#view-home .home-top-row{display:flex;gap:16px}` /
  `#view-home .home-top-row>.hero-card{flex:0 0 55%}` at budget-home.css:248-252 depends on)
  — **zero matches anywhere.** No element in `index.html` or any string in `js/app.js` ever
  applies this class.
- `.budget-desktop-grid` (the wrapper `#view-budget .budget-desktop-grid{display:grid;
  grid-template-columns:1fr 1fr;gap:20px;align-items:start}` at budget-home.css:279 depends on)
  — **zero matches anywhere.** Same problem.

Net effect: the CSS for Home's side-by-side hero+stats row and Budget's two-column layout is
correctly written and would work — but nothing ever applies the class it's scoped to, so it
never fires. On desktop, Home and Budget silently fall back to a plain single-column mobile
stack sitting inside a much wider, mostly-empty pane. That's almost certainly what reads as
"cramped and not adjusted to desktop" — the outer container did get wider, the inner content
never got the layout that was written for it.

## TASK

### Home
Find wherever `#view-home`'s content actually gets built (search for the render function —
likely `renderHome()`). Wrap the hero card and the 4-stat `.home-grid` in a `.home-top-row` div,
matching what budget-home.css:248-252 already expects:
```html
<div class="home-top-row">
  <!-- existing hero-card markup, unchanged -->
  <!-- existing .home-grid markup, unchanged -->
</div>
```
Don't change anything inside the hero card or the grid — only add the wrapping div. Everything
else on Home (habits, budget snapshot, notes card, etc.) stays exactly where it is, below this
row, same as today.

### Budget
Find the Budget tab's render function. Wrap the Budget sections in a `.budget-desktop-grid` div
so budget-home.css:279's `grid-template-columns:1fr 1fr` has something to apply to:
```html
<div class="budget-desktop-grid">
  <div><!-- left column sections --></div>
  <div><!-- right column sections --></div>
</div>
```
Use your judgment on the left/right split after looking at what actually renders today — a
natural grouping is something like income/savings/fixed/variable inputs on one side and weekly
summary/history/charts on the other, but pick whatever grouping the real content supports
cleanly. This wrapper is scoped inside the `@media(min-width:1024px)` block, so it's harmless on
mobile — no mobile-specific handling needed for it.

### While you're in that media-query block
Skim the rest of `budget-home.css:199-307` for any other selector that assumes a wrapper class
the same way `.home-top-row` and `.budget-desktop-grid` did — I checked those two specifically
and confirmed they're dead, but didn't exhaustively re-verify every other selector in the block
(e.g. `#view-stats .charts-row`). If you find another one that's similarly unreachable, fix it
the same way (add the wrapper where the content renders); if everything else already has its
matching element, leave it alone.

## OUT OF SCOPE

Don't touch `.log-cols` / `.log-left` / `.log-right` / `#desktop-exercise-nav` — Log's wrapper
structure already exists and is correctly wired. Francois also flagged Log as feeling cramped on
desktop, but since its column structure is confirmed present in the code, that's a different,
more specific problem (most likely inside the exercise cards themselves not scaling up, not a
missing wrapper) — worth a fresh look with an actual screenshot once this prompt ships, not
something to guess at blind in this pass.

## VERIFICATION — for Francois to check on desktop (resize browser to ≥1024px wide)

1. Home tab: hero card and the 4-stat grid sit side by side (hero roughly 55% width, grid takes
   the rest) — not stacked one under the other in a narrow column.
2. Budget tab: sections appear in two columns side by side, not one long single column down the
   middle of a mostly-empty page.
3. Resize the browser back down below 1024px → both tabs return to the normal single-column
   mobile layout — nothing desktop-specific should leak onto phone/tablet widths.
4. Nothing inside the hero card, home-grid, or budget sections changed in content or behaviour —
   this should look like rearranged furniture, not a redesign.
5. Log and Kitchen tabs — unaffected, look the same as before this prompt.
6. Still cramped-looking anywhere after this? Screenshot it — the fix above only covers the two
   confirmed-dead wrappers, not every possible desktop sizing issue.
