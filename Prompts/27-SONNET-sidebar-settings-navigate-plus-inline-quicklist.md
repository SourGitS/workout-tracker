# PROMPT 27 — Sidebar Settings: Navigate Directly + Always-Visible Quick Settings as Plain List Rows

## CODEBASE CONTEXT

Currently the sidebar's "Settings" row (index.html:58-61) is a toggle: clicking it expands/
collapses a hidden panel (`#quick-settings-menu`, populated by `renderQuickSettingsMenu()`,
js/app.js:3712-3729) containing Dark mode, Day colours, Calorie goal, and an "All settings →"
link that's the only way to reach the real Settings screen from this row.

Two rounds of visual iteration already confirmed: no card/popover container, no distinct panel
background — the expanded rows should use the exact same look as every other sidebar row
(`.ds-item`'s styling from css/kitchen-extras.css:240 — `border-radius:12px;padding:10px
14px;margin:0 10px 2px;font-size:14px;font-weight:600;color:var(--muted)`, `var(--track)`
background on hover).

This prompt changes the interaction model on top of that confirmed look:
- The Settings row itself should navigate straight to the full Settings screen (like Home/Log/
  Stats already do), not toggle a panel.
- Dark mode / Day colours / Calorie goal should be **always visible** underneath it, permanently
  part of the list — no expand/collapse, no click needed to reveal them.
- No more "All settings" row — redundant now that the Settings row itself goes there.

This removes the open/closed state entirely, which simplifies the code: no caret, no
`max-height` animation, no persisted open/closed flag.

## TASK

### 1. HTML (index.html:58-61) — replace the whole block
```html
    <div class="ds-settings-wrap" id="ds-settings-wrap">
      <button class="ds-item ds-settings-row" onclick="toggleQuickSettings(event)" aria-expanded="false" aria-controls="quick-settings-menu"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg><span>Settings</span><svg class="ds-caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></button>
      <div id="quick-settings-menu" class="quick-settings-inline"></div>
    </div>
```
with:
```html
    <button class="ds-item" onclick="setView('settings')"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg><span>Settings</span></button>
    <div id="quick-settings-menu" class="ds-quick-settings"></div>
```
(`setView('settings')` is already the exact call the old "All settings" link used — proven to
correctly open the full Settings screen from the desktop sidebar.)

### 2. CSS (css/budget-home.css) — replace lines 217-240
Remove the caret/open-state/collapse-animation rules and the old cramped `.qs-*` mini-styling;
replace with rows that copy `.ds-item`'s real look:
```css
  /* Quick settings — Dark mode / Day colours / Calorie goal, always visible under the Settings
     nav item (no expand/collapse, no popover). Rows intentionally match .ds-item's exact look
     (css/kitchen-extras.css) so they read as more of the same list, not a separate widget. */
  .ds-quick-settings .qs-item{display:flex;align-items:center;justify-content:space-between;gap:10px;border-radius:12px;padding:10px 14px;margin:0 10px 2px;font-family:var(--font-ui);font-size:14px;font-weight:600;color:var(--muted)}
  .ds-quick-settings .qs-item:hover{background:var(--track);color:var(--text)}
  .ds-quick-settings .qs-goal-row{display:flex;justify-content:space-between;align-items:center;padding:10px 14px 2px;margin:0 10px;font-family:var(--font-ui);font-size:14px;font-weight:600;color:var(--muted)}
  .ds-quick-settings .qs-goal-cal{color:var(--muted);font-weight:600}
  .ds-quick-settings .qs-goal-opts{display:flex;gap:2px;padding:2px 10px 4px}
  .qs-goal{flex:1;text-align:center;padding:7px 4px;border-radius:10px;border:none;background:transparent;font-family:var(--font-ui);font-size:14px;font-weight:600;color:var(--muted);cursor:pointer}
  .qs-goal:hover{background:var(--track);color:var(--text)}
  .qs-goal.on{color:var(--accent);background:rgba(var(--accent-rgb),.13)}
```
(`.toggle-switch`/`.toggle-slider` — the actual switch control — already exist elsewhere in the
app and don't need redefining here.)

### 3. JS (js/app.js) — always-render the menu, drop the "All settings" row, remove dead code
Replace `renderQuickSettingsMenu()` (js/app.js:3712-3729):
```js
function renderQuickSettingsMenu(){
  const menu=document.getElementById('quick-settings-menu'); if(!menu) return;
  const dark=S.theme!=='light';
  const dyn=localStorage.getItem('daily_dynamic_colours')==='true';
  const cg=(typeof calcGoalCals==='function')?calcGoalCals():null;
  const goal=(S.personalInfo&&S.personalInfo.goal)||'maintain';
  const goalBtn=(id,label)=>'<button class="qs-goal'+(goal===id?' on':'')+'" onclick="quickSetGoal(\''+id+'\')">'+label+'</button>';
  menu.innerHTML=
    '<div class="qs-item"><span>Dark mode</span>'+
      '<label class="toggle-switch"><input type="checkbox"'+(dark?' checked':'')+' onchange="quickSetTheme(this.checked)"><span class="toggle-slider"></span></label></div>'+
    '<div class="qs-item"><span>Day colours</span>'+
      '<label class="toggle-switch"><input type="checkbox"'+(dyn?' checked':'')+' onchange="quickSetDynamic(this.checked)"><span class="toggle-slider"></span></label></div>'+
    '<div class="qs-goal-row"><span>Calorie goal</span><span class="qs-goal-cal">'+(cg?cg[goal]+' kcal':'Set up in Settings')+'</span></div>'+
    '<div class="qs-goal-opts">'+goalBtn('cut','Cut')+goalBtn('maintain','Maintain')+goalBtn('bulk','Bulk')+'</div>';
}
```
Delete these four functions entirely (js/app.js:3734-3752) — there's no open/closed state left to
manage:
```js
function setQuickSettingsOpen(open){ ... }
function toggleQuickSettings(e){ ... }
function closeQuickSettings(){ ... }
function restoreQuickSettings(){ ... }
```
`quickSetTheme`/`quickSetDynamic`/`quickSetGoal` (js/app.js:3754-3756) stay exactly as they are —
each already calls `renderQuickSettingsMenu()` after changing its value, which still works now
that the menu is always present.

Find the one call site of `restoreQuickSettings()` (js/app.js:9622, sidebar init) and replace it
with a direct call:
```js
renderQuickSettingsMenu();
```

`daily_qs_open` (the old persisted open/closed flag) is now unused — safe to leave as an orphaned
localStorage key for existing users, no migration needed.

## OUT OF SCOPE

- The full Settings screen itself (`setView('settings')`'s destination) — unchanged, just now
  reachable directly from this row instead of via a link buried inside the old panel.
- Any other sidebar nav item — untouched.

## VERIFICATION — for Francois to check (desktop, ≥1024px window)

1. Sidebar always shows Dark mode, Day colours, and Calorie goal (with Cut/Maintain/Bulk) right
   under "Settings" — no click needed, no expand/collapse, no caret.
2. These rows look identical in font/size/padding/hover to Home, Log, Stats, etc. — not a boxed
   or visually separate section.
3. Clicking the "Settings" row itself (the icon+label, not the rows below it) takes you straight
   to the full Settings screen.
4. No "All settings" row anymore — confirm you don't miss it (it's redundant with #3 now).
5. Toggling Dark mode / Day colours / Cut-Maintain-Bulk from this list still works exactly as
   before and updates immediately.
