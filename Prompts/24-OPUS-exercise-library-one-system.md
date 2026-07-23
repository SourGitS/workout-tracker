# PROMPT 24 — Exercise Library: Manage Exercises From Either Entry Point, Not Just One

## WHY THIS IS A NEW PROMPT, NOT JUST PROMPT 21 AGAIN

Prompt 21 checked whether the Log tab's Swap modal and the Training Split editor's "add
exercise" picker read from different data — they don't, both call `loadExerciseLib()`, confirmed
via grep. That was real, but it answered a narrower question than what's actually bothering
Francois: it's not that the *data* is duplicated, it's that there are two *screens* with
different capabilities, and no way to get from one to the other. That's the actual gap this
prompt closes.

## CODEBASE CONTEXT — the real asymmetry

Two places let you work with exercises, both ultimately reading/writing the same
`loadExerciseLib()`/`saveExerciseLib()` store (`wt_exercise_lib`), but with different powers:

- **Exercise Library page** (hamburger menu → Exercise Library, `renderExerciseLibList()`,
  js/app.js:1698-1715) — can **add** (`openNewExercise()`), **edit** (`openEditExercise(id)`),
  and **delete** (Prompt 17 added this into the edit modal, `#exlib-add-modal`). Full control.
- **Training Split editor's picker** (Settings → Training Split → tap a day → "+ add exercise",
  `sePickerListHTML()`/`sePick()`/`sePickCustom()`, js/app.js:7745-7859) — can only **add**
  (pick an existing one, or type a new name to create one via `sePickCustom()`, which does
  correctly save into the shared library, confirmed). It has **no way to edit or delete** an
  exercise. If you're mid-split-build and notice an exercise has the wrong muscle tag, or you
  want to delete a stale custom one, you have to abandon what you're doing, back out to the
  hamburger menu, fix it on the other screen, then come back in. That round-trip is almost
  certainly what reads as "two separate libraries," even though there's genuinely one shared
  list underneath — confirmed again by `renameExerciseRefs()` (js/app.js:1817+), which already
  correctly cascades a rename across sessions, day customisations, and swap targets.

## TASK

### 1. Add an edit affordance to each row in the Split editor's picker
`sePickerListHTML()` (js/app.js:7745-7759) currently renders each real exercise as one whole
`<button>` (can't nest a second button inside it for edit). Restructure to a row with two
targets — same visual footprint, edit reuses the exact modal Prompt 17 already built:
```js
let out=filtered.map(e=>
  '<div class="se-picker-item">'+
    '<span class="se-picker-pick" onclick="sePick('+JSON.stringify(e.name).replace(/"/g,'&quot;')+')">'+
      '<span>'+_catEscHtml(e.name)+'</span><span class="se-picker-muscle">'+e.muscle+'</span>'+
    '</span>'+
    '<button class="se-picker-edit" onclick="event.stopPropagation();openEditExercise(\''+e.id+'\')" aria-label="Edit exercise">✎</button>'+
  '</div>'
).join('');
```
(Leave the `se-picker-new` "+ Add as new exercise" row as its own plain button — it's not a real
row yet, no edit action applies to it.)

CSS (css/workout.css, near the existing `.se-picker-item` rule at line 289): change
`.se-picker-item` from button-flex-row to a container that holds both targets, add the two new
inner classes:
```css
.se-picker-item{display:flex;align-items:center;gap:4px;width:100%;padding:4px;border:none;border-radius:10px;background:rgba(var(--accent-rgb),.05);color:var(--text)}
[data-theme="dark"] .se-picker-item{background:rgba(255,255,255,.05)}
.se-picker-pick{flex:1;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 8px;font-size:14px;font-weight:500;cursor:pointer;-webkit-tap-highlight-color:transparent}
.se-picker-edit{flex-shrink:0;width:28px;height:28px;border-radius:50%;border:none;background:none;color:var(--muted);font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}
```
`.se-picker-muscle` and `.se-picker-new` stay as they are.

### 2. Make the edit modal refresh whichever list is actually open
`confirmNewExercise()` (js/app.js:1809-1811) and Prompt 17's `deleteCurrentExercise()` currently
only refresh `renderExerciseLibList()` (the standalone page). Make both refresh the Split
editor's picker too, if that's the context you edited from:
```js
closeNewExercise();
if(document.getElementById('exercise-lib-list')) renderExerciseLibList();
if(typeof SE!=='undefined' && SE.target>=0 && document.getElementById('se-picker-list')) document.getElementById('se-picker-list').innerHTML=sePickerListHTML();
if(S.view==='log' && typeof renderLog==='function') renderLog();
```
Apply the same `se-picker-list` refresh line to `deleteCurrentExercise()` right before/after its
existing `renderExerciseLibList()` call.

### 3. Verify the edit modal stacks correctly over the picker sheet
`#exlib-add-modal` needs to visually sit on top of `.se-picker` (both are fixed-position
overlays) when opened from within the Split editor. Check the actual z-index values rather than
assuming — if the modal doesn't appear above the picker sheet, bump `#exlib-add-modal`'s z-index
(or `.modal-overlay`'s, whichever it inherits) above `.se-picker`'s `z-index:201`
(css/workout.css:283).

## OUT OF SCOPE

- Fully merging `sePickerListHTML()` and `renderExerciseLibList()` into one shared render
  function — bigger refactor than this fix needs; today's minimal change (add an edit button,
  fix the refresh path) gets you full parity without touching either function's core rendering
  logic.
- The Swap modal / global-name-keyed swap behaviour — that's Prompt 21's territory, unrelated to
  this gap.
- `renameExerciseRefs()` and the rest of the rename-cascade system — already confirmed correct,
  not touched.

## VERIFICATION — for Francois to check

1. Settings → Training Split → tap into a day → "+ add exercise" → every real exercise row now
   has a small pencil icon next to it, not just the name.
2. Tap the pencil → the same edit screen you already know from Exercise Library opens (with
   Delete available, from Prompt 17) — right there, without leaving the Split editor.
3. Rename or change an exercise's muscle group from inside that picker → close it → the picker
   list shows the update immediately, no need to back out and back in.
4. Delete an exercise from inside that picker → it disappears from the picker list right away.
5. Back out to the hamburger menu → Exercise Library page → the same edit/delete you just did is
   reflected there too — confirms it's genuinely one shared list, reachable properly from both
   places now.
