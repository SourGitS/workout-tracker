# PROMPT 12 — Desktop Nav Consistency: Accounts + Exercise Library Shouldn't Need "Back"

## CODEBASE CONTEXT

Desktop sidebar (`#desktop-sidebar`, ≥1024px) lists 9 destinations. 7 of them are wired as
`<button class="ds-item" data-tab="X">` and flow through `setView(v)` (js/app.js:1147) — Home,
Log, Stats, Kitchen, Budget, Plans, Notes. The other 2 — **Accounts** and **Exercise Library** —
are wired as `<button class="ds-item" onclick="openAccounts()">` /
`onclick="openExerciseLibrary()"` instead, bypassing `setView()` entirely. They render as
full-screen `position:fixed` overlay pages (`#view-accounts` at index.html:738,
`#view-exercise-library` at index.html:678) with a "← Back" control, a pattern that makes sense
on mobile (where they're reached via the hamburger menu and there's no persistent sidebar to
click away to) but is inconsistent on desktop, where every other destination is a direct
one-click sidebar switch with no concept of "back."

## THE BUG (confirmed, not just a preference)

This isn't only a style inconsistency — Accounts is actually stuck. Compare the two overlay
close paths inside `setView()`:
```javascript
function setView(v, direction, opts){
  opts = opts || {};
  const _libOv=document.getElementById('view-exercise-library');
  if(_libOv&&_libOv.style.display!=='none'){_libOv.style.display='none';_libOv.style.left='0';}
  // ... no equivalent check for view-accounts anywhere in this function ...
```
`setView()` explicitly closes the Exercise Library overlay whenever any tab is switched to — but
has no matching line for `#view-accounts`. So clicking Home/Log/Stats/Kitchen/Budget/Plans/Notes
in the sidebar while Accounts is open never hides it; the Accounts overlay just sits there,
covering the content area, regardless of what tab you clicked. The **only** way out is the
explicit Back button. That's exactly the bug Francois hit.

`openAccounts()` (js/app.js:7792) also never touches `.ds-item.active` classes at all, unlike
`openExerciseLibrary()` (js/app.js:1601, line 1606 clears active state) — so the sidebar's
highlighted item likely doesn't update correctly when Accounts opens or closes either.

## THE DESIGN RULE (per Francois)

On desktop, sidebar items that are genuine peer destinations (Home, Log, Stats, Kitchen, Budget,
Accounts, Plans, Notes, Exercise Library) should never show a "back" control — you leave by
clicking a different sidebar item, same as all the others. Pages reached by drilling INTO one of
those destinations — Settings' sub-sections (`#view-settings-detail`), the Training Split editor
(`#view-split-editor`), the Budget categories editor (`#view-budget-editor`), and a specific
exercise's detail page (`#view-exercise-detail`, reached from Log/Stats, not the sidebar) — are
genuinely hierarchical, not sidebar peers, so their "← Back" stays exactly as it is. Don't touch
those four.

## TASK — desktop only (≥1024px); do not change mobile behaviour at all

### 1. Make `setView()` aware of Accounts, the same way it already is of Exercise Library
Add the equivalent check-and-close for `#view-accounts` in `setView()`, mirroring the existing
Exercise Library pattern (same spot, same reasoning — read the surrounding code to match the
exact ordering relative to `S.view = v` being set, since that ordering is why the existing
Exercise Library check is inlined there rather than calling `closeExerciseLibrary()` directly).

### 2. Fix sidebar active-highlighting for Accounts
`openAccounts()` should mark the Accounts `.ds-item` active (and clear the others) the same way
`openExerciseLibrary()` does today. When either overlay closes (via the Back button, or via the
new `setView()` handling from step 1), the sidebar's active item should correctly reflect
whatever `S.view` actually is.

### 3. Hide "← Back" for these two specifically, desktop only
- Accounts uses the shared `.detail-topbar`/`.detail-back` header (index.html:739-740) — same
  markup as Settings-detail/Split-editor/Budget-editor/Exercise-detail, so you can't just hide
  `.detail-back` globally without also hiding it on those (which must stay). Scope the fix to
  `#view-accounts .detail-back` specifically.
- Exercise Library's back control is a separate inline-styled button,
  `[data-action="close-exercise-library"]` (index.html:679-680), not `.detail-topbar`/
  `.detail-back` — hide that selector specifically instead.
- `@media (min-width:1024px)` only. On mobile, both back controls must keep working exactly as
  they do today — that's still the only way to leave these overlays there.

### 4. Give both a way to close if something still needs it
With the back button hidden and the sidebar the sole navigation method, double check nothing
else on desktop assumed the back button was the only close path (e.g. a keyboard shortcut or
click-outside-to-close would be a nice-to-have but isn't required — the sidebar link now covers
it structurally).

## OUT OF SCOPE — leave these exactly as they are

`#view-settings-detail`, `#view-split-editor`, `#view-budget-editor`, `#view-exercise-detail` —
all four keep their "← Back" on both mobile and desktop; they're genuine drill-downs, not
sidebar peers. Don't touch the mobile behaviour of Accounts or Exercise Library either — the
full-screen overlay + visible Back button is correct there.

## VERIFICATION — for Francois to check on desktop (≥1024px browser window)

1. Click Accounts in the sidebar → no "← Back" control visible; the Accounts item in the
   sidebar shows as active/highlighted.
2. While on Accounts, click Home (or Log, Stats, Kitchen, Budget, Plans, Notes) in the sidebar →
   switches immediately, Accounts is gone, the newly-clicked item is now the highlighted one.
   This is the main thing to check — today this click silently does nothing.
3. Repeat both checks for Exercise Library.
4. Click into a Settings section (e.g. Personal Info), or Training Split, or Budget categories,
   or a specific exercise's detail page from Log/Stats → "← Back" is still there and still
   works, exactly as before. These should be completely unaffected.
5. Shrink the browser below 1024px → Accounts and Exercise Library go back to full-screen
   overlays with a visible, working "← Back" — exactly like today, nothing regressed on mobile.
