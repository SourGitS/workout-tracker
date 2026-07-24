# PROMPT 26 — URGENT: Fix Firebase Sync Silently Overwriting Local Data

## WHY THIS PROMPT EXISTS

Francois reported real data loss: an income source ("Misc income") disappeared and had to be
re-added, variable spend categories were affected, and a Log tab session history got completely
reset. **Update**: he then rebuilt his training split from scratch, and it got wiped again before
this prompt was ever run — confirming the same root cause also hits training split, via the exact
same sync path shape. This is a genuine pre-existing bug in the sync layer — confirmed via git
history that none of the recent feature prompts touch this code. It happened to surface this week
because rapid prompt iteration meant far more app reloads than normal (every git push redeploys to
GitHub Pages, and the PWA reloads) — each reload re-runs the Firebase sign-in handshake, giving a
latent race condition many more chances to fire than it would in ordinary day-to-day use.

## ROOT CAUSE

Four places pull data from Firebase and adopt whatever the cloud has **without checking whether
it's actually newer than the local copy**. Compare this to `budgetData` (weekly budget entries),
which already does this correctly (`mergeBudgetWeeks()`, js/app.js:62-72 — newer `updatedAt` per
week wins, union instead of wholesale replace). These four don't:

1. **Sessions — the most exposed, no protection at all** (js/app.js:200-209). A live
   `.on('value')` listener runs `S.sessions = data ? Object.values(data).sort(...) : []` on
   *every* cloud read, then immediately writes that straight into `localStorage['wt_sessions']`.
   No merge, no check. If this fires with a stale, partial, or empty snapshot (plausible right
   after sign-in, before the "seed the cloud" check just above it has finished, or over a slow
   connection), it wipes session history outright — this is the Log tab reset.

