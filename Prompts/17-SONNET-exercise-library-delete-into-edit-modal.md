# PROMPT 17 — Exercise Library: Move Delete Into the Edit Modal

## CODEBASE CONTEXT

Screenshot (desktop, Exercise Library): Francois circled the red "×" delete button that sits
permanently on every row and wants it gone from there — "shouldn't need to always be available."

`renderExerciseLibList()` (js/app.js:1698-1715) currently renders two persistent buttons per
row: `.lib-edit-btn` (✎, opens the edit modal) and `.lib-del-btn` (×, deletes immediately after
a native `confirm()`, no modal). The delegated click listener (js/app.js:1808-1829) handles both
— the delete branch (1813-1822) does the actual filter/hide/re-render work inline.

There's already a real edit modal (`#exlib-add-modal`, index.html:773-789, opened via
`openEditExercise(id)`) with a name field, muscle picker, an "allow negative" checkbox, and a
Cancel/Save button row (`.modal-btn-row`). It has no delete option today — this prompt adds one
there instead of on the row.

## WHY "MOVE INTO EDIT" INSTEAD OF SWIPE-TO-DELETE

Francois offered swipe-to-reveal as an alternative. Not using that here because this screenshot
is the **desktop** view — swipe is a touch gesture with no clean mouse equivalent, so it would
need a second, different delete affordance for desktop anyway (this app has real desktop usage
now, see prompts 11/12). Moving delete into the edit modal works identically on both, with no
new gesture-handling code. If you still want swipe-to-delete as a mobile-only nice-to-have on
top of this, that's a separate, bigger follow-up — say so and I'll scope it.

## TASK

### 1. Drop the row-level delete button
In `renderExerciseLibList()` (js/app.js:1704-1713), remove the `.lib-del-btn` button, keep only
edit:
```js
el.innerHTML=filtered.map(e=>
  '<div class="lib-row">'+
    '<div style="flex:1;min-width:0;cursor:pointer" data-ex="'+_catEsc(e.name)+'" onclick="openExerciseDetail(this.dataset.ex)">'+
    '<div class="lib-row-name">'+_catEscHtml(e.name)+'</div>'+
    '<div class="lib-row-muscle">'+_catEscHtml(muscleLabel(e.muscle))+' · tap for history</div></div>'+
    // Delete now lives inside the edit modal (openEditExercise) — see Prompt 17.
    '<div style="display:flex;gap:6px;flex-shrink:0">'
      +'<button class="lib-edit-btn" data-action="lib-edit-exercise" data-id="'+e.id+'" aria-label="Edit exercise">✎</button>'
    +'</div>'+
  '</div>'
).join('')||'<div style="padding:32px 0;text-align:center;color:var(--muted)">No exercises found</div>';
```

### 2. Add a Delete option inside the edit modal
In index.html, inside `#exlib-add-modal`, after the existing `.modal-btn-row`:
```html
<div class="modal-btn-row">
  <button class="modal-btn secondary" onclick="closeNewExercise()">Cancel</button>
  <button class="modal-btn primary" id="exlib-confirm-btn" onclick="confirmNewExercise()">Add</button>
</div>
<button class="modal-btn danger hidden" id="exlib-delete-btn" style="width:100%;margin-top:8px" onclick="deleteCurrentExercise()">Delete exercise</button>
```
Add the matching style next to the other `.modal-btn` variants (css/nutrition-modals.css, near
line 27-30):
```css
.modal-btn.danger{background:transparent;border:1.5px solid var(--danger);color:var(--danger)}
```
Outline-red, matching the same colour treatment `.lib-del-btn` already used.

### 3. Show it only when editing (never when adding new)
Extend `_setExModalLabels()` (js/app.js:1722-1725):
```js
function _setExModalLabels(editing){
  const t=document.getElementById('exlib-modal-title'); if(t) t.textContent=editing?'Edit exercise':'New exercise';
  const b=document.getElementById('exlib-confirm-btn'); if(b) b.textContent=editing?'Save':'Add';
  const d=document.getElementById('exlib-delete-btn'); if(d) d.classList.toggle('hidden', !editing);
}
```
This already runs from both `openNewExercise()` (editing=false) and `openEditExercise()`
(editing=true), so no other call site needs to change.

### 4. Wire the new button to the existing delete logic
Add a new function, reusing the exact same steps the old row-button handler used:
```js
function deleteCurrentExercise(){
  if(!_editExId) return;
  if(!confirm('Delete this exercise?')) return;
  const id=_editExId;
  saveExerciseLib(loadExerciseLib().filter(x=>x.id!==id)); // drop any custom (or default override)
  // A program default regenerates from the split, so also hide it by id or it reappears.
  if(id.indexOf('ex_def_')===0){ const h=loadLibHidden(); if(!h.includes(id)){ h.push(id); saveLibHidden(h); } }
  closeNewExercise();
  renderExerciseLibList();
}
```

### 5. Remove the now-dead row-delete handler
Delete the `lib-delete-exercise` branch from the delegated click listener (js/app.js:1813-1822)
— grep first to confirm nothing else still points a `data-action="lib-delete-exercise"` at it
(the row button was the only place this attribute got set, per the render function above).

## OUT OF SCOPE

- Editing a **default** (program) exercise's name is already a no-op today — its name
  regenerates from the Training Split on every load, per the existing comment above
  `openEditExercise()` (js/app.js:1717-1719). Not something this prompt changes; renaming
  defaults still happens in the Split editor, only muscle group / allow-negative / delete apply
  here.
- Swipe-to-delete — not built now, see reasoning above.
- `.lib-default-badge` (css/kitchen-extras.css:444) — exists in CSS but wasn't referenced in the
  row template even before this change; unrelated to this prompt, not touched.

## VERIFICATION — for Francois to check

1. Exercise Library list → every row now shows only the pencil (edit) icon, no red "×".
2. Tap the pencil on an existing exercise → edit modal opens with a red outline "Delete
   exercise" button below Cancel/Save.
3. Tap Delete → same confirm popup as before, exercise disappears from the list, modal closes.
4. Tap "+ New exercise" (or however a brand-new exercise is started) → modal opens with **no**
   Delete button, since there's nothing to delete yet.
5. Edit and Save (not delete) still works exactly as before — name/muscle/allow-negative changes
   persist.
6. Try this on both desktop and mobile — same modal, same behaviour either way.
