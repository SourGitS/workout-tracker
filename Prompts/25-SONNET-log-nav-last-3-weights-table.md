# PROMPT 25 — Desktop Log Nav: Show Last 3 Top Weights Per Exercise

## CODEBASE CONTEXT

The list in the screenshot is `#desktop-exercise-nav` (js/app.js:2124-2128, inside
`renderLog()`) — the desktop-only left-column quick-nav (css/budget-home.css:276,
`@media(min-width:1024px)`; hidden entirely on mobile, css/budget-home.css:131). Currently just
a bullet/check + exercise name, click-to-scroll to that exercise's card:
```js
const exNav=document.getElementById('desktop-exercise-nav');
if(exNav) exNav.innerHTML=t.exercises.map((ex,ei)=>{
  const d=S.checked.has(ei);
  return `<div class="den-item${d?' done':''}" onclick="safeScrollIntoView(document.getElementById('ec${ei}'),{behavior:'smooth',block:'start'})">`+
    `<span style="flex-shrink:0">${d?'✓':'•'}</span><span>${dn(ex.name)}</span></div>`;
```
`dn(ex.name)` already resolves swaps for the *label* — the missing piece is that nothing looks
up weight history at all yet.

`getPoints(exName)` (js/app.js:841-851) already does exactly "top weight per session" — it's the
same function the Stats progress chart uses, so reusing it keeps this consistent with what "top
weight" means everywhere else in the app rather than inventing a second definition:
```js
function getPoints(exName){
  const pts=[];
  S.sessions.forEach(s=>{
    const ex=s.exercises.find(e=>e.name===exName);
    if(ex&&ex.sets.length){
      const ws=ex.sets.filter(s=>s.weight>0).map(s=>s.weight);
      if(ws.length) pts.push({date:s.date,weight:Math.max(...ws)});
    }
  });
  return pts;
}
```
Returns points oldest→newest (matches `S.sessions`'s append order).

**Swap-awareness**: since swap is a global name-keyed override (`S.swaps`, Prompt 21), any
session logged while an exercise was swapped in was saved under the *swapped* name, not the
original slot name. So the weight lookup must use `dn(ex.name)` (the current display/swapped
name), not `ex.name` directly — otherwise a swapped exercise would show weight history for the
exercise it *used to be*, not the one it currently is. `confirmSwap()` already calls `renderLog()`
after saving a swap, so once this reads the swap-aware name, it updates automatically — no extra
wiring needed for that part.

## TASK

Replace the `exNav.innerHTML=...` block with:
```js
if(exNav) exNav.innerHTML=t.exercises.map((ex,ei)=>{
  const d=S.checked.has(ei);
  const displayName=dn(ex.name);
  const pts=getPoints(displayName).slice(-3);        // last 3 sessions, oldest→newest
  while(pts.length<3) pts.unshift(null);              // left-pad so the newest stays rightmost
  const weightsHTML=pts.map(p=>'<span class="den-w">'+(p?p.weight:'—')+'</span>').join('');
  return `<div class="den-item${d?' done':''}" onclick="safeScrollIntoView(document.getElementById('ec${ei}'),{behavior:'smooth',block:'start'})">`+
    `<span class="den-check" style="flex-shrink:0">${d?'✓':'•'}</span>`+
    `<span class="den-name">${displayName}</span>`+
    `<span class="den-weights">${weightsHTML}</span>`+
  `</div>`;
}).join('');
```

CSS additions (css/budget-home.css, right after the existing `.den-item` rules ~line 277-279):
```css
.den-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.den-weights{display:flex;gap:6px;flex-shrink:0}
.den-w{width:28px;text-align:right;font-family:var(--font-num);font-weight:600;font-size:11px;color:var(--muted)}
.den-item.done .den-w{color:var(--green);opacity:.8}
```
`.den-item` is already `display:flex;align-items:center;gap:8px` — that's enough for the name to
truncate and the weight columns to stay right-aligned and fixed-width without extra changes
there.

Judgement calls made, flagged in case you want them different:
- **Column order**: oldest of the 3 on the left, most recent on the right (reads like a small
  trend, left-to-right). If you'd rather have most-recent-first (leftmost), that's a one-line
  swap (drop the `unshift` padding for a `push`-based right-pad instead, or `.reverse()` the
  final array before mapping).
- **Missing history**: shown as "—", not a blank cell, so columns stay visually aligned across
  every row regardless of how much history an exercise has.
- **No unit label** ("kg") shown per cell, to keep the column narrow — add one if it reads
  ambiguous in practice.

## OUT OF SCOPE

- Mobile — this list doesn't exist there at all (`#desktop-exercise-nav{display:none}` outside
  the desktop media query); nothing to change on mobile.
- `getPoints()`/`getPR()` themselves — reused as-is, not modified. Note both currently count
  *any* logged set (including warmups) toward "top weight" — that's existing behaviour this
  prompt intentionally doesn't change; flag separately if that ever needs fixing.
- The exercise cards themselves (Log's main column) — untouched, this only touches the desktop
  nav list.

## VERIFICATION — for Francois to check (desktop, ≥1024px window, Log tab)

1. Each row in the left-column exercise list now shows up to 3 small numbers after the name —
   the top weight from your last 3 sessions with that exercise, oldest→newest left-to-right.
2. An exercise you've never logged, or one you just added → shows "—" in some or all of the 3
   slots, not broken/blank.
3. Swap an exercise out for a different one → its weight columns immediately update to show the
   swapped-in exercise's own history, not the original's.
4. Tapping a row still scrolls to that exercise's card, unchanged.