2. **Budget config — `daily_budget_config`** (income/fixed/variable expense arrays used by
   Settings + CSV export, js/app.js:326-350 pull / 4707-4715 save). A one-time `.once('value')`
   read replaces the whole config with the cloud copy, no merge. If cloud is older than local
   (edited locally, hadn't finished pushing up yet), the older cloud version wins — and if an
   array comes back empty, it falls back even further to the hardcoded factory defaults
   (Fujifilm/McDonald's, Food/Social + Personal/Misc, js/app.js:4688-4703).

3. **Budget category name lists — `daily_budget_inc_cats`/`fix_cats`/`var_cats`** (the store the
   Budget tab actually renders day-to-day, js/app.js:5198-5223, synced via the shared
   `syncBlobListen()` helper, js/app.js:83-105). This one has *partial* protection — an
   "offline edit wins" check, but **only** for the narrow window before its own initial
   `.once('value')` resolves. Once that flips true (the normal case), any later cloud read is
   adopted unconditionally, with no way to tell "older" from "newer." This is almost certainly
   the direct mechanism behind "Misc income disappeared" and the variable-category issue: an
   edit saves locally and starts pushing to the cloud, the app reloads before that push is
   confirmed, and the reload's listener reads back the not-yet-updated cloud value and silently
   overwrites the local edit with it.

4. **Training split — `wt_split`** (js/app.js:659 save via `saveSplit()`, js/app.js:479 pull),
   confirmed by Francois rebuilding his split and having it wiped again before this prompt ran.
   Exact same shape as #3: `saveSplit()` writes through the plain (non-timestamped)
   `lsSave('wt_split', splitConfig, 'trainingSplit')`, and the pull is a plain
   `syncBlobListen(user.uid,'trainingSplit','wt_split',...)` — same "unconditional adopt once
   seedDone flips true" gap. A rebuilt split saved locally, reload before the push lands, and the
   reload's listener reads back the pre-rebuild cloud copy and overwrites the fresh one.

`syncBlobListen()` is shared by ~16 other sync paths (theme, swaps, exercise library, kitchen
data, home layout, etc.) that haven't been reported as broken. This prompt does **not** touch the
shared function or those other call sites — see OUT OF SCOPE.

## TASK

### 1. Sessions: merge by id instead of replacing wholesale
Replace js/app.js:200-209:
```js
    dbRef.on('value', snap=>{
      const data=snap.val();
      S.sessions = data ? Object.values(data).sort((a,b)=>a.date<b.date?-1:1) : [];
      localStorage.setItem('wt_sessions', JSON.stringify(S.sessions));
      if(S.view==='stats'){
        if(statsSubTab==='history') renderHistory();
        else if(statsSubTab==='training') renderTraining();
        else if(statsSubTab==='overview') renderStatsOverview();
      }
    });
```
with:
```js
    dbRef.on('value', snap=>{
      const cloudMap = snap.val() || {};
      // Union by id instead of adopting the cloud snapshot wholesale — a stale/empty cloud
      // read (e.g. right after sign-in, before the seed-check above finishes) used to wipe
      // every locally-logged session outright. Sessions are effectively create-once, so a
      // straight union recovers anything the old wholesale-replace could drop; local wins on
      // the rare same-id collision since it's the actively-open device's copy.
      const localMap = {}; S.sessions.forEach(s=>{ localMap[s.id]=s; });
      const mergedMap = {...cloudMap, ...localMap};
      S.sessions = Object.values(mergedMap).sort((a,b)=>a.date<b.date?-1:1);
      localStorage.setItem('wt_sessions', JSON.stringify(S.sessions));
      // Local had sessions the cloud didn't (the exact gap that used to cause data loss) —
      // converge the cloud so the next pull, on any device, sees them too.
      const cloudMissingSome = Object.keys(localMap).some(id=>!(id in cloudMap));
      if(cloudMissingSome) dbRef.set(mergedMap);
      if(S.view==='stats'){
        if(statsSubTab==='history') renderHistory();
        else if(statsSubTab==='training') renderTraining();
        else if(statsSubTab==='overview') renderStatsOverview();
      }
    });
```

### 2. Budget config: stamp + compare `updatedAt`
Save (js/app.js:4707-4715) — add one line:
```js
function saveBudgetConfig(cfg){
  cfg.updatedAt = Date.now();
  budgetConfig = cfg;
  incomeStreams = cfg.incomeStreams;
  localStorage.setItem('daily_budget_config', JSON.stringify(cfg));
  localStorage.removeItem('daily_income_streams');
  if(firebaseReady&&auth&&auth.currentUser&&db){
    db.ref('users/'+auth.currentUser.uid+'/budgetConfig').set(cfg);
  }
}
```
Pull (js/app.js:326-350), replace the whole block with:
```js
    db.ref('users/'+user.uid+'/budgetConfig').once('value').then(snap=>{
      if(snap.exists()){
        const val=snap.val()||{};
        const fix=a=>Array.isArray(a)?a:Object.values(a||{});
        if(Array.isArray(val.incomeStreams)||val.incomeStreams){
          const cloudCfg={
            incomeStreams:fix(val.incomeStreams),
            fixedExpenses:fix(val.fixedExpenses),
            variableExpenses:fix(val.variableExpenses),
            updatedAt: val.updatedAt||0,
          };
          // Newer updatedAt wins (mirrors mergeBudgetWeeks) instead of adopting the cloud
          // copy outright — a stale snapshot used to silently overwrite fresher local edits,
          // including dropping them to empty and then to the hardcoded factory defaults.
          if((budgetConfig.updatedAt||0) > cloudCfg.updatedAt){
            db.ref('users/'+user.uid+'/budgetConfig').set(budgetConfig); // converge cloud
          } else {
            budgetConfig=cloudCfg;
            if(!budgetConfig.incomeStreams.length||!budgetConfig.fixedExpenses.length||!budgetConfig.variableExpenses.length){
              const def=loadBudgetConfig();
              if(!budgetConfig.incomeStreams.length) budgetConfig.incomeStreams=def.incomeStreams;
              if(!budgetConfig.fixedExpenses.length) budgetConfig.fixedExpenses=def.fixedExpenses;
              if(!budgetConfig.variableExpenses.length) budgetConfig.variableExpenses=def.variableExpenses;
            }
            incomeStreams=budgetConfig.incomeStreams;
            localStorage.setItem('daily_budget_config',JSON.stringify(budgetConfig));
            if(S.view==='budget') renderBudgetTab();
            if(S.view==='home') renderHome();
          }
        }
      } else {
        db.ref('users/'+user.uid+'/budgetConfig').set(budgetConfig);
      }
    });
```

### 3. Budget category name lists: timestamp-aware sync, scoped to just these 3 stores
Add two new functions near `syncBlobListen`/`syncBlobPush` (js/app.js, right after the existing
`syncBlobListen` at line 105) — additive, does not modify the existing function:
```js
// Timestamp-aware variant of syncBlobPush/syncBlobListen, used only where a stale cloud read
// must never clobber a newer local edit (see Prompt 26 — budget category lists were silently
// reverting because the plain blob sync has no way to tell "old" from "new"). Wire shape in
// Firebase: {v:<string>, t:<ms>}. A bare-string cloud value (written by the older plain
// syncBlobPush, or pre-migration) is treated as t=0, so a locally-stamped edit always wins
// against it and converges the cloud to the new shape — no separate migration step needed.
function lsSaveTS(key, value, tsKey, syncPath){
  const now=Date.now();
  try{
    localStorage.setItem(key, typeof value==='string'?value:JSON.stringify(value));
    localStorage.setItem(tsKey, String(now));
  }catch(e){ console.warn('localStorage save failed for '+key, e); return; }
  if(syncPath && firebaseReady && auth && auth.currentUser && db){
    db.ref('users/'+auth.currentUser.uid+'/'+syncPath).set({v:localStorage.getItem(key), t:now});
  }
}
function syncBlobListenTS(uid, path, lsKey, tsKey, onUpdate){
  const ref=db.ref('users/'+uid+'/'+path);
  const localT=()=>parseInt(localStorage.getItem(tsKey)||'0',10)||0;
  ref.on('value', snap=>{
    const raw=snap.val();
    if(raw==null||raw==='') return; // nothing in the cloud yet — never adopt emptiness
    const isEnvelope = raw && typeof raw==='object' && 'v' in raw;
    const cloudV = isEnvelope ? raw.v : raw;
    const cloudT = isEnvelope ? (raw.t||0) : 0;
    if(cloudV==null || cloudV==='') return;
    if(localT() > cloudT){
      ref.set({v:localStorage.getItem(lsKey), t:localT()}); // local newer — converge cloud
      return;
    }
    if(localStorage.getItem(lsKey)===cloudV) return; // unchanged
    localStorage.setItem(lsKey, cloudV);
    localStorage.setItem(tsKey, String(cloudT));
    try{ onUpdate&&onUpdate(); }catch(e){}
  });
  return ref;
}
```
Update the three save functions (js/app.js:5206, 5214, 5223):
```js
function saveFixCats(cats){ lsSaveTS('daily_budget_fix_cats', cats, 'daily_budget_fix_cats_ts', 'budgetFixCats'); }
function saveVarCats(cats){ lsSaveTS('daily_budget_var_cats', cats, 'daily_budget_var_cats_ts', 'budgetVarCats'); }
function saveIncCats(cats){ lsSaveTS('daily_budget_inc_cats', cats, 'daily_budget_inc_cats_ts', 'budgetIncCats'); }
```
`loadIncCats`/`loadFixCats`/`loadVarCats` need no changes — the envelope only wraps the
Firebase-side value; localStorage still holds the plain string exactly as before.

Update the three call sites (js/app.js:378-380):
```js
    incCatRef = syncBlobListenTS(user.uid,'budgetIncCats','daily_budget_inc_cats','daily_budget_inc_cats_ts',()=>{ if(S.view==='budget'&&!budEditing()) renderBudgetTab(); });
    fixCatRef = syncBlobListenTS(user.uid,'budgetFixCats','daily_budget_fix_cats','daily_budget_fix_cats_ts',()=>{ if(S.view==='budget'&&!budEditing()) renderBudgetTab(); });
    varCatRef = syncBlobListenTS(user.uid,'budgetVarCats','daily_budget_var_cats','daily_budget_var_cats_ts',()=>{ if(S.view==='budget'&&!budEditing()) renderBudgetTab(); });
```

### 4. Training split: reuse the same timestamp-aware sync
Confirmed broken — same fix pattern as #3, reusing the `lsSaveTS`/`syncBlobListenTS` functions
added above (do this part after Part 3, since it depends on those two functions existing).

Save side — `splitCfg()` (js/app.js:651-658) and `saveSplit()` (js/app.js:659):
```js
function splitCfg(){
  if(!splitConfig){
    splitConfig=loadSplit();
    // Persist a migrated split once so it's stable across reloads and seeds the cloud.
    if(!_splitPersisted){ _splitPersisted=true; if(localStorage.getItem('wt_split')==null){ try{ lsSaveTS('wt_split', splitConfig, 'wt_split_ts', 'trainingSplit'); }catch(e){} } }
  }
  return splitConfig;
}
function saveSplit(){ const c=sanitizeSplit(splitConfig); if(c) splitConfig=c; lsSaveTS('wt_split', splitConfig, 'wt_split_ts', 'trainingSplit'); }
```
Pull side — js/app.js:479:
```js
    syncBlobListenTS(user.uid,'trainingSplit','wt_split','wt_split_ts',()=>{
      splitConfig=null; splitCfg(); // reload from the just-updated localStorage copy
      if(S.view==='log'&&typeof renderLog==='function') renderLog();
      if(S.view==='home'&&typeof renderHome==='function') renderHome();
      if(S.view==='stats'&&statsSubTab==='training'&&typeof renderTraining==='function') renderTraining();
      if(typeof renderSplitEditor==='function'&&document.getElementById('view-split-editor')&&document.getElementById('view-split-editor').style.display!=='none') renderSplitEditor();
    });
```
This also protects onboarding's split-seeding path (`finishOnboarding()`) for free, since that
code calls the same `saveSplit()`.

Bump the service worker cache version (whatever it currently is, +1) so this fix reaches devices
immediately instead of waiting on the existing cached copy.

## OUT OF SCOPE

- The other ~16 remaining `syncBlobListen()` call sites (theme, swaps, exercise library, kitchen
  data, home layout, day colours, habits log, etc.) — the same underlying weakness likely exists
  there too, but none of them have been reported as losing data, and rewriting all of them in the
  same pass as a trust-critical data-loss fix is its own risk. Worth a dedicated audit later;
  not bundled into this fix.
- `mergeBudgetWeeks()`/weekly `budgetData` — already correct, untouched.
- Anything about *why* a push might be slow/fail (network handling, retry logic) — out of
  scope; this fix makes a slow/failed push harmless instead of trying to make pushes faster.

## VERIFICATION — for Francois to check

1. Add a new income source or variable category, then **immediately** reload the app (or force-
   close and reopen) a few times in a row — it should stay, not revert.
2. Log a workout, reload immediately after saving — the session should still be there.
3. If you have a second device signed in, add a category on one device, open the app on the
   other within a few seconds — it should show up there too (not just survive reloads, actually
   sync).
4. General regression check: Budget tab still shows all your real income sources, fixed
   expenses, and variable categories (not the factory defaults — Fujifilm/McDonald's/Food-Social/
   Personal-Misc) unless those genuinely are your categories.
5. Log tab: your existing session history is all still there after this update installs.
6. Rebuild/edit your training split, then **immediately** reload a few times in a row — it
   should stay exactly as you left it, not revert to an older version.

## IN THE MEANTIME

Until this is running: try to avoid closing or reloading the app in the few seconds right after
adding/editing a budget category, logging a session, or editing your training split — especially
on a weak connection — that's the exact window this bug lives in. If you're rebuilding the split
again before this fix is in, build it, wait 10-15 seconds without touching anything (let the sync
push finish), then confirm it survives one reload before you close the app.
