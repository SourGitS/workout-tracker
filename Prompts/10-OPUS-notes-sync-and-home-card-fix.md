# PROMPT 10 — Fix Notes: Cross-Device Sync + Home Card Bugs

## CODEBASE CONTEXT

`js/app.js`, lines 617-618:
```javascript
function loadNotes(){ try{ return JSON.parse(localStorage.getItem('wt_notes')||'[]'); }catch(e){ return []; } }
function saveNotes(n){ try{ localStorage.setItem('wt_notes',JSON.stringify(n)); }catch(e){ console.warn('notes save failed',e); } }
```
Pure localStorage (`wt_notes` key) — zero Firebase wiring. Compare to every sibling data store,
all of which sync:
- `savePlans()` (~line 609-616) pushes directly: `db.ref('users/'+auth.currentUser.uid+'/plans').set(data)`.
- Profile / budgetDefaults / settingsCollapsed / weightGoal / subscriptions all use the generic
  helper `fbReconcile(path, lsKey, get, set, render, seedWhen)` (defined ~line 167) for a
  one-shot pull+seed on sign-in, called from inside `auth.onAuthStateChanged` (~line 289-366).
- Sessions and weights get a dedicated `dbRef`/`weightDbRef` with `.once('value')` (initial
  pull/seed) + `.on('value', ...)` (live listener) — see ~line 192-227.

`buildHomeNotesCard()` (~line 9688) and `renderHomeNotesBubble()` (~line 9713) render the Home
tab's notes widget from `loadNotes()`.

## WHY THESE BUGS EXIST

Notes were never wired into the sync system every other feature got — this looks like a gap,
not a regression (there's nothing to "undo," just something to add). The Home-card issues below
are separate, pre-existing logic bugs in `buildHomeNotesCard()`'s filtering, unrelated to sync.

## PART 1 — Wire Notes into Firebase sync (cross-device)

### 1a. Push on save
Update `saveNotes()` to also push to Firebase, matching `savePlans()`'s exact pattern (same
guard, same shape):
```javascript
function saveNotes(n){
  try{ localStorage.setItem('wt_notes',JSON.stringify(n)); }catch(e){ console.warn('notes save failed',e); }
  try{
    if(firebaseReady&&auth&&auth.currentUser&&db){
      db.ref('users/'+auth.currentUser.uid+'/notes').set(n);
    }
  }catch(e){ console.warn('notes firebase sync failed',e); }
}
```

### 1b. Pull + seed on sign-in
Add a `saveNotesLocalOnly(n)` helper that does only the localStorage half (no cloud write):
```javascript
function saveNotesLocalOnly(n){
  try{ localStorage.setItem('wt_notes',JSON.stringify(n)); }catch(e){ console.warn('notes save failed',e); }
}
```
Then add an `fbReconcile` call alongside the existing profile/budgetDefaults/etc. calls inside
`auth.onAuthStateChanged` (~line 289-366):
```javascript
// Sync notes
fbReconcile('notes','wt_notes',
  ()=>loadNotes(), v=>{ saveNotesLocalOnly(Array.isArray(v)?v:Object.values(v||{})); },
  ()=>{ renderNotes(); renderHomeNotesBubble(); });
```
Use `saveNotesLocalOnly` (not `saveNotes`) as the `set` callback here specifically. `fbReconcile`
only pulls once per sign-in (`.once('value')`, not a live listener), so calling `saveNotes()`
wouldn't loop — but it would immediately write the just-pulled cloud value straight back to the
cloud, a pointless extra round-trip. `saveNotesLocalOnly` avoids that.

### Data-safety check before finishing Part 1
This codebase has a real history of sync bugs that wiped user data (see commits `b6328fd`,
`860ca2b`, `0d1a88a` if you want the details of past incidents). `fbReconcile`'s existing
`seedWhen` logic already guards the classic failure mode — an empty local store silently
overwriting a populated cloud one, or vice versa — by only seeding the cloud when the local
value is non-empty, and only overwriting local when the cloud snapshot `exists()`. Don't bypass
or simplify that guard. Francois has real notes on his phone right now that must survive this
change untouched.

## PART 2 — Fix: priority notes never appear on the Home card (logic bug)

`buildHomeNotesCard()` currently has:
```javascript
const urgent = notes.filter(n=>!n.priority&&n.date<=in7Str&&n.date>=today);
const upcoming = notes.filter(n=>!n.priority&&n.date>in7Str);
```
Both filters explicitly exclude `n.priority===true`, and no code path renders priority notes
anywhere else — marking a note "Priority" in the edit modal currently makes it **less** visible
(it disappears from the Home card entirely), which is backwards. Add a `priority` bucket and
render it first, above urgent/upcoming, visually distinguished (e.g. an accent-colored dot
instead of danger/muted) so Priority reads as "pinned to the top," not "hidden":
```javascript
const priority = notes.filter(n=>n.priority);
```
A note that is both priority and date-bearing should render once, in the priority section only
— don't also duplicate it into urgent/upcoming.

## PART 3 — Home card should also surface undated notes

Francois wants notes without a date to show on the Home card too, not just Reminder/Expiry
notes. Currently `buildHomeNotesCard()` filters to `n.date && n.dateType!=='none'` before
anything else, which is why a plain note (the default `dateType` for every new note — see
`notesOpenEdit`'s default object) never appears there at all.

- Add a `recent` bucket: notes with `dateType==='none'` (or no `date`), excluding anything
  already in the `priority` bucket, sorted by `createdAt` descending, capped at a reasonable
  count (e.g. the 3 most recent) so the card doesn't grow unbounded as notes pile up.
- Render order top to bottom: **priority** → **urgent** (due within 7 days) → **recent**
  (undated, capped) → **upcoming** (due after 7 days). Use your judgment on ordering/cap once
  you see it rendered on-device — the goal is "my notes actually show up here," not a rigid
  spec.
- A note should only ever render in one bucket, never two.

## VERIFICATION — for Francois to check

1. Sign in with the same Google account on two devices (iPhone PWA + desktop browser, or any
   two). Add a note on one — confirm it appears on the other (a manual refresh/reopen is fine).
2. Edit a note on one device, confirm the edit shows up on the other.
3. Delete a note on one device, confirm it disappears on the other.
4. Mark a note "Priority" → it now appears on the Home notes card pinned at the top (it didn't
   before).
5. Create a plain note with no date set → it now appears on the Home card under recent notes.
6. Create a note with a Reminder date within 7 days → still appears under the urgent/soon
   section, same as before.
7. Sign out and back in → no notes are lost, none are duplicated.
8. Force-quit the app on your phone right after adding a note (before you've confirmed it
   synced), reopen it → the note is still there locally AND still makes it to the cloud. This
   one matters given this codebase's history of sync bugs losing data — don't skip it.
