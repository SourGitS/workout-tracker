# PROMPT 19 — Three Settings Additions: What's New Popup, Favourite Colours, Home Layout Previews

Bundled into one prompt because all three are additive (no existing behaviour changes), touch
completely separate functions with zero line overlap, and are all Settings/onboarding-adjacent.
Do them as three independent parts in one pass — nothing in Part 1 depends on Part 2 or 3.

---

## PART 1 — "What's New" Popup After an Update

### Codebase context
There's already a half-built hook for this. `checkOnboarding()` (js/app.js:7625-~7644) compares
`profileData.onboardingVersion` against `OB_VERSION` (currently `2`) on every app load, and for
an existing user who's behind, calls:
```js
function showWhatsNew(fromVersion, toVersion){ /* TODO: future what's-new nudge */ }
```
— a literal stub. `OB_VERSION` is specifically "onboarding steps version," not a general release
version — reusing it would only fire when onboarding itself gained a step, not for everyday
fixes/features. This needs its own separate counter.

### Task
Add near `OB_VERSION`:
```js
// Bump WHATS_NEW_VERSION and add an entry whenever existing users should see a "what's new"
// popup next time they open the app. Independent of OB_VERSION.
const WHATS_NEW_VERSION = 1;
const WHATS_NEW_LOG = [
  { v:1, items:['New app icon and logo, everywhere in the app', 'Brighter, taller completed-exercise rows on Log', 'Exercise Library: delete moved into the edit screen'] }
];
```
(Fill the actual v1 items in from what's genuinely shipped recently — check Prompts/ and git log,
don't invent history.)

Add `profileData.lastSeenWhatsNew`, seeded for brand-new users inside `finishOnboarding()`
(js/app.js:8273-8279), right next to the existing version stamp:
```js
profileData.onboardingVersion = OB_VERSION;
profileData.lastSeenWhatsNew = WHATS_NEW_VERSION;   // brand-new users start "caught up"
```

Check on every load, alongside (after) `checkOnboarding()`:
```js
function checkWhatsNew(){
  const v = profileData.lastSeenWhatsNew || 0;
  if(v >= WHATS_NEW_VERSION) return;
  const entries = WHATS_NEW_LOG.filter(e=>e.v>v && e.v<=WHATS_NEW_VERSION);
  if(!entries.length){ profileData.lastSeenWhatsNew = WHATS_NEW_VERSION; localStorage.setItem('daily_profile', JSON.stringify(profileData)); return; }
  showWhatsNewModal(entries);
}
```
Show every missed entry, not just the latest — someone who skipped a while sees everything.

Replace the `showWhatsNew` stub with a real modal (same `.modal-overlay`/`.modal-box` pattern
`notesOpenEdit()` already uses for a dynamically-created overlay):
```js
function showWhatsNewModal(entries){
  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id='whats-new-overlay';
  const body=entries.map(e=>'<ul style="margin:0 0 10px;padding-left:20px">'+
    e.items.map(i=>'<li style="margin-bottom:6px;font-size:14px;color:var(--text)">'+i+'</li>').join('')+
  '</ul>').join('');
  overlay.innerHTML='<div class="modal-box" style="max-width:420px">'+
    '<div style="font-size:18px;font-weight:800;margin-bottom:4px">What\'s new</div>'+
    '<div style="font-size:13px;color:var(--muted);margin-bottom:14px">Since you last opened Daily</div>'+
    body+
    '<button onclick="dismissWhatsNew()" class="modal-btn primary" style="width:100%;margin-top:6px">Got it</button>'+
  '</div>';
  document.body.appendChild(overlay);
}
function dismissWhatsNew(){
  document.getElementById('whats-new-overlay')?.remove();
  profileData.lastSeenWhatsNew = WHATS_NEW_VERSION;
  localStorage.setItem('daily_profile', JSON.stringify(profileData));
  syncProfileToFirebase();
}
```

### Out of scope
`OB_VERSION`/onboarding nudging itself; retroactively back-filling changelog history beyond v1;
any settings UI to re-view past changelogs.

---

## PART 2 — Favourite Accent Colours

### Codebase context
Settings → Appearance, static mode (Dynamic day colours OFF): a single native
`<input type="color">` (`#static-accent-input`, js/app.js:943-946, inside
`renderDayColorPickers()`) wired to `setStaticAccent(hex)`. No history — nowhere to bank a
colour you like while comparing candidates before deciding on a new default.

### Task
Storage, following the same pattern every other small preference list already uses:
```js
function loadAccentFavourites(){ return lsLoad('daily_accent_favourites', [], Array.isArray); }
function saveAccentFavourites(list){ lsSave('daily_accent_favourites', list, 'accentFavourites'); }
```
Register `syncBlobListen(user.uid,'accentFavourites','daily_accent_favourites',
()=>renderDayColorPickers())` alongside the other listeners in `auth.onAuthStateChanged`.

Add to the static-mode branch of `renderDayColorPickers()`, right after the native colour input
(js/app.js:940-948):
```js
const favs=loadAccentFavourites();
wrap.innerHTML +=
  '<div style="margin-top:14px">'+
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'+
      '<span style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px">Favourites</span>'+
      '<button onclick="saveCurrentAccentAsFavourite()" style="font-size:12px;font-weight:700;color:var(--accent);background:none;border:none;cursor:pointer;padding:0">+ Save current colour</button>'+
    '</div>'+
    (favs.length
      ? '<div class="dc-swatches">'+favs.map(hex=>
          '<button class="dc-swatch" style="background:'+hex+';position:relative" onclick="setStaticAccent(\''+hex+'\');renderDayColorPickers()" aria-label="'+hex+'">'+
            '<span onclick="event.stopPropagation();removeAccentFavourite(\''+hex+'\')" style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:var(--danger);color:#fff;font-size:10px;line-height:16px;text-align:center">×</span>'+
          '</button>').join('')+'</div>'
      : '<p style="font-size:12px;color:var(--muted)">No favourites saved yet.</p>')+
  '</div>';
```
(Reuses `.dc-swatch` — don't invent a new swatch style.)
```js
function saveCurrentAccentAsFavourite(){
  const hex=(restColor()||'#FF6B35').toLowerCase();
  const favs=loadAccentFavourites();
  if(!favs.includes(hex)) favs.push(hex);
  saveAccentFavourites(favs);
  renderDayColorPickers();
}
function removeAccentFavourite(hex){
  saveAccentFavourites(loadAccentFavourites().filter(h=>h!==hex));
  renderDayColorPickers();
}
```

### Out of scope
Actually changing the app's default colour (not decided yet — this only builds the save/try
tool); dynamic-mode's per-day preset grid (`DAY_COLOR_PRESETS`) — untouched.

---

## PART 3 — Home Layout: Small Preview Under Each Card Toggle

### Codebase context
Settings → Home Layout (`renderHomeLayoutSection()`, js/app.js:7439-7453) lists every Home
widget from `HOME_WIDGETS` (js/app.js:~7394-7404) as a plain label + toggle, no visual — toggling
blind. Rather than 9 bespoke pixel-accurate live-data thumbnails (ongoing maintenance burden,
two places to keep in sync every time a real card's design changes), use a handful of reusable
skeleton shapes assigned per widget by rough content type.

### Task
```js
function hlPreviewStat(){ return '<div class="hl-preview"><div class="hl-p-label"></div><div class="hl-p-stat"></div><div class="hl-p-sub"></div></div>'; }
function hlPreviewList(rows){ return '<div class="hl-preview"><div class="hl-p-label"></div>'+Array(rows||3).fill('<div class="hl-p-row"></div>').join('')+'</div>'; }
function hlPreviewBars(){ return '<div class="hl-preview"><div class="hl-p-label"></div><div class="hl-p-bars">'+Array(7).fill(0).map(()=> '<div class="hl-p-bar" style="height:'+(30+Math.random()*60)+'%"></div>').join('')+'</div></div>'; }
```
```css
.hl-preview{background:var(--card);border:1px solid var(--card-border);border-radius:10px;padding:10px;margin:6px 0 2px;pointer-events:none}
.hl-p-label{width:40%;height:8px;border-radius:4px;background:var(--border);margin-bottom:8px}
.hl-p-stat{width:60%;height:20px;border-radius:5px;background:var(--accent);opacity:.35;margin-bottom:6px}
.hl-p-sub{width:75%;height:7px;border-radius:4px;background:var(--border)}
.hl-p-row{width:100%;height:9px;border-radius:4px;background:var(--border);margin-bottom:6px}
.hl-p-row:last-child{margin-bottom:0;width:70%}
.hl-p-bars{display:flex;align-items:flex-end;gap:4px;height:36px}
.hl-p-bar{flex:1;background:var(--accent);opacity:.35;border-radius:2px 2px 0 0}
```
Extend each `HOME_WIDGETS` entry with a `preview` field, e.g.:
```js
{id:'streak',   label:'Streak & This Week',   tab:'Train', preview:hlPreviewBars},
{id:'review',   label:'Week in Review',       tab:'Train', preview:hlPreviewStat},
{id:'recent',   label:'Recent Workout',       tab:'Train', preview:hlPreviewList},
{id:'calories', label:'Overview & Greeting',  tab:'Nutrition', fixed:true, preview:hlPreviewStat},
{id:'habits',   label:"Today's Habits",       tab:'Habits', preview:hlPreviewList},
{id:'budget',   label:'Weekly Budget',        tab:'Budget', preview:hlPreviewStat},
{id:'balance',  label:'Net Worth & Accounts', tab:'Budget', preview:hlPreviewStat},
{id:'tiles',    label:'Money Quick Tiles',    tab:'Budget', preview:()=>hlPreviewList(2)},
{id:'notes',    label:'Notes',                tab:'Notes', preview:hlPreviewList},
```
(Add one for `session` too — check what it actually renders before picking an archetype.)

In `renderHomeLayoutSection()` (js/app.js:7443-7452), render the preview under each row:
```js
'<div class="settings-row" style="padding:7px 0;flex-direction:column;align-items:stretch">'+
  '<div style="display:flex;justify-content:space-between;align-items:center">'+
    '<span class="settings-row-label">'+w.label+(w.fixed?' <span style="font-size:11px;color:var(--muted)">· always shown</span>':'')+'</span>'+
    (w.fixed?'':'<label class="toggle-switch"><input type="checkbox"'+(hidden.has(w.id)?'':' checked')+' onchange="homeWidgetToggle(\''+w.id+'\',this.checked)"><span class="toggle-slider"></span></label>')+
  '</div>'+
  (w.preview?w.preview():'')+
'</div>'
```

### Out of scope
Live/real data in previews (deliberately placeholder); any real Home card's actual design;
drag-reorder code (js/app.js:7461-7505) — untouched.

---

## VERIFICATION — for Francois to check, all three parts

1. **What's new**: bump `WHATS_NEW_VERSION` past an existing install's stored value (or just ship
   it) → reload → popup lists the changes → "Got it" dismisses it → reload again → doesn't
   reappear. Fresh onboarding → no popup fires immediately after.
2. **Favourite colours**: Settings → Appearance (Dynamic day colours OFF) → pick a colour, save
   it as a favourite → tap it later to reapply → remove it with the × → syncs to a second device.
3. **Home Layout previews**: Settings → Home Layout → every row now has a small illustrative
   preview box underneath (not real data) → toggles still work → nothing on the actual Home tab
   changed.
