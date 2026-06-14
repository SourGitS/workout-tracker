# PROMPT 1 — Nav Restructure: Fold Stats into Home, Add Kitchen Tab

## CONTEXT

This is a multi-file lifestyle app called **Daily**. Files:
- `index.html` — structure and HTML
- `css/style.css` — all styles
- `js/app.js` — all JavaScript logic

Current bottom nav (5 tabs): Home | Log | Stats | Budget | Settings
Desktop: left sidebar with same items.

## TASK

Restructure the navigation to make room for a new Kitchen tab (coming in a later prompt).

**New bottom nav (5 tabs): Home | Log | Kitchen | Budget | Settings**

Kitchen tab is a placeholder for now — just an empty section with a "Coming soon" message.
Stats content moves into the Home dashboard.

---

## STEP 1 — Update bottom nav HTML in index.html

Replace the current Stats nav button with a Kitchen button:

```html
<!-- REMOVE this: -->
<button class="nav-btn" data-view="stats" onclick="setView('stats')">
  <svg viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  Stats
</button>

<!-- ADD this in its place: -->
<button class="nav-btn" data-view="kitchen" onclick="setView('kitchen')">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>
  Kitchen
</button>
```

Also add Kitchen to the desktop sidebar — after the Log item, before Budget:
```html
<button class="ds-item" data-tab="kitchen"><i class="ti ti-chef-hat"></i><span>Kitchen</span></button>
```

---

## STEP 2 — Add Kitchen section in index.html

After the closing `</section>` of `view-budget`, add:

```html
<!-- KITCHEN VIEW -->
<section id="view-kitchen" class="hidden">
  <div class="desktop-topbar"><h1 class="dt-title">Kitchen</h1></div>
  <div class="empty" style="padding-top:80px">
    <div class="empty-icon">🍳</div>
    <div class="empty-title">Kitchen coming soon</div>
    <div class="empty-sub">Recipes and shopping list will live here.</div>
  </div>
</section>
```

---

## STEP 3 — Move Stats content into Home in js/app.js

Find the `setView(v)` function. It currently calls `renderHistory()` or `renderProgress()` when `v === 'stats'`. 

Update it so:
- `v === 'stats'` no longer triggers (Stats tab is gone)
- `v === 'home'` also renders a stats summary section (recent session + weekly grid)
- `v === 'kitchen'` is handled (renders the Kitchen placeholder)

Add this case to `setView`:
```javascript
if(v === 'kitchen') { /* placeholder — no render needed yet */ }
```

---

## STEP 4 — Add Stats summary cards to the Home dashboard

In `renderHome()` (or wherever the Home tab content is built), add two new cards at the bottom of the home view:

1. **Recent workout** — shows the last saved session (date, type, exercises count). Tapping expands it or links to full history. Pull data from `localStorage.getItem('wt_sessions')`.

2. **Weekly consistency grid** — the same 7-column week grid currently in Stats > Progress. Reuse the existing `renderWeekGrid()` function if one exists, or the `.week-section` card HTML pattern.

Both cards should use the existing `.card`, `.sec-label`, `.session-card` classes for consistent styling.

---

## STEP 5 — Update desktop sidebar active state

In js/app.js, wherever the desktop sidebar highlights the active tab (likely by matching `data-tab` to the current view), ensure `kitchen` is included in the mapping.

---

## STEP 6 — Remove Stats from the nav pill calculation

The `#nav-pill` animates position based on which tab is active. It uses `left` percentage based on tab index. With Stats removed and Kitchen added as tab 3 (index 2), verify the pill still animates correctly to all 5 positions:
- Home = 0%
- Log = 20%
- Kitchen = 40%
- Budget = 60%
- Settings = 80%

Check the JS that sets `#nav-pill` left position and update tab index references if needed.

---

## VERIFICATION

After making changes:
1. Open index.html in browser
2. Confirm bottom nav shows: Home | Log | Kitchen | Budget | Settings
3. Tap Kitchen — see "Coming soon" placeholder
4. Tap Home — see the two new Stats summary cards at the bottom
5. Confirm Stats tab is completely gone from nav and sidebar
6. Confirm nav pill animates correctly to all 5 positions
7. Test on mobile viewport (375px width) — all 5 labels should be readable
