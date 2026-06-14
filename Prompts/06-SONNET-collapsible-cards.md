# PROMPT 5 — Collapsible Cards (Budget + Exercise)

## CODEBASE CONTEXT

Multi-file app: `index.html`, `css/style.css`, `js/app.js`
Stack: Vanilla JS + CSS. No frameworks.
Dark mode via `[data-theme="dark"]` on html/body.
CSS variables: `--border`, `--card`, `--text`, `--muted`, `--accent`, `--radius`
Existing card class: `.card` — used throughout app.
Exercise cards use `.ex-card` class.

---

## FEATURE SPEC

Add collapse/expand toggle to cards across the app. Collapsed state shows only the card header with a summary value. Expanded state shows full card content (default).

Collapse state persists in localStorage key `daily_collapsed` — an object of `{ [cardId]: true }` where `true` = collapsed.

---

## PART 1 — Budget tab: collapsible section cards

### Cards to make collapsible (Budget > Week view):

| Card | Collapsed summary shown |
|------|------------------------|
| Income | "Total income: $X" |
| Savings | "Total saved: $X" |
| Fixed Expenses | "Total fixed: $X" |
| Variable Expenses | "Total variable: $X" |
| Weekly Result | "Leftover: $X · [status pill]" |
| Previous Weeks | "X weeks recorded" |

### Implementation:

Each `.card` in the Budget tab needs a collapsible header row added at the top:

```html
<div class="card-collapse-header" onclick="toggleCard('card-id')">
  <div class="sec-label">💰 Income</div>
  <div class="card-collapse-right">
    <span class="card-collapse-summary" id="card-id-summary"></span>
    <svg class="card-chevron" id="card-id-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
  </div>
</div>
<div class="card-collapse-body" id="card-id-body">
  <!-- existing card content here -->
</div>
```

### CSS to add in style.css under `/* ── Collapsible cards ── */`:

```css
.card-collapse-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  margin-bottom: 8px;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
.card-collapse-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.card-collapse-summary {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  opacity: 0;
  transition: opacity 0.2s;
}
.card.collapsed .card-collapse-summary {
  opacity: 1;
}
.card-chevron {
  color: var(--muted);
  flex-shrink: 0;
  transition: transform 0.25s ease;
}
.card.collapsed .card-chevron {
  transform: rotate(-90deg);
}
.card-collapse-body {
  overflow: hidden;
  transition: max-height 0.3s ease, opacity 0.25s ease;
  max-height: 1000px;
  opacity: 1;
}
.card.collapsed .card-collapse-body {
  max-height: 0;
  opacity: 0;
}
.card.collapsed {
  /* Remove bottom padding when collapsed so card is compact */
  padding-bottom: 4px;
}
```

### JS function to add in app.js:

```javascript
function toggleCard(id) {
  const card = document.getElementById(id);
  if (!card) return;
  const isCollapsed = card.classList.toggle('collapsed');
  // Persist
  const collapsed = JSON.parse(localStorage.getItem('daily_collapsed') || '{}');
  if (isCollapsed) collapsed[id] = true;
  else delete collapsed[id];
  localStorage.setItem('daily_collapsed', JSON.stringify(collapsed));
}

function restoreCardCollapse() {
  const collapsed = JSON.parse(localStorage.getItem('daily_collapsed') || '{}');
  Object.keys(collapsed).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('collapsed');
  });
}
```

Call `restoreCardCollapse()` after each render function that builds budget cards (after `renderBudgetTab()`, `renderBudgetWeek()`, etc.).

### Summary values:

After `budRecalc()` updates totals, also update summary spans:
```javascript
// After calculating totals:
const setSum = (id, text) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};
setSum('bud-income-summary', `$${totalIncome}`);
setSum('bud-savings-summary', `$${totalSaved}`);
setSum('bud-fixed-summary', `$${totalFixed}`);
setSum('bud-variable-summary', `$${totalVariable}`);
setSum('bud-result-summary', leftover >= 0 ? `+$${leftover} left` : `-$${Math.abs(leftover)} over`);
```

---

## PART 2 — Log tab: collapsible exercise cards

### Behaviour:
- Each `.ex-card` gets a small collapse toggle button in its top-right corner (next to the existing check button)
- When an exercise is marked **done** (check button tapped), the card **auto-collapses** after a 400ms delay
- User can manually re-expand at any time by tapping the chevron
- Collapsed exercise card shows: exercise name + "✓ Done" or last set summary (e.g. "4×10 @ 80kg")
- Collapse state resets when the user changes day or saves the session

### Implementation:

In the function that renders each exercise card (likely `renderExercises()` or similar), add a collapse toggle button inside `.ex-top` or `.ex-top-bar`:

```html
<button class="ex-collapse-btn" onclick="toggleExCard('ex-card-{index}')" aria-label="Collapse">
  <svg class="card-chevron" ...>...</svg>
</button>
```

Add CSS:
```css
.ex-collapse-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--muted);
  flex-shrink: 0;
  -webkit-tap-highlight-color: transparent;
}
.ex-card.collapsed .ex-collapse-body {
  max-height: 0;
  overflow: hidden;
  opacity: 0;
}
.ex-card .ex-collapse-body {
  max-height: 2000px;
  overflow: hidden;
  transition: max-height 0.3s ease, opacity 0.2s ease;
  opacity: 1;
}
.ex-card.collapsed .card-chevron {
  transform: rotate(-90deg);
}
.ex-card-done-summary {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
  display: none;
}
.ex-card.collapsed .ex-card-done-summary {
  display: block;
}
```

Wrap the set inputs and add-set button (everything below `.ex-top`) in a `<div class="ex-collapse-body">`.

Auto-collapse on done — in the function that handles the check button tap:
```javascript
// After marking exercise done:
setTimeout(() => {
  const card = document.getElementById(`ex-card-${index}`);
  if (card) card.classList.add('collapsed');
}, 400);
```

Exercise collapse state is NOT persisted to localStorage — it resets on page load and day change (ephemeral UI state only).

---

## PART 3 — Settings tab: collapsible settings cards (optional, lower priority)

Apply the same `.card-collapse-header` pattern to settings cards if time permits. Each settings section card (Profile, Health, etc.) can be independently collapsed. Persist state in `daily_collapsed` with keys like `settings-health`, `settings-profile`, etc.

---

## VERIFICATION

1. Open Budget tab → all cards expanded by default
2. Tap chevron on Income card → collapses, shows "Total income: $X" summary
3. Refresh page → Income card stays collapsed
4. Tap chevron again → expands
5. Enter income value → summary updates while collapsed
6. Open Log tab → complete an exercise → card auto-collapses after 400ms showing done summary
7. Tap chevron on collapsed exercise card → re-expands
8. Change day → all exercise cards back to expanded
9. Test on mobile 375px — chevron tap target is comfortable
10. Dark mode — chevron and summary text look correct
