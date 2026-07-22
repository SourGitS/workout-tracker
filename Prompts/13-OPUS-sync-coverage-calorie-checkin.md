# PROMPT 13 — Sync Coverage: Calorie Tracking + Check-in Streak

## CODEBASE CONTEXT

Two Firebase sync patterns exist in `js/app.js`:
1. **Bespoke, per-feature** (older): dedicated `dbRef`/`weightDbRef` + `.on('value')` listeners
   for sessions/weights, and `fbReconcile(path, lsKey, get, set, render, seedWhen)` (line ~167)
   for profile/budgetDefaults/settingsCollapsed/weightGoal/subscriptions/notes.
2. **Generic blob sync** (newer, used for everything added after the original sync was built):
   `lsSave(key, value, syncPath)` (line ~128) writes to localStorage and, if a `syncPath` is
   given, calls `syncBlobPush(syncPath, key)` (line ~77). `syncBlobListen(uid, path, lsKey,
   onUpdate)` (line ~83), called once per key inside `auth.onAuthStateChanged`, does the pull +
   live-listen side. This pattern is what Accounts (`daily_accounts` → `'accounts'`), all of
   Kitchen (`kitchen_recipes`/`kitchen_pantry`/etc.), custom exercises, training split, theme,
   day colours, budget categories, and credit-card tracking already use correctly.

## AUDIT RESULT

Cross-referenced every `localStorage.setItem`/`lsSave` call in `js/app.js` against every
`fbReconcile`/`dbRef`/`fbRef`/`syncBlobPush`/`syncBlobListen` call. Most features are correctly
wired — including Accounts, which turned out to already have both push and pull sync in place
(`saveAccounts()` → `lsSave('daily_accounts', accounts, 'accounts')`, plus
`syncBlobListen(user.uid,'accounts','daily_accounts',...)` registered at sign-in). If Accounts
still isn't visibly syncing for Francois, the wiring itself isn't the obvious cause — see the
"Also investigate" section below for the one concrete thing that could still cause it.

Two real, confirmed gaps — entire features with **no Firebase sync anywhere**, same pattern as
the Notes bug fixed in prompt 10:

- **Calorie tracking** — `wt_calories` (today's logged entries, `persistDailyLog()`),
  `daily_cal_history` (daily kcal totals keyed by date, feeds the weekly chart,
  `recordCalorieHistory()`), and `daily_saved_foods` (quick-add favourite foods) are pure
  localStorage. None of them call `lsSave` with a `syncPath`, `fbReconcile`, or any `db.ref`.
- **Check-in streak** — `daily_checkin_log` (`logCheckin()`/`calcStreak()`) is also pure
  localStorage, no sync anywhere. A streak built on one device won't show up, or worse will look
  reset, on another.

## TASK

### 1. Calorie tracking
Wire `wt_calories`, `daily_cal_history`, and `daily_saved_foods` into the existing generic blob
pattern, exactly like Accounts/Kitchen already do:
- Wherever each is currently saved via a plain `localStorage.setItem(...)`, switch it to
  `lsSave(key, value, 'someSyncPath')` — pick short, collision-free path names (e.g.
  `'calorieLog'`, `'calorieHistory'`, `'savedFoods'`) that don't already exist under
  `users/<uid>/` (check the existing path list in the codebase context above before naming
  these).
- Register a matching `syncBlobListen(user.uid, 'calorieLog', 'wt_calories', ()=>{...})` (and
  the other two) inside `auth.onAuthStateChanged`, alongside the existing Kitchen/Accounts
  registrations — re-render whatever's currently on screen if it's showing calorie data
  (mirror how the Kitchen listeners guard with `if(S.view==='kitchen'&&...)`).

### 2. Check-in streak
Same treatment for `daily_checkin_log` — `lsSave` with a syncPath (e.g. `'checkinLog'`), plus a
`syncBlobListen` registration that recalculates/re-renders the streak display when the cloud
value changes on another device.

### 3. Data-safety check
Same caution as prompt 10: `syncBlobListen`'s existing seed logic (`if(!snap.exists() && local
!=null && local!=='') ref.set(local)`) already handles "don't let an empty local value wipe a
populated cloud one, or vice versa" correctly for every other key using this pattern — don't
write custom merge logic for these three, just reuse the exact same function.

## ALSO INVESTIGATE (not confirmed broken — worth checking rather than blindly trusting the code read)

`ensureAccountsMigrated()` (~line 4786) runs at module load time, before Firebase auth state is
known, and can create + immediately push a local `daily_accounts` value derived from legacy
savings/CC logs if `daily_accounts` has never been written on that device. On a second device
signing in for the first time, if that device happens to have old local legacy data AND the
cloud 'accounts' path hasn't been created yet for some reason, there's a plausible (not proven)
race between this migration and `syncBlobListen`'s cloud-existence check. Trace through whether
this could ever cause a fresh device to seed the cloud with a stale local guess instead of
waiting to check the cloud first, and whether that matches what Francois might have actually
seen. If you find a real race, fix it; if it checks out fine, say so rather than changing
anything speculatively.

## OUT OF SCOPE

`wt_setdata` (mid-workout in-progress recovery state — intentionally same-device-only scratch
data, the permanent record is `wt_sessions` which already syncs) and `daily_reminders` (just
local "have I shown this reminder today" dedup — leave both as they are.

## VERIFICATION — for Francois to check on two devices/browsers signed into the same account

1. Log a calorie entry on device A → open the calorie tracker on device B (reload/reopen if
   needed) → the entry appears.
2. Save a favourite food on device A → it's in the quick-add list on device B.
3. Check the weekly calorie chart on device A, log more entries there, then check the chart on
   device B → totals match.
4. Build a check-in streak on device A for a few days → device B shows the same current/longest
   streak, not reset to 0.
5. Re-test Accounts specifically on a fresh sign-in (sign out, clear the app, sign back in on a
   device that's never had this app's data before) → confirm it pulls the real cloud data rather
   than a locally-guessed migration.
6. Sign out and back in on both devices afterward → nothing from any of these three features is
   lost or duplicated.
