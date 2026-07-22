# PROMPT 21 — Swap-Exercise Screen: Match Training Split's Picker, Then Check the Sync Complaint

## CODEBASE CONTEXT

Two different "pick an exercise" UIs exist and look nothing alike:

- **Log tab's Swap modal** (`openSwapModal`/`renderSwapList`, js/app.js:2652-2691; markup at
  index.html:625-636) — a centered `.modal-overlay`/`.modal-box`, plain-text rows
  (`.swap-lib-row`, css/kitchen-extras.css:445-446: just a bottom border, no background),
  grouped under muscle-name headers.
- **Training Split editor's picker** (`SE` object / `renderSplitEditor`/`sePickerListHTML`,
  js/app.js:7708-7769) — a bottom slide-up sheet (`.se-picker`/`.se-picker-backdrop`,
  css/workout.css:282-292), rounded pill-button rows (`.se-picker-item`, tinted background,
  no borders, `.se-picker-muscle` tag shown inline on the right), flat list (no group headers).

Francois wants swap's screen to match the split editor's look — reusing the existing
`.se-picker*` classes directly rather than reskinning `.swap-lib-row` separately (two visually
near-identical systems is exactly the kind of duplication CLAUDE.md flags as a recurring problem
in this codebase).

## ON THE "THEY'RE NOT SYNCED" PART

Checked whether the two pickers pull from different exercise lists — they don't. Both call the
same `loadExerciseLib()`. There's no duplicated/stale library causing a mismatch.

What IS true: "swap" is a **global, name-keyed override**, not tied to a specific day or a
specific instance. `confirmSwap()` (js/app.js:2699-2714) does `S.swaps[ex.name] = newName`, and
every exercise name is displayed through `dn(name){ return S.swaps[name] || name; }`
(js/app.js:816). So swapping "Lateral Raise Machine" → "Cable Lateral Raise" from **any one**
session applies **everywhere** that exact name appears in the whole split, not just that day.
This is very likely the actual "problems when I swap out exercises" — not a bug exactly, but
probably not the behaviour Francois expects (day-specific substitution) if he's swapping
something for one session and finding it changed on a different day too.

This is a genuine data-model question, not a quick styling fix, and changing swap from
global-by-name to per-day/per-instance would touch how `S.swaps` is stored and read everywhere
`dn()` is called — bigger and riskier than this prompt's main ask. **Don't change that model in
this pass.** Instead:

## TASK

### 1. Restyle the swap modal to reuse the split-editor's picker classes
Change the swap modal's markup (index.html:625-636) from a `.modal-overlay`/`.modal-box` to the
same bottom-sheet structure `renderSplitEditor()` already uses for its picker (js/app.js:7734-
7740), keeping swap's two extra pieces (the current-swap label, the "Reset to default" button)
that the split picker doesn't have:
```html
<div class="se-picker-backdrop hidden" id="swap-backdrop" onclick="closeSwapModal()"></div>
<div class="se-picker hidden" id="swap-modal">
  <div class="se-picker-head">Swap exercise<button class="se-picker-x" onclick="closeSwapModal()" aria-label="Close">×</button></div>
  <div style="font-size:13px;color:var(--muted);margin-bottom:10px" id="swap-original-label"></div>
  <input class="se-picker-search" type="text" id="swap-input" placeholder="Search or type a new name…" oninput="renderSwapList()" autocomplete="off">
  <div class="se-picker-list" id="swap-lib-list" style="max-height:40vh"></div>
  <div style="display:flex;gap:8px;margin-top:10px">
    <button class="modal-btn secondary" onclick="resetSwapDefault()">Reset to default</button>
    <button class="modal-btn primary" onclick="confirmSwap()">Save</button>
  </div>
</div>
```
Update `openSwapModal()`/`closeSwapModal()` (js/app.js:2652-2667, 2696-2698) to toggle the
`hidden` class on both `#swap-backdrop` and `#swap-modal` instead of the old
`.classList.remove/add('hidden')` on a single `.modal-overlay` — mirror exactly how
`seClosePicker()`/the picker-open path in `renderSplitEditor()` handles its own backdrop+sheet
pair.

### 2. Restyle the row template to match
In `renderSwapList()` (js/app.js:2668-2691), change each row from `.swap-lib-row` to
`.se-picker-item`, and show the muscle tag the same way `sePickerListHTML()` does:
```js
html+='<button class="se-picker-item" data-swap="'+_catEsc(e.name)+'" onclick="swapPickExercise(this.dataset.swap)"><span>'+_catEscHtml(e.name)+'</span><span class="se-picker-muscle">'+e.muscle+'</span></button>';
```
Keep the muscle-group section headers above each group — that part of swap's structure is
reasonable to keep (it's picking from the whole library, a longer list than split's "add to this
day" picker, which excludes what's already there) — just needs the shared header style, not a
rewrite of the grouping logic itself.

## OUT OF SCOPE

- Changing swap from a global name-keyed override to a per-day/per-instance one — see reasoning
  above. If you think this really is what's driving Francois's complaint, say so back to him
  explicitly and let him confirm before touching `S.swaps`'/`dn()`'s data model — don't change
  it speculatively in this pass.
- The Training Split editor's picker itself (`.se-picker*`, `sePickerListHTML()`) — untouched;
  swap is being changed to match it, not the other way around.
- `loadExerciseLib()` itself — confirmed already shared correctly between both pickers, nothing
  to fix there.

## VERIFICATION — for Francois to check

1. Log tab → tap the swap icon on any exercise → picker now slides up from the bottom, same look
   as Training Split's "add exercise" picker (rounded pill rows, tinted background, no line
   dividers between rows).
2. Search still filters the list, muscle-group headers still there, "Reset to default" and Save
   still work exactly as before.
3. Swap an exercise on one specific day → check whether it also changed on OTHER days that use
   the same exercise name. If yes, that confirms the global-by-name behaviour above — tell me
   and we'll scope a proper per-day fix as its own prompt, now that it's confirmed rather than
   guessed.
