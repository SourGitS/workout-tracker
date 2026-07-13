'use strict';

// ── Firebase ─────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDYLW15gSIKYfbZ1lLH-82TG74em2Cin9w",
  authDomain: "workout-tracker-5dd55.firebaseapp.com",
  databaseURL: "https://workout-tracker-5dd55-default-rtdb.firebaseio.com",
  projectId: "workout-tracker-5dd55",
  storageBucket: "workout-tracker-5dd55.firebasestorage.app",
  messagingSenderId: "30476940153",
  appId: "1:30476940153:web:9145b265c3f285dc83b5a8",
  measurementId: "G-ZMZK790C9W"
};
let firebaseReady = !firebaseConfig.apiKey.startsWith('REPLACE');
let auth = null, db = null;
let dbRef       = null;
let weightDbRef = null;
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstallPrompt = e; });

// iOS first-tap fix: a bound (even empty) click listener on an ancestor makes mobile WebKit
// treat descendant taps as real clicks immediately, instead of swallowing the first tap of a
// fresh load / post-idle as a hover simulation. Bound here at parse time (script is deferred,
// so document.body already exists) — as early as possible, before any user interaction.
document.body.addEventListener('click', function(){}, false);

function handleAuth(){
  if(!firebaseReady || !auth) return;
  if(auth.currentUser){ auth.signOut(); return; }
  auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()).catch(()=>{});
}
function updateHeaderAvatar(){
  const btn=document.getElementById('header-avatar'); if(!btn) return;
  const user=(firebaseReady&&auth)?auth.currentUser:null;
  if(user&&user.photoURL){
    btn.innerHTML='<img src="'+user.photoURL+'" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover">';
    btn.style.background='transparent';
  } else {
    const name=profileData.name||S.personalInfo?.name||'';
    const initial=name?name.charAt(0).toUpperCase():'?';
    btn.innerHTML='<span style="font-size:14px;font-weight:700;color:var(--accent);line-height:1">'+initial+'</span>';
    btn.style.background='#2a2a2a';
  }
}
function syncProfileToFirebase(){ const r=fbRef('profile'); if(r) r.set(profileData); }
function syncPersonalInfoToFirebase(){ const r=fbRef('personalInfo'); if(r) r.set(S.personalInfo); }
function syncBudDefaultsToFirebase(){ const r=fbRef('budgetDefaults'); if(r) r.set(budDefaults); }
// When the caller knows which week changed, write ONLY that week's node — a device
// holding a stale copy of other weeks then can't clobber them, whatever it does.
// The whole-blob set survives only as the fallback for calls with no key.
function syncBudgetDataToFirebase(changedKey){
  const r=fbRef('budgetData'); if(!r) return;
  if(changedKey && budgetData[changedKey]) r.child(changedKey).set(budgetData[changedKey]);
  else r.set(budgetData);
}
// Merge cloud and local budget data per week instead of letting the cloud blob replace
// local wholesale — the replace is how a device with a stale copy used to wipe another
// device's newer week (blank current-week inputs). Weeks are never deleted anywhere in
// the app, so a union is safe; a week present on both sides goes to the newer updatedAt
// stamp (legacy weeks without one count as 0; ties keep the cloud copy, matching the old
// behaviour for never-stamped data).
function mergeBudgetWeeks(localData, cloudData){
  const merged={}; let cloudNeedsUpdate=false;
  new Set([...Object.keys(localData||{}), ...Object.keys(cloudData||{})]).forEach(k=>{
    const l=(localData||{})[k], c=(cloudData||{})[k];
    if(c===undefined){ merged[k]=l; cloudNeedsUpdate=true; return; }
    if(l===undefined){ merged[k]=c; return; }
    if(((l&&l.updatedAt)||0) > ((c&&c.updatedAt)||0)){ merged[k]=l; cloudNeedsUpdate=true; }
    else merged[k]=c;
  });
  return {data:merged, cloudNeedsUpdate};
}
function syncSettingsCollapsedToFirebase(){ const r=fbRef('settingsCollapsed'); if(r) r.set(settingsCollapsed); }
// ── Generic blob sync (Realtime Database) for simple localStorage keys ──
// Stores the raw localStorage string under users/<uid>/<path>. Used for data added
// after the original sync was built (budget categories, credit card, weight log).
function syncBlobPush(path, lsKey){
  const r=fbRef(path); if(!r) return;
  setSyncStatus('Syncing…');
  r.set(localStorage.getItem(lsKey)||'')
    .then(()=>setSyncStatus('Synced ✓')).catch(()=>setSyncStatus('Sync failed'));
}
function syncBlobListen(uid, path, lsKey, onUpdate){
  const ref=db.ref('users/'+uid+'/'+path);
  const preAuthLocal=localStorage.getItem(lsKey); // snapshot before any cloud callback fires
  let seedDone=false;
  ref.once('value').then(snap=>{
    const local=localStorage.getItem(lsKey);
    if(!snap.exists() && local!=null && local!=='') ref.set(local); // seed cloud from this device
    seedDone=true;
  });
  ref.on('value', snap=>{
    const v=snap.val();
    if(v==null || v==='') return;
    // First fire arrives before seed-once resolves; if local differs, local wins (offline edit)
    if(!seedDone && preAuthLocal!=null && preAuthLocal!=='' && preAuthLocal!==v){
      ref.set(preAuthLocal);
      return;
    }
    if(localStorage.getItem(lsKey)===v) return; // unchanged
    localStorage.setItem(lsKey, v);
    try{ onUpdate&&onUpdate(); }catch(e){}
  });
  return ref;
}
function setSyncStatus(txt){
  const el=document.getElementById('sync-status');
  if(el) el.textContent=txt;
}

// ── Generic localStorage load/save ────────────────────────────────
// Read+parse a JSON value, returning `fallback` if it's missing, unparseable, null,
// or fails the optional `validate` predicate. The fallback is returned as-is (pass a
// fresh literal at the call site). Replaces the hand-rolled try/JSON.parse loaders.
function lsLoad(key, fallback, validate){
  try{
    const raw=localStorage.getItem(key);
    if(raw==null) return fallback;
    const v=JSON.parse(raw);
    if(v==null) return fallback;
    if(validate && !validate(v)) return fallback;
    return v;
  }catch(e){ return fallback; }
}
// Write to localStorage (JSON-encoded unless already a string) and, when a Firebase
// blob `syncPath` is given, push it to the cloud. setItem is guarded so a quota /
// private-mode failure can't throw out of the caller mid-render; the push is guarded too.
function lsSave(key, value, syncPath){
  try{
    localStorage.setItem(key, typeof value==='string'?value:JSON.stringify(value));
  }catch(e){ console.warn('localStorage save failed for '+key, e); return; }
  if(syncPath){ try{ if(typeof syncBlobPush==='function') syncBlobPush(syncPath, key); }catch(e){} }
}

// ── Firebase helpers ──────────────────────────────────────────────
// Per-user ref for `path`, or null if Firebase isn't ready / not signed in. Centralises
// the firebaseReady/auth/currentUser/db guard every cloud write repeated verbatim.
function fbRef(path){
  if(!firebaseReady||!auth||!auth.currentUser||!db) return null;
  return db.ref('users/'+auth.currentUser.uid+'/'+path);
}
// One-shot reconcile for a simple object/array store on sign-in: if the cloud has a
// value, pull it into memory (`set`) + localStorage and refresh the UI (`render`);
// otherwise seed the cloud from the local value when it's worth it (`seedWhen`, default
// "non-empty"). get()/set() bridge the module-scoped variable the store lives in.
function fbReconcile(path, lsKey, get, set, render, seedWhen){
  const ref=fbRef(path); if(!ref) return;
  ref.once('value').then(snap=>{
    if(snap.exists()){
      set(snap.val());
      localStorage.setItem(lsKey, JSON.stringify(get()));
      if(render) render();
    } else {
      const v=get();
      const worth = seedWhen ? seedWhen() : (Array.isArray(v) ? v.length>0 : !!(v&&Object.keys(v).length>0));
      if(worth) ref.set(v);
    }
  });
}

if(firebaseReady){
  try{
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db   = firebase.database();
    auth.getRedirectResult().catch(()=>{});
    auth.onAuthStateChanged(user=>{
  let piRef, savRef, habitsRef, budDataRef, incCatRef, fixCatRef, varCatRef, ccRef;
  if(user){

    dbRef = db.ref('users/'+user.uid+'/sessions');
    dbRef.once('value').then(snap=>{
      if(!snap.exists() && S.sessions.length>0){
        const data={};
        S.sessions.forEach(s=>{ data[s.id]=s; });
        dbRef.set(data);
      }
    });
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

    weightDbRef = db.ref('users/'+user.uid+'/weights');
    weightDbRef.once('value').then(snap=>{
      if(!snap.exists() && S.weights.length>0){
        const data={};
        S.weights.forEach(w=>{ data[w.date.replace(/-/g,'')]=w; });
        weightDbRef.set(data);
      }
    });
    weightDbRef.on('value', snap=>{
      const data=snap.val();
      S.weights = data ? Object.values(data).sort((a,b)=>a.date<b.date?-1:1) : [];
      // The cloud copy replaces S.weights wholesale, so legacy daily_weight_log entries
      // merged while signed out must be re-applied here and pushed back up.
      if(mergeLegacyWeightEntries()) persistWeights();
      else localStorage.setItem('wt_weight', JSON.stringify(S.weights));
      if(S.view==='stats'&&(statsSubTab==='body'||statsSubTab==='overview')) setStatsTab(statsSubTab);
    });

    // One-time migration: fold the old duplicate weight log (daily_weight_log locally,
    // users/{uid}/weightLog in the cloud) into the canonical weights store, then delete
    // both copies. Per-date conflicts keep the wt_weight value (mergeLegacyWeightEntries).
    db.ref('users/'+user.uid+'/weightLog').once('value').then(snap=>{
      const v=snap.val();
      if(v){ try{ const arr=JSON.parse(v); if(Array.isArray(arr)) _wtLegacyCloud=arr; }catch(e){} }
      if(mergeLegacyWeightEntries()) persistWeights();
      localStorage.removeItem('daily_weight_log');
      db.ref('users/'+user.uid+'/weightLog').remove().catch(()=>{});
    });

    // ── Sync personal info (calorie goal) ──
    piRef = db.ref('users/'+user.uid+'/personalInfo');
    piRef.once('value').then(snap=>{
      if(!snap.exists() && Object.keys(S.personalInfo||{}).length>0){
        piRef.set(S.personalInfo);
      }
    });
    piRef.on('value', snap=>{
      if(!snap.val()) return;
      S.personalInfo = snap.val();
      localStorage.setItem('wt_personalinfo', JSON.stringify(S.personalInfo));
      renderSettings();
    });

    // ── Sync savings balance log ──
    savRef = db.ref('users/'+user.uid+'/savingsLog');
    // Initial sync: MERGE local + cloud (newest-per-date wins) and push the union back, so a
    // local-only/newer update is never lost and the cloud catches up.
    savRef.once('value').then(snap=>{
      const cloud = snap.exists() ? Object.values(snap.val()||{}) : [];
      savingsLog = mergeSavings(savingsLog, cloud);
      localStorage.setItem('daily_savings_log', JSON.stringify(savingsLog));
      savRef.set(Object.fromEntries(savingsLog.filter(e=>e&&e.date).map(e=>[String(e.date).replace(/-/g,''),e])));
      if(typeof renderHome==='function') renderHome();
    });
    // Live updates: merge (don't blindly overwrite) so a fresh local entry survives.
    savRef.on('value', snap=>{
      const data=snap.val();
      if(!data) return;
      savingsLog = mergeSavings(savingsLog, Object.values(data));
      localStorage.setItem('daily_savings_log', JSON.stringify(savingsLog));
      if(typeof renderHome==='function') renderHome();
    });

    // ── Sync daily habits ──
    habitsRef = db.ref('users/'+user.uid+'/habits');
    habitsRef.once('value').then(snap=>{
      try{
        const local = JSON.parse(localStorage.getItem('daily_habits')||'null');
        if(!snap.exists() && local) habitsRef.set(local);
      }catch(e){ console.warn('habits seed failed',e); }
    }).catch(e=>console.warn('habits sync error',e));
    habitsRef.on('value', snap=>{
      if(!snap.val()) return;
      localStorage.setItem('daily_habits', JSON.stringify(snap.val()));
      if(typeof renderHome==='function') renderHome();
    });

    // Sync profile
    fbReconcile('profile','daily_profile',
      ()=>profileData, v=>{ profileData=v||{}; },
      ()=>{ renderAccountSection(); renderHome(); });

    // Sync budget defaults
    fbReconcile('budgetDefaults','daily_budget_defaults',
      ()=>budDefaults, v=>{ budDefaults=v||{}; },
      ()=>{ if(S.view==='budget') renderBudgetTab(); });

    // Sync weekly budget data (real-time, both directions)
    db.ref('users/'+user.uid+'/budgetData').once('value').then(snap=>{
      if(!snap.exists() && Object.keys(budgetData).length>0){
        db.ref('users/'+user.uid+'/budgetData').set(budgetData);
      }
    });
    budDataRef = db.ref('users/'+user.uid+'/budgetData');
    budDataRef.on('value', snap=>{
      const data=snap.val();
      if(data){
        const active=document.activeElement;
        const editing=active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA');
        if(editing) return; // never overwrite budgetData while user has focus in an input
        const scrubbed=scrubSavingsTarget(data); // strip the removed savings target from incoming cloud data
        // Merge per week (newer updatedAt wins) rather than adopting the cloud blob
        // wholesale — see mergeBudgetWeeks. If local had newer weeks, push the merge
        // result back so the cloud converges too. No loop: the echoed snapshot merges
        // to an identical result, so cloudNeedsUpdate comes back false.
        const merged=mergeBudgetWeeks(budgetData, data);
        budgetData=merged.data;
        localStorage.setItem('daily_budget',JSON.stringify(budgetData));
        if(scrubbed||merged.cloudNeedsUpdate) budDataRef.set(budgetData);
        if(S.view==='budget') renderBudgetTab();
        if(S.view==='home') renderHome();
      }
    });

    // Sync budget config (income streams + fixed + variable expenses)
    db.ref('users/'+user.uid+'/budgetConfig').once('value').then(snap=>{
      if(snap.exists()){
        const val=snap.val()||{};
        const fix=a=>Array.isArray(a)?a:Object.values(a||{});
        if(Array.isArray(val.incomeStreams)||val.incomeStreams){
          budgetConfig={
            incomeStreams:fix(val.incomeStreams),
            fixedExpenses:fix(val.fixedExpenses),
            variableExpenses:fix(val.variableExpenses),
          };
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
      } else {
        db.ref('users/'+user.uid+'/budgetConfig').set(budgetConfig);
      }
    });

    // Sync settings collapsed state
    fbReconcile('settingsCollapsed','daily_settings_collapsed',
      ()=>settingsCollapsed, v=>{ settingsCollapsed=v||{}; },
      ()=>{ if(S.view==='settings') applySettingsCollapsed(); });

    // Sync weight goal
    fbReconcile('weightGoal','daily_weight_goal',
      ()=>weightGoal, v=>{ weightGoal=v||{}; },
      ()=>{ if(S.view==='stats') renderWeightGoal(); },
      ()=>!!weightGoal.target);

    // Sync subscriptions
    fbReconcile('subscriptions','daily_subscriptions',
      ()=>subscriptionsData, v=>{ subscriptionsData=Array.isArray(v)?v:Object.values(v||{}); },
      ()=>{ applySubscriptionsToBudget(); if(S.view==='settings') renderSubscriptionsSection(); });

    // ── Sync data added after the original sync was built ──
    const budEditing=()=>{ const a=document.activeElement; return a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'); };
    incCatRef = syncBlobListen(user.uid,'budgetIncCats','daily_budget_inc_cats',()=>{ if(S.view==='budget'&&!budEditing()) renderBudgetTab(); });
    fixCatRef = syncBlobListen(user.uid,'budgetFixCats','daily_budget_fix_cats',()=>{ if(S.view==='budget'&&!budEditing()) renderBudgetTab(); });
    varCatRef = syncBlobListen(user.uid,'budgetVarCats','daily_budget_var_cats',()=>{ if(S.view==='budget'&&!budEditing()) renderBudgetTab(); });
    ccRef     = syncBlobListen(user.uid,'creditCard','daily_cc',()=>{ if(S.view==='home'&&typeof renderHome==='function') renderHome(); });
    syncBlobListen(user.uid,'ccLog','daily_cc_log',()=>{ ccLog=loadCCLog(); if(S.view==='stats'&&statsSubTab==='finance') renderBSBalance(); });
    // ── Cross-device sync for everything else that was previously local-only ──
    // These keys are all unset until the user changes them, so an untouched device can't
    // seed empty data over a device that has real data (last-writer-wins is safe here).
    syncBlobListen(user.uid,'homeOrder','daily_home_order',()=>{ if(S.view==='home'&&typeof renderHome==='function') renderHome(); });
    syncBlobListen(user.uid,'habitsLog','daily_habits_log',()=>{ try{ habitsLog=loadHabitsLog(); }catch(e){} if(typeof refreshHabitsUI==='function') refreshHabitsUI(); });
    syncBlobListen(user.uid,'dynamicColours','daily_dynamic_colours',()=>{ if(typeof applyDayColour==='function') applyDayColour(); });
    syncBlobListen(user.uid,'dayColors','daily_day_colors',()=>{ if(typeof applyDayColour==='function') applyDayColour(); if(S.view==='settings'&&typeof renderDayColorPickers==='function') renderDayColorPickers(); });
    syncBlobListen(user.uid,'appTheme','wt_theme',()=>{ S.theme=localStorage.getItem('wt_theme')||S.theme; if(typeof applyTheme==='function') applyTheme(); });
    syncBlobListen(user.uid,'swaps','wt_swaps',()=>{ try{ S.swaps=JSON.parse(localStorage.getItem('wt_swaps')||'{}')||{}; }catch(e){} if(S.view==='log'&&typeof renderLog==='function') renderLog(); });
    syncBlobListen(user.uid,'dayCustom','wt_day_custom',()=>{ try{ dayCustom=JSON.parse(localStorage.getItem('wt_day_custom')||'{}')||{}; }catch(e){} if(S.view==='log'&&typeof renderLog==='function') renderLog(); if(S.view==='home'&&typeof renderHome==='function') renderHome(); });
    syncBlobListen(user.uid,'exerciseLib','wt_exercise_lib',()=>{ if(typeof renderExerciseLibList==='function') renderExerciseLibList(); });
    syncBlobListen(user.uid,'trainingSplit','wt_split',()=>{
      splitConfig=null; splitCfg(); // reload from the just-updated localStorage copy
      if(S.view==='log'&&typeof renderLog==='function') renderLog();
      if(S.view==='home'&&typeof renderHome==='function') renderHome();
      if(S.view==='stats'&&statsSubTab==='training'&&typeof renderTraining==='function') renderTraining();
      if(typeof renderSplitEditor==='function'&&document.getElementById('view-split-editor')&&document.getElementById('view-split-editor').style.display!=='none') renderSplitEditor();
    });
    // ── Kitchen sync ──
    syncBlobListen(user.uid,'kitRecipes','kitchen_recipes',()=>{ try{ kitRecipes=kitLoadRecipes(); }catch(e){} if(S.view==='kitchen'&&typeof kitRender==='function') kitRender(); });
    syncBlobListen(user.uid,'kitShopSelected','kitchen_shopping_selected',()=>{ try{ kitShopSelected=kitShopLoadSelected(); kitShopView=kitShopSelected.length?'list':'selector'; }catch(e){} if(S.view==='kitchen'&&typeof kitShopRender==='function') kitShopRender(); });
    syncBlobListen(user.uid,'kitShopChecked','kitchen_shopping_checked',()=>{ try{ kitShopChecked=kitShopLoadChecked(); }catch(e){} if(S.view==='kitchen'&&typeof kitShopRenderList==='function') kitShopRenderList(); });
    syncBlobListen(user.uid,'kitShopManual','kitchen_shopping_manual',()=>{ try{ kitShopManual=kitShopLoadManual(); }catch(e){} if(S.view==='kitchen'&&typeof kitShopRenderList==='function') kitShopRenderList(); });
    syncBlobListen(user.uid,'kitPantry','kitchen_pantry',()=>{ try{ kitPantryData=kitPantryLoad(); }catch(e){} if(S.view==='kitchen'&&typeof kitPantryRender==='function') kitPantryRender(); });
    // Sync plans from cloud on login (cloud wins on first load; local wins on conflict via timestamp)
    db.ref('users/'+user.uid+'/plans').once('value').then(snap=>{
      if(snap.exists()){
        const cloud=snap.val();
        const local=loadPlans();
        // Cloud wins if it has more plans; otherwise keep local
        if(cloud&&Array.isArray(cloud.plans)&&cloud.plans.length>=local.plans.length){
          try{ localStorage.setItem('wt_plans',JSON.stringify(cloud)); }catch(e){}
        } else if(local.plans.length>0){
          db.ref('users/'+user.uid+'/plans').set(local);
        }
      } else {
        const local=loadPlans();
        if(local.plans.length>0) db.ref('users/'+user.uid+'/plans').set(local);
      }
      if(S.view==='plans') renderPlans();
    }).catch(e=>console.warn('plans sync failed',e));
    setSyncStatus('Synced ✓');

  } else {
    if(dbRef){ dbRef.off(); dbRef=null; }
    if(weightDbRef){ weightDbRef.off(); weightDbRef=null; }
    if(piRef){ piRef.off(); piRef=null; }
    if(savRef){ savRef.off(); savRef=null; }
    if(habitsRef){ habitsRef.off(); habitsRef=null; }
    if(budDataRef){ budDataRef.off(); budDataRef=null; }
    if(incCatRef){ incCatRef.off(); incCatRef=null; }
    if(fixCatRef){ fixCatRef.off(); fixCatRef=null; }
    if(varCatRef){ varCatRef.off(); varCatRef=null; }
    if(ccRef){ ccRef.off(); ccRef=null; }
    setSyncStatus('Not signed in');
  }
  updateHeaderAvatar();
  renderAccountSection();
    });
  } catch(e){
    firebaseReady = false;
    auth = null; db = null;
  }
}

// ── Program: user-editable training split ────────────────────────
// A split is a list of training "types" (each a named workout with its own exercise list)
// plus a `schedule` mapping the rotating day index → a type index. Persisted to wt_split
// and synced. Existing accounts (and the original hardcoded 6-day Arnold Split) migrate in
// via loadSplit(); brand-new users get a neutral 3-day full-body default until onboarding.
// LEGACY_SPLIT_TYPES is the exact original program — used only to migrate existing users
// with zero visible change, and to build the exercise-library defaults for them.
const LEGACY_SPLIT_TYPES = [
  {
    id:'cb', name:'Chest & Back', colorKey:'chest-back', pillClass:'cb', barColor:'#ef4444',
    exercises:[
      {name:'Incline smith press', sets:3},
      {name:'Chest fly', sets:2},
      {name:'Chest press machine', sets:2},
      {name:'Pullups', sets:3, allowNegative:true, note:'− kg = assisted · + kg = added weight'},
      {name:'Upper back row', sets:3},
      {name:'Seated row', sets:2},
      {name:'Dead hangs', sets:2, priority:'grip', unit:'secs'},
      {name:'Abs', sets:2, priority:'abs'},
    ]
  },
  {
    id:'sa', name:'Shoulders & Arms', colorKey:'shoulders-arms', pillClass:'sa', barColor:'#3b82f6',
    exercises:[
      {name:'Shoulder press', sets:2},
      {name:'Lateral raise', sets:2},
      {name:'Rear delt fly', sets:2},
      {name:'Barbell bicep curl', sets:3},
      {name:'Barbell reverse curl', sets:3},
      {name:'Tricep pushdown', sets:2},
      {name:'Single arm tricep pushdown', sets:2},
      {name:'Forearm curl', sets:2},
      {name:'Standing calf raise', sets:4, priority:'calves'},
      {name:'Abs', sets:2, priority:'abs'},
    ]
  },
  {
    id:'lg', name:'Legs', colorKey:'legs', pillClass:'lg', barColor:'#10b981',
    exercises:[
      {name:'Standing calf raise', sets:4, priority:'calves'},
      {name:'Smith machine squat', sets:3, warmupSets:1},
      {name:'Seated leg curl', sets:3},
      {name:'Leg extension', sets:3},
      {name:'Abs', sets:2, priority:'abs'},
    ]
  }
];
const LEGACY_SCHEDULE = [0,1,2,0,1,2];
// Palette assigned to freshly-created split days (index → colour). colorKey stays a plain
// slug used only to seed the per-day colour store (LEGACY_DAY_COLOURS) on migration.
const SPLIT_PALETTE = ['#3b82f6','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#ef4444','#10b981','#6366f1'];
function legacySplit(){ return { types: JSON.parse(JSON.stringify(LEGACY_SPLIT_TYPES)), schedule: LEGACY_SCHEDULE.slice() }; }
// Neutral 3-day full-body split for brand-new users who skip the split builder.
function genericSplit(){
  return { types:[
    {id:'fbA',name:'Full Body A',colorKey:'fullbody',barColor:'#3b82f6',exercises:[
      {name:'Squat',sets:3},{name:'Bench press',sets:3},{name:'Bent-over row',sets:3},{name:'Plank',sets:3,unit:'secs'}]},
    {id:'fbB',name:'Full Body B',colorKey:'push',barColor:'#f59e0b',exercises:[
      {name:'Deadlift',sets:3},{name:'Overhead press',sets:3},{name:'Lat pulldown',sets:3},{name:'Lunge',sets:3}]},
    {id:'fbC',name:'Full Body C',colorKey:'pull',barColor:'#8b5cf6',exercises:[
      {name:'Leg press',sets:3},{name:'Incline press',sets:3},{name:'Seated row',sets:3},{name:'Calf raise',sets:3}]},
  ], schedule:[0,1,2] };
}
// Normalise a loaded/edited split: guarantee ids, names, exercise arrays, and a schedule
// that only references valid type indices (falls back to one-slot-per-type).
function sanitizeSplit(s){
  if(!s||typeof s!=='object'||!Array.isArray(s.types)||!s.types.length) return null;
  s.types.forEach((t,i)=>{
    if(!t.id) t.id='t'+i+'_'+Math.random().toString(36).slice(2,7);
    if(!t.name) t.name='Day '+(i+1);
    if(!Array.isArray(t.exercises)) t.exercises=[];
  });
  let sch=Array.isArray(s.schedule)?s.schedule.filter(n=>Number.isInteger(n)&&n>=0&&n<s.types.length):[];
  if(!sch.length) sch=s.types.map((_,i)=>i);
  s.schedule=sch;
  return s;
}
function loadSplit(){
  const clean=sanitizeSplit(lsLoad('wt_split',null));
  if(clean) return clean;
  // No saved split → migrate. An account that has already been used (name set, sessions
  // logged, or per-day customisations) is the existing Arnold-split user → seed the legacy
  // program so their log/history/stats are byte-identical. A truly fresh install gets the
  // neutral default (overwritten when they build a split in onboarding).
  const existing = !!(typeof profileData==='object'&&profileData&&(profileData.name||'').trim())
    || (typeof S==='object'&&S&&Array.isArray(S.sessions)&&S.sessions.length>0)
    || (typeof dayCustom==='object'&&dayCustom&&Object.keys(dayCustom).length>0);
  return existing ? legacySplit() : genericSplit();
}
let splitConfig=null;
let _splitPersisted=false;
// Lazy init so the migration heuristics can read profileData / S.sessions / dayCustom,
// which are all declared later in the file. First real call is at boot render time.
function splitCfg(){
  if(!splitConfig){
    splitConfig=loadSplit();
    // Persist a migrated split once so it's stable across reloads and seeds the cloud.
    if(!_splitPersisted){ _splitPersisted=true; if(localStorage.getItem('wt_split')==null){ try{ lsSave('wt_split', splitConfig, 'trainingSplit'); }catch(e){} } }
  }
  return splitConfig;
}
function saveSplit(){ const c=sanitizeSplit(splitConfig); if(c) splitConfig=c; lsSave('wt_split', splitConfig, 'trainingSplit'); }
function splitTypes(){ return splitCfg().types; }
function splitSchedule(){ return splitCfg().schedule; }
function scheduleLen(){ const n=splitSchedule().length; return n>0?n:1; }
function typeIdxForDay(i){ const s=splitSchedule(); const n=s.length||1; return s[((i%n)+n)%n]||0; }
function typeForDayIdx(i){ const ts=splitTypes(); return ts[typeIdxForDay(i)] || ts[0]; }
function allExerciseNames(){ return [...new Set(splitTypes().flatMap(t=>(t.exercises||[]).map(e=>e.name)))]; }

// ── Storage helpers ──────────────────────────────────────────────
function load(){ return lsLoad('wt_sessions', []); }
function loadWeights(){ return lsLoad('wt_weight', []); }
function loadSwaps(){ return lsLoad('wt_swaps', {}); }
function loadTheme(){
  // Default dark (the momentum look). Users opt into light via Settings.
  return localStorage.getItem('wt_theme')||'dark';
}
function loadPersonalInfo(){ return lsLoad('wt_personalinfo', {}); }
function loadDailyLog(){
  try{
    const saved = JSON.parse(localStorage.getItem('wt_calories')||'{}');
    const today = getLocalDate();
    // Always guarantee an entries array — a missing/old-shape object would otherwise
    // make S.dailyLog.entries undefined and crash renderHome() (blank Home tab).
    if(saved.date !== today || !Array.isArray(saved.entries)) return {date:today, entries:[]};
    // Migrate: ensure every entry has a category (default 'other')
    saved.entries.forEach(e=>{ if(!e.category) e.category='other'; });
    return saved;
  } catch{ return {date:getLocalDate(), entries:[]}; }
}
// Daily calorie totals history, keyed by date → total kcal (for the weekly chart)
function loadCalorieHistory(){ return lsLoad('daily_cal_history', {}); }
let calorieHistory = loadCalorieHistory();
function recordCalorieHistory(){
  if(!S.dailyLog||!S.dailyLog.date) return;
  const total=S.dailyLog.entries.reduce((a,e)=>a+(e.kcal||0),0);
  calorieHistory[S.dailyLog.date]=total;
  localStorage.setItem('daily_cal_history', JSON.stringify(calorieHistory));
}
function loadSavingsLog(){ return lsLoad('daily_savings_log', []); }
function loadPlans(){
  const DEF={plans:[],activePlanId:null,streak:{lastDate:'',count:0}};
  let raw;
  try{ raw=JSON.parse(localStorage.getItem('wt_plans')||'null'); }catch(e){ return {plans:[],activePlanId:null,streak:{lastDate:'',count:0}}; }
  if(!raw||typeof raw!=='object') return DEF;
  // Legacy shape: some installs stored a BARE ARRAY of plans (the old "daily routine" model,
  // each plan carrying its own exercises/history) instead of the {plans,activePlanId,streak}
  // wrapper the current tab expects. Returning that array as-is made renderPlans crash on
  // data.plans.find (plans undefined) — a silent blank Plans tab. Wrap/coerce to a stable
  // shape so every caller is safe; the plan objects themselves are preserved untouched.
  if(Array.isArray(raw)){
    return {plans:raw, activePlanId:(raw[0]&&raw[0].id)||null, streak:{lastDate:'',count:0}};
  }
  if(!Array.isArray(raw.plans)) raw.plans=[];
  if(!raw.streak||typeof raw.streak!=='object') raw.streak={lastDate:'',count:0};
  if(raw.activePlanId===undefined) raw.activePlanId=(raw.plans[0]&&raw.plans[0].id)||null;
  return raw;
}
function savePlans(data){
  try{ localStorage.setItem('wt_plans',JSON.stringify(data)); }catch(e){ console.warn('plans save failed',e); }
  try{
    if(firebaseReady&&auth&&auth.currentUser&&db){
      db.ref('users/'+auth.currentUser.uid+'/plans').set(data);
    }
  }catch(e){ console.warn('plans firebase sync failed',e); }
}
function loadNotes(){ try{ return JSON.parse(localStorage.getItem('wt_notes')||'[]'); }catch(e){ return []; } }
function saveNotes(n){ try{ localStorage.setItem('wt_notes',JSON.stringify(n)); }catch(e){ console.warn('notes save failed',e); } }
// Merge two savings logs by date, keeping the most recently-edited entry per date (by `t`).
// Prevents a stale cloud copy from clobbering a fresh local update on the next load.
function mergeSavings(a, b){
  const m={};
  [...(a||[]),...(b||[])].forEach(e=>{
    if(!e||!e.date) return;
    const cur=m[e.date];
    if(!cur || (e.t||0) >= (cur.t||0)) m[e.date]=e;
  });
  return Object.values(m).sort((x,y)=>x.date<y.date?-1:1);
}
function saveSavingsLog(){
  localStorage.setItem('daily_savings_log', JSON.stringify(savingsLog));
  pushSavings();
}
// savRef is let-scoped to the auth callback, so referencing it from this global function threw
// a ReferenceError that the old try/catch swallowed — the cloud write silently never ran, so
// edits never synced to other devices. Write to the ref by uid instead (same fix as pushHabits).
function pushSavings(){
  try{
    if(firebaseReady && auth && auth.currentUser && db){
      db.ref('users/'+auth.currentUser.uid+'/savingsLog').set(Object.fromEntries(
        savingsLog.filter(e=>e&&e.date).map(e=>[String(e.date).replace(/-/g,''),e])
      ));
    }
  }catch(err){ console.error('savings cloud sync failed', err); }
}
function logCheckin(){
  const today=getLocalDate();
  try{
    const log=JSON.parse(localStorage.getItem('daily_checkin_log')||'[]');
    if(!log.includes(today)){ log.push(today); localStorage.setItem('daily_checkin_log',JSON.stringify(log)); }
  } catch{}
}
function calcStreak(){
  let log=[];
  try{ log=JSON.parse(localStorage.getItem('daily_checkin_log')||'[]'); } catch{}
  if(!log.length) return {current:0,longest:0};
  const dates=[...new Set(log)].sort();
  const d=localMidnight(getLocalDate());
  // Current streak: walk backwards from today
  let current=0;
  while(true){
    if(dates.includes(dateStr(d))){ current++; d.setDate(d.getDate()-1); }
    else break;
  }
  // Longest streak: scan sorted dates
  let longest=dates.length?1:0, run=1;
  for(let i=1;i<dates.length;i++){
    const diff=Math.round((new Date(dates[i]+'T12:00:00')-new Date(dates[i-1]+'T12:00:00'))/(864e5));
    if(diff===1){ run++; if(run>longest) longest=run; }
    else run=1;
  }
  longest=Math.max(longest,current);
  return {current,longest};
}
function loadProfileData(){ return lsLoad('daily_profile', {}); }

// ── State ────────────────────────────────────────────────────────
const S = {
  view: 'home',
  dayIdx: 0,
  setData: {},
  checked: new Set(),
  sessions: load(),
  weights: loadWeights(),
  swaps: loadSwaps(),
  theme: loadTheme(),
  personalInfo: loadPersonalInfo(),
  dailyLog: loadDailyLog(),
  sessionNote: '',
  swapTarget: null,
  chart: null,
  weightChart: null,
  sessionStart: null,
  // Exercises added via the Log "+ Add exercise" button. SESSION-ONLY: merged into the
  // currently-viewed day's list (so they show in today's log and save into that date's
  // history) but never written to dayCustom — future occurrences of the day type render
  // from the plan template with no trace of them. Reset on day change / after save.
  sessionAdds: [],
};

let exCollapsed = new Set(); // session-only exercise card collapse state

// ── Persist ──────────────────────────────────────────────────────
function persist(){
  try{ localStorage.setItem('wt_sessions', JSON.stringify(S.sessions)); }catch(e){ console.warn('localStorage full',e); }
  if(dbRef){
    const data={};
    S.sessions.forEach(s=>{ data[s.id]=s; });
    dbRef.set(data).catch(e=>console.error('Firebase sync error:',e));
  }
}
function persistWeights(){
  try{ localStorage.setItem('wt_weight', JSON.stringify(S.weights)); }catch(e){ console.warn('localStorage full',e); }
  if(weightDbRef){
    const data={};
    S.weights.forEach(w=>{ data[w.date.replace(/-/g,'')]=w; });
    weightDbRef.set(data).catch(e=>console.error('Firebase weight sync error:',e));
  }
}
function saveSwaps(){ lsSave('wt_swaps', S.swaps, 'swaps'); }
function persistDailyLog(){ try{ localStorage.setItem('wt_calories', JSON.stringify(S.dailyLog)); }catch(e){ console.warn('localStorage full',e); } recordCalorieHistory(); }

// ── Helpers ──────────────────────────────────────────────────────
// Per-day-type exercise customisation (permanent, overlay model): `added` extra exercises
// and `hidden` removed names, keyed by TYPES id (cb/sa/lg). Cached in memory; saved on change.
let dayCustom = lsLoad('wt_day_custom', {}, o=>o&&typeof o==='object');
function saveDayCustom(){ lsSave('wt_day_custom', dayCustom, 'dayCustom'); }
function dayCustomFor(typeId){ return dayCustom[typeId] || (dayCustom[typeId]={added:[],hidden:[]}); }
function effectiveExercises(base){
  const c=dayCustom[base.id]||{};
  const hidden=new Set(c.hidden||[]);
  const added=(c.added||[]).map(a=>({name:a.name, sets:a.sets||1, muscle:a.muscle, custom:true}));
  let list=[...base.exercises, ...added].filter(ex=>!hidden.has(ex.name));
  // Session-only additions (Log "+ Add exercise") for the CURRENTLY-VIEWED day only. They join
  // the rendered list — so saveSession (which reads this same list) writes them into today's
  // history — but they are NOT in dayCustom, so they vanish on the next occurrence. The length
  // guard keeps the common (no-adds) path free of the extra typeForDayIdx lookup.
  if(typeof S!=='undefined' && Array.isArray(S.sessionAdds) && S.sessionAdds.length
     && typeof typeForDayIdx==='function' && base.id===typeForDayIdx(S.dayIdx).id){
    const have=new Set(list.map(e=>e.name));
    S.sessionAdds.forEach(a=>{ if(a&&a.name&&!have.has(a.name)){ list.push({name:a.name, muscle:a.muscle||'other', custom:true, sessionOnly:true}); have.add(a.name); } });
  }
  if(c.order && c.order.length){
    // Apply the user's drag-reordered sequence; anything not in `order` (e.g. just added) trails.
    const pos=n=>{ const i=c.order.indexOf(n); return i<0?1e6:i; };
    list=list.map((ex,i)=>[ex,i]).sort((a,b)=>(pos(a[0].name)-pos(b[0].name))||(a[1]-b[1])).map(p=>p[0]);
  }
  return list;
}
// Returns a shallow clone of the day's program type with its EFFECTIVE (customised) exercise
// list, so every consumer (render/save/Home counts) sees the same add/remove edits.
function type(i){ const base=typeForDayIdx(i); return {...base, exercises:effectiveExercises(base)}; }
function dn(name){ return S.swaps[name] || name; } // display name (respects swaps)

function lastSessionOf(typeName){
  for(let i=S.sessions.length-1;i>=0;i--)
    if(S.sessions[i].sessionType===typeName) return S.sessions[i];
  return null;
}
function hintWeight(session, exName, setIdx){
  if(!session) return '';
  const ex = (session.exercises||[]).find(e=>e.name===exName);
  if(!ex||!ex.sets||!ex.sets[setIdx]) return '';
  return ex.sets[setIdx].weight||'';
}
function fmtDate(iso){
  const d = new Date(iso+'T12:00:00');
  return d.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});
}
function getPR(exName){
  let pr=0;
  S.sessions.forEach(s=>s.exercises.forEach(ex=>{
    if(ex.name===exName) ex.sets.forEach(set=>{ if(set.weight>pr) pr=set.weight; });
  }));
  return pr;
}
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

// ── Theme ─────────────────────────────────────────────────────────
function applyTheme(){
  const isDark = S.theme !== 'light';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = isDark ? '#080808' : '#f2f2f7';
}
function setTheme(t){
  S.theme = t;
  lsSave('wt_theme', t, 'appTheme');
  applyTheme();
  if(S.view==='stats') setStatsTab(statsSubTab); // re-render charts with the new theme colours
}

// ── Accent colour ─────────────────────────────────────────────────
// ── Accent / per-day colour system ────────────────────────────────
// One unified system: a palette of 8 presets, one colour assigned per actual training day
// (keyed by day NAME so it tracks renames/adds/removes) plus a colour for rest days. The
// rest colour doubles as the app's static base accent when dynamic day colours are off.
const DAY_COLOR_PRESETS = ['#FF6B35','#3B82F6','#8B5CF6','#EF4444','#10B981','#F59E0B','#EC4899','#14B8A6'];
const REST_COLOR_KEY = '__rest__';
function hexToRgb(hex){
  const h=(hex||'').replace('#','');
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)].join(',');
}
function applyAccent(hex){
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-rgb', hexToRgb(hex));
}
// Legacy muscle-group → colour; used only to migrate existing accounts onto the new store.
const LEGACY_DAY_COLOURS = { 'chest-back':'#3B82F6','shoulders-arms':'#8B5CF6','legs':'#EF4444','rest':'#FF6B35' };
function buildDefaultDayColors(){
  const map={};
  try{ (splitTypes()||[]).forEach((t,i)=>{
    if(!t||!t.name) return;
    map[t.name] = LEGACY_DAY_COLOURS[t.colorKey] || t.barColor || DAY_COLOR_PRESETS[i%DAY_COLOR_PRESETS.length];
  }); }catch(e){}
  // Preserve any previously-chosen single accent as the base/rest colour.
  map[REST_COLOR_KEY] = localStorage.getItem('daily_accent_color') || '#FF6B35';
  return map;
}
function loadDayColors(){
  let m=null;
  try{ m=JSON.parse(localStorage.getItem('daily_day_colors')||'null'); }catch(e){}
  if(!m||typeof m!=='object') m=buildDefaultDayColors();
  if(!m[REST_COLOR_KEY]) m[REST_COLOR_KEY]='#FF6B35';
  return m;
}
function saveDayColors(m){ lsSave('daily_day_colors', m, 'dayColors'); }
function restColor(){ return loadDayColors()[REST_COLOR_KEY] || '#FF6B35'; }
function dayColorFor(name){ const m=loadDayColors(); return (name&&m[name]) || m[REST_COLOR_KEY] || '#FF6B35'; }
function setDayColorEnc(encKey, hex){
  const key=decodeURIComponent(encKey);
  const m=loadDayColors(); m[key]=hex; saveDayColors(m);
  applyDayColour();
  if(typeof renderDayColorPickers==='function') renderDayColorPickers();
}
// Name of the training day currently shown in the Log tab (drives the live accent).
function currentDayName(){ const t=typeForDayIdx(S.dayIdx); return t?t.name:null; }
function applyDayColour(){
  if(typeof applyLogoDayColour==='function') applyLogoDayColour(); // keep the wordmark in sync
  const enabled = localStorage.getItem('daily_dynamic_colours') === 'true';
  const hero = document.querySelector('.hero-workout-card');
  const rtBar = document.getElementById('rt-bar');
  // Dynamic ON → follow the current day's assigned colour; OFF → static rest/base colour.
  const hex = enabled ? dayColorFor(currentDayName()) : restColor();
  applyAccent(hex);
  if(hero){ hero.style.background=''; hero.style.boxShadow=''; }
  if(rtBar) rtBar.style.boxShadow = enabled ? ('0 8px 24px rgba('+hexToRgb(hex)+',.30)') : '';
}
function onDynamicColoursToggle(enabled){
  lsSave('daily_dynamic_colours', enabled ? 'true' : 'false', 'dynamicColours');
  renderDayColorPickers();
  applyDayColour();
}
// Appearance → per-day colour pickers. One row per live training day + one for rest days.
function renderDayColorPickers(){
  const wrap=document.getElementById('day-colors-list'); if(!wrap) return;
  const dynamicOn=localStorage.getItem('daily_dynamic_colours')==='true';

  if(!dynamicOn){
    // Static mode: show a single native colour picker
    const cur=restColor()||'#FF6B35';
    wrap.innerHTML=
      '<div style="display:flex;align-items:center;gap:14px;padding:4px 0">' +
        '<label style="font-size:14px;color:var(--text);font-weight:500;flex:1">Accent colour</label>' +
        '<input type="color" id="static-accent-input" value="'+cur+'" ' +
          'style="width:44px;height:44px;border:none;border-radius:10px;cursor:pointer;background:none;padding:0" ' +
          'oninput="setStaticAccent(this.value)" ' +
          'onchange="setStaticAccent(this.value)">' +
      '</div>' +
      '<p style="font-size:12px;color:var(--muted);margin:8px 0 0;line-height:1.4">This colour is used as the app accent everywhere. Enable Dynamic day colours above to set a colour per training day.</p>';
    return;
  }

  // Dynamic mode: full per-day grid (original code)
  const m=loadDayColors();
  const rows=[]; const seen=new Set();
  let types=[]; try{ types=splitTypes()||[]; }catch(e){}
  types.forEach(t=>{ if(t&&t.name&&!seen.has(t.name)){ seen.add(t.name); rows.push({key:t.name,label:t.name}); } });
  rows.push({key:REST_COLOR_KEY,label:'Rest days'});
  wrap.innerHTML=rows.map(r=>{
    const cur=String(m[r.key]||m[REST_COLOR_KEY]||'#FF6B35').toLowerCase();
    const sw=DAY_COLOR_PRESETS.map(hex=>
      '<button class="dc-swatch'+(hex.toLowerCase()===cur?' active':'')+'" style="background:'+hex+'" '+
        'onclick="setDayColorEnc(\''+encodeURIComponent(r.key)+'\',\''+hex+'\')" aria-label="'+hex+'"></button>'
    ).join('');
    return '<div class="dc-row"><div class="dc-row-name">'+String(r.label).replace(/</g,'&lt;')+'</div>'+
      '<div class="dc-swatches">'+sw+'</div></div>';
  }).join('');
}
function setStaticAccent(hex){
  if(!hex||!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
  const m=loadDayColors();
  m[REST_COLOR_KEY]=hex;
  saveDayColors(m);
  applyDayColour();
}

// ── Timer ─────────────────────────────────────────────────────────
function fmtTimer(ms){
  const s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60);
  const mm=String(m%60).padStart(2,'0'), ss=String(s%60).padStart(2,'0');
  return h>0?`${h}:${mm}:${ss}`:`${m}:${ss}`;
}
function getDurationMins(){ return S.sessionStart ? Math.round((Date.now()-S.sessionStart)/60000) : 0; }
function fmtDuration(mins){
  if(!mins) return '';
  return mins>=60 ? Math.floor(mins/60)+'h '+String(mins%60).padStart(2,'0')+'m' : mins+'m';
}
// Session timer — timestamp-based (survives backgrounding). Source of truth is
// S.sessionStart (ms epoch); elapsed is derived on read, never tick-counted.
function sessionGetElapsed(){ return S.sessionStart ? Date.now()-S.sessionStart : 0; }
function sessionFormat(ms){
  const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return h>0 ? h+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0') : m+':'+String(sec).padStart(2,'0');
}
function rtUpdateSessionLabels(){
  const txt=sessionFormat(sessionGetElapsed());
  const bar=document.getElementById('rt-bar-session');
  if(bar) bar.textContent='Session: '+txt;
  const fs=document.getElementById('rt-fs-session');
  if(fs) fs.textContent='Session '+txt;
  // Same ~per-second interval drives the lap button's live duration, so the current lap time
  // is visible on the button without opening the fullscreen timer.
  if(typeof updateLapFabText==='function') updateLapFabText();
}

// ── Rest Timer (stopwatch) ────────────────────────────────────────
// Counts UP. Elapsed is derived from timestamps, never from tick counts, so
// backgrounding the tab (which throttles setInterval) can't make it drift or
// "pause". The interval only drives the display refresh.
let rtStartTime = null;   // ms epoch of the current run segment
let rtOffset = 0;         // accumulated ms from previous paused segments
let rtRunning = false;
let rtInterval = null;
let rtLaps = [];
let rtUiInterval = null;  // 1s refresh for the session label while on the Log tab

function rtFormat(ms){
  const s=Math.floor(ms/1000), min=Math.floor(s/60), sec=s%60, tenth=Math.floor((ms%1000)/100);
  return min>0 ? min+':'+String(sec).padStart(2,'0')+'.'+tenth : sec+'.'+tenth;
}
function rtGetElapsed(){ if(!rtRunning) return rtOffset; return rtOffset+(Date.now()-rtStartTime); }
function rtStart(){
  rtStartTime=Date.now(); rtRunning=true;
  if(!S.sessionStart){ S.sessionStart=Date.now(); rtStartUi(); } // first Start also starts the session
  if(rtInterval) clearInterval(rtInterval);
  rtInterval=setInterval(rtTick,47);
  rtUpdateControls();
  updateLapFab();
}
function rtPause(){
  if(!rtRunning) return;
  rtOffset+=Date.now()-rtStartTime;
  rtRunning=false;
  clearInterval(rtInterval); rtInterval=null;
  rtUpdateControls();
  updateLapFab();
}
function rtToggle(){ rtRunning ? rtPause() : rtStart(); }
function rtTick(){ rtUpdateDisplay(rtGetElapsed()); }

function rtUpdateDisplay(ms){
  const txt=rtFormat(ms);
  const bar=document.getElementById('rt-bar-time'); if(bar) bar.textContent=txt;
  const fs=document.getElementById('rt-fs-time'); if(fs) fs.textContent=txt;
}
function rtUpdateControls(){
  const barBtn=document.getElementById('rt-bar-toggle');
  if(barBtn) barBtn.textContent=rtRunning?'Pause':'Start';
  const fsBtn=document.getElementById('rt-fs-toggle');
  if(fsBtn){ fsBtn.textContent=rtRunning?'Stop':'Start'; fsBtn.className='rt-fs-btn '+(rtRunning?'stop':'start'); }
}
function rtLap(){
  rtLaps.unshift({label:'Rest '+(rtLaps.length+1), ms:rtGetElapsed()});
  rtOffset=0; rtStartTime=Date.now();
  rtRenderLaps();
  rtUpdateDisplay(rtGetElapsed());
}
function rtRenderLaps(){
  const el=document.getElementById('rt-fs-laps');
  if(!el) return;
  el.innerHTML=rtLaps.map(l=>
    '<div class="rt-lap-row"><span class="rt-lap-label">'+l.label+'</span><span class="rt-lap-time">'+rtFormat(l.ms)+'</span></div>'
  ).join('');
}
// Full reset of the rest stopwatch (day change / after save) — session is reset separately.
function rtResetAll(){
  rtPause();
  rtOffset=0; rtStartTime=null; rtLaps=[];
  rtUpdateDisplay(0); rtRenderLaps(); rtUpdateControls();
  updateLapFab();
}
// Floating LAP button — visible only while the rest stopwatch is running on the Log tab,
// so you can bank a rest split without opening the fullscreen timer. Reuses rtLap via the
// timer-lap delegated action; splits show in the fullscreen timer's lap list.
// m:ss clock for the lap button (whole seconds — the button shows the CURRENT lap/rest
// duration, i.e. time since the last lap, which is exactly the rest stopwatch's elapsed).
function lapFabClock(ms){ const s=Math.floor(ms/1000); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); }
function updateLapFabText(){
  const t=document.querySelector('#lap-fab .lap-fab-text');
  if(t) t.textContent = rtRunning ? lapFabClock(rtGetElapsed()) : 'LAP';
}
function updateLapFab(){
  const f=document.getElementById('lap-fab'); if(!f) return;
  f.style.display=(rtRunning && S.view==='log') ? 'flex' : 'none';
  updateLapFabText(); // show the current lap time immediately when the button appears
}
// Sync all timer UI to current state (called when entering the Log tab).
function rtInitDisplay(){
  rtUpdateDisplay(rtGetElapsed());
  rtUpdateControls();
  rtRenderLaps();
  rtUpdateSessionLabels();
}
function rtOpenFullscreen(){
  const fs=document.getElementById('rt-fullscreen');
  if(!fs) return;
  fs.classList.remove('hidden');
  rtInitDisplay();
}
function rtCloseFullscreen(){
  const fs=document.getElementById('rt-fullscreen');
  if(fs) fs.classList.add('hidden');
}
function rtStartUi(){ if(rtUiInterval) return; rtUiInterval=setInterval(rtUpdateSessionLabels,500); }
function rtStopUi(){ if(rtUiInterval){ clearInterval(rtUiInterval); rtUiInterval=null; } }

// Recompute on return to foreground: setInterval is throttled while hidden, so
// snap the display back to the true timestamp-derived elapsed.
document.addEventListener('visibilitychange',()=>{
  if(document.hidden) return;
  if(rtRunning) rtUpdateDisplay(rtGetElapsed());
  rtUpdateSessionLabels();
});

// Timer controls via event delegation. Buttons carry data-action instead of inline
// onclick — delegation on document is the more reliable tap path in iOS standalone PWAs
// (matches how the budget/category controls are wired). One listener, no double-fire.
document.addEventListener('click',function(e){
  const btn=e.target.closest('[data-action^="timer-"]');
  if(!btn) return;
  switch(btn.dataset.action){
    case 'timer-toggle': rtToggle(); break;
    case 'timer-lap':    rtLap(); break;
    case 'timer-expand': rtOpenFullscreen(); break;
    case 'timer-close':  rtCloseFullscreen(); break;
    case 'timer-reset':  rtResetAll(); break;
  }
});

// Desktop: drag the floating timer panel (mousedown anywhere on the bar except buttons).
(function(){
  let dragging=false,dx=0,dy=0,bar=null;
  document.addEventListener('mousedown',e=>{
    if(window.innerWidth<1024) return;
    bar=document.getElementById('rt-bar');
    if(!bar||!bar.contains(e.target)||e.target.closest('button')) return;
    const r=bar.getBoundingClientRect();
    dragging=true; dx=e.clientX-r.left; dy=e.clientY-r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!dragging||!bar) return;
    const w=bar.offsetWidth, h=bar.offsetHeight;
    const x=Math.min(Math.max(0,e.clientX-dx),window.innerWidth-w);
    const y=Math.min(Math.max(0,e.clientY-dy),window.innerHeight-h);
    bar.style.left=x+'px'; bar.style.top=y+'px';
    bar.style.right='auto'; bar.style.bottom='auto';
  });
  document.addEventListener('mouseup',()=>{ dragging=false; });
})();

function suggestDay(){
  if(!S.sessions.length) return 0;
  const last = S.sessions[S.sessions.length-1];
  return (last.dayNum||0) % scheduleLen();
}

// ── Init day ─────────────────────────────────────────────────────
function initDay(idx){
  S.dayIdx = idx;
  S.checked = new Set();
  S.sessionNote = '';
  S.sessionStart = null;
  S.sessionAdds = []; // fresh day → no carried-over session-only additions
  const noteEl = document.getElementById('session-note');
  if(noteEl) noteEl.value = '';
  const t = type(idx);
  // Dynamic sets: every exercise opens with a single working set; the user adds more
  // (or warmups) as they go. Last-session values are shown as hints at render time.
  S.setData = {};
  t.exercises.forEach(ex=>{
    S.setData[ex.name] = [{weight:'', reps:'', type:'working', done:false}];
  });
}

// ── View ─────────────────────────────────────────────────────────
let statsSubTab = 'overview';
function setView(v, direction, opts){
  opts = opts || {};
  const _libOv=document.getElementById('view-exercise-library');
  if(_libOv&&_libOv.style.display!=='none'){_libOv.style.display='none';_libOv.style.left='0';}
  const prev=S.view;
  S.view = v;
  const swipeIdx=NAV_ORDER.indexOf(v);
  const isSwipe=swipeIdx>=0;
  // Overlay (non-deck) views are the direct <section> children of #app-main; hide them all,
  // then reveal the target if it's an overlay. Deck views (home/budget/log/stats) live inside
  // #swipe-deck and are shown by deck position (mobile) / .deck-active (desktop) instead.
  document.querySelectorAll('#app-main > section').forEach(el=>el.classList.add('hidden'));
  if(!isSwipe){ const incoming=document.getElementById('view-'+v); if(incoming) incoming.classList.remove('hidden'); }
  document.querySelectorAll('.swipe-panel').forEach(p=>p.classList.toggle('deck-active', p.id===('view-'+v)));
  // Move the deck to the target panel — unless the gesture already positioned it (fromSwipe).
  if(isSwipe && !opts.fromSwipe) setDeckPosition(swipeIdx, prev!==v);
  else if(isSwipe) deckIdx=swipeIdx;
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  document.querySelectorAll('.ds-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===v));
  // The bottom scroll-fade paints over the kitchen's floating "+" / add bars (the tab-slide
  // transform traps those fixed elements below it), so hide it on the Kitchen tab.
  const _sf=document.getElementById('scroll-fade'); if(_sf) _sf.style.display = (v==='kitchen') ? 'none' : '';
  if(v==='home') renderHome();
  if(v==='log'){
    renderLog();
    // The rest-timer bar lives inside #view-log, so it shows/hides with the tab.
    rtInitDisplay();
    rtStartUi();
  } else {
    rtStopUi();
  }
  // Stats is a standalone top-level view (its own bottom-nav tab + desktop sidebar item).
  if(v==='stats'){ setStatsTab(statsSubTab); }
  if(v==='budget') renderBudgetTab();
  if(v==='kitchen') kitRender();
  else if(typeof kitShopRenderAddBar==='function') kitShopRenderAddBar(false); // hide fixed shopping add-bar off-tab
  if(v==='settings') renderSettings();
  if(v==='plans') renderPlans();
  if(v==='notes') renderNotes();
  updateNavPill(v);
  updateStatsPill(v);
  if(typeof updateLapFab==='function') updateLapFab();
  if(v!=='home' && homeEditMode){ homeEditMode=false; const b=document.getElementById('home-edit-btn'); if(b){ b.textContent='Edit layout'; b.classList.remove('active'); } }
  updateNavBadges();
}
const NAV_ORDER=['home','budget','log','stats'];

// ── Swipe deck (native-feel tab paging) ──────────────────────────
// The four bottom-nav views sit side-by-side in #swipe-deck and track the finger in real
// time; releasing spring-snaps to the nearest view. Mobile only — desktop pages via
// .deck-active (see setView + layout.css). Order matches NAV_ORDER: home,budget,log,stats.
let deckIdx = 0;
function setDeckPosition(idx, animate){
  const deck=document.getElementById('swipe-deck'); if(!deck) return;
  idx=Math.max(0, Math.min(NAV_ORDER.length-1, idx));
  if(animate) deck.classList.add('snapping'); else deck.classList.remove('snapping');
  deck.style.transform='translateX('+(-idx*25)+'%)';
  if(animate){ deck.addEventListener('transitionend',function h(){ deck.classList.remove('snapping'); deck.removeEventListener('transitionend',h); },{once:true}); }
  deckIdx=idx;
}
(function(){
  const deck=document.getElementById('swipe-deck'); if(!deck) return;
  const MAX=NAV_ORDER.length-1;
  let tsX=0,tsY=0,tsDelta=0,tsLocked=null,tsStartIdx=0,tsTime=0,dragging=false;
  deck.addEventListener('touchstart',e=>{
    if(window.innerWidth>=1024 || e.touches.length>1) return; // desktop / pinch → no paging
    tsX=e.touches[0].clientX; tsY=e.touches[0].clientY;
    tsDelta=0; tsLocked=null; tsStartIdx=deckIdx; tsTime=Date.now(); dragging=true;
    deck.classList.remove('snapping');
  },{passive:true});
  deck.addEventListener('touchmove',e=>{
    if(!dragging) return;
    const dx=e.touches[0].clientX-tsX, dy=e.touches[0].clientY-tsY;
    if(tsLocked===null){
      if(Math.abs(dx)>Math.abs(dy)+3) tsLocked='h';
      else if(Math.abs(dy)>Math.abs(dx)+3) tsLocked='v';
    }
    if(tsLocked!=='h') return;                 // vertical/undecided → let the panel scroll
    e.preventDefault();
    // Rubber-band: past either end the drag is damped to 0.3× and hard-clamped near 60px.
    let d=dx;
    if((tsStartIdx===0 && d>0)||(tsStartIdx===MAX && d<0)) d*=0.3;
    tsDelta=d;
    let pct=(tsStartIdx*25)-(d/window.innerWidth*25);
    const over=60/window.innerWidth*25;
    pct=Math.max(-over, Math.min(MAX*25+over, pct));
    deck.style.transform='translateX('+(-pct)+'%)';
  },{passive:false});
  function end(){
    if(!dragging) return;
    dragging=false;
    if(tsLocked!=='h'){ return; }               // wasn't a horizontal page gesture
    const dt=Date.now()-tsTime;
    const movedPct=Math.abs(tsDelta)/window.innerWidth;
    const flick=Math.abs(tsDelta)>40 && dt<250;  // fast flick
    let target=tsStartIdx;
    if(movedPct>0.25 || flick){
      if(tsDelta<0 && tsStartIdx<MAX) target=tsStartIdx+1;
      else if(tsDelta>0 && tsStartIdx>0) target=tsStartIdx-1;
    }
    setDeckPosition(target, true);               // spring-snap
    if(NAV_ORDER[target]!==S.view) setView(NAV_ORDER[target], null, {fromSwipe:true});
    else updateNavPill(S.view);
  }
  deck.addEventListener('touchend',end);
  deck.addEventListener('touchcancel',end);
})();

// ── Pull-to-refresh on the Home tab ──────────────────────────────
// Manual (not native PTR) to avoid conflicts in PWA standalone mode. Only engages
// when Home is showing and already scrolled to the very top. #app-main is the scroller.
(function(){
  let startY=0,pulling=false;
  const THRESHOLD=70;
  const main=document.getElementById('app-main');
  if(!main) return;
  main.addEventListener('touchstart',e=>{
    if(typeof homeEditMode!=='undefined' && homeEditMode){ pulling=false; return; } // dragging cards, not pulling
    // The Home panel is the scroller now (mobile), not #app-main — read its scrollTop.
    const homePanel=document.getElementById('view-home');
    const atTop=(homePanel?homePanel.scrollTop:main.scrollTop)===0;
    if(S.view==='home' && atTop){ startY=e.touches[0].clientY; pulling=true; }
    else pulling=false;
  },{passive:true});
  main.addEventListener('touchend',e=>{
    if(!pulling) return;
    pulling=false;
    if(S.view!=='home') return;
    const dist=e.changedTouches[0].clientY-startY;
    if(dist>THRESHOLD) refreshHomeTab();
  },{passive:true});
})();
function refreshHomeTab(){
  renderHome(); // re-renders greeting, hero, stats, budget snapshot — the whole Home tab
  const fb=document.getElementById('home-content');
  if(fb){ fb.style.transition='opacity .2s ease'; fb.style.opacity='.5'; setTimeout(()=>fb.style.opacity='1',300); }
}

function updateNavPill(v){
  const idx=NAV_ORDER.indexOf(v);
  const pill=document.getElementById('nav-pill');
  if(pill) pill.style.left=(idx*25)+'%';
}
// ── Weekday wordmark tint ─────────────────────────────────────────
// Vibrant rainbow, one colour per weekday (Sun..Sat), applied to the DAILY logo,
// the slide-out menu title, and the active Stats pill via the --day-color var.
function applyLogoDayColour(){
  let c;
  if(localStorage.getItem('daily_dynamic_colours')==='true'){
    // Dynamic day colours on → follow the current training day's assigned colour, so the
    // wordmark matches the rest of the dynamically-themed UI.
    c=dayColorFor(currentDayName());
  } else {
    // Off → follow the user's chosen static accent (same colour applyDayColour uses), so the
    // "Daily" wordmark tracks the accent picked in Appearance instead of a fixed weekday colour.
    c=restColor();
  }
  document.documentElement.style.setProperty('--day-color', c);
  // The gradient wordmark fill (layout.css) needs the colour as an rgb TRIPLET for its
  // rgba() stops — publish it alongside the plain colour. Non-hex values just leave the
  // var unset, and the CSS falls back to --accent-rgb.
  const hex=/^#?([0-9a-f]{6})$/i.exec(c||'');
  if(hex){ const n=parseInt(hex[1],16);
    document.documentElement.style.setProperty('--day-color-rgb', ((n>>16)&255)+','+((n>>8)&255)+','+(n&255)); }
  // Belt-and-suspenders: also set the colour inline so the wordmark tints even if the
  // CSS custom-property chain ever fails to resolve on a given device. Harmless under the
  // gradient fill: -webkit-text-fill-color:transparent outranks `color` for glyph paint.
  const t=document.getElementById('header-title'); if(t) t.style.color=c;
  const mt=document.getElementById('side-menu-title'); if(mt) mt.style.color=c;
}
// Stats pill shows on Home (and stays visible+active on the Stats view so it doubles
// as the way back). Hidden everywhere else.
function updateStatsPill(v){
  const p=document.getElementById('header-stats-pill');
  if(!p) return;
  // Visible on Home/Log/Budget (carrying the tab as context); hidden on Stats itself + Kitchen/Settings.
  if(v==='home'||v==='log'||v==='budget'){
    p.style.display='block';
    p.classList.remove('active');
    p.dataset.context=v;
  } else {
    p.style.display='none';
  }
}
// Context-aware: open Stats at the sub-tab relevant to where the chip was tapped from.
// (This app uses Stats sub-tabs, not scrollable sections, so we switch sub-tab not scroll.)
function openStatsFromChip(){
  const ctx=document.getElementById('header-stats-pill')?.dataset.context || S.view;
  setView('stats');
  if(typeof setStatsTab==='function') setStatsTab(ctx==='budget' ? 'finance' : ctx==='log' ? 'training' : 'overview');
}
function openProfile(){ setView('settings'); if(typeof openSettingsSection==='function') openSettingsSection('account'); }

// ── Slide-out settings menu ───────────────────────────────────────
// Just the two most-used settings shortcuts; everything else is reachable via "All settings".
const MENU_SECTIONS=[
  {id:'account',label:'Account'},
  {id:'appearance',label:'Appearance'}
];
// Primary destinations, mirroring the desktop sidebar so the hamburger reaches everything
// the sidebar does — including views not in the mobile bottom nav (Kitchen, Plans, Notes).
const MENU_NAV=[
  {id:'home',label:'Home'},
  {id:'log',label:'Log'},
  {id:'stats',label:'Stats'},
  {id:'kitchen',label:'Kitchen'},
  {id:'budget',label:'Budget'},
  {id:'plans',label:'Plans'},
  {id:'notes',label:'Notes'},
];
function menuNav(v){ closeMenu(); setView(v); }
function buildSideMenu(){
  const list=document.getElementById('side-menu-list');
  if(!list) return;
  const chev='<svg class="smi-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const groupLabel=t=>'<div class="side-menu-group-label">'+t+'</div>';
  list.innerHTML =
    groupLabel('Navigate')+
    MENU_NAV.map(n=>'<button class="side-menu-item" onclick="menuNav(\''+n.id+'\')"><span class="smi-label">'+n.label+'</span>'+chev+'</button>').join('')+
    '<div class="side-menu-divider"></div>'+
    '<button class="side-menu-item" data-action="open-exercise-library"><span class="smi-label">Exercise Library</span>'+chev+'</button>'+
    groupLabel('Settings')+
    '<button class="side-menu-item" onclick="openMenuSection(\'\')"><span class="smi-label">All settings</span>'+chev+'</button>'+
    MENU_SECTIONS.map(s=>'<button class="side-menu-item" onclick="openMenuSection(\''+s.id+'\')"><span class="smi-label">'+s.label+'</span>'+chev+'</button>').join('');
}
// ── Exercise Library ──────────────────────────────────────────────
// Master list of exercises the user maintains. Defaults are derived from the program
// (ALL_EX) and can't be deleted; customs are stored in wt_exercise_lib. Muscle group for
// defaults is a best-guess from the name. This is the management view; adding to a day's
// session is a separate picker (built later).
function libGuessMuscle(name){
  const n=(name||'').toLowerCase();
  if(/(abs|core|plank|crunch|oblique)/.test(n)) return 'core';
  if(/(calf|calves|squat|leg|lunge|hamstring|quad|glute)/.test(n)) return 'legs';
  if(/(bicep|tricep|curl|pushdown|forearm|extension)/.test(n)) return 'arms';
  if(/(shoulder|lateral|delt|overhead)/.test(n)) return 'shoulders';
  if(/(row|pull|lat|hang|deadlift|chin)/.test(n)) return 'back';
  if(/(chest|bench|incline|fly|dip|press)/.test(n)) return 'chest';
  return 'other';
}
function loadExerciseLib(){
  let customs=[];
  try{ const a=JSON.parse(localStorage.getItem('wt_exercise_lib')); if(Array.isArray(a)) customs=a; }catch(e){}
  const customIds=new Set(customs.map(c=>c.id));
  const defaults=allExerciseNames().map(name=>({
    id:'ex_def_'+name.toLowerCase().replace(/[^a-z0-9]+/g,'_'),
    name, muscle:libGuessMuscle(name), custom:false
  })).filter(d=>!customIds.has(d.id));
  return [...defaults, ...customs];
}
function saveExerciseLib(lib){
  // Persist only the user's customs; defaults always regenerate from the program.
  lsSave('wt_exercise_lib', lib.filter(e=>e.custom), 'exerciseLib');
}
let _libMuscle='all';
function openExerciseLibrary(){
  const v=document.getElementById('view-exercise-library'); if(!v) return;
  v.style.display='block';
  // On desktop, leave the sidebar uncovered
  v.style.left=window.innerWidth>=1024?'260px':'0';
  document.querySelectorAll('.ds-item').forEach(b=>b.classList.remove('active'));
  const s=document.getElementById('lib-search'); if(s) s.value='';
  _libMuscle='all';
  document.querySelectorAll('[data-action="lib-filter-muscle"]').forEach(b=>b.classList.toggle('active',b.dataset.muscle==='all'));
  renderExerciseLibList();
  if(typeof closeMenu==='function') closeMenu();
}
function closeExerciseLibrary(){
  const v=document.getElementById('view-exercise-library');
  if(v){ v.style.display='none'; v.style.left='0'; }
  document.querySelectorAll('.ds-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===S.view));
}
function renderExerciseLibList(){
  const q=(document.getElementById('lib-search')?.value||'').toLowerCase();
  const lib=loadExerciseLib();
  const filtered=lib.filter(e=>(_libMuscle==='all'||e.muscle===_libMuscle)&&(!q||e.name.toLowerCase().includes(q)));
  const el=document.getElementById('exercise-lib-list'); if(!el) return;
  el.innerHTML=filtered.map(e=>
    '<div class="lib-row">'+
      '<div><div class="lib-row-name">'+_catEscHtml(e.name)+'</div>'+
      '<div class="lib-row-muscle">'+e.muscle+'</div></div>'+
      (e.custom
        ? '<div style="display:flex;gap:6px;flex-shrink:0">'
          +'<button class="lib-edit-btn" data-action="lib-edit-exercise" data-id="'+e.id+'" aria-label="Edit exercise">✎</button>'
          +'<button class="lib-del-btn" data-action="lib-delete-exercise" data-id="'+e.id+'" aria-label="Delete exercise">×</button>'
          +'</div>'
        : '<button class="lib-edit-btn" data-action="lib-edit-exercise" data-id="'+e.id+'" aria-label="Edit exercise">✎</button>')+
    '</div>'
  ).join('')||'<div style="padding:32px 0;text-align:center;color:var(--muted)">No exercises found</div>';
}
// New/edit-exercise modal — replaces window.prompt() (blocked in iOS standalone PWAs).
// The same form serves both paths; _editExId picks which. Only customs are editable:
// default names regenerate from the training-split program on every load, so a rename
// stored here would be silently discarded — defaults are renamed in the Split editor.
let _newExMuscle='other';
let _editExId=null; // library id being edited; null = creating a new exercise
function _setExModalLabels(editing){
  const t=document.getElementById('exlib-modal-title'); if(t) t.textContent=editing?'Edit exercise':'New exercise';
  const b=document.getElementById('exlib-confirm-btn'); if(b) b.textContent=editing?'Save':'Add';
}
function openNewExercise(){
  _editExId=null;
  _newExMuscle='other';
  const nm=document.getElementById('exlib-new-name'); if(nm) nm.value='';
  document.querySelectorAll('[data-action="exlib-pick-muscle"]').forEach(b=>b.classList.toggle('active',b.dataset.muscle==='other'));
  _setExModalLabels(false);
  const m=document.getElementById('exlib-add-modal'); if(m) m.classList.remove('hidden');
  setTimeout(()=>{ if(nm) nm.focus(); }, 50);
}
function openEditExercise(id){
  const ex=loadExerciseLib().find(e=>e.id===id);
  if(!ex) return;
  _editExId=id;
  _newExMuscle=ex.muscle||'other';
  const nm=document.getElementById('exlib-new-name'); if(nm) nm.value=ex.name;
  document.querySelectorAll('[data-action="exlib-pick-muscle"]').forEach(b=>b.classList.toggle('active',b.dataset.muscle===_newExMuscle));
  _setExModalLabels(true);
  const m=document.getElementById('exlib-add-modal'); if(m) m.classList.remove('hidden');
  setTimeout(()=>{ if(nm) nm.focus(); }, 50);
}
function closeNewExercise(){ const m=document.getElementById('exlib-add-modal'); if(m) m.classList.add('hidden'); }
function confirmNewExercise(){
  const nm=document.getElementById('exlib-new-name');
  const name=(nm?nm.value:'').trim();
  if(!name){ closeNewExercise(); return; }
  const lib=loadExerciseLib();
  if(_editExId){
    const ex=lib.find(e=>e.id===_editExId);
    if(ex){
      const oldName=ex.name;
      if(name!==oldName && lib.some(e=>e.id!==_editExId && e.name.toLowerCase()===name.toLowerCase())
         && !confirm('An exercise named "'+name+'" already exists — rename anyway? Their history will be combined.')) return;
      if(ex.custom){
        ex.name=name; ex.muscle=_newExMuscle;
        saveExerciseLib(lib);
      } else {
        // Default exercise: save as a custom override with the same id (loadExerciseLib will hide the default)
        lib.push({id:ex.id, name, muscle:_newExMuscle, custom:true});
        saveExerciseLib(lib);
      }
      if(name!==oldName) renameExerciseRefs(oldName,name);
    }
  } else {
    lib.push({id:'ex_custom_'+Date.now(), name, muscle:_newExMuscle, custom:true});
    saveExerciseLib(lib);
  }
  closeNewExercise();
  renderExerciseLibList();
}
// The exercise NAME is the join key across the app — logged sessions (which History, the
// PR board and Stats all read from), per-day customisations, swap targets and today's
// in-memory set data. Carry every reference over on rename so past logs follow the new
// name instead of being stranded (and hidden from PRs/stats) under the old one.
function renameExerciseRefs(oldName,newName){
  let touched=false;
  S.sessions.forEach(s=>(s.exercises||[]).forEach(ex=>{ if(ex.name===oldName){ ex.name=newName; touched=true; } }));
  if(touched) persist();
  touched=false;
  Object.values(dayCustom||{}).forEach(c=>{
    (c.added||[]).forEach(a=>{ if(a.name===oldName){ a.name=newName; touched=true; } });
    ['hidden','order'].forEach(k=>{
      if(Array.isArray(c[k])&&c[k].includes(oldName)){ c[k]=c[k].map(n=>n===oldName?newName:n); touched=true; }
    });
  });
  if(touched) saveDayCustom();
  touched=false;
  Object.keys(S.swaps||{}).forEach(k=>{
    if(S.swaps[k]===oldName){ S.swaps[k]=newName; touched=true; }
    if(k===oldName){ S.swaps[newName]=S.swaps[k]; delete S.swaps[k]; touched=true; }
  });
  if(touched) saveSwaps();
  if(S.setData&&S.setData[oldName]){ S.setData[newName]=S.setData[oldName]; delete S.setData[oldName]; }
  if(S.view==='log'&&typeof renderLog==='function') renderLog();
  if(S.view==='home'&&typeof renderHome==='function') renderHome();
}
// One delegated listener for all Exercise Library actions (iOS-reliable taps)
document.addEventListener('click',function(e){
  if(e.target.closest('[data-action="open-exercise-library"]')){ openExerciseLibrary(); return; }
  if(e.target.closest('[data-action="close-exercise-library"]')){ closeExerciseLibrary(); return; }
  const f=e.target.closest('[data-action="lib-filter-muscle"]');
  if(f){ _libMuscle=f.dataset.muscle; document.querySelectorAll('[data-action="lib-filter-muscle"]').forEach(b=>b.classList.toggle('active',b===f)); renderExerciseLibList(); return; }
  const del=e.target.closest('[data-action="lib-delete-exercise"]');
  if(del){ if(!confirm('Delete this exercise?')) return; saveExerciseLib(loadExerciseLib().filter(x=>x.id!==del.dataset.id)); renderExerciseLibList(); return; }
  const ed=e.target.closest('[data-action="lib-edit-exercise"]');
  if(ed){ openEditExercise(ed.dataset.id); return; }
  if(e.target.closest('[data-action="new-custom-exercise"]')){ openNewExercise(); return; }
  const pm=e.target.closest('[data-action="exlib-pick-muscle"]');
  if(pm){ _newExMuscle=pm.dataset.muscle; document.querySelectorAll('[data-action="exlib-pick-muscle"]').forEach(b=>b.classList.toggle('active',b===pm)); return; }
});

// ── Log tab: edit mode (add/remove exercises for the day type) ─────
let logEditMode=false;
// The exercise you've tapped as "what I'm doing now" — moves the accent spotlight there.
// -1 = auto (first not-done exercise). Reset on day change.
let activeExIdx=-1;
function setActiveExercise(ei){ activeExIdx=ei; exCollapsed.delete(ei); renderLog(); }

// ── Drag-to-reorder exercises (edit mode, touch) ──────────────────
// HTML5 drag-and-drop doesn't work on iOS, so use touch events. Order persists per day
// type in dayCustom.order (effectiveExercises applies it). Saved sessions are untouched.
function logSetExerciseOrder(orderedNames){
  const base=typeForDayIdx(S.dayIdx);
  const c=dayCustomFor(base.id);
  c.order=orderedNames.slice();
  saveDayCustom();
}
function persistExOrderFromDOM(){
  const exs=type(S.dayIdx).exercises; // pre-save order — card ids (ec{ei}) index into this
  const cards=[...document.querySelectorAll('#exercise-list .ex-card')];
  const names=cards.map(c=>{ const ei=parseInt((c.id||'').replace('ec',''),10); return exs[ei]?exs[ei].name:null; }).filter(Boolean);
  if(names.length){ logSetExerciseOrder(names); recomputeChecked(); renderLog(); }
}
(function(){
  let dragCard=null;
  document.addEventListener('touchstart',function(e){
    if(!logEditMode) return;
    const handle=e.target.closest('.ex-drag-handle'); if(!handle) return;
    const card=handle.closest('.ex-card'); if(!card) return;
    dragCard=card; card.classList.add('ex-dragging');
    e.preventDefault();
  },{passive:false});
  document.addEventListener('touchmove',function(e){
    if(!dragCard) return;
    e.preventDefault();
    const t=e.touches[0];
    const over=document.elementFromPoint(t.clientX,t.clientY);
    const overCard=(over&&over.closest)?over.closest('.ex-card'):null;
    if(overCard&&overCard!==dragCard&&overCard.parentElement===dragCard.parentElement){
      const r=overCard.getBoundingClientRect();
      const after=t.clientY>r.top+r.height/2;
      dragCard.parentElement.insertBefore(dragCard, after?overCard.nextSibling:overCard);
    }
  },{passive:false});
  function endDrag(){ if(!dragCard) return; dragCard.classList.remove('ex-dragging'); dragCard=null; persistExOrderFromDOM(); }
  document.addEventListener('touchend',endDrag);
  document.addEventListener('touchcancel',endDrag);
})();
function toggleLogEdit(){ logEditMode=!logEditMode; renderLog(); }
function logRemoveExercise(name){
  if((S.setData[name]||[]).some(s=>s.done)) return; // guard: never remove an exercise with a completed set
  if(S.sessionAdds && S.sessionAdds.some(a=>a.name===name)){
    // Session-only add → just drop it from the session; never touches the template.
    S.sessionAdds=S.sessionAdds.filter(a=>a.name!==name);
  } else {
    const base=typeForDayIdx(S.dayIdx);
    const c=dayCustomFor(base.id);
    if((c.added||[]).some(a=>a.name===name)) c.added=c.added.filter(a=>a.name!==name); // drop a legacy dayCustom add
    else c.hidden=[...new Set([...(c.hidden||[]), name])];                              // hide a built-in (permanent, unchanged)
    saveDayCustom();
  }
  delete S.setData[name];
  recomputeChecked(); saveSetData(); renderLog();
}
function logAddExercise(name, muscle){
  if(!name) return;
  // Session-only add: DO NOT write to dayCustom / the day template. Just track it for the
  // current session so it renders today and saves into today's history; the plan is untouched.
  if(!S.sessionAdds) S.sessionAdds=[];
  const alreadyShown = type(S.dayIdx).exercises.some(e=>e.name===name); // includes prior session adds
  if(!alreadyShown && !S.sessionAdds.some(a=>a.name===name)){
    S.sessionAdds.push({name, muscle:muscle||'other'});
  }
  if(!S.setData[name]) S.setData[name]=[{weight:'',reps:'',type:'working',done:false}];
  saveSetData(); renderLog();
}
// Add-exercise picker — pulls from the Exercise Library, excluding ones already in the day.
function openAddExercise(){
  const m=document.getElementById('log-add-picker'); if(!m) return;
  const s=document.getElementById('logpick-search'); if(s) s.value='';
  m.classList.remove('hidden'); renderAddPicker();
  setTimeout(()=>{ if(s) s.focus(); },50);
}
function closeAddExercise(){ const m=document.getElementById('log-add-picker'); if(m) m.classList.add('hidden'); }
function renderAddPicker(){
  const q=(document.getElementById('logpick-search')?.value||'').toLowerCase();
  const inDay=new Set(type(S.dayIdx).exercises.map(e=>e.name));
  const lib=loadExerciseLib().filter(e=>!inDay.has(e.name) && (!q||e.name.toLowerCase().includes(q)));
  const el=document.getElementById('logpick-list'); if(!el) return;
  el.innerHTML=lib.map(e=>
    '<button class="logpick-row" data-action="logpick-add" data-name="'+_catEsc(e.name)+'" data-muscle="'+e.muscle+'">'+
      '<span class="logpick-name">'+_catEscHtml(e.name)+'</span><span class="logpick-muscle">'+e.muscle+'</span>'+
    '</button>'
  ).join('')||'<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px">Nothing to add — manage your list in the Exercise Library.</div>';
}
// Delegated listener for Log edit-mode + picker actions (iOS-reliable taps)
document.addEventListener('click',function(e){
  if(e.target.closest('[data-action="log-edit-toggle"]')){ toggleLogEdit(); return; }
  if(e.target.closest('[data-action="log-add-exercise"]')){ openAddExercise(); return; }
  const delEx=e.target.closest('[data-action="log-del-exercise"]');
  if(delEx){ logRemoveExercise(delEx.dataset.name); return; }
  const pick=e.target.closest('[data-action="logpick-add"]');
  if(pick){ logAddExercise(pick.dataset.name, pick.dataset.muscle); closeAddExercise(); return; }
});

function toggleMenu(){
  const o=document.getElementById('menu-overlay'), m=document.getElementById('side-menu');
  if(!o||!m) return;
  const open=m.classList.contains('open');
  o.classList.toggle('open',!open);
  m.classList.toggle('open',!open);
}
function closeMenu(){
  const o=document.getElementById('menu-overlay'), m=document.getElementById('side-menu');
  if(o) o.classList.remove('open');
  if(m) m.classList.remove('open');
}
function openMenuSection(s){
  closeMenu();
  // Habits has a working in-app manager (add/remove) — open it instead of the placeholder section.
  if(s==='habits'){ if(typeof openHabitsEditModal==='function') openHabitsEditModal(); return; }
  setView('settings');
  if(s){ if(typeof openSettingsSection==='function') openSettingsSection(s); }
  else { if(typeof closeSettingsSection==='function') closeSettingsSection(); }
}
function updateNavBadges(){
  const today=getLocalDate();
  const hasSessionToday=S.sessions.some(s=>s.date===today);
  const bl=document.getElementById('badge-log');
  if(bl) bl.style.display=hasSessionToday?'none':'block';
  const wKey=weekKey(getMondayOf(0));
  const wData=budgetData[wKey];
  const showBudget=!wData||(!wData.saved&&wData.draft);
  const bb=document.getElementById('badge-budget');
  if(bb) bb.style.display=showBudget?'block':'none';
}
// Old sub-tab names (saved state, header-pill contexts) map onto the new structure.
const STATS_TAB_ALIASES={progress:'training', budget:'finance', weight:'body'};
function setStatsTab(tab){
  tab=STATS_TAB_ALIASES[tab]||tab;
  const paneIds={overview:'sub-overview',history:'sub-history',training:'sub-training',body:'sub-body',nutrition:'sub-nutrition',finance:'sub-finance'};
  const btnIds={overview:'st-ov-btn',history:'st-hist-btn',training:'st-train-btn',body:'st-body-btn',nutrition:'st-nut-btn',finance:'st-fin-btn'};
  if(!paneIds[tab]) tab='overview';
  statsSubTab = tab;
  Object.keys(paneIds).forEach(t=>{
    const pane=document.getElementById(paneIds[t]); if(pane) pane.classList.toggle('hidden',t!==tab);
    const btn=document.getElementById(btnIds[t]); if(btn) btn.classList.toggle('active',t===tab);
  });
  const activeBtn=document.getElementById(btnIds[tab]);
  if(activeBtn&&activeBtn.scrollIntoView) activeBtn.scrollIntoView({block:'nearest',inline:'nearest'});
  if(tab==='overview') renderStatsOverview();
  if(tab==='history') renderHistory();
  if(tab==='training') renderTraining();
  if(tab==='body') renderBody();
  if(tab==='nutrition') renderNutrition();
  if(tab==='finance') renderBudgetStats();
}

// ── LOG view ─────────────────────────────────────────────────────
function renderLog(){
  if(!Object.keys(S.setData).length) initDay(S.dayIdx);
  const t = type(S.dayIdx);
  // Make sure every effective exercise (incl. ones just added) has a starting set row.
  t.exercises.forEach(ex=>{ if(!S.setData[ex.name]) S.setData[ex.name]=[{weight:'',reps:'',type:'working',done:false}]; });

  // Day hero card — arrow-navigated, per-day muscle colour, progress + TODAY badge.
  const done=S.checked.size, total=t.exercises.length;
  const pct = total ? Math.round(done/total*100) : 0;
  // Hero tint follows the SAME rule as the accent (applyDayColour): dynamic colours ON →
  // this day's assigned colour; OFF → the fixed static accent (restColor). Reading the raw
  // day colour unconditionally was the bug — with dynamic OFF the accent went static but this
  // card stayed the day's colour (e.g. green for Legs), so the static pick looked overridden.
  const _dynOn = localStorage.getItem('daily_dynamic_colours') === 'true';
  const heroRgb = hexToRgb(_dynOn ? dayColorFor(currentDayName()) : restColor());
  const isToday = S.dayIdx === suggestDay();
  const heroEl = document.getElementById('log-day-hero');
  if(heroEl){
    heroEl.innerHTML =
      '<div class="log-day-hero-card" style="background:linear-gradient(150deg, rgba('+heroRgb+',.9), rgba('+heroRgb+',.55) 55%, rgba('+heroRgb+',.35));box-shadow:0 16px 40px rgba('+heroRgb+',.3)">'+
        '<div class="ldh-nav">'+
          '<button class="ldh-arrow" onclick="logDayStep(-1)" aria-label="Previous day">&#8249;</button>'+
          '<div class="ldh-center" onclick="logGoToday()">'+
            '<div class="ldh-name">'+t.name+'</div>'+
            '<div class="ldh-sub">Day '+(S.dayIdx+1)+' of '+scheduleLen()+(isToday?'<span class="ldh-today">TODAY</span>':'')+'</div>'+
          '</div>'+
          '<button class="ldh-arrow" onclick="logDayStep(1)" aria-label="Next day">&#8250;</button>'+
        '</div>'+
        '<div class="ldh-progress-row"><span>'+done+' of '+total+' done</span><span>'+pct+'%</span></div>'+
        '<div class="ldh-bar"><div class="ldh-bar-fill" style="width:'+pct+'%"></div></div>'+
        '<button class="ldh-timer" data-action="timer-expand" aria-label="Open timer">'+
          '<span class="ldh-timer-dot"></span>'+
          '<span id="rt-bar-time" class="ldh-timer-time">0.0</span>'+
          '<span id="rt-bar-session" class="ldh-timer-session">Session: 0:00</span>'+
          '<svg class="ldh-timer-expand" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>'+
        '</button>'+
      '</div>';
    rtUpdateDisplay(rtGetElapsed()); rtUpdateSessionLabels(); // sync the freshly-rendered timer
    // Entrance animations — fresh DOM nodes from innerHTML so they always replay
    const heroCard = heroEl.querySelector('.log-day-hero-card');
    if(heroCard) heroCard.classList.add('ldh-breathe');
    const todayBadge = heroEl.querySelector('.ldh-today');
    if(todayBadge) todayBadge.classList.add('ldh-badge-animate');
    const barFill = heroEl.querySelector('.ldh-bar-fill');
    if(barFill){ barFill.style.setProperty('--bar-target', pct+'%'); barFill.classList.add('ldh-bar-animate'); }
  }
  const tag = document.getElementById('header-tag');
  if(tag){ tag.textContent=`Day ${S.dayIdx+1} · ${t.name}`; tag.style.color=t.barColor; }

  document.getElementById('exercise-list').innerHTML = t.exercises.map(renderExCard).join('');
  document.querySelectorAll('#exercise-list .ex-card').forEach((card, i) => {
    card.style.animationDelay = (i * 55) + 'ms';
    card.classList.add('ex-card-enter');
  });

  // Edit-mode controls: button label + the add-exercise button visibility
  const eb=document.getElementById('log-edit-btn');
  if(eb){ eb.textContent=logEditMode?'Done':'Edit'; eb.classList.toggle('active',logEditMode); }
  // "+ Add exercise" is always available at the bottom of the day's list (previously it only
  // appeared in Edit mode, so adding to the session required tapping Edit first).
  const ab=document.getElementById('log-add-exercise-btn');
  if(ab) ab.style.display='block';

  // Desktop exercise overview nav (left column)
  const exNav=document.getElementById('desktop-exercise-nav');
  if(exNav) exNav.innerHTML=t.exercises.map((ex,ei)=>{
    const d=S.checked.has(ei);
    return `<div class="den-item${d?' done':''}" onclick="document.getElementById('ec${ei}').scrollIntoView({behavior:'smooth',block:'start'})">`+
      `<span style="flex-shrink:0">${d?'✓':'•'}</span><span>${dn(ex.name)}</span></div>`;
  }).join('');

  document.getElementById('save-msg').style.display='none';
  document.getElementById('save-btn').textContent='Save session';
  document.getElementById('save-btn').style.background='';

  checkSessionComplete();
}

// Show the "Session complete" card once every exercise for the day is marked done.
// Volume = Σ (weight × reps) across all logged sets; time = live session elapsed.
function checkSessionComplete(){
  const card=document.getElementById('session-complete-card');
  if(!card) return;
  const t=type(S.dayIdx);
  const allDone = t.exercises.length>0 && S.checked.size===t.exercises.length;
  if(allDone){
    let vol=0;
    t.exercises.forEach(ex=>{
      (S.setData[ex.name]||[]).forEach(s=>{
        vol += (parseFloat(s.weight)||0)*(parseInt(s.reps)||0);
      });
    });
    const vEl=document.getElementById('sc-volume');
    const tEl=document.getElementById('sc-time');
    if(vEl) vEl.textContent=Math.round(vol)+' kg';
    if(tEl) tEl.textContent=sessionFormat(sessionGetElapsed());
    card.style.display='block';
  } else {
    card.style.display='none';
  }
}

function renderExCard(ex, ei){
  const done = S.checked.has(ei);
  // "Active" = the exercise you're on now. If you've tapped one (and it's still valid +
  // not done) the spotlight stays there; otherwise it auto-falls to the first not-done one.
  const exs = type(S.dayIdx).exercises;
  let activeEi;
  if(activeExIdx>=0 && activeExIdx<exs.length && !S.checked.has(activeExIdx)){
    activeEi = activeExIdx;
  } else {
    activeEi = -1;
    for(let i=0;i<exs.length;i++){ if(!S.checked.has(i)){ activeEi=i; break; } }
  }
  const isActive = ei===activeEi && !done;
  const badge = ex.priority ? `<span class="badge badge-${ex.priority}">${ex.priority==='grip'?'dead hangs':ex.priority}</span>` : '';
  const unit = ex.unit||'reps';
  const displayName = dn(ex.name);
  const isSwapped = S.swaps[ex.name] && S.swaps[ex.name] !== ex.name;

  // Dynamic set rows. Warmup is a per-set toggle (not positional); working sets are
  // numbered 1..n and show last session's working-set value (kg × reps) as a hint.
  const sets = S.setData[ex.name] || [];
  const lastWork = lastWorkingSetsFor(type(S.dayIdx), ex.name);
  let workIdx = 0;
  const setRows = sets.map((s,si)=>{
    const isWarmup = s.type==='warmup';
    const minAttr = ex.allowNegative ? 'min="-999"' : 'min="0"';
    let numLabel, hint='';
    if(isWarmup){
      numLabel='W';
    } else {
      numLabel=String(++workIdx);
      const lw=lastWork[workIdx-1];
      if(lw && (lw.weight||lw.reps)) hint='Last: '+(lw.weight||'–')+'kg × '+(lw.reps||'–');
    }
    return `
    <div class="set-row${isWarmup?' set-warmup':''}${s.done?' set-done':''}">
      <button class="set-warmup-btn${isWarmup?' active':''}" onclick="toggleWarmup(${ei},${si})" aria-label="Toggle warmup">W</button>
      <div class="set-num">${numLabel}</div>
      <input class="set-kg" type="number" inputmode="decimal" ${minAttr} step="0.5"
        placeholder="${isWarmup?'bw':'kg'}" value="${s.weight}"
        onchange="updSet(${ei},${si},'weight',this.value)">
      <span class="set-sep">×</span>
      <input class="set-reps" type="number" inputmode="numeric" min="0"
        placeholder="${unit}" value="${s.reps}"
        onchange="updSet(${ei},${si},'reps',this.value)">
      <button class="set-check${s.done?' done':''}" onclick="toggleSetDone(${ei},${si})" aria-label="Mark set done">✓</button>
      <button class="set-delete-btn" onclick="delSet(${ei},${si})" aria-label="Delete set">×</button>
      ${hint?`<div class="set-hint">${hint}</div>`:''}
    </div>`;
  }).join('');

  const collapsed = exCollapsed.has(ei);
  const workSets = sets.filter(s=>s.type!=='warmup' && (s.reps||s.weight));
  let exSummary = '';
  if(workSets.length){
    const last=workSets[workSets.length-1];
    exSummary=workSets.length+'×'+(last.reps||'?');
    if(last.weight) exSummary+=' @ '+last.weight+'kg';
  }
  return `<div class="ex-card${done?' done':''}${isActive?' active':''}${collapsed?' collapsed':''}" id="ec${ei}">
    ${done?'<span class="exercise-done-check">✓</span>':''}
    <div class="ex-top ex-top-bar" style="background:transparent">
      <div class="ex-left" onclick="setActiveExercise(${ei})" style="cursor:pointer" title="Set as current exercise">
        <div class="ex-name">${displayName}</div>
        ${exSummary?`<div class="ex-collapse-summary">${exSummary}</div>`:''}
        ${isSwapped?`<div class="swap-badge">swapped</div>`:''}
        ${ex.note?`<div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:2px">${ex.note}</div>`:''}
        ${badge?`<div class="ex-badges">${badge}</div>`:''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        ${logEditMode ? `<span class="ex-drag-handle" aria-label="Drag to reorder" title="Hold and drag to reorder">⠿</span>` : ''}
        <button class="swap-btn" onclick="openSwapModal(${ei})" title="Swap exercise" aria-label="Swap exercise">
          <svg viewBox="0 0 24 24"><path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/></svg>
        </button>
        <button class="ex-collapse-btn" onclick="toggleExCollapse(${ei})" aria-label="Toggle collapse">
          <svg class="card-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        ${(logEditMode && !(S.setData[ex.name]||[]).some(s=>s.done)) ? `<button class="ex-del-btn" data-action="log-del-exercise" data-name="${_catEsc(ex.name)}" aria-label="Remove exercise">×</button>` : ''}
      </div>
    </div>
    <div class="ex-collapse-body"${collapsed?' style="height:0;opacity:0;overflow:hidden"':''}>
      ${setRows}
      <div class="set-actions">
        <button class="add-set-btn" onclick="addSet(${ei})">+ Add set</button>
        <button class="add-warmup-btn" onclick="addSet(${ei},'warmup')">+ Warmup</button>
      </div>
    </div>
  </div>`;
}

function selectDay(idx){ logEditMode=false; activeExIdx=-1; exCollapsed.clear(); initDay(idx); saveSetData(); rtResetAll(); dismissPostSaveWeight(); renderLog(); rtUpdateSessionLabels(); }
// Day hero arrows — wrap around the split's schedule; centre taps back to today's suggested day.
function logDayStep(dir){ const n=scheduleLen(); selectDay(((S.dayIdx+dir)%n+n)%n); }
function logGoToday(){ selectDay(suggestDay()); }

// Last session's WORKING sets for an exercise (for the per-row hint). Old saved
// sessions have no per-set `type` → treat every set as working (best-effort).
function lastWorkingSetsFor(t, exName){
  const sess=lastSessionOf(t.name);
  if(!sess) return [];
  const ex=(sess.exercises||[]).find(e=>e.name===exName);
  if(!ex||!ex.sets) return [];
  return ex.sets.filter(s=>s.type?s.type!=='warmup':true).map(s=>({weight:s.weight,reps:s.reps}));
}
// Exercise-done is derived from sets: done when it has ≥1 working set and all working
// sets are ticked. S.checked stays the single source for Home progress/streak/badges.
function recomputeChecked(){
  const exs=type(S.dayIdx).exercises;
  S.checked=new Set();
  exs.forEach((ex,ei)=>{
    const sets=S.setData[ex.name]||[];
    const work=sets.filter(s=>s.type!=='warmup');
    if(work.length>0 && work.every(s=>s.done)) S.checked.add(ei);
  });
}
function updSet(ei, si, field, val){
  const ex = type(S.dayIdx).exercises[ei];
  if(!S.setData[ex.name]||!S.setData[ex.name][si]) return;
  S.setData[ex.name][si][field] = val;
  if(!S.sessionStart && String(val).trim()){
    S.sessionStart = Date.now(); // first set logged starts the session timer
    rtStartUi();
    rtUpdateSessionLabels();
  }
  saveSetData();
}
function toggleExCollapse(ei){
  exCollapsed.has(ei) ? exCollapsed.delete(ei) : exCollapsed.add(ei);
  renderLog();
}
function addSet(ei, setType){
  const ex = type(S.dayIdx).exercises[ei];
  const arr = S.setData[ex.name] || (S.setData[ex.name]=[]);
  const ns = {weight:'',reps:'',type:setType==='warmup'?'warmup':'working',done:false};
  if(setType==='warmup') arr.unshift(ns); else arr.push(ns); // warmups sit at the top
  recomputeChecked(); saveSetData(); renderLog();
}
function delSet(ei, si){
  const ex = type(S.dayIdx).exercises[ei];
  const arr = S.setData[ex.name]; if(!arr) return;
  arr.splice(si,1);
  if(arr.length===0) arr.push({weight:'',reps:'',type:'working',done:false}); // keep ≥1 row
  recomputeChecked(); saveSetData(); renderLog();
}
function toggleWarmup(ei, si){
  const ex = type(S.dayIdx).exercises[ei];
  const s = S.setData[ex.name] && S.setData[ex.name][si]; if(!s) return;
  s.type = s.type==='warmup' ? 'working' : 'warmup';
  recomputeChecked(); saveSetData(); renderLog();
}
function toggleSetDone(ei, si){
  const ex = type(S.dayIdx).exercises[ei];
  const s = S.setData[ex.name] && S.setData[ex.name][si]; if(!s) return;
  s.done = !s.done;
  const justMarkedDone = s.done;
  recomputeChecked(); saveSetData();
  const nowDone = S.checked.has(ei);
  const exList = type(S.dayIdx).exercises;
  const dayComplete = justMarkedDone && exList.length > 0 && S.checked.size === exList.length;
  renderLog();

  // Micro-interactions on freshly rendered DOM nodes
  if(justMarkedDone){
    const card = document.getElementById('ec'+ei);
    if(card){
      const rows = card.querySelectorAll('.set-row');
      const row = rows[si];
      if(row){
        const btn = row.querySelector('.set-check');
        if(btn){ btn.classList.add('check-btn-ripple'); setTimeout(()=>btn.classList.remove('check-btn-ripple'), 500); }
        row.classList.add('set-row-sweep');
        setTimeout(()=>row.classList.remove('set-row-sweep'), 600);
      }
      if(nowDone){ card.classList.add('ex-card-done-glow'); setTimeout(()=>card.classList.remove('ex-card-done-glow'), 800); }
    }
  }

  // Day complete — 5 celebration rings scattered across the viewport
  if(dayComplete){
    for(let i=0;i<5;i++){
      const ring=document.createElement('div');
      ring.className='celebrate-ring';
      ring.style.top=(20+Math.random()*60)+'vh';
      ring.style.left=(20+Math.random()*60)+'vw';
      ring.style.animationDelay=(i*80)+'ms';
      document.body.appendChild(ring);
      setTimeout(()=>ring.remove(), 700+i*80);
    }
    const barFill=document.querySelector('.ldh-bar-fill');
    if(barFill){ barFill.style.transition='opacity 0.15s'; barFill.style.opacity='0.3'; setTimeout(()=>{ barFill.style.opacity=''; barFill.style.transition=''; }, 250); }
  }

  if(nowDone){ setTimeout(()=>{ exCollapsed.add(ei); renderLog(); }, 400); } // auto-collapse when complete
}

// ── In-progress persistence ───────────────────────────────────────
// S.setData is rebuilt fresh by initDay and was lost on refresh. Persist the current
// day's in-progress sets (incl. warmup/done) so a reload mid-workout restores them.
function saveSetData(){
  try{
    localStorage.setItem('wt_setdata', JSON.stringify({
      date:getLocalDate(), dayIdx:S.dayIdx, setData:S.setData,
      checked:[...S.checked], sessionStart:S.sessionStart, note:S.sessionNote,
      sessionAdds:S.sessionAdds // keep session-only adds visible across a same-day reload
    }));
  }catch(e){}
}
function restoreSetData(){
  try{
    const raw=localStorage.getItem('wt_setdata'); if(!raw) return false;
    const o=JSON.parse(raw);
    if(!o || o.date!==getLocalDate() || typeof o.dayIdx!=='number') return false; // only same-day
    initDay(o.dayIdx);
    if(o.setData && typeof o.setData==='object') S.setData=o.setData;
    S.checked=new Set(o.checked||[]);
    S.sessionStart=o.sessionStart||null;
    S.sessionNote=o.note||'';
    S.sessionAdds=Array.isArray(o.sessionAdds)?o.sessionAdds:[]; // restore same-day session-only adds
    return true;
  }catch(e){ return false; }
}
function clearSetData(){ try{ localStorage.removeItem('wt_setdata'); }catch(e){} }

// ── Save session ─────────────────────────────────────────────────
function saveSession(){
  const t = type(S.dayIdx);
  const exercises = t.exercises.map(ex=>({
    name: ex.name,
    sets: S.setData[ex.name]
      .map(s=>({weight:parseFloat(s.weight)||0, reps:parseInt(s.reps)||0, type:s.type==='warmup'?'warmup':'working'}))
      .filter(s=>s.weight>0||s.reps>0)
  })).filter(ex=>ex.sets.length>0);

  if(!exercises.length){
    const msg=document.getElementById('save-msg');
    msg.style.display='block'; msg.style.color='var(--danger)';
    msg.textContent='Log at least one set before saving.'; return;
  }

  const note = S.sessionNote.trim();
  const sessionObj = {
    id: Date.now().toString(),
    date: getLocalDate(),
    dayNum: S.dayIdx+1,
    sessionType: t.name,
    duration: getDurationMins(),
    exercises
  };
  if(note) sessionObj.note = note;

  S.sessions.push(sessionObj);
  persist();
  updateNavBadges();

  // Progressive overload check
  const poSuggestions = checkPO(S.sessions[S.sessions.length-1]);

  // Reset note, session timer and rest stopwatch
  S.sessionNote = '';
  S.sessionStart = null;
  S.sessionAdds = []; // session-only adds are now in this date's history; don't carry them forward
  clearSetData(); // saved now — drop the in-progress copy so a reload starts fresh
  rtResetAll();
  rtUpdateSessionLabels();
  const noteEl = document.getElementById('session-note');
  if(noteEl) noteEl.value = '';

  // Success feedback
  const btn = document.getElementById('save-btn');
  const msg = document.getElementById('save-msg');
  btn.textContent = '✓ Saved!';
  btn.style.background = 'var(--accent)';
  msg.style.display = 'block';
  msg.style.color = 'var(--accent)';
  msg.textContent = 'Session saved!';
  showPostSaveWeightPrompt();

  setTimeout(()=>{
    btn.textContent = 'Save session';
    btn.style.background = '';
    if(poSuggestions.length) showPOModal(poSuggestions);
  }, 900);
}

// ── Progressive overload check ────────────────────────────────────
function checkPO(newSession){
  let prev = null;
  const past = S.sessions.slice(0, -1);
  for(let i = past.length-1; i >= 0; i--){
    if(past[i].sessionType === newSession.sessionType){ prev = past[i]; break; }
  }
  if(!prev) return [];

  const suggestions = [];
  newSession.exercises.forEach(ex=>{
    const prevEx = prev.exercises.find(e=>e.name===ex.name);
    if(!prevEx) return;
    const curSets  = ex.sets.filter(s=>s.weight>0&&s.reps>0);
    const prevSets = prevEx.sets.filter(s=>s.weight>0&&s.reps>0);
    if(!curSets.length||!prevSets.length) return;
    const curTop  = curSets.reduce((b,s)=>s.weight>b.weight?s:b);
    const prevTop = prevSets.reduce((b,s)=>s.weight>b.weight?s:b);
    if(prevTop.weight<=0) return;
    if(curTop.weight>=prevTop.weight && curTop.reps>=prevTop.reps){
      suggestions.push({name:dn(ex.name), weight:curTop.weight, reps:curTop.reps});
    }
  });
  return suggestions;
}

function showPOModal(suggestions){
  document.getElementById('po-items').innerHTML = suggestions.map(s=>`
    <div class="po-item">
      <div class="po-item-name">${s.name}</div>
      <div class="po-item-tip">Try ${s.weight+2.5}kg next time (+2.5kg)</div>
    </div>`).join('');
  document.getElementById('po-modal').classList.remove('hidden');
}
function closePOModal(){
  document.getElementById('po-modal').classList.add('hidden');
}

// ── Week review ───────────────────────────────────────────────────
function getWeekBounds(){
  const monday=getMondayOf(0);
  const mondayStr=weekKey(monday);
  const sunday=new Date(monday); sunday.setDate(monday.getDate()+6);
  return {mondayStr, sundayStr:dateStr(sunday)};
}
function renderWeekReviewCard(){
  const {mondayStr,sundayStr}=getWeekBounds();
  const isSunday=localMidnight(getLocalDate()).getDay()===0;
  const weekBudget=budgetData[mondayStr];
  if(!isSunday&&!(weekBudget&&weekBudget.saved)) return '';

  const workoutDays=new Set(
    S.sessions.filter(s=>s.date>=mondayStr&&s.date<=sundayStr).map(s=>s.date)
  ).size;

  let leftoverLine='';
  if(weekBudget){
    const inc=weekIncome(weekBudget);
    const leftover=inc>0?weekLeftover(weekBudget):null;
    if(leftover!==null){
      const statusTxt=leftover>=50?'🟢 On track':leftover>=0?'🟡 Tight':'🔴 Over';
      const col=leftover>=0?'var(--success)':'var(--danger)';
      leftoverLine='<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span style="font-size:13px;color:var(--muted)">Budget</span><span style="font-size:13px;font-weight:600;color:'+col+'">'+(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0)+' · '+statusTxt+'</span></div>';
    }
  }

  let calLine='';
  const cg=calcGoalCals();
  const goalCals=cg?(cg.goal==='cut'?cg.cut:cg.goal==='bulk'?cg.bulk:cg.maintain):null;
  if(goalCals){
    const calTotal=S.dailyLog.entries.reduce((a,e)=>a+e.kcal,0);
    calLine='<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span style="font-size:13px;color:var(--muted)">Today\'s cals</span><span style="font-size:13px;font-weight:600">'+calTotal+' / '+goalCals+' kcal</span></div>';
  }

  let weightLine='';
  const weekWeights=S.weights.filter(w=>w.date>=mondayStr&&w.date<=sundayStr).sort((a,b)=>a.date<b.date?-1:1);
  if(weekWeights.length>=2){
    const chg=+(weekWeights[weekWeights.length-1].weight-weekWeights[0].weight).toFixed(1);
    const col=chg<0?'var(--success)':chg>0?'var(--danger)':'var(--muted)';
    weightLine='<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span style="font-size:13px;color:var(--muted)">Weight</span><span style="font-size:13px;font-weight:600;color:'+col+'">'+(chg>0?'+':'')+chg+'kg this week</span></div>';
  }

  return '<div class="card">'
    +'<div class="sec-label" style="margin-bottom:10px">🗓️ Week in review</div>'
    +'<div style="display:flex;justify-content:space-between;padding:6px 0"><span style="font-size:13px;color:var(--muted)">Workouts</span><span style="font-size:13px;font-weight:600">'+workoutDays+' / 6 days</span></div>'
    +leftoverLine+calLine+weightLine
    +'<button onclick="openWeekReviewModal()" style="width:100%;margin-top:12px;padding:10px;background:var(--bg);border:1.5px solid var(--border);border-radius:8px;font-size:14px;font-weight:600;color:var(--text);cursor:pointer">View full review</button>'
    +'</div>';
}
// Shared week-review body — used by the wr-modal popup AND inline by Stats > Overview.
function buildWeekReviewHTML(){
  const {mondayStr,sundayStr}=getWeekBounds();
  const weekSessions=S.sessions.filter(s=>s.date>=mondayStr&&s.date<=sundayStr);
  const workoutDays=new Set(weekSessions.map(s=>s.date)).size;

  const sessionHTML=weekSessions.length
    ?weekSessions.map(s=>'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-weight:600">'+fmtDate(s.date)+'</span><span style="font-size:13px;color:var(--muted)">'+s.sessionType+(s.duration?' · '+fmtDuration(s.duration):'')+'</span></div>').join('')
    :'<div style="font-size:13px;color:var(--muted);padding:8px 0">No workouts logged this week</div>';

  const bd=budgetData[mondayStr];
  let budHTML='<div style="font-size:13px;color:var(--muted);padding:8px 0">No budget data this week</div>';
  if(bd){
    const inc=weekIncome(bd);
    const saved=weekSavedAmt(bd);
    // Match the Budget Editor exactly: sum the ACTUAL per-week fix_/var_ category amounts
    // (weekFixedTotal/weekVarTotal — the same data budRecalc feeds into "Total variable").
    // The old code used bd.snapshot.* (a stale aggregate) or config*Total() (the PLANNED
    // budget), so variable read as the plan's $670 instead of the $510 actually entered.
    const fixed=weekFixedTotal(bd);
    const variable=weekVarTotal(bd);
    const leftover=inc>0?weekLeftover(bd):null;
    const col=leftover!==null&&leftover>=0?'var(--success)':'var(--danger)';
    budHTML='<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:var(--muted)">Income</span><span style="font-weight:600;color:var(--success)">'+(inc>0?'$'+inc.toFixed(0):'—')+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:var(--muted)">Saved</span><span style="font-weight:600">$'+saved.toFixed(0)+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:var(--muted)">Fixed expenses</span><span style="font-weight:600">$'+fixed.toFixed(0)+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:var(--muted)">Variable expenses</span><span style="font-weight:600">$'+variable.toFixed(0)+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;font-weight:700;border-top:1px solid var(--border);margin-top:4px"><span>Left over</span><span style="color:'+col+'">'+(leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'—')+'</span></div>';
  }

  let calHTML='';
  const cg=calcGoalCals();
  const goalCals=cg?(cg.goal==='cut'?cg.cut:cg.goal==='bulk'?cg.bulk:cg.maintain):null;
  if(goalCals){
    const calTotal=S.dailyLog.entries.reduce((a,e)=>a+e.kcal,0);
    const pct=Math.round(calTotal/goalCals*100);
    calHTML='<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Today\'s calories</div>'
      +'<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px"><span style="color:var(--muted)">Eaten today</span><span style="font-weight:600">'+calTotal+' / '+goalCals+' kcal ('+pct+'%)</span></div></div>';
  }

  const weekWeights=S.weights.filter(w=>w.date>=mondayStr&&w.date<=sundayStr).sort((a,b)=>a.date<b.date?-1:1);
  let weightHTML='<div style="font-size:13px;color:var(--muted);padding:8px 0">No weight logged this week</div>';
  if(weekWeights.length){
    weightHTML=weekWeights.map(w=>'<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--muted)">'+fmtDate(w.date)+'</span><span style="font-weight:600">'+w.weight+'kg</span></div>').join('');
    if(weekWeights.length>=2){
      const chg=+(weekWeights[weekWeights.length-1].weight-weekWeights[0].weight).toFixed(1);
      const col=chg<0?'var(--success)':chg>0?'var(--danger)':'var(--muted)';
      weightHTML+='<div style="font-size:13px;font-weight:700;padding:8px 0 0;color:'+col+'">'+(chg>0?'+':'')+chg+'kg this week</div>';
    }
  }

  // Habits section for modal
  let habitsModalHTML='';
  if(habitsData.length){
    const wkDates=getWeekDates();
    const todayStr=getLocalDate();
    const dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const rows=wkDates.map((date,i)=>{
      if(date>todayStr) return '';
      const done=(habitsLog[date]||[]).length;
      const n=habitsData.length;
      const col=done===0?'var(--muted)':done>=n?'var(--success)':'var(--warn)';
      return '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">'
        +'<span style="color:var(--muted)">'+dayNames[i]+' '+fmtDate(date)+'</span>'
        +'<span style="font-weight:600;color:'+col+'">'+done+'/'+n+'</span>'
        +'</div>';
    }).filter(Boolean).join('');
    habitsModalHTML='<div><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Habits</div>'
      +(rows||'<div style="font-size:13px;color:var(--muted);padding:8px 0">No habits logged yet</div>')
      +'</div>';
  }

  return '<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:8px">Workouts ('+workoutDays+'/6 days)</div>'+sessionHTML+'</div>'
    +'<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Budget</div>'+budHTML+'</div>'
    +calHTML
    +'<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Weight this week</div>'+weightHTML+'</div>'
    +habitsModalHTML;
}
function openWeekReviewModal(){
  document.getElementById('wr-modal-body').innerHTML=buildWeekReviewHTML();
  document.getElementById('wr-modal').classList.remove('hidden');
}
function closeWeekReviewModal(){
  document.getElementById('wr-modal').classList.add('hidden');
}

// ── Exercise swap ─────────────────────────────────────────────────
function openSwapModal(ei){
  S.swapTarget = ei;
  const ex = type(S.dayIdx).exercises[ei];
  const cur = S.swaps[ex.name];
  // Show the current swap (if any) in the LABEL, not the search box.
  document.getElementById('swap-original-label').textContent =
    cur ? `${ex.name} → ${cur}` : `Default: ${ex.name}`;
  // Start the search box EMPTY so the whole library renders. Prefilling it with the current
  // swap name (frequently a custom name absent from the library) made renderSwapList filter
  // the list down to zero rows — the "swap list is empty / swap won't save" bug, since with
  // nothing pickable the swap could never be committed.
  document.getElementById('swap-input').value = '';
  document.getElementById('swap-modal').classList.remove('hidden');
  renderSwapList();
  setTimeout(()=>document.getElementById('swap-input').focus(), 100);
}
function renderSwapList(){
  const q=(document.getElementById('swap-input')?.value||'').toLowerCase();
  const lib=loadExerciseLib();
  const filtered=q?lib.filter(e=>e.name.toLowerCase().includes(q)):lib;
  const ORDER=['chest','back','shoulders','arms','legs','core','other'];
  const groups={};
  filtered.forEach(e=>{ const m=e.muscle||'other'; if(!groups[m]) groups[m]=[]; groups[m].push(e); });
  const el=document.getElementById('swap-lib-list'); if(!el) return;
  let html='';
  ORDER.forEach(m=>{
    if(!groups[m]||!groups[m].length) return;
    html+='<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;padding:8px 0 2px">'
      +m.charAt(0).toUpperCase()+m.slice(1)+'</div>';
    groups[m].forEach(e=>{
      // Name goes in an HTML-escaped data attribute, read back in the handler. Inlining
      // JSON.stringify(name) put double quotes INSIDE the double-quoted onclick attribute,
      // which truncated it to `swapPickExercise(` — so tapping a row did nothing and swaps
      // couldn't be picked from the list at all.
      html+='<div class="swap-lib-row" data-swap="'+_catEsc(e.name)+'" onclick="swapPickExercise(this.dataset.swap)">'+_catEscHtml(e.name)+'</div>';
    });
  });
  el.innerHTML=html||'<div style="padding:12px 0;text-align:center;color:var(--muted);font-size:13px">No exercises found</div>';
}
function swapPickExercise(name){
  document.getElementById('swap-input').value=name;
  confirmSwap();
}
function closeSwapModal(){
  document.getElementById('swap-modal').classList.add('hidden');
}
function confirmSwap(){
  const ex = type(S.dayIdx).exercises[S.swapTarget];
  const newName = document.getElementById('swap-input').value.trim();
  // Empty box = no change: keep whatever's currently set. (The box now starts empty so the full
  // list shows, so an untouched Save must NOT wipe an existing swap.) Removing a swap is done
  // with the "Reset to default" button → resetSwapDefault().
  if(!newName){ closeSwapModal(); return; }
  if(newName !== ex.name){
    S.swaps[ex.name] = newName;
  } else {
    delete S.swaps[ex.name]; // picking the exercise's own default name clears any swap
  }
  saveSwaps();
  closeSwapModal();
  renderLog();
}
function resetSwapDefault(){
  const ex = type(S.dayIdx).exercises[S.swapTarget];
  delete S.swaps[ex.name];
  saveSwaps();
  closeSwapModal();
  renderLog();
}

// ── Empty state helper ────────────────────────────────────────────
function emptyState(emoji,heading,sub,btnLabel,btnAction){
  return `<div style="text-align:center;padding:32px 16px;margin:32px 0">
    <div style="font-size:40px;margin-bottom:12px">${emoji}</div>
    <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px">${heading}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:${btnLabel?'18px':'0'}">${sub}</div>
    ${btnLabel?`<button onclick="${btnAction}" style="padding:10px 22px;border-radius:10px;border:none;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer">${btnLabel}</button>`:''}
  </div>`;
}

// ── HISTORY view ──────────────────────────────────────────────────
function renderHistory(){
  const list = document.getElementById('history-list');
  if(!S.sessions.length){
    list.innerHTML=emptyState('🏋️','No sessions yet','Log your first workout to start tracking your progress','Go to Log →',"setView('log')");
    return;
  }
  list.innerHTML = [...S.sessions].reverse().map((s,ri)=>{
    const i = S.sessions.length-1-ri;
    const tc = splitTypes().find(t=>t.name===s.sessionType)||splitTypes()[0];
    const summary = s.exercises.map(e=>`${dn(e.name)} (${e.sets.length} sets)`).join(' · ');
    const detail = s.exercises.map(ex=>`
      <div class="session-ex-row">
        <div class="session-ex-name">${dn(ex.name)}</div>
        ${ex.sets.map((set,si)=>`<div class="session-set-line">Set ${si+1}: ${set.weight?set.weight+'kg':'—'} × ${set.reps||'—'}</div>`).join('')}
      </div>`).join('');

    const durStr = s.duration ? ` · ${fmtDuration(s.duration)}` : '';
    return `<div class="session-card">
      <div class="session-card-top">
        <div class="session-date-str">${fmtDate(s.date)} · Day ${s.dayNum}${durStr}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="session-type-pill ${tc.id}">${s.sessionType}</div>
          <button class="session-del-x" onclick="deleteSession('${s.id}')" title="Delete session" aria-label="Delete session">✕</button>
        </div>
      </div>
      <div class="session-summary">${summary}</div>
      <div class="session-expand" id="se${i}">${detail}
        <button class="delete-btn" onclick="deleteSession('${s.id}')">Delete session</button>
      </div>
      ${s.note?`<div class="session-note-block" id="sn${i}">${s.note.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`:''}
      <div class="hist-toggle-row">
        <button class="hist-toggle-btn" onclick="toggleExpand('se${i}',this)">Show sets ▾</button>
        ${s.note?`<button class="hist-toggle-btn" onclick="toggleExpand('sn${i}',this)">Notes ▾</button>`:''}
      </div>
    </div>`;
  }).join('');
}

function toggleExpand(id, btn){
  const el = document.getElementById(id);
  if(!el) return;
  const open = el.style.display === 'block';
  el.style.display = open ? 'none' : 'block';
  if(btn){
    const label = btn.textContent.includes('sets') ? (open?'Show sets ▾':'Hide sets ▴')
                                                     : (open?'Notes ▾':'Notes ▴');
    btn.textContent = label;
  }
}

function deleteSession(id){
  if(!confirm('Delete this session?')) return;
  S.sessions = S.sessions.filter(s=>s.id!==id);
  persist(); renderHistory();
}

// ── WEIGHT tracking ──────────────────────────────────────────────
// Single write path for a weight entry (Stats > Body form + post-save Log prompt).
function addWeightEntry(date, weight){
  S.weights = S.weights.filter(w=>w.date!==date);
  S.weights.push({date, weight});
  S.weights.sort((a,b)=>a.date<b.date?-1:1);
  persistWeights();
}
function logWeight(){
  const dateEl  = document.getElementById('weight-date');
  const inputEl = document.getElementById('weight-input');
  const weight  = parseFloat(inputEl.value);
  const date    = dateEl.value;
  if(!weight || !date) return;
  addWeightEntry(date, weight);
  inputEl.value='';
  renderWeightSection();
}
// ── Post-workout weight prompt (Log tab, after Save session) ─────
// Inline and skippable — never a modal, so it can't collide with the PO modal.
function showPostSaveWeightPrompt(){
  const wrap=document.getElementById('post-save-weight'); if(!wrap) return;
  const today=getLocalDate();
  if(S.weights.some(w=>w.date===today)){ wrap.innerHTML=''; return; } // already logged today
  wrap.innerHTML=
    '<div class="psw-card">'+
      '<div class="psw-title">⚖️ Log your weight? Scale\'s right there.</div>'+
      '<div class="psw-row">'+
        '<input class="psw-input" id="psw-input" type="number" inputmode="decimal" min="30" max="250" step="0.1" placeholder="kg">'+
        '<button class="psw-save" onclick="confirmPostSaveWeight()">Save</button>'+
        '<button class="psw-skip" onclick="dismissPostSaveWeight()">Skip</button>'+
      '</div>'+
    '</div>';
}
function confirmPostSaveWeight(){
  const v=parseFloat(document.getElementById('psw-input')?.value);
  if(!v||v<30||v>250) return;
  addWeightEntry(getLocalDate(), v);
  const wrap=document.getElementById('post-save-weight');
  if(wrap){
    wrap.innerHTML='<div class="psw-card" style="text-align:center;color:var(--success);font-size:13px;font-weight:600">✓ '+v+'kg logged</div>';
    setTimeout(()=>{ if(wrap) wrap.innerHTML=''; },1800);
  }
}
function dismissPostSaveWeight(){
  const wrap=document.getElementById('post-save-weight');
  if(wrap) wrap.innerHTML='';
}
function deleteWeight(date){
  S.weights = S.weights.filter(w=>w.date!==date);
  persistWeights();
  renderWeightSection();
}
function renderWeightSection(){
  const wrap = document.getElementById('weight-section');
  if(!wrap) return;
  const today  = getLocalDate();
  const sorted = [...S.weights].sort((a,b)=>a.date<b.date?-1:1);
  const cur    = sorted.length ? sorted[sorted.length-1].weight : null;
  const lo     = sorted.length ? Math.min(...sorted.map(w=>w.weight)) : null;
  const hi     = sorted.length ? Math.max(...sorted.map(w=>w.weight)) : null;

  wrap.innerHTML=`
    <div class="week-section" style="margin-bottom:14px">
      <div class="week-section-title">Body weight</div>
      <div class="week-section-sub">Log your weight to track bulk progress</div>
      <div style="display:flex;gap:8px;margin-bottom:12px;align-items:stretch">
        <div style="flex:1;display:flex;flex-direction:column;gap:6px">
          <input type="date" id="weight-date" value="${today}"
            style="width:100%;height:40px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;padding:0 10px;background:var(--card);color:var(--text)">
          <input type="number" id="weight-input" inputmode="decimal" min="30" max="250" step="0.1" placeholder="kg"
            style="width:100%;height:40px;border:1.5px solid var(--border);border-radius:8px;font-size:18px;font-weight:500;text-align:center;background:var(--card);color:var(--text)">
        </div>
        <button onclick="logWeight()"
          style="padding:0 18px;background:var(--header);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Log</button>
      </div>
      ${sorted.length ? `
        <div class="stats-grid" style="margin-bottom:12px">
          <div class="stat-card"><div class="stat-val">${cur}kg</div><div class="stat-lbl">Current</div></div>
          <div class="stat-card"><div class="stat-val">${lo}kg</div><div class="stat-lbl">Lowest</div></div>
          <div class="stat-card"><div class="stat-val">${hi}kg</div><div class="stat-lbl">Highest</div></div>
        </div>
        ${sorted.length>=2?`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px"><canvas id="weight-chart" style="max-height:360px"></canvas></div>`:''}
        <div style="max-height:160px;overflow-y:auto">
          ${[...sorted].reverse().map(w=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
              <span style="font-size:13px;color:var(--muted)">${fmtDate(w.date)}</span>
              <span style="font-size:14px;font-weight:600">${w.weight}kg</span>
              <button onclick="deleteWeight('${w.date}')" style="font-size:12px;color:var(--danger);background:none;border:none;cursor:pointer;padding:0 4px">✕</button>
            </div>`).join('')}
        </div>` :
        emptyState('⚖️','No weight logged',"Tap 'Log weight' above to start tracking")}
    </div>`;
  animateStatVals(wrap);

  if(S.weightChart){ S.weightChart.destroy(); S.weightChart=null; }
  if(sorted.length>=2){
    const ctx=document.getElementById('weight-chart');
    if(!ctx) return;
    const isDark = S.theme==='dark';
    const gc=isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)';
    const tc=isDark?'#888':'#94a3b8';
    S.weightChart=new Chart(ctx,{
      type:'line',
      data:{
        labels:sorted.map(w=>fmtDate(w.date)),
        datasets:[{
          data:sorted.map(w=>w.weight),
          borderColor:'#6366f1',backgroundColor:'rgba(99,102,241,0.08)',
          borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#6366f1',
          fill:true,tension:0.3
        }]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'kg'}}},
        scales:{
          x:{grid:{color:gc},ticks:{color:tc,font:{size:11},maxTicksLimit:6}},
          y:{grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>v+'kg'},beginAtZero:false}
        }
      }
    });
  }
}

function syncWeightGoalToFirebase(){
  if(!firebaseReady||!auth||!auth.currentUser||!db) return;
  db.ref('users/'+auth.currentUser.uid+'/weightGoal').set(weightGoal);
}
function syncSubscriptionsToFirebase(){
  if(!firebaseReady||!auth||!auth.currentUser||!db) return;
  db.ref('users/'+auth.currentUser.uid+'/subscriptions').set(subscriptionsData);
}
function saveWeightGoal(){
  const t = parseFloat(document.getElementById('wg-target')?.value);
  const d = document.getElementById('wg-date')?.value||null;
  if(!t||isNaN(t)) return;
  weightGoal = {target:t, date:d};
  localStorage.setItem('daily_weight_goal', JSON.stringify(weightGoal));
  syncWeightGoalToFirebase();
  renderWeightGoal();
}
function renderWeightGoal(){
  const wrap = document.getElementById('weight-goal-section');
  if(!wrap) return;
  const sorted = [...S.weights].sort((a,b)=>a.date<b.date?-1:1);
  const target = weightGoal.target;
  const targetDate = weightGoal.date||'';
  let progressHTML = '';
  if(sorted.length && target){
    const startW = sorted[0].weight;
    const curW   = sorted[sorted.length-1].weight;
    const range  = target - startW;
    const pct    = range!==0 ? Math.max(0, Math.min(100, (curW - startW) / range * 100)) : 100;
    const rem    = Math.abs(target - curW).toFixed(1);
    let etaStr   = '';
    if(sorted.length >= 2){
      const last4    = sorted.slice(-4);
      const days     = (new Date(last4[last4.length-1].date) - new Date(last4[0].date)) / 86400000;
      const change   = last4[last4.length-1].weight - last4[0].weight;
      if(days > 0 && change !== 0){
        const daysNeeded = (target - curW) / (change / days);
        if(daysNeeded > 0){
          const eta = new Date();
          eta.setDate(eta.getDate() + Math.round(daysNeeded));
          etaStr = eta.toLocaleDateString('en-CA');
        }
      }
    }
    progressHTML = `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:4px">
          <span>${startW}kg start</span><span>${target}kg goal</span>
        </div>
        <div style="position:relative;height:12px;background:var(--border);border-radius:6px;overflow:visible">
          <div style="height:100%;width:${pct}%;background:var(--header);border-radius:6px;transition:width 0.4s"></div>
          <div style="position:absolute;top:-2px;left:calc(${pct}% - 1.5px);width:3px;height:16px;background:#fff;border-radius:2px;box-shadow:0 0 0 1.5px rgba(0,0,0,0.3)"></div>
        </div>
        <div class="stats-grid" style="margin-top:10px">
          <div class="stat-card"><div class="stat-val">${curW}kg</div><div class="stat-lbl">Current</div></div>
          <div class="stat-card"><div class="stat-val">${rem}kg</div><div class="stat-lbl">Remaining</div></div>
          ${etaStr?`<div class="stat-card"><div class="stat-val" style="font-size:13px">${etaStr}</div><div class="stat-lbl">Est. date</div></div>`:''}
        </div>
      </div>`;
  } else if(!sorted.length){
    progressHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:8px 0">Log weight entries to see progress</div>';
  }
  wrap.innerHTML = `
    <div class="week-section" style="margin-bottom:14px">
      <div class="week-section-title">Weight goal</div>
      <div style="display:flex;gap:8px;margin-bottom:12px;align-items:flex-end">
        <div style="flex:1">
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">Target (kg)</div>
          <input type="number" id="wg-target" inputmode="decimal" min="30" max="250" step="0.1" placeholder="kg"
            value="${target||''}"
            style="width:100%;height:40px;border:1.5px solid var(--border);border-radius:8px;font-size:16px;font-weight:500;text-align:center;background:var(--card);color:var(--text)">
        </div>
        <div style="flex:1">
          <div style="font-size:12px;color:var(--muted);margin-bottom:4px">Target date</div>
          <input type="date" id="wg-date" value="${targetDate}"
            style="width:100%;height:40px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;padding:0 10px;background:var(--card);color:var(--text)">
        </div>
        <button onclick="saveWeightGoal()"
          style="padding:0 18px;height:40px;background:var(--header);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;flex-shrink:0">Save</button>
      </div>
      ${progressHTML}
    </div>`;
  animateStatVals(wrap);
}

// ── BODY sub-tab (consolidated weight tracker + goal) ─────────────
function renderBody(){
  renderWeightSection();
  renderWeightGoal();
}

// ── TRAINING sub-tab (formerly Progress, minus the weight widgets) ─
function renderTraining(){
  const empty=document.getElementById('train-empty');
  const content=document.getElementById('train-content');
  if(!S.sessions.length){
    if(empty) empty.innerHTML=emptyState('📊','No workout data yet','Complete and save a session to see your progress charts here');
    if(content) content.classList.add('hidden');
    ensureHabitsStatsInProgress();
    return;
  }
  if(empty) empty.innerHTML='';
  if(content) content.classList.remove('hidden');
  const sel = document.getElementById('pr-select');
  const prev = sel.value;
  const exNames = allExerciseNames();
  sel.innerHTML = exNames.map(n=>`<option value="${n}"${n===prev?' selected':''}>${dn(n)}</option>`).join('');
  if(!sel.value && exNames.length) sel.value = exNames[0];
  renderTrainStreak();
  renderVolumeTrend();
  renderWeeklyGrid();
  renderConsistStats();
  renderMuscleBalance();
  renderChart();
  renderPRBoard();
  ensureHabitsStatsInProgress();
}

// ── Training: workout streak (any calendar day with ≥1 saved session) ─
function calcSessionStreak(){
  const dates=[...new Set(S.sessions.map(s=>s.date))].sort();
  if(!dates.length) return {current:0,longest:0};
  // Current: walk back from today; an unfinished today doesn't break a streak that ran
  // through yesterday, so the walk may start one day back.
  const set=new Set(dates);
  const d=localMidnight(getLocalDate());
  if(!set.has(dateStr(d))) d.setDate(d.getDate()-1);
  let current=0;
  while(set.has(dateStr(d))){ current++; d.setDate(d.getDate()-1); }
  let longest=1, run=1;
  for(let i=1;i<dates.length;i++){
    const diff=Math.round((new Date(dates[i]+'T12:00:00')-new Date(dates[i-1]+'T12:00:00'))/864e5);
    if(diff===1){ run++; if(run>longest) longest=run; }
    else run=1;
  }
  return {current, longest:Math.max(longest,current)};
}
function renderTrainStreak(){
  const el=document.getElementById('train-streak-grid'); if(!el) return;
  const {current,longest}=calcSessionStreak();
  const total=[...new Set(S.sessions.map(s=>s.date))].length;
  el.innerHTML=[
    {l:'Current streak',v:'🔥 '+current},
    {l:'Longest streak',v:longest},
    {l:'Days trained',v:total},
  ].map(s=>`<div class="stat-card"><div class="stat-val">${s.v}</div><div class="stat-lbl">${s.l}</div></div>`).join('');
  animateStatVals(el);
}

// ── Training: total volume trend (Σ weight × reps, grouped by week or month) ─
let trainVolRange='week';
let trainVolChart=null;
function setTrainVolRange(range){
  trainVolRange=range;
  ['week','month'].forEach(r=>{
    const btn=document.getElementById('tv-'+r); if(!btn) return;
    const a=r===range;
    btn.style.background=a?'rgba(255,255,255,0.3)':'transparent';
    btn.style.color=a?'#fff':'rgba(255,255,255,0.65)';
  });
  renderVolumeTrend();
}
function sessionVolume(s){
  let vol=0;
  (s.exercises||[]).forEach(ex=>(ex.sets||[]).forEach(set=>{
    if(set.weight>0&&set.reps>0) vol+=set.weight*set.reps;
  }));
  return vol;
}
function mondayKeyOf(ds){
  const d=localMidnight(ds);
  const day=d.getDay();
  d.setDate(d.getDate()-(day===0?6:day-1));
  return dateStr(d);
}
function renderVolumeTrend(){
  const wrap=document.getElementById('train-vol-wrap'); if(!wrap) return;
  if(trainVolChart){ trainVolChart.destroy(); trainVolChart=null; }
  const groups={};
  S.sessions.forEach(s=>{
    const key=trainVolRange==='week'?mondayKeyOf(s.date):s.date.substring(0,7);
    groups[key]=(groups[key]||0)+sessionVolume(s);
  });
  const keys=Object.keys(groups).sort().slice(-12);
  if(keys.length<2){
    wrap.innerHTML='<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px 0">Not enough data yet — keep logging sessions.</div>';
    return;
  }
  const labels=keys.map(k=>trainVolRange==='week'
    ? new Date(k+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short'})
    : new Date(k+'-01T12:00:00').toLocaleDateString('en-AU',{month:'short',year:'2-digit'}));
  wrap.innerHTML='<canvas id="train-vol-chart"></canvas>';
  const ctx=document.getElementById('train-vol-chart'); if(!ctx) return;
  const {gc,tc}=budChartGridColors();
  const accent=(getComputedStyle(document.documentElement).getPropertyValue('--accent')||'#FF6B35').trim();
  const accentRgb=(getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb')||'255,107,53').trim();
  trainVolChart=new Chart(ctx,{
    type:'bar',
    data:{
      labels,
      datasets:[{label:'Volume',data:keys.map(k=>Math.round(groups[k])),backgroundColor:'rgba('+accentRgb+',0.6)',borderColor:accent,borderWidth:1,borderRadius:6,maxBarThickness:48}]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:c=>c.parsed.y.toLocaleString()+' kg lifted'}}
      },
      scales:{
        x:{grid:{display:false},ticks:{color:tc,font:{size:11},maxTicksLimit:12}},
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>(v>=1000?(v/1000)+'t':v+'kg')},beginAtZero:true}
      }
    }
  });
}

// ── Training: muscle-group balance (sets per group, last 30 days) ──
const MUSCLE_COLOURS={chest:'#3B82F6',back:'#8B5CF6',shoulders:'#F59E0B',arms:'#EC4899',legs:'#EF4444',core:'#52B788',other:'#94a3b8'};
function renderMuscleBalance(){
  const wrap=document.getElementById('train-muscle-wrap'); if(!wrap) return;
  const byName={};
  loadExerciseLib().forEach(e=>{ byName[e.name]=e.muscle; });
  const cutoff=localMidnight(getLocalDate());
  cutoff.setDate(cutoff.getDate()-29);
  const cutoffStr=dateStr(cutoff);
  const counts={chest:0,back:0,shoulders:0,arms:0,legs:0,core:0,other:0};
  S.sessions.forEach(s=>{
    if(s.date<cutoffStr) return;
    (s.exercises||[]).forEach(ex=>{
      const m=byName[ex.name]||libGuessMuscle(ex.name);
      const n=(ex.sets||[]).filter(set=>(set.type?set.type!=='warmup':true)&&(set.weight>0||set.reps>0)).length;
      counts[counts[m]!==undefined?m:'other']+=n;
    });
  });
  const rows=Object.keys(counts).filter(m=>counts[m]>0||m!=='other');
  const max=Math.max(1,...rows.map(m=>counts[m]));
  const total=rows.reduce((a,m)=>a+counts[m],0);
  if(!total){
    wrap.innerHTML='<div style="text-align:center;color:var(--muted);font-size:13px;padding:8px 0">No sets logged in the last 30 days.</div>';
    return;
  }
  wrap.innerHTML=rows.map(m=>{
    const pct=Math.round(counts[m]/max*100);
    const label=m.charAt(0).toUpperCase()+m.slice(1);
    return '<div class="muscle-bar-row">'+
      '<div class="muscle-bar-label">'+label+'</div>'+
      '<div class="muscle-bar-track"><div class="muscle-bar-fill" style="width:'+pct+'%;background:'+MUSCLE_COLOURS[m]+'"></div></div>'+
      '<div class="muscle-bar-count">'+counts[m]+' set'+(counts[m]!==1?'s':'')+'</div>'+
    '</div>';
  }).join('');
}

// Display colour for a split day in the consistency grid + legend. Legacy day types keep
// their exact original grid colours; custom days fall back to their own barColor.
function typeGridColor(t){
  const map={'chest-back':'#E74C3C','shoulders-arms':'#3b82f6','legs':'#52B788'};
  if(t&&map[t.colorKey]) return map[t.colorKey];
  return (t&&t.barColor) || '#94a3b8';
}
function renderWeeklyGrid(targetId){
  // Map each session date → the colour of its logged day type (matched by name so old
  // sessions still colour correctly). Unknown/renamed types show as a plain filled cell.
  const typeByName={};
  splitTypes().forEach(t=>{ typeByName[t.name]=t; });
  const sessionMap = {};
  S.sessions.forEach(s=>{ sessionMap[s.date] = typeByName[s.sessionType] ? typeGridColor(typeByName[s.sessionType]) : '#94a3b8'; });

  const todayStr = getLocalDate();
  const today = localMidnight(todayStr);
  const dow = today.getDay();
  const daysToMon = dow===0?6:dow-1;
  const thisMonday = new Date(today); thisMonday.setDate(today.getDate()-daysToMon);
  const startDate = new Date(thisMonday); startDate.setDate(thisMonday.getDate()-49);

  const DAY_LABELS=['M','T','W','T','F','S','S'];
  let html=`<div class="week-section">
    <div class="week-section-title">8-week consistency</div>
    <div class="week-section-sub">Each square = one day · coloured = session logged</div>
    <div class="week-day-labels"><div></div>${DAY_LABELS.map(d=>`<div class="week-day-lbl">${d}</div>`).join('')}</div>`;

  for(let w=0;w<8;w++){
    const weekStart=new Date(startDate); weekStart.setDate(startDate.getDate()+w*7);
    const lbl=weekStart.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
    html+=`<div class="week-row"><div class="week-row-lbl">${lbl}</div>`;
    for(let d=0;d<7;d++){
      const cellDate=new Date(weekStart); cellDate.setDate(weekStart.getDate()+d);
      const ds=dateStr(cellDate);
      const col=sessionMap[ds]||'';
      const isToday=ds===todayStr?' today':'';
      const styles=[];
      if(cellDate>today) styles.push('opacity:0.25');
      if(col) styles.push('background:'+col);
      const styleAttr=styles.length?` style="${styles.join(';')}"`:'';
      html+=`<div class="day-cell${isToday}"${styleAttr}></div>`;
    }
    html+='</div>';
  }
  // Legend: one entry per unique day type in the split, in schedule order.
  const seen=new Set();
  const legendTypes=[];
  splitSchedule().forEach(idx=>{ const t=splitTypes()[idx]; if(t&&!seen.has(t.id)){ seen.add(t.id); legendTypes.push(t); } });
  html+=`<div class="week-legend">${legendTypes.map(t=>
    `<div class="legend-item"><div class="legend-dot" style="background:${typeGridColor(t)}"></div>${(t.name||'').replace(/</g,'&lt;')}</div>`
  ).join('')}</div></div>`;
  const el=document.getElementById(targetId||'week-grid-wrap');
  if(el) el.innerHTML=html;
}

// ── Stat count-up animation ──
function animateCount(element,targetValue,duration=600){
  const decimals=(String(targetValue).split('.')[1]||'').length;
  const suffix=element.dataset.suffix||'';
  const start=performance.now();
  function tick(now){
    const t=Math.min((now-start)/duration,1);
    const eased=1-Math.pow(1-t,3);
    const v=targetValue*eased;
    element.textContent=(decimals?v.toFixed(decimals):String(Math.round(v)))+suffix;
    if(t<1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
function animateStatVals(container){
  if(!container) return;
  container.querySelectorAll('.stat-val').forEach(el=>{
    const m=el.textContent.match(/^(\d+(?:\.\d+)?)(.*)$/s);
    if(!m||!parseFloat(m[1])) return;
    el.dataset.suffix=m[2];
    animateCount(el,parseFloat(m[1]));
  });
}

function renderConsistStats(){
  const today=localMidnight(getLocalDate());
  const dow=today.getDay(), daysToMon=dow===0?6:dow-1;
  const thisMonday=new Date(today); thisMonday.setDate(today.getDate()-daysToMon);
  const fourWeeksAgo=new Date(today); fourWeeksAgo.setDate(today.getDate()-27);

  const thisWeek=S.sessions.filter(s=>{const d=new Date(s.date+'T12:00:00');return d>=thisMonday;}).length;
  const last4=S.sessions.filter(s=>{const d=new Date(s.date+'T12:00:00');return d>=fourWeeksAgo;}).length;
  const durations=S.sessions.filter(s=>s.duration>0).map(s=>s.duration);
  const avgDur=durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null;

  const perWeek=scheduleLen();
  document.getElementById('consist-stats').innerHTML=[
    {l:'This week',v:`${thisWeek}/${perWeek}`},
    {l:'Last 4 weeks',v:`${last4}/${perWeek*4}`},
    {l:'Avg session',v:avgDur?`${avgDur} min`:'—'},
  ].map(s=>`<div class="stat-card"><div class="stat-val">${s.v}</div><div class="stat-lbl">${s.l}</div></div>`).join('');
  animateStatVals(document.getElementById('consist-stats'));
}

function renderChart(){
  const exName = document.getElementById('pr-select').value;
  const pts = getPoints(exName);

  const pr = getPR(exName);
  const totalSets = S.sessions.reduce((acc,s)=>{
    const ex=s.exercises.find(e=>e.name===exName);
    return acc+(ex?ex.sets.length:0);
  },0);
  const sessions = S.sessions.filter(s=>s.exercises.some(e=>e.name===exName)).length;
  document.getElementById('stats-grid').innerHTML = [
    {l:'Sessions',v:sessions||'—'},
    {l:'Total sets',v:totalSets||'—'},
    {l:'Best weight',v:pr?pr+'kg':'—'},
  ].map(s=>`<div class="stat-card"><div class="stat-val">${s.v}</div><div class="stat-lbl">${s.l}</div></div>`).join('');
  animateStatVals(document.getElementById('stats-grid'));

  if(S.chart){ S.chart.destroy(); S.chart=null; }
  const ctx = document.getElementById('prog-chart');

  if(!pts.length){
    ctx.style.display='none';
    const msg=ctx.parentElement.querySelector('.no-data-msg');
    if(!msg){
      const p=document.createElement('p');
      p.className='no-data-msg';
      p.style.cssText='text-align:center;color:var(--muted);padding:20px 0;font-size:14px';
      p.textContent='No data yet — log some sessions first';
      ctx.parentElement.appendChild(p);
    }
    return;
  }

  ctx.style.display='';
  const nm=ctx.parentElement.querySelector('.no-data-msg');
  if(nm) nm.remove();

  const isDark = S.theme==='dark';
  const gc=isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)';
  const tc=isDark?'#888':'#94a3b8';

  S.chart = new Chart(ctx,{
    type:'line',
    data:{
      labels:pts.map(p=>fmtDate(p.date)),
      datasets:[{
        data:pts.map(p=>p.weight),
        borderColor:'#52B788',backgroundColor:'rgba(82,183,136,0.08)',
        borderWidth:2.5,pointRadius:5,pointBackgroundColor:'#52B788',
        fill:true,tension:0.3
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'kg'}}},
      scales:{
        x:{grid:{color:gc},ticks:{color:tc,font:{size:11},maxTicksLimit:6}},
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>v+'kg'},beginAtZero:false}
      }
    }
  });
}

function renderPRBoard(){
  document.getElementById('pr-board').innerHTML = splitTypes().map(t=>`
    <div class="pr-board-section">
      <div class="pr-section-label">${t.name}</div>
      ${t.exercises.map(ex=>{
        const pr=getPR(ex.name);
        return `<div class="pr-row">
          <div class="pr-ex-name">${dn(ex.name)}</div>
          <div class="pr-val${pr?'':' none'}">${pr?pr+'kg':'—'}</div>
        </div>`;
      }).join('')}
    </div>`).join('');
}

// ── SETTINGS view ─────────────────────────────────────────────────
function toggleSettingsSection(key){
  if(settingsCollapsed[key]) delete settingsCollapsed[key];
  else settingsCollapsed[key]=1;
  localStorage.setItem('daily_settings_collapsed',JSON.stringify(settingsCollapsed));
  syncSettingsCollapsedToFirebase();
  const c=!!settingsCollapsed[key];
  const body=document.getElementById('ssc-'+key);
  const chev=document.getElementById('sc-'+key);
  const hdr=document.getElementById('sh-'+key);
  if(body) body.style.display=c?'none':'';
  if(chev) chev.style.transform=c?'rotate(-90deg)':'rotate(0deg)';
  if(hdr) hdr.style.marginBottom=c?'0':'14px';
}
function applySettingsCollapsed(){
  ['income','savings-target','fixed','variable'].forEach(key=>{
    if(!settingsCollapsed[key]) return;
    const body=document.getElementById('ssc-'+key);
    const chev=document.getElementById('sc-'+key);
    const hdr=document.getElementById('sh-'+key);
    if(body) body.style.display='none';
    if(chev) chev.style.transform='rotate(-90deg)';
    if(hdr) hdr.style.marginBottom='0';
  });
}
function settingsProfileCardTap(){
  const user=(firebaseReady&&auth)?auth.currentUser:null;
  if(user){ openSettingsSection('account'); } else { handleAuth(); }
}
function renderSettingsTopCard(){
  const av=document.getElementById('stg-avatar');
  const nm=document.getElementById('stg-name');
  const em=document.getElementById('stg-email');
  const sy=document.getElementById('stg-sync');
  if(!av) return;
  const user=(firebaseReady&&auth)?auth.currentUser:null;
  if(user){
    const photo=user.photoURL;
    const uname=user.displayName||profileData.name||'Google user';
    av.classList.toggle('stg-avatar-grad',!photo);
    av.innerHTML=photo?'<img src="'+photo+'" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover">':'<span style="font-size:20px;font-weight:800;color:#fff">'+uname.charAt(0).toUpperCase()+'</span>';
    if(nm) nm.textContent=uname;
    if(em) em.textContent=user.email||'';
    if(sy){ sy.textContent='● Synced to cloud'; sy.style.color='var(--success)'; }
  } else {
    const name=profileData.name||S.personalInfo?.name||'';
    av.classList.toggle('stg-avatar-grad',!!name);
    av.innerHTML=name?'<span style="font-size:20px;font-weight:800;color:#fff">'+name.charAt(0).toUpperCase()+'</span>':'<span style="font-size:20px;color:var(--muted)">?</span>';
    if(nm) nm.textContent=name||'Not signed in';
    if(em) em.textContent='';
    if(sy){ sy.textContent='Tap to sign in'; sy.style.color='var(--muted)'; }
  }
  updateDesktopSidebar();
}
function updateDesktopSidebar(){
  const av=document.querySelector('.ds-av');
  const nm=document.querySelector('.ds-name');
  const sy=document.querySelector('.ds-sync');
  if(!av) return;
  const user=(firebaseReady&&auth)?auth.currentUser:null;
  const name=(user&&user.displayName)||profileData.name||S.personalInfo?.name||'';
  const initials=name?name.trim().split(/\s+/).map(w=>w.charAt(0).toUpperCase()).slice(0,2).join(''):'?';
  av.textContent=initials;
  if(nm) nm.textContent=name||'Not signed in';
  if(sy) sy.textContent=user?'Synced':'Local only';
}
// Every settings item opens as a genuine full-screen pushed view: the target section div is
// moved out of its hidden store into #view-settings-detail (mirrors the split/budget editor
// overlays), and moved back on close. Desktop and mobile behave identically (the overlay is
// simply offset past the sidebar on desktop) — so there's no "stacked column" branch to break.
const SETTINGS_SECTION_KEYS=['account','health','habits','appearance','export'];
const SETTINGS_TITLES={account:'Account',health:'Health',habits:'Habits',subscriptions:'Subscriptions',appearance:'Appearance',export:'Export'};
let _activeSettingsKey=null;
function openSettingsSection(key){
  const overlay=document.getElementById('view-settings-detail');
  const content=document.getElementById('settings-detail-content');
  const store=document.getElementById('settings-sections-store');
  const sec=document.getElementById('settings-'+key+'-section');
  if(!overlay||!content||!sec) return;
  // Return a previously-mounted section to the store, then mount the requested one.
  if(_activeSettingsKey && _activeSettingsKey!==key){
    const prev=document.getElementById('settings-'+_activeSettingsKey+'-section');
    if(prev){ prev.classList.add('hidden'); if(store) store.appendChild(prev); }
  }
  content.appendChild(sec);
  sec.classList.remove('hidden');
  _activeSettingsKey=key;
  const t=document.getElementById('settings-detail-title'); if(t) t.textContent=SETTINGS_TITLES[key]||key;
  // Populate each section's dynamic content (unchanged from before).
  if(key==='account') renderAccountSection();
  if(key==='health'){
    const pi=S.personalInfo;
    ['name','age','sex','height','weight','activity'].forEach(f=>{
      const el=document.getElementById('pi-'+f); if(el&&pi[f]!=null) el.value=pi[f];
    });
    renderTDEESection();
  }
  if(key==='habits') renderHabitsEditModal();
  if(key==='appearance'){ const th=document.getElementById('theme-toggle'); if(th) th.checked=S.theme==='dark'; const dc=document.getElementById('toggle-dynamic-colours'); if(dc) dc.checked=localStorage.getItem('daily_dynamic_colours')==='true'; renderDayColorPickers(); }
  if(key==='subscriptions') renderSubscriptionsSection();
  overlay.style.display='block';
  overlay.style.left=window.innerWidth>=1024?'260px':'0';
  overlay.scrollTop=0;
}
function closeSettingsSection(){
  const overlay=document.getElementById('view-settings-detail');
  if(overlay){ overlay.style.display='none'; overlay.style.left='0'; }
  // Move the mounted section back to its hidden store so the overlay is left empty/clean.
  if(_activeSettingsKey){
    const store=document.getElementById('settings-sections-store');
    const sec=document.getElementById('settings-'+_activeSettingsKey+'-section');
    if(sec){ sec.classList.add('hidden'); if(store) store.appendChild(sec); }
    _activeSettingsKey=null;
  }
}
function saveProfileSection(){
  profileData.name=document.getElementById('profile-name')?.value.trim()||'';
  localStorage.setItem('daily_profile',JSON.stringify(profileData));
  syncProfileToFirebase();
  updateHeaderAvatar();
  renderSettingsTopCard();
  const btn=document.getElementById('profile-save-btn');
  if(btn){ btn.textContent='Saved ✓'; btn.style.background='var(--accent)'; setTimeout(()=>{ btn.textContent='Save'; btn.style.background=''; },2000); }
}
function applySubscriptionsToBudget(){
  const monthly=Math.round(subscriptionsData.reduce((s,sub)=>s+(sub.monthlyCost||0),0)*100)/100;
  const weekly=Math.round(monthly/4.33*100)/100;
  budDefaults.subs=weekly;
  localStorage.setItem('daily_budget_defaults',JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();
  const el=document.getElementById('fix-subs');
  if(el) el.value=weekly>0?weekly:'';
}
function pickSubEmoji(emoji,btn){
  const val=document.getElementById('sub-emoji-val');
  const disp=document.getElementById('sub-emoji-display');
  if(val) val.value=emoji;
  if(disp) disp.textContent=emoji;
  document.querySelectorAll('.sub-emoji-btn').forEach(b=>b.classList.remove('sub-emoji-active'));
  if(btn) btn.classList.add('sub-emoji-active');
}
function addSubscription(){
  const name=(document.getElementById('sub-name')?.value||'').trim();
  const cost=parseFloat(document.getElementById('sub-cost')?.value);
  const cycle=document.getElementById('sub-cycle')?.value||'monthly';
  const emoji=document.getElementById('sub-emoji-val')?.value||'📱';
  if(!name||isNaN(cost)||cost<=0) return;
  const monthlyCost=cycle==='yearly'?Math.round(cost/12*100)/100:Math.round(cost*100)/100;
  subscriptionsData.push({name,monthlyCost,cycle,originalCost:cost,emoji});
  localStorage.setItem('daily_subscriptions',JSON.stringify(subscriptionsData));
  applySubscriptionsToBudget();
  syncSubscriptionsToFirebase();
  renderSubscriptionsSection();
}
function deleteSubscription(idx){
  subscriptionsData.splice(idx,1);
  localStorage.setItem('daily_subscriptions',JSON.stringify(subscriptionsData));
  applySubscriptionsToBudget();
  syncSubscriptionsToFirebase();
  renderSubscriptionsSection();
}
// Delegated handler: re-rendered / modal buttons are more reliable on iOS via one
// document listener than per-button inline onclick handlers.
document.addEventListener('click', function(e){
  const btn=e.target.closest('.delete-sub-btn');
  if(btn){
    const idx=parseInt(btn.dataset.idx,10);
    if(!isNaN(idx)) deleteSubscription(idx);
    return;
  }
  if(e.target.closest('#savings-save-btn')){ confirmSavingsBalance(); return; }
  if(e.target.closest('#savings-cancel-btn')){ closeSavingsModal(); return; }
});
function renderSubscriptionsSection(){
  const wrap=document.getElementById('be-subs')||document.getElementById('subscriptions-content');
  if(!wrap) return;
  const EMOJIS=['📺','🎵','🎮','📱','☁️','🏋️','📚','🛡️','🎬','💊','🌐','📰','🎯','💻','✈️','🧘'];
  const curEmoji=document.getElementById('sub-emoji-val')?.value||'📱';
  const total=Math.round(subscriptionsData.reduce((s,sub)=>s+(sub.monthlyCost||0),0)*100)/100;
  const weeklyTotal=Math.round(total/4.33*100)/100;

  const listRows=subscriptionsData.length
    ? subscriptionsData.map((sub,i)=>{
        const cycleNote=sub.cycle==='yearly'?` <span style="font-size:11px;color:var(--muted)">(${sub.originalCost}/yr)</span>`:'';
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:20px;line-height:1;flex-shrink:0">${sub.emoji}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sub.name.replace(/</g,'&lt;')}</div>
            <div style="font-size:12px;color:var(--muted)">$${sub.monthlyCost}/mo${cycleNote}</div>
          </div>
          <button class="delete-sub-btn" data-idx="${i}" style="color:var(--danger);flex-shrink:0">✕</button>
        </div>`;
      }).join('')
    : '<div style="text-align:center;color:var(--muted);font-size:13px;padding:12px 0">No subscriptions yet</div>';

  wrap.innerHTML=`
    <div class="settings-card">
      <div class="settings-card-title" style="cursor:default">Add subscription</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">
        ${EMOJIS.map(e=>`<button type="button" class="sub-emoji-btn${e===curEmoji?' sub-emoji-active':''}" onclick="pickSubEmoji('${e}',this)">${e}</button>`).join('')}
      </div>
      <input type="hidden" id="sub-emoji-val" value="${curEmoji}">
      <div class="settings-field">
        <label>Name</label>
        <div style="display:flex;align-items:center;gap:10px">
          <span id="sub-emoji-display" style="font-size:24px;line-height:1;flex-shrink:0">${curEmoji}</span>
          <input type="text" id="sub-name" placeholder="e.g. Netflix" style="flex:1;height:44px;border:1.5px solid var(--border);border-radius:8px;font-size:15px;padding:0 12px;background:var(--card);color:var(--text)">
        </div>
      </div>
      <div class="settings-2col">
        <div class="settings-field">
          <label>Cost ($)</label>
          <input type="number" id="sub-cost" inputmode="decimal" min="0" step="0.01" placeholder="0.00" style="width:100%;height:44px;border:1.5px solid var(--border);border-radius:8px;font-size:15px;padding:0 12px;background:var(--card);color:var(--text)">
        </div>
        <div class="settings-field">
          <label>Billing</label>
          <select id="sub-cycle" style="width:100%;height:44px;border:1.5px solid var(--border);border-radius:8px;font-size:15px;padding:0 12px;background:var(--card);color:var(--text);-webkit-appearance:none;appearance:none">
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
      </div>
      <button onclick="addSubscription()" class="settings-save-btn">+ Add</button>
    </div>
    <div class="settings-card">
      <div class="settings-card-title" style="cursor:default">My subscriptions</div>
      ${listRows}
      ${subscriptionsData.length?`
        <div style="padding-top:12px;margin-top:2px;border-top:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:13px;color:var(--muted)">Monthly total</span>
            <span style="font-size:14px;font-weight:700;color:var(--text)">$${total}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:13px;color:var(--muted)">Weekly equivalent</span>
            <span style="font-size:16px;font-weight:800;color:var(--accent)">$${weeklyTotal}</span>
          </div>
        </div>`:''}
    </div>`;
}
function renderInstallCard(){
  const wrap = document.getElementById('stg-install-card');
  if(!wrap) return;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let content;
  if(isStandalone){
    content = '<span style="font-size:13px;color:var(--muted)">✅ Already installed</span>';
  } else if(isIOS){
    content = '<p style="font-size:13px;color:var(--muted);margin:0">Tap the Share button <strong style="color:var(--text)">□↑</strong> in Safari, then tap <strong style="color:var(--text)">"Add to Home Screen"</strong></p>';
  } else if(deferredInstallPrompt){
    content = '<button onclick="triggerInstallPrompt()" style="width:100%;padding:10px;border-radius:10px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600;cursor:pointer">Install App</button>';
  } else {
    wrap.style.display='none'; return;
  }
  wrap.style.display='';
  wrap.innerHTML=`<div class="settings-card"><div style="font-size:14px;font-weight:700;margin-bottom:10px">📲 Add to Home Screen</div>${content}</div>`;
}
function triggerInstallPrompt(){
  if(!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  deferredInstallPrompt.userChoice.then(()=>{ deferredInstallPrompt=null; renderInstallCard(); });
}
function renderSettings(){
  // Entering the Settings tab shows the grouped list; ensure any open detail overlay is closed.
  closeSettingsSection();
  renderSettingsTopCard(); // profile card avatar/name/sync state
  renderInstallCard();
}

// Merged "Account" section — sign-in + Profile (name) + Reminders + Advanced (reset
// onboarding), each under its own card/sub-heading so it reads as grouped rows, not a wall.
function renderAccountSection(){
  const wrap=document.getElementById('settings-account-section'); if(!wrap) return;
  const user=(firebaseReady&&auth)?auth.currentUser:null;
  let signIn;
  if(user){
    const photo=user.photoURL;
    const uname=user.displayName||'Google user';
    const email=user.email||'';
    const avatar=photo
      ?'<img src="'+photo+'" referrerpolicy="no-referrer" style="width:46px;height:46px;border-radius:50%;object-fit:cover;flex-shrink:0">'
      :'<div style="width:46px;height:46px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff;flex-shrink:0">'+uname.charAt(0).toUpperCase()+'</div>';
    signIn=
      '<div class="settings-card">'+
        '<div class="settings-card-title" style="cursor:default">Account</div>'+
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">'+
          avatar+
          '<div style="min-width:0">'+
            '<div style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+uname+'</div>'+
            '<div style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+email+'</div>'+
            '<div style="font-size:12px;color:var(--success);margin-top:2px">● Synced to cloud</div>'+
          '</div>'+
        '</div>'+
        '<button onclick="handleAuth()" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer">Sign out</button>'+
      '</div>';
  } else {
    signIn=
      '<div class="settings-card">'+
        '<div class="settings-card-title" style="cursor:default">Account</div>'+
        '<div style="font-size:13px;color:var(--muted);margin-bottom:14px">Not signed in — sign in to sync your data across devices.</div>'+
        '<button onclick="handleAuth()" style="width:100%;padding:10px;border-radius:10px;border:none;background:#4285f4;color:#fff;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">'+
          '<svg viewBox="0 0 24 24" style="width:16px;height:16px;flex-shrink:0"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>'+
          'Sign in with Google'+
        '</button>'+
      '</div>';
  }
  const profileCard=
    '<div class="settings-card">'+
      '<div class="settings-card-title" style="cursor:default">Profile</div>'+
      '<div class="settings-field">'+
        '<label>Your name</label>'+
        '<input type="text" id="profile-name" placeholder="e.g. Francois" value="'+(profileData.name||'').replace(/"/g,'&quot;')+'" autocomplete="name">'+
      '</div>'+
      '<button class="settings-save-btn" id="profile-save-btn" onclick="saveProfileSection()" style="margin-top:4px">Save</button>'+
    '</div>';
  const remindersCard=
    '<div class="settings-card">'+
      '<div class="settings-card-title" style="cursor:default">Reminders</div>'+
      '<div id="reminders-inner"></div>'+
    '</div>';
  const advancedCard=
    '<div class="settings-card">'+
      '<div class="settings-card-title" style="cursor:default;font-size:13px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.4px">Advanced</div>'+
      '<button onclick="resetOnboarding()" style="width:100%;padding:11px;border-radius:8px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer">Reset onboarding</button>'+
    '</div>';
  wrap.innerHTML=signIn+profileCard+remindersCard+advancedCard;
  renderRemindersSection();
  renderSettingsTopCard();
}

function savePersonalInfo(){
  S.personalInfo = {
    name:     document.getElementById('pi-name').value.trim(),
    age:      parseInt(document.getElementById('pi-age').value)||null,
    sex:      document.getElementById('pi-sex').value,
    height:   parseFloat(document.getElementById('pi-height').value)||null,
    weight:   parseFloat(document.getElementById('pi-weight').value)||null,
    activity: document.getElementById('pi-activity').value,
    goal:     S.personalInfo.goal||'maintain'
  };
  localStorage.setItem('wt_personalinfo', JSON.stringify(S.personalInfo));
  renderTDEESection();
  renderCalorieLog();

  const btn = document.getElementById('pi-save-btn');
  if(btn){
    btn.textContent='✓ Saved!'; btn.style.background='var(--accent)';
    setTimeout(()=>{ btn.textContent='Save info'; btn.style.background=''; }, 1500);
  }
}

function calcGoalCals(){
  const pi = S.personalInfo;
  if(!pi.age||!pi.height||!pi.weight||!pi.sex) return null;
  const bmr = pi.sex==='female'
    ? (10*pi.weight)+(6.25*pi.height)-(5*pi.age)-161
    : (10*pi.weight)+(6.25*pi.height)-(5*pi.age)+5;
  const activity = parseFloat(pi.activity)||1.55;
  const tdee = Math.round(bmr*activity);
  const goal = pi.goal||'maintain';
  return {tdee, cut:tdee-500, maintain:tdee, bulk:tdee+300, goal};
}

function selectGoal(goal){
  S.personalInfo.goal = goal;
  localStorage.setItem('wt_personalinfo', JSON.stringify(S.personalInfo));
  renderTDEESection();
  renderCalorieLog();
  if(document.getElementById('calorie-overlay')?.style.display==='flex') renderCalorieOverlay();
}

function renderTDEESection(){
  const wrap = document.getElementById('tdee-section');
  if(!wrap) return;
  const c = calcGoalCals();
  if(!c){
    wrap.innerHTML=`<div style="font-size:13px;color:var(--muted);text-align:center;padding:14px 0">Fill in your details above and tap Save to see calorie targets.</div>`;
    return;
  }
  const g = c.goal;
  wrap.innerHTML=`
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:4px">Daily calorie targets</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">TDEE: ${c.tdee} kcal · tap a goal to track it</div>
      <div class="tdee-grid">
        <div class="tdee-card" style="color:var(--danger);border-color:${g==='cut'?'var(--danger)':'var(--border)'}" onclick="selectGoal('cut')">
          <div class="tdee-card-val">${c.cut}</div>
          <div class="tdee-card-lbl">Cut</div>
          ${g==='cut'?'<div class="tdee-card-active" style="color:var(--danger)">✓ Active</div>':''}
        </div>
        <div class="tdee-card" style="color:var(--success);border-color:${g==='maintain'?'var(--success)':'var(--border)'}" onclick="selectGoal('maintain')">
          <div class="tdee-card-val">${c.maintain}</div>
          <div class="tdee-card-lbl">Maintain</div>
          ${g==='maintain'?'<div class="tdee-card-active" style="color:var(--success)">✓ Active</div>':''}
        </div>
        <div class="tdee-card" style="color:var(--blue);border-color:${g==='bulk'?'var(--blue)':'var(--border)'}" onclick="selectGoal('bulk')">
          <div class="tdee-card-val">${c.bulk}</div>
          <div class="tdee-card-lbl">Bulk</div>
          ${g==='bulk'?'<div class="tdee-card-active" style="color:var(--blue)">✓ Active</div>':''}
        </div>
      </div>
    </div>`;
}

// ── Calorie log ────────────────────────────────────────────────────
function renderCalorieLog(){
  const wrap = document.getElementById('calorie-log-inner');
  if(!wrap) return;

  // Check for midnight reset
  const today = getLocalDate();
  if(S.dailyLog.date !== today){
    S.dailyLog = {date:today, entries:[]};
    persistDailyLog();
  }

  const c = calcGoalCals();
  const goalCals = c ? (c.goal==='cut'?c.cut:c.goal==='bulk'?c.bulk:c.maintain) : null;
  const total = S.dailyLog.entries.reduce((a,e)=>a+e.kcal, 0);
  const pct = goalCals ? Math.min(110, Math.round(total/goalCals*100)) : 0;
  const barColor = pct>100?'var(--danger)':pct>80?'var(--warn)':'var(--success)';

  let html = '';

  if(goalCals){
    html += `
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin-bottom:4px">
        <span>${total} kcal eaten</span>
        <span>Goal: ${goalCals} kcal</span>
      </div>
      <div class="cal-progress-bar">
        <div class="cal-progress-fill" style="width:${Math.min(100,pct)}%;background:${barColor}"></div>
      </div>
      <div style="font-size:12px;color:var(--muted);text-align:right;margin-bottom:12px">
        ${pct<=100?`${goalCals-total} kcal remaining`:`${total-goalCals} kcal over goal`}
      </div>`;
  } else {
    html += `<div style="font-size:13px;color:var(--muted);margin-bottom:12px">Save your personal info to see a calorie goal here.</div>`;
  }

  html += `
    <div class="cal-add-row">
      <input class="cal-food-input" type="text" id="cal-food" placeholder="Food / meal">
      <input class="cal-kcal-input" type="number" id="cal-kcal" inputmode="numeric" placeholder="kcal" min="1">
      <button class="cal-add-btn" onclick="logCalorie()">Add</button>
    </div>`;

  if(S.dailyLog.entries.length){
    html += `<div style="max-height:220px;overflow-y:auto;margin-top:4px">`;
    [...S.dailyLog.entries].reverse().forEach((e,ri)=>{
      const i = S.dailyLog.entries.length-1-ri;
      html += `<div class="cal-entry">
        <div class="cal-entry-name">${e.name.replace(/</g,'&lt;')||'—'}</div>
        <div class="cal-entry-kcal">${e.kcal} kcal</div>
        <button class="cal-del-btn" onclick="deleteCalEntry(${i})">✕</button>
      </div>`;
    });
    html += `</div>
      <div style="padding-top:10px;font-size:14px;font-weight:700;text-align:right">Total: ${total} kcal</div>`;
  } else {
    html += `<div style="text-align:center;color:var(--muted);font-size:13px;padding:14px 0">No food logged today</div>`;
  }

  wrap.innerHTML = html;
}

function logCalorie(category){
  const food = document.getElementById('cal-food');
  const kcalEl = document.getElementById('cal-kcal');
  const kcal = parseInt(kcalEl.value);
  if(!kcal||kcal<=0) return;
  S.dailyLog.entries.push({name: food.value.trim()||'Unknown', kcal, category: category||'other'});
  persistDailyLog();
  food.value=''; kcalEl.value='';
  renderCalorieLog();
  if(document.getElementById('calorie-overlay')?.style.display==='flex') renderCalorieOverlay();
}
function deleteCalEntry(i){
  S.dailyLog.entries.splice(i, 1);
  persistDailyLog();
  renderCalorieLog();
  if(document.getElementById('calorie-overlay')?.style.display==='flex') renderCalorieOverlay();
}

// ── Calorie overlay (full-screen) ─────────────────────────────────
const MEAL_CATS=[
  {id:'breakfast',emoji:'🌅',label:'Breakfast'},
  {id:'lunch',emoji:'🥗',label:'Lunch'},
  {id:'dinner',emoji:'🍽️',label:'Dinner'},
  {id:'snacks',emoji:'🍎',label:'Snacks'},
];
function openCalorieOverlay(){
  const ov=document.getElementById('calorie-overlay');
  if(!ov) return;
  ov.style.display='flex';
  renderCalorieOverlay();
}
function closeCalorieOverlay(){
  const ov=document.getElementById('calorie-overlay');
  if(ov) ov.style.display='none';
  if(S.calOverlayChart){ S.calOverlayChart.destroy(); S.calOverlayChart=null; }
}
function overlayAddCalorie(cat){
  const food=document.getElementById('ov-food-'+cat);
  const kcalEl=document.getElementById('ov-kcal-'+cat);
  if(!kcalEl) return;
  const kcal=parseInt(kcalEl.value);
  if(!kcal||kcal<=0) return;
  const today=getLocalDate();
  if(S.dailyLog.date!==today){ S.dailyLog={date:today,entries:[]}; }
  S.dailyLog.entries.push({name:(food?.value.trim())||'Unknown', kcal, category:cat});
  persistDailyLog();
  renderCalorieLog();
  renderCalorieOverlay();
}
function deleteOverlayEntry(i){
  S.dailyLog.entries.splice(i,1);
  persistDailyLog();
  renderCalorieLog();
  renderCalorieOverlay();
}
function renderCalorieOverlay(){
  const inner=document.getElementById('calorie-overlay-inner');
  if(!inner) return;
  const today=getLocalDate();
  if(S.dailyLog.date!==today){ S.dailyLog={date:today,entries:[]}; persistDailyLog(); }
  const c=calcGoalCals();
  const goal=c?c.goal:'maintain';
  const goalCals=c?(goal==='cut'?c.cut:goal==='bulk'?c.bulk:c.maintain):null;
  const eaten=S.dailyLog.entries.reduce((a,e)=>a+e.kcal,0);
  const rem=goalCals!=null?goalCals-eaten:null;

  // Header
  let html='<div id="calorie-overlay-header">'+
    '<button id="calorie-overlay-back" onclick="closeCalorieOverlay()">←</button>'+
    '<div style="font-size:20px;font-weight:700">Calories</div></div>';

  // Target switcher
  if(c){
    const pill=(g,lbl,val)=>{
      const active=goal===g;
      return '<button onclick="selectGoal(\''+g+'\')" style="flex:1;padding:10px 6px;border-radius:999px;border:1.5px solid '+(active?'var(--accent)':'var(--border)')+';background:'+(active?'var(--accent)':'transparent')+';color:'+(active?'#fff':'var(--text)')+';font-size:13px;font-weight:600;cursor:pointer;text-align:center">'
        +lbl+'<div style="font-size:11px;font-weight:500;opacity:0.85;margin-top:1px">'+val+'</div></button>';
    };
    html+='<div style="display:flex;gap:8px;margin-bottom:24px">'+
      pill('bulk','Bulk',c.bulk)+pill('maintain','Maintain',c.maintain)+pill('cut','Cut',c.cut)+'</div>';
  } else {
    html+='<div style="text-align:center;color:var(--muted);font-size:13px;margin-bottom:20px">Add your personal info in Settings to see calorie targets.</div>';
  }

  // Ring + stats
  if(goalCals!=null){
    const pct=Math.min(100,Math.round(eaten/goalCals*100));
    const ringCol=rem<0?'var(--danger)':pct>80?'var(--warn)':'var(--success)';
    const R=58,circ=+(2*Math.PI*R).toFixed(1),offset=+(circ*(1-pct/100)).toFixed(1);
    html+='<div style="display:flex;flex-direction:column;align-items:center;margin-bottom:28px">'+
      '<svg width="150" height="150" viewBox="0 0 150 150">'+
        '<circle cx="75" cy="75" r="'+R+'" fill="none" stroke="var(--border)" stroke-width="12"/>'+
        '<circle cx="75" cy="75" r="'+R+'" fill="none" stroke="'+ringCol+'" stroke-width="12" stroke-dasharray="'+circ+'" stroke-dashoffset="'+offset+'" stroke-linecap="round" transform="rotate(-90 75 75)"/>'+
        '<text x="75" y="70" text-anchor="middle" dominant-baseline="middle" font-size="30" font-weight="800" fill="var(--text)">'+eaten+'</text>'+
        '<text x="75" y="94" text-anchor="middle" font-size="12" fill="var(--muted)">eaten</text>'+
      '</svg>'+
      '<div style="display:flex;gap:28px;margin-top:14px">'+
        '<div style="text-align:center"><div style="font-size:18px;font-weight:800;color:'+ringCol+'">'+(rem>=0?rem:Math.abs(rem))+'</div><div style="font-size:11px;color:var(--muted)">'+(rem>=0?'remaining':'over')+'</div></div>'+
        '<div style="text-align:center"><div style="font-size:18px;font-weight:800">'+goalCals+'</div><div style="font-size:11px;color:var(--muted)">goal</div></div>'+
      '</div></div>';
  }

  // Meal log by category
  MEAL_CATS.forEach(cat=>{
    const items=S.dailyLog.entries.map((e,i)=>({e,i})).filter(o=>(o.e.category||'other')===cat.id);
    const subtotal=items.reduce((a,o)=>a+o.e.kcal,0);
    html+='<div class="card" style="margin-bottom:12px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">'+
        '<div style="font-size:14px;font-weight:700">'+cat.emoji+' '+cat.label+'</div>'+
        '<div style="font-size:13px;font-weight:600;color:var(--muted)">'+subtotal+' kcal</div>'+
      '</div>';
    items.forEach(o=>{
      html+='<div class="cal-entry"><div class="cal-entry-name">'+(o.e.name.replace(/</g,'&lt;')||'—')+'</div>'+
        '<div class="cal-entry-kcal">'+o.e.kcal+' kcal</div>'+
        '<button class="cal-del-btn" onclick="deleteOverlayEntry('+o.i+')">✕</button></div>';
    });
    html+='<div class="cal-add-row" style="margin:10px 0 0">'+
      '<input class="cal-food-input" type="text" id="ov-food-'+cat.id+'" placeholder="Food / meal">'+
      '<input class="cal-kcal-input" type="number" id="ov-kcal-'+cat.id+'" inputmode="numeric" placeholder="kcal" min="1">'+
      '<button class="cal-add-btn" onclick="overlayAddCalorie(\''+cat.id+'\')">+ Add</button>'+
      '</div></div>';
  });

  // Weekly chart
  html+='<div class="card" style="margin-bottom:12px"><div style="font-size:14px;font-weight:700;margin-bottom:12px">Last 7 days</div>'+
    '<canvas id="cal-week-chart" height="160"></canvas></div>';

  inner.innerHTML=html;

  // Build weekly chart
  const labels=[],eatenData=[],dayInit=[];
  for(let i=6;i>=0;i--){
    const d=new Date(today+'T12:00:00'); d.setDate(d.getDate()-i);
    const key=d.toLocaleDateString('en-CA');
    const total = key===today ? eaten : (calorieHistory[key]||0);
    eatenData.push(total);
    dayInit.push(['S','M','T','W','T','F','S'][d.getDay()]);
    labels.push(key);
  }
  const ctx=document.getElementById('cal-week-chart');
  if(ctx && typeof Chart!=='undefined'){
    if(S.calOverlayChart){ S.calOverlayChart.destroy(); S.calOverlayChart=null; }
    const accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#FF6B35';
    const datasets=[{label:'Eaten',data:eatenData,backgroundColor:accent,borderRadius:4,barPercentage:0.6}];
    if(goalCals!=null) datasets.push({label:'Target',type:'line',data:eatenData.map(()=>goalCals),borderColor:'rgba(150,150,150,0.7)',borderDash:[5,4],borderWidth:1.5,pointRadius:0,fill:false});
    S.calOverlayChart=new Chart(ctx,{
      type:'bar',
      data:{labels:dayInit,datasets},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false}},
        scales:{x:{grid:{display:false},ticks:{color:'#94a3b8'}},y:{beginAtZero:true,grid:{color:'rgba(150,150,150,0.12)'},ticks:{color:'#94a3b8'}}}}
    });
  }
}

// ── Saved foods (favourites) ──────────────────────────────────────
function loadSavedFoods(){ return lsLoad('daily_saved_foods', []); }
function persistSavedFoods(){
  localStorage.setItem('daily_saved_foods', JSON.stringify(savedFoods));
}
let savedFoods = loadSavedFoods();

function addSavedFood(){
  const nameEl=document.getElementById('saved-food-name');
  const kcalEl=document.getElementById('saved-food-kcal');
  const name=nameEl?.value.trim();
  const kcal=parseInt(kcalEl?.value);
  if(!name||!kcal||kcal<=0) return;
  savedFoods.push({name, kcal});
  persistSavedFoods();
  nameEl.value=''; kcalEl.value='';
  renderSavedFoods();
}
function deleteSavedFood(i){
  savedFoods.splice(i,1);
  persistSavedFoods();
  renderSavedFoods();
}
function logFromFavourite(name, kcal){
  const today=getLocalDate();
  if(S.dailyLog.date!==today){ S.dailyLog={date:today,entries:[]}; }
  S.dailyLog.entries.push({name, kcal, category:'other'});
  persistDailyLog();
  renderCalorieLog();
  if(document.getElementById('calorie-overlay')?.style.display==='flex') renderCalorieOverlay();
}
function renderSavedFoods(){
  const wrap=document.getElementById('saved-foods-inner'); if(!wrap) return;
  let html=`
    <div class="cal-add-row" style="margin-bottom:12px">
      <input class="cal-food-input" type="text" id="saved-food-name" placeholder="Food name">
      <input class="cal-kcal-input" type="number" id="saved-food-kcal" inputmode="numeric" placeholder="kcal" min="1">
      <button class="cal-add-btn" onclick="addSavedFood()">Save</button>
    </div>`;
  if(savedFoods.length){
    html+=`<div style="display:flex;flex-wrap:wrap;gap:7px">`;
    savedFoods.forEach((f,i)=>{
      const safeName=f.name.replace(/</g,'&lt;').replace(/'/g,'&#39;');
      html+=`<div style="display:inline-flex;align-items:center;gap:4px;background:var(--blue-bg);border:1.5px solid var(--blue-border);border-radius:20px;padding:5px 8px 5px 12px">
        <span onclick="logFromFavourite('${safeName}',${f.kcal})" style="font-size:13px;font-weight:600;color:var(--blue-dark);cursor:pointer">${safeName} · ${f.kcal} kcal</span>
        <button onclick="deleteSavedFood(${i})" style="font-size:12px;color:var(--muted);background:none;border:none;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0">✕</button>
      </div>`;
    });
    html+=`</div>`;
  } else {
    html+=`<div style="text-align:center;color:var(--muted);font-size:13px;padding:10px 0">No saved foods yet — save frequent meals above</div>`;
  }
  wrap.innerHTML=html;
}

// ── Export ────────────────────────────────────────────────────────
function exportBudgetCSV(){
  const keys=Object.keys(budgetData).sort();
  if(!keys.length){ alert('No budget weeks saved yet.'); return; }
  const rows=['Week,Income,Saved,Fixed,Variable,Total Out,Leftover'];
  let tIncome=0,tSaved=0,tFixed=0,tVar=0,tOut=0,tLeft=0;
  keys.forEach(k=>{
    const d=budgetData[k];
    const mon=new Date(k+'T12:00:00'),fri=new Date(mon); fri.setDate(mon.getDate()+4);
    const lbl=mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' – '+fri.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
    const income=weekIncome(d);
    const saved=weekSavedAmt(d);
    const fixed=d.snapshot?parseFloat(d.snapshot.fixed)||0:configFixedTotal();
    const variable=d.snapshot?parseFloat(d.snapshot.variable)||0:configVariableTotal();
    const out=saved+fixed+variable;
    const left=income>0?income-out:0;
    tIncome+=income;tSaved+=saved;tFixed+=fixed;tVar+=variable;tOut+=out;tLeft+=income>0?left:0;
    rows.push([`"${lbl}"`,income,saved,fixed,variable,out,income>0?left:''].join(','));
  });
  rows.push(['"Totals"',tIncome,tSaved,tFixed,tVar,tOut,tLeft].join(','));
  const blob=new Blob([rows.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`budget-${getLocalDate()}.csv`;
  a.click();
}

function exportData(){
  if(!S.sessions.length){ alert('No sessions to export yet.'); return; }
  const rows=['Date,Day,Session,Exercise,Set,Weight (kg),Reps'];
  S.sessions.forEach(s=>{
    s.exercises.forEach(ex=>{
      ex.sets.forEach((set,si)=>{
        rows.push([s.date,s.dayNum,s.sessionType,ex.name,si+1,set.weight||'',set.reps||''].join(','));
      });
    });
  });
  const blob=new Blob([rows.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`workout-log-${getLocalDate()}.csv`;
  a.click();
}

// ── Full data backup (export / import) ───────────────────────────
// Backs up EVERY app localStorage key (budget, workouts, weight, kitchen, settings…)
// as raw strings, so a future change that renames a field can be recovered from here.
// Values are kept as strings (not JSON.parsed) so non-JSON entries like wt_theme survive.
function exportAllData(){
  const data={};
  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    if(key && /^(daily_|wt_|kitchen_)/.test(key)) data[key]=localStorage.getItem(key);
  }
  const backup={ app:'daily', version:1, exported:new Date().toISOString(), data };
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download='daily-backup-'+getLocalDate()+'.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function importData(e){
  const file=e.target.files&&e.target.files[0];
  if(!file){ return; }
  const reader=new FileReader();
  reader.onload=function(ev){
    let parsed;
    try{ parsed=JSON.parse(ev.target.result); }catch(err){ alert('Invalid backup file — could not read JSON.'); return; }
    // Accept both {data:{...}} (this app's format) and a flat {key:value} object
    const data=(parsed && parsed.data && typeof parsed.data==='object') ? parsed.data : parsed;
    if(!data || typeof data!=='object'){ alert('Invalid backup file.'); return; }
    const keys=Object.keys(data).filter(k=>/^(daily_|wt_|kitchen_)/.test(k));
    if(!keys.length){ alert('No Daily data found in this file.'); return; }
    if(!confirm('Restore '+keys.length+' data keys from this backup?\nThis overwrites the current data on this device.')){ e.target.value=''; return; }
    keys.forEach(k=>{
      const v=data[k];
      localStorage.setItem(k, typeof v==='string' ? v : JSON.stringify(v));
    });
    alert('Data restored. Reloading…');
    location.reload();
  };
  reader.readAsText(file);
}


// ── Budget constants (fallback defaults) ──────────────────────────
const DEFAULT_SAVINGS   = 350;
const DEFAULT_FINE      = 25;
const DEFAULT_SUBS      = 17;
const DEFAULT_GYM       = 27;
const DEFAULT_TRANSPORT = 50;
const DEFAULT_FOOD      = 70;
const DEFAULT_PUB       = 100;
const DEFAULT_PERSONAL  = 60;

// ── Fixed spending categories (8 fixed; stored as d.cats per week) ─
const BUD_CATS = [
  { key:'housing',       name:'Housing / Rent', icon:'🏠' },
  { key:'transport',     name:'Transport',       icon:'🚌' },
  { key:'groceries',     name:'Groceries',       icon:'🛒' },
  { key:'eating_out',    name:'Eating Out',      icon:'🍔' },
  { key:'entertainment', name:'Entertainment',   icon:'🎬' },
  { key:'personal_care', name:'Personal Care',   icon:'🛍️' },
  { key:'subscriptions', name:'Subscriptions',   icon:'📱' },
  { key:'other',         name:'Other',           icon:'💸' },
];
const BUD_DONUT_COLOURS = [
  '#FF6B35','rgba(255,107,53,.6)','rgba(255,107,53,.35)',
  '#52B788','#3B82F6','#8B5CF6','#f59e0b','#ec4899',
];

// ── Budget state ──────────────────────────────────────────────────
let currentWeekIdx     = 0;
let currentMonthOffset = 0;
let budgetView         = 'week';
let budgetData         = budLoadData();
let budDefaults        = budLoadDefaults();
// ── Unified budget config (single source of truth) ───────────────
// daily_budget_config = { incomeStreams[], fixedExpenses[], variableExpenses[] }
function loadBudgetConfig(){
  try{
    const c=JSON.parse(localStorage.getItem('daily_budget_config')||'null');
    if(c&&Array.isArray(c.incomeStreams)&&Array.isArray(c.fixedExpenses)&&Array.isArray(c.variableExpenses)) return c;
  }catch(e){}
  // Build defaults, migrating any pre-existing (separate) income streams
  let income=null;
  try{ const s=JSON.parse(localStorage.getItem('daily_income_streams')||'null'); if(Array.isArray(s)&&s.length) income=s; }catch(e){}
  const bd=(typeof budDefaults==='object'&&budDefaults)?budDefaults:{};
  return {
    incomeStreams: income || [
      {id:'1',name:'Fujifilm',weeklyAmount:507},
      {id:'2',name:"McDonald's",weeklyAmount:278},
    ],
    fixedExpenses: [
      {id:'f1',name:'Fine payment',weeklyAmount:bd.fine??25},
      {id:'f2',name:'Subscriptions',weeklyAmount:bd.subs??17},
      {id:'f3',name:'Transport',weeklyAmount:bd.transport??50},
      {id:'f4',name:'Gym',weeklyAmount:bd.gym??27},
    ],
    variableExpenses: [
      {id:'v1',name:'Food / Social',weeklyAmount:150},
      {id:'v2',name:'Personal / Misc',weeklyAmount:68},
    ],
  };
}
let budgetConfig = loadBudgetConfig();
let incomeStreams = budgetConfig.incomeStreams; // legacy alias kept in sync
function saveBudgetConfig(cfg){
  budgetConfig = cfg;
  incomeStreams = cfg.incomeStreams;
  localStorage.setItem('daily_budget_config', JSON.stringify(cfg));
  localStorage.removeItem('daily_income_streams'); // consolidate — no separate key
  if(firebaseReady&&auth&&auth.currentUser&&db){
    db.ref('users/'+auth.currentUser.uid+'/budgetConfig').set(cfg);
  }
}
// Legacy shims (older code paths still reference these names)
function loadIncomeStreams(){ return budgetConfig.incomeStreams; }
function saveIncomeStreams(){ saveBudgetConfig(budgetConfig); }
function cfgSum(arr){ return (arr||[]).reduce((a,i)=>a+(parseFloat(i.weeklyAmount)||0),0); }
function configIncomeTotal(){ return cfgSum(budgetConfig.incomeStreams); }
function configFixedTotal(){ return cfgSum(budgetConfig.fixedExpenses); }
function configVariableTotal(){ return cfgSum(budgetConfig.variableExpenses); }

// ── Generic line-item editing (Budget tab + Settings share these) ─
function addBudgetItem(type){
  const prefix=type==='incomeStreams'?'i':type==='fixedExpenses'?'f':'v';
  if(!Array.isArray(budgetConfig[type])) budgetConfig[type]=[];
  budgetConfig[type].push({id:prefix+Date.now(),name:'',weeklyAmount:0});
  saveBudgetConfig(budgetConfig);
  refreshBudgetUI();
}
function deleteBudgetItem(type,id){
  if(!Array.isArray(budgetConfig[type])||budgetConfig[type].length<=1) return;
  budgetConfig[type]=budgetConfig[type].filter(x=>x.id!==id);
  saveBudgetConfig(budgetConfig);
  refreshBudgetUI();
}
function updateBudgetItem(type,id,field,val){
  const it=(budgetConfig[type]||[]).find(x=>x.id===id);
  if(!it) return;
  it[field]= field==='weeklyAmount' ? (parseFloat(val)||0) : val;
  saveBudgetConfig(budgetConfig);
  refreshBudgetUI();
}
function refreshBudgetUI(){
  if(S.view==='budget') renderBudgetTab();
  if(S.view==='home') renderHome();
  // Keep the structural editors that share these handlers in sync when they're open, so
  // "+ Add item" / delete visibly update their lists (they aren't the Budget tab or Home).
  const be=document.getElementById('view-budget-editor');
  if(be && be.style.display!=='none' && typeof renderBudgetEditor==='function') renderBudgetEditor();
  if(document.getElementById('ob-inc-list')){ renderBudgetEditList('ob-inc-list','incomeStreams'); renderBudgetEditList('ob-fix-list','fixedExpenses'); }
}
function renderBudgetEditList(containerId,type){
  const el=document.getElementById(containerId);
  if(!el) return;
  const items=budgetConfig[type]||[];
  el.innerHTML=items.map(it=>
    '<div class="bud-edit-row">'+
      '<input class="bud-edit-name" value="'+(it.name||'').replace(/"/g,'&quot;')+'" placeholder="Name" onchange="updateBudgetItem(\''+type+'\',\''+it.id+'\',\'name\',this.value)">'+
      '<input class="bud-edit-amt" type="number" inputmode="decimal" value="'+(it.weeklyAmount??'')+'" placeholder="0" onchange="updateBudgetItem(\''+type+'\',\''+it.id+'\',\'weeklyAmount\',this.value)">'+
      '<button class="bud-edit-del" title="Remove" onclick="deleteBudgetItem(\''+type+'\',\''+it.id+'\')">🗑️</button>'+
    '</div>'
  ).join('')+
    '<button class="bud-add-item" onclick="addBudgetItem(\''+type+'\')">+ Add item</button>';
}


// ── Per-week snapshot accessors (history reads these; legacy fallback) ─
function weekIncome(d){
  if(!d) return 0;
  if(d.snapshot&&typeof d.snapshot==='object') return parseFloat(d.snapshot.income)||0;
  if(d.income&&typeof d.income==='object'){
    return Object.values(d.income).reduce((a,v)=>a+(parseFloat(v)||0),0);
  }
  // Sum the dynamic income sources (ids fuji/mcd map onto legacy d.inc_fuji / d.inc_mcd)
  return loadIncCats().reduce((s,c)=>s+(parseFloat(d['inc_'+c.id])||0),0);
}
function weekSpending(d){
  if(d&&d.snapshot) return (parseFloat(d.snapshot.fixed)||0)+(parseFloat(d.snapshot.variable)||0);
  // Sum across the user's dynamic fixed + variable categories
  return weekFixedTotal(d)+weekVarTotal(d);
}
function weekSavedAmt(d){
  if(!d) return 0;
  // New free-input model: the saved total is exactly what was entered for the week
  if(d.sav_amount!==undefined&&d.sav_amount!=='') return parseFloat(d.sav_amount)||0;
  if(d.snapshot) return parseFloat(d.snapshot.saved)||0;
  // Legacy "extra" field (old target+extra model) — no target is added anymore, so it's just
  // whatever extra was recorded. Genuine legacy weeks were frozen to sav_amount by recoverBudgetData.
  if(d.sav_extra!==undefined) return parseFloat(d.sav_extra)||0;
  return 0;
}
function weekLeftover(d){
  if(d&&d.snapshot) return parseFloat(d.snapshot.leftover)||0;
  return weekIncome(d)-weekSpending(d)-weekSavedAmt(d);
}
let savingsLog         = loadSavingsLog();
// ── Credit-card balance history (dated; drives the Finance net-worth line) ──
function loadCCLog(){ return lsLoad('daily_cc_log', []); }
let ccLog = loadCCLog();
function recordCCHistory(bal){
  const today=getLocalDate();
  ccLog=ccLog.filter(e=>e&&e.date!==today);
  ccLog.push({date:today,balance:bal,t:Date.now()});
  ccLog.sort((a,b)=>a.date<b.date?-1:1);
  lsSave('daily_cc_log', ccLog, 'ccLog');
}
// Last known CC balance on or before `date`; earliest entry before history starts;
// falls back to the current daily_cc balance if no history exists at all.
function ccBalanceAt(date){
  let last=null;
  for(const e of ccLog){ if(e.date<=date) last=e; else break; }
  if(last) return last.balance;
  if(ccLog.length) return ccLog[0].balance;
  return parseFloat(loadCCData().balance)||0;
}
// ── Legacy weight-log merge (daily_weight_log / users/{uid}/weightLog → wt_weight) ──
// The old duplicate store held {date, kg} entries; the canonical store holds
// {date, weight}. Union by date, wt_weight winning conflicts. Idempotent — safe to run
// at boot and again from the weights cloud listener (which replaces S.weights wholesale).
let _wtLegacyCloud=null; // parsed cloud copy, fetched once at sign-in
function mergeLegacyWeightEntries(){
  const srcs=[];
  const local=lsLoad('daily_weight_log', []);
  if(Array.isArray(local)) srcs.push(...local);
  if(Array.isArray(_wtLegacyCloud)) srcs.push(..._wtLegacyCloud);
  if(!srcs.length) return false;
  const have=new Set(S.weights.map(w=>w&&w.date));
  let added=false;
  srcs.forEach(e=>{
    if(!e||!e.date||have.has(e.date)) return;
    const kg=parseFloat(e.kg!==undefined?e.kg:e.weight);
    if(!kg||kg<=0) return;
    S.weights.push({date:e.date, weight:kg});
    have.add(e.date);
    added=true;
  });
  if(added) S.weights.sort((a,b)=>a.date<b.date?-1:1);
  return added;
}
let profileData        = loadProfileData();
let settingsCollapsed  = lsLoad('daily_settings_collapsed', {});
function loadWeightGoal(){ return lsLoad('daily_weight_goal', {}); }
let weightGoal = loadWeightGoal();
function loadSubscriptions(){ return lsLoad('daily_subscriptions', []); }
let subscriptionsData = loadSubscriptions();
let habitsData         = loadHabits();
let habitsLog          = loadHabitsLog();
let budChart           = null;
let budDonutChart      = null;
let monthWeekChart     = null;   // Month view: weekly grouped bar chart
let yearStackChart     = null;   // Yearly view: stacked bars + savings-rate line
let yearCCChart        = null;   // Yearly view: monthly CC / variable spending line
let budTrendRange      = 'monthly';
let bsChart            = null;
let bsBalChart         = null;
let bsTrendRange       = 'monthly';

// ── Budget storage ────────────────────────────────────────────────
function budLoadData(){ return lsLoad('daily_budget', {}); }
function budSaveData(changedKey){
  localStorage.setItem('daily_budget', JSON.stringify(budgetData));
  syncBudgetDataToFirebase(changedKey);
}
function budLoadDefaults(){ return lsLoad('daily_budget_defaults', {}); }
function budSaveDefaults(){
  budDefaults.fine      = parseFloat(document.getElementById('fix-fine')?.value)      || DEFAULT_FINE;
  budDefaults.subs      = parseFloat(document.getElementById('fix-subs')?.value)      || DEFAULT_SUBS;
  budDefaults.gym       = parseFloat(document.getElementById('fix-gym')?.value)       || DEFAULT_GYM;
  budDefaults.transport = parseFloat(document.getElementById('fix-transport')?.value) || DEFAULT_TRANSPORT;
  localStorage.setItem('daily_budget_defaults', JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();
}
function getWeeklySavings(){ return 0; } // weekly-savings target was removed; no-op for legacy callers
// Pay day (day-of-week 0-6) per income source, keyed by the source's id in loadIncCats().
// Reads budDefaults.payDays first, then falls back to the original hardcoded fuji/mcd fields
// so existing saved settings keep working until the user changes them via the new selectors.
function getPayDay(id){
  const pd = budDefaults.payDays && budDefaults.payDays[id];
  if(pd!=null && !isNaN(pd)) return parseInt(pd);
  if(id==='fuji') return budDefaults.fujifilmPayDay ?? 4;   // legacy: Thursday
  if(id==='mcd')  return budDefaults.mcdonaldsPayDay ?? 2;  // legacy: Tuesday
  return 5; // sensible default (Friday) for newly-added sources
}
function setPayDay(id, day){
  if(!budDefaults.payDays || typeof budDefaults.payDays!=='object') budDefaults.payDays={};
  budDefaults.payDays[id]=parseInt(day);
}
function dFine()       { return budDefaults.fine       ?? DEFAULT_FINE; }
function dSubs()       { return budDefaults.subs       ?? DEFAULT_SUBS; }
function dGym()        { return budDefaults.gym        ?? DEFAULT_GYM; }
function dTransport()  { return budDefaults.transport  ?? DEFAULT_TRANSPORT; }
function dFineLabel()      { return budDefaults.fine_label      || '⚙️ Fine repayment'; }
function dSubsLabel()      { return budDefaults.subs_label      || '📱 Subscriptions'; }
function dGymLabel()       { return budDefaults.gym_label       || '🏋️ Gym'; }
function dTransportLabel() { return budDefaults.transport_label || '🚌 Transport'; }
function dTransportBud()   { return budDefaults.transport       ?? DEFAULT_TRANSPORT; }
function dFoodBud()    { return budDefaults.food_bud    ?? DEFAULT_FOOD; }
function dPubBud()     { return budDefaults.pub_bud     ?? DEFAULT_PUB; }
function dPersonalBud(){ return budDefaults.personal_bud ?? DEFAULT_PERSONAL; }

// ── Date helpers (device-local timezone) ─────────────────────────
// "Today" as YYYY-MM-DD in the user's own device timezone. Native Date getters resolve the
// device's local wall clock (including its DST), so each user's day/midnight matches their
// own clock. This only governs newly-computed dates — previously-saved date strings are never
// re-derived, so switching timezones can't retroactively change stored data.
function getLocalDate(){
  return dateStr(new Date());
}
function localMidnight(dateStr){
  const [y,m,d]=dateStr.split('-').map(Number);
  return new Date(y,m-1,d);
}
function dateStr(d){
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// ── Week / month key helpers ──────────────────────────────────────
function getMondayOf(weekOffset = 0){
  // Anchor on the user's own device calendar date via getLocalDate(). The day-of-week of a
  // calendar date is timezone-independent, so .getDay() on a local-midnight Date is safe
  // (no offset/DST math needed). Returns a local-midnight Date so callers (weekKey/
  // fmtWeekLabel and monday.setDate arithmetic) keep working unchanged.
  const today = localMidnight(getLocalDate());
  const day = today.getDay();                 // 0=Sun … 6=Sat
  const diffToMonday = (day === 0) ? 6 : day - 1;
  const monday = new Date(today);
  monday.setDate(today.getDate() - diffToMonday + (weekOffset * 7));
  return monday;
}
function weekKey(monday){ return dateStr(monday); }
function fmtWeekLabel(monday){
  const fri = new Date(monday); fri.setDate(monday.getDate()+4);
  const opts = {day:'numeric',month:'short'};
  return monday.toLocaleDateString('en-AU',opts)+' – '+fri.toLocaleDateString('en-AU',opts);
}
function getBudWeekData(key){
  return budgetData[key]||{
    inc_fuji:'',inc_mcd:'',
    sav_amount:'',fix_transport:'',
    var_food:'',var_pub:'',var_personal:'',notes:''
  };
}
function getMonthDate(offset){
  // Anchor to the current week's Monday so the default month matches where the latest
  // week data lives (e.g. if today is Wed Jul 2, Monday was Jun 29 → default month = June).
  const mon=getMondayOf(0);
  return new Date(mon.getFullYear(),mon.getMonth()+offset,1);
}
function getMondaysInMonth(monthDate){
  const year=monthDate.getFullYear(),month=monthDate.getMonth();
  const mondays=[];
  const d=new Date(year,month,1);
  while(d.getDay()!==1) d.setDate(d.getDate()+1); // advance to first Monday
  while(d.getMonth()===month){ mondays.push(dateStr(d)); d.setDate(d.getDate()+7); }
  return mondays;
}
function fmtMonthLabel(d){ return d.toLocaleDateString('en-AU',{month:'long',year:'numeric'}); }

// ── Budget view toggle ────────────────────────────────────────────
function setBudgetView(v){
  budgetView=v;
  const setBtn=(id,active)=>{ const b=document.getElementById(id); if(!b) return;
    b.style.background=active?'var(--card)':'transparent'; b.style.fontWeight=active?'700':'500';
    b.style.color=active?'var(--text)':'var(--muted)'; b.style.boxShadow=active?'0 1px 3px rgba(0,0,0,0.1)':'none'; };
  setBtn('bv-week-btn',v==='week');
  setBtn('bv-month-btn',v==='month');
  setBtn('bv-year-btn',v==='year');
  document.getElementById('budget-week-view').classList.toggle('hidden',v!=='week');
  document.getElementById('budget-month-view').classList.toggle('hidden',v!=='month');
  document.getElementById('budget-year-view').classList.toggle('hidden',v!=='year');
  if(v==='week') renderBudgetTab();
  if(v==='month') renderMonth();
  if(v==='year') renderYear();
}

// ── Week navigation ───────────────────────────────────────────────
function changeWeek(dir){
  if(dir>0&&currentWeekIdx>=0) return;
  budSaveDraft();              // flush the viewed week's inputs before the index changes
  budPastEdit=false;          // lock the next week by default (history is read-only unless unlocked)
  currentWeekIdx+=dir; renderBudgetTab();
}
function changeMonth(dir){
  if(dir>0&&currentMonthOffset>=0) return;
  currentMonthOffset+=dir; renderMonth();
}

// ── One-time data recovery ────────────────────────────────────────
// The accordion/donut redesigns stored each week in one of several shapes:
//   • legacy per-input fields  (inc_fuji / var_food / …)            ← what this tab reads
//   • a dynamic income map     (d.income = {streamId: amount})
//   • aggregate snapshots      (d.snapshot = {income, variable, …}) ← shadows legacy fields
//   • category objects         (d.cats = {groceries, transport, …})
// Crucially the redesigns never DELETED the original per-input fields — they only added
// aggregates on top, and the history readers (weekIncome/weekSpending) prefer those
// aggregates, which is why real data appeared to vanish. This normalises every saved
// week back to the per-input fields and removes the shadowing aggregates so the restored
// tab and the Stats readers both see the user's real numbers. Runs once; idempotent.
// Remove residue of the deleted weekly-savings target from the CURRENT/FUTURE weeks so they
// never auto-show or re-bake the old target (e.g. 300). Past weeks were frozen by
// recoverBudgetData and are left untouched. Returns true if it changed anything.
function scrubSavingsTarget(data){
  if(!data||typeof data!=='object') return false;
  const curWk=(typeof getMondayOf==='function'&&typeof weekKey==='function')?weekKey(getMondayOf(0)):'';
  if(!curWk) return false;
  let changed=false;
  Object.keys(data).forEach(wk=>{
    if(wk<curWk) return; // current + future only; past weeks stay frozen
    const w=data[wk]; if(!w||typeof w!=='object') return;
    if(w.sav_extra!==undefined){ delete w.sav_extra; changed=true; }       // drop old-model marker
    // NOTE: this used to also clear sav_amount whenever it equalled budDefaults.weeklySavings
    // (the old auto-savings TARGET, since removed as a feature). But weeklySavings still
    // lingers in budDefaults (e.g. 200), so that clear treated a user's LEGITIMATE manual
    // entry that happened to equal the target — 200, their own "$200 minimum" goal, the most
    // natural value to type — as stale residue and wiped it. It ran on every boot
    // (recoverBudgetData) and every cloud sync (the budgetData listener, which then wrote the
    // emptied blob back to Firebase), so savings of exactly the target never survived a
    // refresh and never synced. The savings-target feature is gone and current/future weeks
    // now only ever get manually-entered values, so there is nothing legitimate left to scrub.
  });
  return changed;
}
function recoverBudgetData(){
  const raw=localStorage.getItem('daily_budget'); if(!raw) return;
  let data; try{ data=JSON.parse(raw); }catch(e){ return; }
  if(!data||typeof data!=='object') return;
  let changed=false;
  const num=v=>{ const n=parseFloat(v); return isNaN(n)?0:n; };
  // This week's key — only PAST weeks get their old target-based savings frozen.
  const curWk=(typeof getMondayOf==='function'&&typeof weekKey==='function')?weekKey(getMondayOf(0)):'';
  Object.keys(data).forEach(wk=>{
    const w=data[wk]; if(!w||typeof w!=='object') return;
    const has=k=>w[k]!==undefined&&w[k]!==''&&w[k]!==null;

    // ── Income → inc_fuji / inc_mcd / inc_other ──
    if(!has('inc_fuji')&&!has('inc_mcd')&&!has('inc_other')){
      if(w.income&&typeof w.income==='object'){
        const vals=Object.values(w.income).map(num);
        if(vals[0]){ w.inc_fuji=String(vals[0]); changed=true; }
        if(vals[1]){ w.inc_mcd=String(vals[1]); changed=true; }
        const rest=vals.slice(2).reduce((a,v)=>a+v,0);
        if(rest){ w.inc_other=String(rest); changed=true; }
      } else if(w.snapshot&&num(w.snapshot.income)>0){
        // config/donut era only kept a total — preserve it so it isn't lost
        w.inc_fuji=String(num(w.snapshot.income)); changed=true;
      }
    }

    // ── Variable → var_food / var_pub / var_personal ──
    if(!has('var_food')&&!has('var_pub')&&!has('var_personal')){
      if(w.cats&&typeof w.cats==='object'){
        const c=w.cats;
        const food=num(c.groceries)+num(c.eating_out);
        const pub=num(c.entertainment);
        const personal=num(c.personal_care);
        if(food){ w.var_food=String(food); changed=true; }
        if(pub){ w.var_pub=String(pub); changed=true; }
        if(personal){ w.var_personal=String(personal); changed=true; }
        if(!has('fix_transport')&&num(c.transport)){ w.fix_transport=String(num(c.transport)); changed=true; }
      } else if(w.snapshot&&num(w.snapshot.variable)>0){
        // no per-category breakdown available — keep the total under Food so it survives
        w.var_food=String(num(w.snapshot.variable)); changed=true;
      }
    }

    // ── Savings total from snapshot.saved → free-input sav_amount ──
    if(!has('sav_amount')&&w.snapshot&&num(w.snapshot.saved)>0){
      w.sav_amount=String(Math.round(num(w.snapshot.saved))); changed=true;
    }
    // ── Freeze old target-based savings into an explicit amount for PAST weeks, so removing
    //    the weekly-savings target doesn't retroactively change weeks already saved. ──
    if(!has('sav_amount')&&curWk&&wk<curWk&&(has('sav_extra')||w.saved)){
      const oldTarget=(budDefaults&&budDefaults.weeklySavings!=null)?budDefaults.weeklySavings:350;
      w.sav_amount=String(oldTarget+num(w.sav_extra)); changed=true;
    }

    // ── Drop the shadowing aggregates so the legacy readers are the source of truth ──
    if(w.snapshot!==undefined){ delete w.snapshot; changed=true; }
    if(w.cats!==undefined){ delete w.cats; changed=true; }
    if(w.income!==undefined&&typeof w.income==='object'){ delete w.income; changed=true; }
  });
  if(scrubSavingsTarget(data)) changed=true;
  if(changed){
    localStorage.setItem('daily_budget', JSON.stringify(data));
    budgetData=data; // refresh the in-memory copy
    console.log('Budget data recovered and normalised to Fixed/Variable fields.');
  }
}

// ── Render budget tab ─────────────────────────────────────────────
// ── Custom budget categories (add/remove fixed & variable rows) ───
// Category ids match the legacy field suffixes (fine/food/…) so per-week storage
// d['fix_'+id] / d['var_'+id] stays compatible with existing saved weeks.
function loadFixCats(){
  return lsLoad('daily_budget_fix_cats', [
    {id:'fine',      name:'⚖️ Fine repayment',     default:budDefaults.fine??25},
    {id:'subs',      name:'📱 Subscriptions',       default:budDefaults.subs??17},
    {id:'transport', name:'🚌 Transport (Opal)',    default:budDefaults.transport??50},
    {id:'gym',       name:'🏋️ Anytime Fitness',     default:budDefaults.gym??27},
  ], Array.isArray);
}
function saveFixCats(cats){ lsSave('daily_budget_fix_cats', cats, 'budgetFixCats'); }
function loadVarCats(){
  return lsLoad('daily_budget_var_cats', [
    {id:'food',     name:'🍔 Food'},
    {id:'pub',      name:'🍺 Pub & social'},
    {id:'personal', name:'👜 Personal'},
  ], Array.isArray);
}
function saveVarCats(cats){ lsSave('daily_budget_var_cats', cats, 'budgetVarCats'); }
// Income sources — ids match the legacy field suffixes (fuji/mcd) so per-week storage
// d['inc_'+id] stays compatible with existing saved weeks (d.inc_fuji / d.inc_mcd).
function loadIncCats(){
  return lsLoad('daily_budget_inc_cats', [
    {id:'fuji', name:'Fujifilm'},
    {id:'mcd',  name:"McDonald's"},
  ], Array.isArray);
}
function saveIncCats(cats){ lsSave('daily_budget_inc_cats', cats, 'budgetIncCats'); }
function genCatId(prefix){ return prefix+'_'+Date.now(); }

function weekFixedTotal(d){
  let t=0;
  loadFixCats().forEach(c=>{
    const v=d&&d['fix_'+c.id];
    t += (v!==undefined&&v!=='') ? (parseFloat(v)||0) : (parseFloat(c.default)||0);
  });
  return t;
}
function weekVarTotal(d){
  let t=0;
  loadVarCats().forEach(c=>{ t += parseFloat(d&&d['var_'+c.id])||0; });
  return t;
}
// Sum of all fixed-category amounts for a week (same pattern as weekSpending's fixed half).
function weekFixed(d){ return weekFixedTotal(d); }
// Shared chart colours for the budget month/year charts (matches renderBudTrend palette).
const BUD_CHART_COLORS={income:'#1d9e75',variable:'#d85a30',fixed:'#888780',saved:'#378add',rate:'#1d9e75',spending:'#e74c3c'};
// Inline legend pills rendered above a Chart.js canvas (more legible on mobile than
// the built-in legend). items = [{c:'#hex', l:'Label'}, …]
function budChartLegend(items){
  return items.map(it=>'<span class="chart-legend-pill"><span class="chart-legend-dot" style="background:'+it.c+'"></span>'+it.l+'</span>').join('');
}
// Grid + tick colours that adapt to the active theme (same values as renderBudTrend).
function budChartGridColors(){
  const isDark=S.theme==='dark';
  return {gc:isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)', tc:isDark?'#888':'#94a3b8'};
}
const _catEsc=s=>(s||'').replace(/"/g,'&quot;');
const _catEscHtml=s=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// Collapsible section header (shared markup) — collapse handled by the delegated
// .bud-toggle listener + restoreBudgetCollapseState (index-based persistence).
const BUD_CHEVRON='<svg class="bud-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>';
// Per-card edit mode (current week only). When off, add/delete/rename controls are not
// rendered at all — so a stray tap can't delete a category; amounts stay editable always.
const budEditMode = {inc:false, fix:false, var:false};
// A past week temporarily unlocked for backfill editing (e.g. fixing last week's income).
// Reset whenever the viewed week changes so history stays read-only by default.
let budPastEdit = false;
// Collapsible card header with an Edit/Done toggle (current week only). The toggle lives
// inside .bud-toggle but the collapse listener ignores taps on it (see that handler).
function budCardHead(type, label, isCur){
  const editing=budEditMode[type];
  const editBtn = isCur
    ? '<button class="bud-edit-btn'+(editing?' active':'')+'" data-type="'+type+'" data-action="bud-edit-toggle">'+(editing?'Done':'Edit')+'</button>'
    : '';
  return '<div class="sec-label bud-toggle"><span class="bud-head-label">'+label+'</span>'+
    '<span class="bud-head-right">'+editBtn+BUD_CHEVRON+'</span></div>';
}
// In edit mode (current week) category names are editable inputs; otherwise plain labels.
// A brand-new unnamed row also gets an input so it can be named without window.prompt().
function budCatNameHtml(type,c,isCur,editMode){
  if(editMode && isCur){
    return '<input class="bud-cat-name-input" id="catname-'+type+'-'+c.id+'" value="'+_catEsc(c.name||'')+'" placeholder="Name this category…" oninput="budRenameCat(\''+type+'\',\''+c.id+'\',this.value)">';
  }
  if(c.name) return '<div class="bud-row-left"><div class="bud-row-name">'+_catEscHtml(c.name)+'</div></div>';
  return '<input class="bud-cat-name-input" id="catname-'+type+'-'+c.id+'" value="" placeholder="Name this category…" oninput="budRenameCat(\''+type+'\',\''+c.id+'\',this.value)" onchange="renderBudgetTab()"'+(isCur?'':' disabled')+'>';
}
function renderFixedCard(data,isCur){
  const editing=budEditMode.fix && isCur;
  const cats=loadFixCats();
  const rows=cats.map(c=>{
    const raw=data['fix_'+c.id];
    const val=(raw!==undefined&&raw!=='')?raw:(c.default!=null?c.default:'');
    return '<div class="bud-row bud-cat-row" data-cat-id="'+c.id+'">'+
      budCatNameHtml('fix',c,isCur,editing)+
      '<input class="bud-row-input" type="number" inputmode="decimal" id="fix-'+c.id+'" placeholder="$'+(c.default||0)+'" value="'+val+'" oninput="budRecalc();budSaveDraft()"'+(isCur?'':' disabled')+'>'+
      (editing?'<button class="delete-cat-btn" data-type="fix" data-id="'+c.id+'" aria-label="Remove category">×</button>':'')+
    '</div>';
  }).join('');
  return '<div class="card">'+budCardHead('fix','📌 Fixed expenses',isCur)+rows+
    '<div class="bud-row"><div class="bud-row-name" style="font-weight:700">Total fixed</div><div class="bud-row-calc" id="calc-fixed" style="color:var(--muted)">—</div></div>'+
    (editing?'<button class="add-cat-btn" data-type="fix">+ Add fixed expense</button>':'')+
  '</div>';
}
function renderVariableCard(data,isCur){
  const editing=budEditMode.var && isCur;
  const cats=loadVarCats();
  const rows=cats.map(c=>{
    // Show empty placeholder for no/zero spend — never a filled "0"
    const num=parseFloat(data['var_'+c.id]);
    const val=(!isNaN(num)&&num!==0)?data['var_'+c.id]:'';
    return '<div class="bud-row bud-cat-row" data-cat-id="'+c.id+'">'+
      budCatNameHtml('var',c,isCur,editing)+
      '<input class="bud-row-input" type="number" inputmode="decimal" id="var-'+c.id+'" placeholder="$0" value="'+val+'" oninput="budRecalc();budSaveDraft()"'+(isCur?'':' disabled')+'>'+
      (editing?'<button class="delete-cat-btn" data-type="var" data-id="'+c.id+'" aria-label="Remove category">×</button>':'')+
    '</div>';
  }).join('');
  return '<div class="card">'+budCardHead('var','🛒 Variable expenses',isCur)+rows+
    '<div class="bud-row"><div class="bud-row-name" style="font-weight:700">Total variable</div><div class="bud-row-calc" id="calc-variable" style="color:var(--muted)">$0</div></div>'+
    (editing?'<button class="add-cat-btn" data-type="var">+ Add variable expense</button>':'')+
  '</div>';
}
function renderIncomeCard(data,isCur){
  const editing=budEditMode.inc && isCur;
  const cats=loadIncCats();
  const rows=cats.map(c=>{
    const raw=data['inc_'+c.id];
    const val=(raw!==undefined&&raw!=='')?raw:'';
    return '<div class="bud-row bud-cat-row" data-cat-id="'+c.id+'">'+
      budCatNameHtml('inc',c,isCur,editing)+
      '<input class="bud-row-input" type="number" inputmode="decimal" id="inc-'+c.id+'" placeholder="$0" value="'+val+'" oninput="budRecalc();budSaveDraft()"'+(isCur?'':' disabled')+'>'+
      (editing?'<button class="delete-cat-btn" data-type="inc" data-id="'+c.id+'" aria-label="Remove income source">×</button>':'')+
    '</div>';
  }).join('');
  return '<div class="card">'+budCardHead('inc','💵 Income',isCur)+rows+
    '<div class="bud-row"><div class="bud-row-name" style="font-weight:700">Total income</div><div class="bud-row-calc" id="calc-income" style="color:var(--green)">$0</div></div>'+
    (editing?'<button class="add-cat-btn" data-type="inc">+ Add income source</button>':'')+
  '</div>';
}
// Shared loader/saver lookup so add/delete/rename work for all three category types
const BUD_CAT_LOAD={fix:loadFixCats, var:loadVarCats, inc:loadIncCats};
const BUD_CAT_SAVE={fix:saveFixCats, var:saveVarCats, inc:saveIncCats};
function budRenameCat(type,id,val){
  const load=BUD_CAT_LOAD[type], save=BUD_CAT_SAVE[type];
  if(!load) return;
  const cats=load(); const c=cats.find(x=>x.id===id); if(!c) return;
  c.name=val; save(cats); // no re-render: keep input focus while typing
}
// One delegated listener for add / delete category buttons (survives re-renders)
document.addEventListener('click', function(e){
  // Per-card Edit/Done toggle: flush amounts, flip the card's mode, re-render. Names are
  // saved live (budRenameCat oninput) and amounts by budSaveDraft, so Done needs no extra save.
  const editBtn=e.target.closest('[data-action="bud-edit-toggle"]');
  if(editBtn){
    const type=editBtn.dataset.type;
    if(type in budEditMode){
      budSaveDraft();
      budEditMode[type]=!budEditMode[type];
      renderBudgetTab();
    }
    return;
  }
  // Unlock/lock a past week for backfill editing (e.g. fixing a previous week's income).
  const weekEdit=e.target.closest('[data-action="bud-week-edit"]');
  if(weekEdit){
    budSaveDraft();              // flush any edits to the viewed week before flipping the lock
    budPastEdit=!budPastEdit;
    renderBudgetTab();
    return;
  }
  const del=e.target.closest('.delete-cat-btn');
  if(del){
    budSaveDraft();   // flush the week's current input values before the DOM is rebuilt
    const type=del.dataset.type, id=del.dataset.id;
    const load=BUD_CAT_LOAD[type], save=BUD_CAT_SAVE[type];
    if(!load) return;
    save(load().filter(c=>c.id!==id));
    renderBudgetTab();
    return;
  }
  const add=e.target.closest('.add-cat-btn');
  if(add){
    budSaveDraft();   // flush the week's current input values before the DOM is rebuilt
    const type=add.dataset.type;
    const load=BUD_CAT_LOAD[type], save=BUD_CAT_SAVE[type];
    if(!load) return;
    const id=genCatId(type);
    const cat={id,name:''};
    if(type==='fix') cat.default=0;
    const cats=load(); cats.push(cat); save(cats);
    renderBudgetTab();
    setTimeout(()=>document.getElementById('catname-'+type+'-'+id)?.focus(),60);
    return;
  }
});

// Collapsible budget cards: one delegated listener; state persisted by card index
document.addEventListener('click', function(e){
  if(e.target.closest('[data-action="bud-edit-toggle"]')) return; // Edit button isn't a collapse tap
  const toggle=e.target.closest('.bud-toggle');
  if(!toggle) return;
  const card=toggle.closest('.card');
  if(!card) return;
  card.classList.toggle('bud-collapsed');
  saveBudgetCollapseState();
});
function saveBudgetCollapseState(){
  const states=[];
  document.querySelectorAll('#budget-week-view .card').forEach((card,i)=>{ states[i]=card.classList.contains('bud-collapsed'); });
  localStorage.setItem('daily_budget_collapse', JSON.stringify(states));
}
function restoreBudgetCollapseState(){
  try{
    const states=JSON.parse(localStorage.getItem('daily_budget_collapse')||'[]');
    document.querySelectorAll('#budget-week-view .card').forEach((card,i)=>{ if(states[i]) card.classList.add('bud-collapsed'); });
  }catch(e){}
}

function renderBudgetTab(){
  const monday=getMondayOf(currentWeekIdx);
  const key=weekKey(monday);
  const data=getBudWeekData(key);
  const isCur=currentWeekIdx===0;
  if(isCur) budPastEdit=false;          // current week is always editable; clear any past-edit state
  const editable = isCur || budPastEdit; // current week, or a past week the user unlocked

  document.getElementById('week-label-main').textContent=
    isCur?'This week':currentWeekIdx===-1?'Last week':Math.abs(currentWeekIdx)+' weeks ago';
  document.getElementById('week-label-sub').textContent=fmtWeekLabel(monday);
  document.getElementById('week-next-btn').style.opacity=currentWeekIdx>=0?'0.3':'1';

  // Edit-week toggle: only on past weeks (current week is editable already).
  const weekEditBtn=document.getElementById('week-edit-btn');
  if(weekEditBtn){
    weekEditBtn.style.display = isCur ? 'none' : 'inline-block';
    weekEditBtn.textContent = budPastEdit ? '✓ Done editing' : '✎ Edit week';
  }

  // Savings: free per-week amount. New weeks store sav_amount; weeks saved under the old
  // "target + extra" model are shown at their historical total so nothing reads as $0.
  const savEl=document.getElementById('sav-amount');
  if(savEl){
    savEl.value=(data.sav_amount!==undefined&&data.sav_amount!=='')
      ? data.sav_amount
      : '';
    savEl.disabled=!editable; savEl.style.opacity=editable?'1':'0.7';
  }

  // Dynamic income + fixed + variable category cards
  const incWrap=document.getElementById('bud-income-card');
  if(incWrap) incWrap.innerHTML=renderIncomeCard(data,editable);
  const fixWrap=document.getElementById('bud-fixed-card');
  if(fixWrap) fixWrap.innerHTML=renderFixedCard(data,editable);
  const varWrap=document.getElementById('bud-variable-card');
  if(varWrap) varWrap.innerHTML=renderVariableCard(data,editable);

  const notesEl=document.getElementById('week-notes');
  if(notesEl){ notesEl.value=data.notes||''; notesEl.disabled=!editable; }

  const saveBtn=document.getElementById('save-week-btn');
  const saveMsg=document.getElementById('save-week-msg');
  if(saveBtn) saveBtn.style.display=editable?'block':'none';
  if(saveMsg) saveMsg.style.display='none';

  budRecalc(true);
  renderPrevWeeks();
  renderBudgetConfig();
  loadCCInput();
  restoreBudgetCollapseState();
}

// ── Budget config: pay days + weekly savings target (relocated from Settings) ──
// These feed the Home tab (pay-day countdown + budget-left projection) and the
// legacy-week savings fallback. Stored in budDefaults alongside the fixed defaults.
const BUD_DAY_NAMES=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function renderBudgetConfig(){
  const sg=document.getElementById('bud-cfg-savings-goal');
  if(sg) sg.value=budDefaults.savingsGoal??'';
  // One pay-day selector per actual income source (loadIncCats — the list used for weekly
  // entries), so adding/renaming/removing a source updates these automatically.
  const wrap=document.getElementById('bud-payday-rows');
  if(wrap){
    const dayOpts=(cur)=>BUD_DAY_NAMES.map((d,v)=>'<option value="'+v+'"'+(v===cur?' selected':'')+'>'+d+'</option>').join('');
    const cats=loadIncCats();
    wrap.innerHTML = cats.length
      ? cats.map(c=>{
          const name=(c.name||'').trim()||'Income source';
          return '<div class="bud-row">'+
            '<div class="bud-row-left"><div class="bud-row-name">'+_catEscHtml(name)+' pay day</div></div>'+
            '<select class="bud-row-input" id="bud-payday-'+c.id+'" style="width:140px;text-align:left;padding:0 8px;-webkit-appearance:menulist;appearance:menulist" onchange="budSaveConfig()">'+dayOpts(getPayDay(c.id))+'</select>'+
          '</div>';
        }).join('')
      : '<div class="bud-row"><div class="bud-row-left"><div class="bud-row-budget">Add an income source above to set its pay day.</div></div></div>';
  }
}
function budSaveConfig(){
  const sg=document.getElementById('bud-cfg-savings-goal');
  if(sg){ const n=parseFloat(sg.value); budDefaults.savingsGoal = isNaN(n)?undefined:n; }
  // Read every generated pay-day selector back into budDefaults.payDays (keyed by source id).
  loadIncCats().forEach(c=>{
    const el=document.getElementById('bud-payday-'+c.id);
    if(el){ const v=parseInt(el.value); if(!isNaN(v)) setPayDay(c.id, v); }
  });
  localStorage.setItem('daily_budget_defaults', JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();
}

// Savings is a free per-week input (no auto-calc / no lock). The savings goal is SUGGESTIVE
// only — it never fills in an amount, it just colours the savings figure once reached.
const SAVINGS_GOAL = 200; // default when the user hasn't set one
function getSavingsGoal(){ const g=parseFloat(budDefaults&&budDefaults.savingsGoal); return isNaN(g)?SAVINGS_GOAL:g; }
function savingsColor(amt){
  const goal=getSavingsGoal();
  if(amt>=goal) return 'var(--positive)';   // met the goal
  if(amt>0)            return 'var(--accent)';       // saved something, below goal
  return 'var(--muted)';                             // nothing saved
}
function countUp(el, target, duration){
  if(!el || isNaN(target)) return;
  duration = duration || 600;
  const start = performance.now();
  function step(now){
    const p = Math.min((now-start)/duration, 1);
    const ease = 1 - Math.pow(1-p, 3);
    el.textContent = '$' + Math.round(target * ease).toLocaleString();
    if(p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function budRecalc(animate){
  const v=id=>parseFloat(document.getElementById(id)?.value)||0;
  let totalIncome=0;
  loadIncCats().forEach(c=>{ totalIncome += parseFloat(document.getElementById('inc-'+c.id)?.value)||0; });

  // Dynamic fixed + variable totals (sum across the user's custom categories)
  let totalFixed=0;
  loadFixCats().forEach(c=>{ totalFixed += parseFloat(document.getElementById('fix-'+c.id)?.value)||0; });
  let totalVar=0;
  loadVarCats().forEach(c=>{ totalVar += parseFloat(document.getElementById('var-'+c.id)?.value)||0; });

  // Savings is a free per-week amount (no fixed target); $200 is a display-only goal.
  const totalSaved  = parseFloat(document.getElementById('sav-amount')?.value)||0;
  const totalOut    = totalSaved+totalFixed+totalVar;
  const leftover    = totalIncome>0?totalIncome-totalOut:null;

  const $ = (id,t) => { const el=document.getElementById(id); if(el) el.textContent=t; };
  $('calc-income',  totalIncome>0?'$'+totalIncome.toFixed(0):'—');
  $('calc-saved',   '$'+totalSaved.toFixed(0));
  $('calc-fixed',   '$'+totalFixed.toFixed(0));
  $('calc-variable',totalVar>0?'$'+totalVar.toFixed(0):'—');
  $('calc-leftover',leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'—');

  // Suggestive savings goal: below it → red, met → blue
  const calcSavedEl=document.getElementById('calc-saved');
  if(calcSavedEl) calcSavedEl.style.color = totalSaved>=getSavingsGoal() ? 'var(--blue)' : 'var(--danger)';

  const pill=document.getElementById('week-status-pill');
  if(pill){
    if(leftover===null){pill.className='status-pill good';pill.textContent='⏳ Enter income';}
    else if(leftover>=50){pill.className='status-pill good';pill.textContent='🟢 On track';}
    else if(leftover>=0){pill.className='status-pill warn';pill.textContent='🟡 Tight week';}
    else{pill.className='status-pill over';pill.textContent='🔴 Over budget';}
  }

  // Hero summary card
  $('bud-hero-income',  totalIncome>0?'$'+totalIncome.toFixed(0):'$0');
  $('bud-hero-saved',   '$'+totalSaved.toFixed(0));
  $('bud-hero-leftover',leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'—');
  const ccDebt=parseFloat(loadCCData().balance)||0;
  const latestSavBal=savingsLog.length?parseFloat(savingsLog[savingsLog.length-1].balance)||0:0;
  const netSav=latestSavBal-ccDebt;
  $('bud-hero-cc', '$'+ccDebt.toFixed(0));
  $('bud-hero-net', (latestSavBal>0||ccDebt>0)?((netSav>=0?'+$':'-$')+Math.abs(netSav).toFixed(0)):'—');
  if(animate){
    const _el=id=>document.getElementById(id);
    if(totalIncome>0) countUp(_el('bud-hero-income'), totalIncome);
    countUp(_el('bud-hero-saved'), totalSaved);
    countUp(_el('bud-hero-cc'), ccDebt);
  }
  const heroPill=document.getElementById('week-status-pill-hero');
  if(heroPill){
    heroPill.textContent = leftover===null ? 'Enter income' : (leftover>=0 ? '✓ On track' : '⚠ Over budget');
    heroPill.style.background = (leftover!==null&&leftover<0) ? 'rgba(231,76,60,.5)' : 'rgba(255,255,255,.2)';
  }

  const barEl=document.getElementById('budget-bar');     // white fill on the hero gradient
  const barL=document.getElementById('budget-bar-label-l');
  const barR=document.getElementById('budget-bar-label-r');
  if(totalIncome>0){
    const pct=Math.min(110,Math.round(totalOut/totalIncome*100));
    if(barEl){
      if(animate){
        barEl.classList.remove('budget-hero-bar-fill-animate');
        barEl.style.width='0%'; barEl.offsetWidth;
        barEl.classList.add('budget-hero-bar-fill-animate');
        const _tgt=Math.min(100,pct)+'%';
        requestAnimationFrame(()=>{ barEl.classList.remove('budget-hero-bar-fill-animate'); barEl.style.transition='width 0.65s cubic-bezier(0.22,0.61,0.36,1)'; barEl.style.width=_tgt; });
      } else { barEl.style.width=Math.min(100,pct)+'%'; }
    }
    if(barL) barL.textContent='$'+totalOut.toFixed(0)+' spent';
    if(barR) barR.textContent=pct+'% of income';
  } else {
    if(barEl) barEl.style.width='0%';
    if(barL) barL.textContent='Enter income to see breakdown';
    if(barR) barR.textContent='';
  }
}

// Write the per-week editable fields from the DOM into a week record.
//
// CRITICAL: sav-amount and week-notes live in STATIC html — they're always in the DOM,
// even when the Budget tab isn't the active view. The inc/fix/var inputs, by contrast, are
// rendered dynamically and only exist while the tab is on screen (hence their `if(el)`
// guard). Without a matching guard, a save that fires while another tab is showing would
// read the STALE static input — e.g. an empty sav-amount left over from before a cloud sync
// updated budgetData in the background — and
// write that empty value back with a fresh updatedAt, which then wins every merge and wipes
// the real saved amount locally AND on every other device. This is why savings (and only
// savings) kept vanishing on refresh and refused to sync. So only capture the two static
// fields when the Budget tab is the live, rendered view; otherwise preserve budgetData's
// existing values. (renderBudgetTab keeps these inputs in sync with budgetData whenever the
// tab is active — including on incoming cloud echoes — so "budget is the view" == "fresh".)
function budWriteFields(d){
  const gv=id=>document.getElementById(id)?.value||'';
  if(S.view==='budget'){
    d.sav_amount = gv('sav-amount');
    d.notes      = gv('week-notes');
  }
  loadIncCats().forEach(c=>{ const el=document.getElementById('inc-'+c.id); if(el) d['inc_'+c.id]=el.value||''; });
  loadFixCats().forEach(c=>{ const el=document.getElementById('fix-'+c.id); if(el) d['fix_'+c.id]=el.value||''; });
  loadVarCats().forEach(c=>{ const el=document.getElementById('var-'+c.id); if(el) d['var_'+c.id]=el.value||''; });
}
function budSaveDraft(){
  // Current week always auto-persists; a past week persists only while unlocked for editing.
  if(currentWeekIdx !== 0 && !budPastEdit) return;
  const key=weekKey(getMondayOf(currentWeekIdx)); // write to the VIEWED week, not always "this" week
  if(!budgetData[key]) budgetData[key]={};
  const d=budgetData[key];
  const before=JSON.stringify(d);
  budWriteFields(d);
  if(!d.saved) d.draft=true;
  // Only a REAL change stamps and syncs. Draft flushes also fire on render/week-nav with
  // untouched inputs — stamping those would let a device with stale data pass it off as
  // the freshest copy just by being opened.
  if(JSON.stringify(d)===before) return;
  d.updatedAt=Date.now();
  budSaveData(key);
}

function budSaveCurrentWeek(){
  const monday=getMondayOf(currentWeekIdx);
  const key=weekKey(monday);
  if(!budgetData[key]) budgetData[key]={};
  const d=budgetData[key];
  budWriteFields(d);
  d.saved=true; delete d.draft;
  d.updatedAt=Date.now(); // explicit user save — always stamp
  budSaveData(key); renderPrevWeeks(); updateNavBadges();
}

function budSaveWeekExplicit(){
  budSaveCurrentWeek();
  const btn=document.getElementById('save-week-btn');
  const msg=document.getElementById('save-week-msg');
  if(btn){btn.textContent='✓ Saved!';btn.style.background='var(--accent)';}
  if(msg) msg.style.display='block';
  setTimeout(()=>{
    if(btn){btn.textContent='Save week';btn.style.background='';}
    if(msg) msg.style.display='none';
  },1800);
}


function _applyCardCollapse(id, collapse){
  const card=document.getElementById(id); if(!card) return;
  const body=document.getElementById(id+'-body');
  if(!body){ if(collapse) card.classList.add('collapsed'); else card.classList.remove('collapsed'); return; }
  if(collapse){
    card.classList.add('collapsed');
    body.style.height=body.scrollHeight+'px';
    body.style.overflow='hidden';
    setTimeout(()=>{
      body.style.transition='height 0.3s ease,opacity 0.25s ease';
      body.style.height='0';
      body.style.opacity='0';
    }, 16);
  } else {
    card.classList.remove('collapsed');
    body.style.transition='height 0.3s ease,opacity 0.25s ease';
    body.style.height=body.scrollHeight+'px';
    body.style.opacity='';
    body.addEventListener('transitionend',()=>{ body.style.height=''; body.style.transition=''; },{ once:true });
  }
}
function toggleCard(id){
  const card=document.getElementById(id); if(!card) return;
  const isCollapsed=!card.classList.contains('collapsed');
  _applyCardCollapse(id, isCollapsed);
  let collapsed; try{ collapsed=JSON.parse(localStorage.getItem('daily_collapsed')||'{}'); }catch(e){ collapsed={}; }
  if(isCollapsed) collapsed[id]=true; else delete collapsed[id];
  localStorage.setItem('daily_collapsed',JSON.stringify(collapsed));
}
function restoreCardCollapse(){
  let collapsed; try{ collapsed=JSON.parse(localStorage.getItem('daily_collapsed')||'{}'); }catch(e){ collapsed={}; }
  Object.keys(collapsed).forEach(id=>{
    const card=document.getElementById(id); if(!card) return;
    card.classList.add('collapsed');
    const body=document.getElementById(id+'-body');
    if(body){ body.style.height='0'; body.style.opacity='0'; body.style.overflow='hidden'; }
  });
}

function renderPrevWeeks(){
  const wrap=document.getElementById('prev-weeks-section'); if(!wrap) return;
  const curKey=weekKey(getMondayOf(currentWeekIdx));
  const keys=Object.keys(budgetData).filter(k=>k<curKey).sort((a,b)=>b.localeCompare(a)).slice(0,8);
  if(!keys.length){wrap.innerHTML=emptyState('📋','No previous weeks','Your saved weeks will appear here');return;}
  const chevron='<svg class="card-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
  let html='<div class="card" id="bud-card-prev"><div class="card-collapse-header" onclick="toggleCard(\'bud-card-prev\')"><div class="sec-label" style="margin-bottom:0">Previous weeks</div><div class="card-collapse-right">'+chevron+'</div></div><div class="card-collapse-body" id="bud-card-prev-body" style="padding-top:6px">';
  keys.forEach(k=>{
    const d=budgetData[k];
    const inc=weekIncome(d);
    const saved=weekSavedAmt(d);
    const left=inc>0?weekLeftover(d):null;
    const mon=new Date(k+'T12:00:00');
    const fri=new Date(mon); fri.setDate(mon.getDate()+4);
    const lbl=mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' – '+fri.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
    html+='<div class="prev-week-row"><div class="prev-week-date">'+lbl+'</div><div class="prev-week-pills">';
    if(inc>0) html+='<span class="prev-pill in">$'+inc.toFixed(0)+' in</span>';
    html+='<span class="prev-pill saved">$'+saved.toFixed(0)+' saved</span>';
    if(left!==null) html+='<span class="prev-pill '+(left>=0?'left':'over')+'">'+(left>=0?'+':'-')+'$'+Math.abs(left).toFixed(0)+'</span>';
    html+='</div></div>';
  });
  html+='</div></div></div>';
  wrap.innerHTML=html;
}

function renderMonth(){
  const monthDate=getMonthDate(currentMonthOffset);
  const isCur=currentMonthOffset>=0;
  document.getElementById('month-label-main').textContent=fmtMonthLabel(monthDate);
  document.getElementById('month-next-btn').style.opacity=isCur?'0.3':'1';
  const keys=getMondaysInMonth(monthDate);
  let totalIncome=0,totalSaved=0,totalSpending=0,weekCount=0;
  keys.forEach(k=>{
    const d=budgetData[k]; if(!d) return; weekCount++;
    totalIncome+=weekIncome(d);
    totalSaved+=weekSavedAmt(d);
    totalSpending+=weekSpending(d);
  });
  const totalOut=totalSaved+totalSpending;
  const leftover=totalIncome>0?totalIncome-totalOut:null;

  document.getElementById('month-label-sub').textContent=weekCount>0?weekCount+' week'+(weekCount>1?'s':'')+' recorded':'No data saved yet';

  const sg=document.getElementById('month-summary-grid');
  if(sg){
    const ccBalance=parseFloat(loadCCData().balance)||0;
    const savRate=totalIncome>0?(totalSaved/totalIncome*100).toFixed(0)+'%':'—';
    sg.innerHTML=[
      {val:savRate,lbl:'Savings rate',color:BUD_CHART_COLORS.income},
      {val:weekCount>0?'$'+totalSaved.toFixed(0):'—',lbl:'Saved',color:BUD_CHART_COLORS.saved},
      {val:'$'+ccBalance.toFixed(0),lbl:'CC balance',color:BUD_CHART_COLORS.variable},
    ].map(s=>'<div class="sum-card"><div class="sum-card-val" style="color:'+s.color+'">'+s.val+'</div><div class="sum-card-lbl">'+s.lbl+'</div></div>').join('');
  }

  const barEl=document.getElementById('month-bar');
  const barL=document.getElementById('month-bar-label-l');
  const barR=document.getElementById('month-bar-label-r');
  if(totalIncome>0){
    const pct=Math.min(110,Math.round(totalOut/totalIncome*100));
    const bc=pct>100?'var(--danger)':pct>85?'var(--warn)':'var(--success)';
    if(barEl){barEl.style.width=Math.min(100,pct)+'%';barEl.style.background=bc;}
    if(barL) barL.textContent='$'+totalOut.toFixed(0)+' spent';
    if(barR) barR.textContent=pct+'% of income';
  } else {
    if(barEl) barEl.style.width='0%';
    if(barL) barL.textContent=weekCount>0?'Enter income to see breakdown':'No weeks saved for this month';
    if(barR) barR.textContent='';
  }

  const catEl=document.getElementById('month-categories');
  if(catEl){
    const MONTH_CAT_COLORS=['#52B788','#f59e0b','#6366f1','#3b82f6','#ec4899','#8b5cf6','#FF6B35','#14b8a6'];
    const catTotals=loadVarCats().map((c,i)=>({
      label:c.name||'Untitled',
      val:keys.reduce((s,k)=>s+(parseFloat(budgetData[k]?.['var_'+c.id])||0),0),
      color:MONTH_CAT_COLORS[i%MONTH_CAT_COLORS.length]
    }));
    const maxVal=Math.max(1,...catTotals.map(c=>c.val));
    catEl.innerHTML=catTotals.length?catTotals.map(c=>{
      const pct=Math.round(c.val/maxVal*100);
      return '<div class="month-cat-row"><div class="month-cat-label">'+c.label+'</div>'
        +'<div class="month-cat-bar-wrap"><div class="month-cat-bar-fill" style="width:'+pct+'%;background:'+c.color+'"></div></div>'
        +'<div class="month-cat-amount">'+(c.val>0?'$'+c.val.toFixed(0):'—')+'</div></div>';
    }).join(''):'<div style="font-size:13px;color:var(--muted);text-align:center;padding:8px 0">No variable categories</div>';
  }

  const wl=document.getElementById('month-weeks-list');
  if(monthWeekChart){ monthWeekChart.destroy(); monthWeekChart=null; }
  if(wl){
    if(!keys.length){
      wl.innerHTML=emptyState('📅','No weeks in this month','Navigate to a month with budget data');
    } else {
      const labels=keys.map(k=>{
        const mon=new Date(k+'T12:00:00');
        return mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
      });
      const data=keys.map(k=>budgetData[k]);
      const legend=budChartLegend([
        {c:BUD_CHART_COLORS.income,l:'Income'},
        {c:BUD_CHART_COLORS.variable,l:'CC / variable'},
        {c:BUD_CHART_COLORS.fixed,l:'Fixed'},
        {c:BUD_CHART_COLORS.saved,l:'Saved'},
      ]);
      wl.innerHTML='<div class="chart-legend">'+legend+'</div><div id="month-weeks-chart-wrap" style="height:220px"><canvas id="month-weeks-chart"></canvas></div>';
      const ctx=document.getElementById('month-weeks-chart');
      const {gc,tc}=budChartGridColors();
      monthWeekChart=new Chart(ctx,{
        type:'bar',
        data:{
          labels,
          datasets:[
            {label:'Income',data:data.map(weekIncome),backgroundColor:BUD_CHART_COLORS.income,borderRadius:3},
            {label:'CC / variable',data:data.map(weekVarTotal),backgroundColor:BUD_CHART_COLORS.variable,borderRadius:3},
            {label:'Fixed',data:data.map(weekFixed),backgroundColor:BUD_CHART_COLORS.fixed,borderRadius:3},
            {label:'Saved',data:data.map(weekSavedAmt),backgroundColor:BUD_CHART_COLORS.saved,borderRadius:3},
          ]
        },
        options:{
          responsive:true,maintainAspectRatio:false,
          plugins:{
            legend:{display:false},
            tooltip:{callbacks:{label:c=>c.dataset.label+': $'+c.parsed.y.toFixed(0)}}
          },
          scales:{
            x:{grid:{display:false},ticks:{color:tc,font:{size:11}}},
            y:{grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>'$'+v},beginAtZero:true}
          }
        }
      });
    }
  }
}

// ── Yearly budget view ────────────────────────────────────────────
function renderYear(){
  const points=getBudTrendPoints('monthly');

  // Fixed + variable spend per month, grouped with the SAME key/cutoff as
  // getBudTrendPoints('monthly') so the arrays line up 1:1 with `points`.
  const cutoff=localMidnight(getLocalDate());
  cutoff.setDate(1); cutoff.setMonth(cutoff.getMonth()-11);
  const cutoffYM=dateStr(cutoff).substring(0,7);
  const byMonth={};
  Object.keys(budgetData).sort().forEach(k=>{
    const ym=k.substring(0,7); if(ym<cutoffYM) return;
    const d=budgetData[k]; if(!d) return;
    if(!byMonth[ym]) byMonth[ym]={fixed:0,variable:0};
    byMonth[ym].fixed+=weekFixed(d);
    byMonth[ym].variable+=weekVarTotal(d);
  });
  const orderedYM=Object.keys(byMonth).sort();
  const fixedArr=orderedYM.map(ym=>byMonth[ym].fixed);
  const varArr=orderedYM.map(ym=>byMonth[ym].variable);
  const rateArr=points.map(p=>p.income>0?(p.saved/p.income*100):0);

  // ── Stat tiles ──
  const sg=document.getElementById('year-summary-grid');
  if(sg){
    // Savings-rate trend: latest month vs 3 months ago
    let trendVal='—', trendColor='var(--muted)';
    if(rateArr.length>=4){
      const diff=rateArr[rateArr.length-1]-rateArr[rateArr.length-4];
      if(diff>=0){ trendVal='↑ '+diff.toFixed(0)+'%'; trendColor=BUD_CHART_COLORS.income; }
      else      { trendVal='↓ '+Math.abs(diff).toFixed(0)+'%'; trendColor='var(--danger)'; }
    }
    // Saved across the current calendar year
    const curYear=String(localMidnight(getLocalDate()).getFullYear());
    let savedThisYear=0;
    Object.keys(budgetData).forEach(k=>{ if(k.substring(0,4)===curYear) savedThisYear+=weekSavedAmt(budgetData[k]); });
    sg.innerHTML=[
      {val:trendVal,lbl:'Savings rate trend',color:trendColor},
      {val:'$'+savedThisYear.toFixed(0),lbl:'Saved this year',color:BUD_CHART_COLORS.saved},
    ].map(s=>'<div class="sum-card"><div class="sum-card-val" style="color:'+s.color+'">'+s.val+'</div><div class="sum-card-lbl">'+s.lbl+'</div></div>').join('');
  }

  // ── Stacked bar + savings-rate line ──
  if(yearStackChart){ yearStackChart.destroy(); yearStackChart=null; }
  const stackWrap=document.getElementById('year-stack-wrap');
  const stackLegend=document.getElementById('year-stack-legend');
  const {gc,tc}=budChartGridColors();
  if(stackWrap){
    if(points.length<2){
      stackWrap.innerHTML='<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px 0">Not enough data yet.</div>';
      if(stackLegend) stackLegend.innerHTML='';
    } else {
      if(stackLegend) stackLegend.innerHTML=budChartLegend([
        {c:BUD_CHART_COLORS.fixed,l:'Fixed'},
        {c:BUD_CHART_COLORS.variable,l:'CC / variable'},
        {c:BUD_CHART_COLORS.saved,l:'Saved'},
        {c:BUD_CHART_COLORS.rate,l:'Savings rate %'},
      ]);
      stackWrap.style.height='280px';
      stackWrap.innerHTML='<canvas id="year-stack-chart"></canvas>';
      yearStackChart=new Chart(document.getElementById('year-stack-chart'),{
        type:'bar',
        data:{
          labels:points.map(p=>p.label),
          datasets:[
            {label:'Fixed',data:fixedArr,backgroundColor:BUD_CHART_COLORS.fixed,stack:'s'},
            {label:'CC / variable',data:varArr,backgroundColor:BUD_CHART_COLORS.variable,stack:'s'},
            {label:'Saved',data:points.map(p=>p.saved),backgroundColor:BUD_CHART_COLORS.saved,stack:'s',borderRadius:{topLeft:4,topRight:4}},
            {label:'Savings rate',data:rateArr,type:'line',yAxisID:'y2',borderColor:BUD_CHART_COLORS.rate,backgroundColor:BUD_CHART_COLORS.rate,borderWidth:2.5,pointRadius:4,pointBackgroundColor:BUD_CHART_COLORS.rate,tension:0.3,fill:false}
          ]
        },
        options:{
          responsive:true,maintainAspectRatio:false,
          plugins:{
            legend:{display:false},
            tooltip:{callbacks:{label:c=>c.dataset.label==='Savings rate'?c.dataset.label+': '+c.parsed.y.toFixed(0)+'%':c.dataset.label+': $'+c.parsed.y.toFixed(0)}}
          },
          scales:{
            x:{stacked:true,grid:{display:false},ticks:{color:tc,font:{size:11},maxTicksLimit:12}},
            y:{stacked:true,grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>'$'+v},beginAtZero:true},
            y2:{position:'right',min:0,max:50,grid:{display:false},ticks:{color:BUD_CHART_COLORS.rate,font:{size:11},callback:v=>v+'%'}}
          }
        }
      });
    }
  }

  // ── Monthly CC / variable spending line ──
  if(yearCCChart){ yearCCChart.destroy(); yearCCChart=null; }
  const ccWrap=document.getElementById('year-cc-wrap');
  const ccLegend=document.getElementById('year-cc-legend');
  if(ccWrap){
    if(points.length<2){
      ccWrap.innerHTML='<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px 0">Not enough data yet.</div>';
      if(ccLegend) ccLegend.innerHTML='';
    } else {
      if(ccLegend) ccLegend.innerHTML=budChartLegend([{c:BUD_CHART_COLORS.variable,l:'CC / variable spending'}]);
      ccWrap.style.height='200px';
      ccWrap.innerHTML='<canvas id="year-cc-chart"></canvas>';
      yearCCChart=new Chart(document.getElementById('year-cc-chart'),{
        type:'line',
        data:{
          labels:points.map(p=>p.label),
          datasets:[
            {label:'CC / variable spending',data:varArr,borderColor:BUD_CHART_COLORS.variable,backgroundColor:'rgba(216,90,48,0.12)',borderWidth:2.5,pointRadius:3,pointBackgroundColor:BUD_CHART_COLORS.variable,fill:true,tension:0.3}
          ]
        },
        options:{
          responsive:true,maintainAspectRatio:false,
          plugins:{
            legend:{display:false},
            tooltip:{callbacks:{label:c=>'$'+c.parsed.y.toFixed(0)}}
          },
          scales:{
            x:{grid:{display:false},ticks:{color:tc,font:{size:11},maxTicksLimit:12}},
            y:{grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>'$'+v},beginAtZero:true}
          }
        }
      });
    }
  }
}

// ── Budget trends ─────────────────────────────────────────────────
function getBudWeekTotals(d){
  return {income:weekIncome(d), spending:weekSpending(d), saved:weekSavedAmt(d)};
}
function getBudTrendPoints(range){
  const groups={};
  const allKeys=Object.keys(budgetData).sort();
  let filteredKeys=allKeys;
  if(range==='monthly'){
    const cutoff=localMidnight(getLocalDate());
    cutoff.setDate(1);
    cutoff.setMonth(cutoff.getMonth()-11);
    const cutoffYM=dateStr(cutoff).substring(0,7);
    filteredKeys=allKeys.filter(k=>k.substring(0,7)>=cutoffYM);
  }
  filteredKeys.forEach(k=>{
    const d=budgetData[k]; if(!d) return;
    const mon=new Date(k+'T12:00:00');
    const groupKey=range==='yearly'?String(mon.getFullYear()):k.substring(0,7);
    if(!groups[groupKey]) groups[groupKey]={income:0,spending:0,saved:0};
    const t=getBudWeekTotals(d);
    groups[groupKey].income+=t.income;
    groups[groupKey].spending+=t.spending;
    groups[groupKey].saved+=t.saved;
  });
  const sortedLog=[...savingsLog].sort((a,b)=>a.date<b.date?-1:1);
  return Object.keys(groups).sort().map(k=>{
    const label=range==='yearly'?k:(([y,m])=>
      new Date(parseInt(y),parseInt(m)-1,1).toLocaleDateString('en-AU',{month:'short',year:'2-digit'})
    )(k.split('-'));
    const relevant=sortedLog.filter(e=>(range==='yearly'?e.date.substring(0,4):e.date.substring(0,7))<=k);
    const balance=relevant.length?relevant[relevant.length-1].balance:null;
    return {label,...groups[k],balance};
  });
}
function setBudTrendRange(range){
  budTrendRange=range;
  ['monthly','yearly','alltime'].forEach(r=>{
    const btn=document.getElementById('btr-'+r); if(!btn) return;
    btn.style.background=r===range?'var(--header)':'transparent';
    btn.style.color=r===range?'#fff':'var(--muted)';
  });
  renderBudTrend();
}
function renderBudTrend(){
  const wrap=document.getElementById('bud-trend-wrap'); if(!wrap) return;
  if(budChart){budChart.destroy();budChart=null;}
  const points=getBudTrendPoints(budTrendRange);
  if(points.length<2){
    wrap.innerHTML='<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px 0">Not enough data yet.</div>';
    return;
  }
  wrap.innerHTML='<canvas id="bud-trend-chart"></canvas>';
  const ctx=document.getElementById('bud-trend-chart'); if(!ctx) return;
  const {gc,tc}=budChartGridColors();
  budChart=new Chart(ctx,{
    type:'line',
    data:{
      labels:points.map(p=>p.label),
      datasets:[
        {label:'Income',data:points.map(p=>p.income),borderColor:BUD_CHART_COLORS.income,backgroundColor:'rgba(29,158,117,0.08)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:BUD_CHART_COLORS.income,fill:false,tension:0.3},
        {label:'Spending',data:points.map(p=>p.spending),borderColor:BUD_CHART_COLORS.spending,backgroundColor:'rgba(231,76,60,0.08)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:BUD_CHART_COLORS.spending,fill:false,tension:0.3},
        {label:'Saved',data:points.map(p=>p.saved),borderColor:BUD_CHART_COLORS.saved,backgroundColor:'rgba(55,138,221,0.08)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:BUD_CHART_COLORS.saved,fill:false,tension:0.3},
        {label:'Account',data:points.map(p=>p.balance),borderColor:'#94a3b8',backgroundColor:'transparent',borderWidth:2,pointRadius:3,pointBackgroundColor:'#94a3b8',fill:false,tension:0.3,spanGaps:false,borderDash:[5,4]}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:true,
      plugins:{
        legend:{display:true,labels:{color:tc,font:{size:12},usePointStyle:true,pointStyleWidth:10}},
        tooltip:{callbacks:{label:c=>c.dataset.label+': $'+c.parsed.y.toFixed(0)}}
      },
      scales:{
        x:{grid:{color:gc},ticks:{color:tc,font:{size:11},maxTicksLimit:8}},
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>'$'+v},beginAtZero:true}
      }
    }
  });
}

// ── Savings account card ──────────────────────────────────────────
function renderSavingsCard(){
  const wrap=document.getElementById('bud-savings-card-wrap'); if(!wrap) return;
  const today=getLocalDate();
  const sorted=[...savingsLog].sort((a,b)=>a.date<b.date?-1:1);
  const cur=sorted.length?sorted[sorted.length-1]:null;
  wrap.innerHTML=`<div class="card">
    <div class="sec-label" style="margin-bottom:12px">🏦 Savings account</div>
    <div style="display:flex;gap:8px;margin-bottom:12px;align-items:stretch">
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <input type="date" id="sav-log-date" value="${today}"
          style="width:100%;height:40px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;padding:0 10px;background:var(--card);color:var(--text)">
        <input type="number" id="sav-log-bal" inputmode="decimal" min="0" step="0.01" placeholder="Balance ($)"
          style="width:100%;height:40px;border:1.5px solid var(--border);border-radius:8px;font-size:18px;font-weight:500;text-align:center;background:var(--card);color:var(--text)">
      </div>
      <button onclick="logSavingsBalance()"
        style="padding:0 18px;background:var(--header);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Log</button>
    </div>
    ${cur?`<div style="margin-bottom:10px">
      <div style="font-size:28px;font-weight:800">$${cur.balance.toLocaleString()}</div>
      <div style="font-size:12px;color:var(--muted)">Logged ${cur.date}</div>
    </div>`:''}
    ${sorted.length?`<div style="max-height:160px;overflow-y:auto">
      ${[...sorted].reverse().map(e=>`
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;color:var(--muted)">${e.date}</span>
          <span style="font-size:14px;font-weight:600">$${e.balance.toLocaleString()}</span>
          <button onclick="deleteSavingsEntry('${e.date}')" style="font-size:12px;color:var(--danger);background:none;border:none;cursor:pointer;padding:0 4px">✕</button>
        </div>`).join('')}
    </div>`:'<div style="text-align:center;color:var(--muted);font-size:13px;padding:8px 0">No entries yet — log your balance above</div>'}
  </div>`;
}
function logSavingsBalance(){
  const dateEl=document.getElementById('sav-log-date');
  const balEl=document.getElementById('sav-log-bal');
  const bal=parseFloat(balEl.value);
  const date=dateEl.value;
  if(!bal||!date) return;
  savingsLog=savingsLog.filter(e=>e.date!==date);
  savingsLog.push({date,balance:bal,t:Date.now()}); // t lets this win the newest-per-date merge
  savingsLog.sort((a,b)=>a.date<b.date?-1:1);
  saveSavingsLog();
  balEl.value='';
  renderSavingsCard();
  if(statsSubTab==='finance'){ renderBSBalance(); renderBSTrend(); }
}
function deleteSavingsEntry(date){
  savingsLog=savingsLog.filter(e=>e.date!==date);
  saveSavingsLog();
  renderSavingsCard();
  if(statsSubTab==='finance'){ renderBSBalance(); renderBSTrend(); }
}

// ── Savings goals card ────────────────────────────────────────────
function renderGoalsCard(){
  const wrap=document.getElementById('bud-goals-card-wrap'); if(!wrap) return;
  const goals=budDefaults.goals||[];
  const sortedLog=[...savingsLog].sort((a,b)=>a.date<b.date?-1:1);
  const curBal=sortedLog.length?sortedLog[sortedLog.length-1].balance:0;
  const goalsHTML=goals.map((g,i)=>{
    const pct=g.target>0?Math.min(100,Math.round(curBal/g.target*100)):0;
    const remaining=Math.max(0,g.target-curBal);
    const bc=pct>=100?'var(--success)':pct>=50?'var(--warn)':'#3b82f6';
    const weeksLeft=Math.max(0,(new Date(g.date+'T12:00:00')-new Date())/(7*864e5));
    const weeklyNeeded=weeksLeft>0&&remaining>0?'$'+Math.ceil(remaining/weeksLeft).toLocaleString()+'/wk needed':null;
    return `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-size:15px;font-weight:700">${g.name}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--muted)">$${g.target.toLocaleString()} by ${g.date}</span>
          <button onclick="deleteGoal(${i})" style="font-size:12px;color:var(--danger);background:none;border:none;cursor:pointer;padding:0">✕</button>
        </div>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:6px">
        <div style="width:${pct}%;height:100%;background:${bc};border-radius:3px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">
        <span>${pct}%${curBal>0?' ($'+curBal.toLocaleString()+')':''}</span>
        <span>${pct>=100?'🎉 Reached!':(remaining>0?'$'+remaining.toLocaleString()+' to go':'')+(weeklyNeeded?' · '+weeklyNeeded:'')}</span>
      </div>
    </div>`;
  }).join('');
  wrap.innerHTML=`<div class="card">
    <div class="sec-label" style="margin-bottom:12px">🎯 Savings goals</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${goals.length?'4px':'0'}">
      <input type="text" id="goal-name" placeholder="Goal name" style="flex:1 1 100px;min-width:0;max-width:100%;box-sizing:border-box;height:38px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;padding:0 8px;background:var(--card);color:var(--text)">
      <input type="number" id="goal-target" inputmode="decimal" placeholder="$ Target" style="flex:1 1 70px;min-width:0;max-width:100%;box-sizing:border-box;height:38px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;text-align:center;background:var(--card);color:var(--text)">
      <input type="date" id="goal-date" style="flex:1 1 110px;min-width:0;max-width:100%;box-sizing:border-box;height:38px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;padding:0 6px;background:var(--card);color:var(--text)">
      <button onclick="addGoal()" style="flex-shrink:0;padding:0 14px;height:38px;background:var(--header);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Add</button>
    </div>
    ${goals.length?goalsHTML:'<div style="text-align:center;color:var(--muted);font-size:13px;padding:12px 0">Add a goal above</div>'}
  </div>`;
}
function addGoal(){
  const name=document.getElementById('goal-name')?.value.trim();
  const target=parseFloat(document.getElementById('goal-target')?.value);
  const date=document.getElementById('goal-date')?.value;
  if(!name||!target||!date) return;
  if(!budDefaults.goals) budDefaults.goals=[];
  budDefaults.goals.push({name,target,date});
  localStorage.setItem('daily_budget_defaults',JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();
  renderGoalsCard();
}
function deleteGoal(i){
  budDefaults.goals=(budDefaults.goals||[]).filter((_,idx)=>idx!==i);
  localStorage.setItem('daily_budget_defaults',JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();
  renderBSGoals();
}

// ── Budget Stats (Stats tab) ──────────────────────────────────────
function renderBudgetStats(){
  renderBSTrend();
  renderBSProgress();
  renderBSBestWorst();
  renderBSCatBreakdown();
  renderBSBalance();
  renderBSConsist();
  renderBSRecords();
  renderBSGoals();
}

// ── Finance: spending category breakdown (fixed + variable, last 12 saved weeks) ─
function renderBSCatBreakdown(){
  const wrap=document.getElementById('bs-catbreak-wrap'); if(!wrap) return;
  const keys=Object.keys(budgetData)
    .filter(k=>{const d=budgetData[k]; return d&&(d.saved||d.draft);})
    .sort().slice(-12);
  if(!keys.length){ wrap.innerHTML=''; return; }
  const CAT_COLORS=['#52B788','#f59e0b','#6366f1','#3b82f6','#ec4899','#8b5cf6','#FF6B35','#14b8a6','#94a3b8','#d85a30'];
  const cats=[];
  // Fixed: blank weeks fall back to the category default (same convention as weekFixedTotal)
  loadFixCats().forEach(c=>{
    const val=keys.reduce((s,k)=>{
      const v=budgetData[k]['fix_'+c.id];
      return s+((v!==undefined&&v!=='')?(parseFloat(v)||0):(parseFloat(c.default)||0));
    },0);
    cats.push({label:c.name||'Untitled', val, kind:'Fixed'});
  });
  loadVarCats().forEach(c=>{
    const val=keys.reduce((s,k)=>s+(parseFloat(budgetData[k]['var_'+c.id])||0),0);
    cats.push({label:c.name||'Untitled', val, kind:'Variable'});
  });
  cats.sort((a,b)=>b.val-a.val);
  const total=cats.reduce((s,c)=>s+c.val,0);
  if(total<=0){ wrap.innerHTML=''; return; }
  const max=Math.max(1,...cats.map(c=>c.val));
  const rows=cats.filter(c=>c.val>0).map((c,i)=>{
    const pctOfTotal=Math.round(c.val/total*100);
    return '<div class="muscle-bar-row">'+
      '<div class="muscle-bar-label" style="width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="'+_catEsc(c.label)+'">'+_catEscHtml(c.label)+'</div>'+
      '<div class="muscle-bar-track"><div class="muscle-bar-fill" style="width:'+Math.round(c.val/max*100)+'%;background:'+CAT_COLORS[i%CAT_COLORS.length]+'"></div></div>'+
      '<div class="muscle-bar-count" style="width:78px">$'+Math.round(c.val).toLocaleString()+' · '+pctOfTotal+'%</div>'+
    '</div>';
  }).join('');
  wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden">'+
    '<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">🧾 Where the money goes · last '+keys.length+' week'+(keys.length>1?'s':'')+'</div>'+
    '<div style="padding:14px 16px">'+rows+
      '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted);border-top:1px solid var(--border);padding-top:10px;margin-top:4px"><span>Total spent</span><b style="color:var(--text)">$'+Math.round(total).toLocaleString()+'</b></div>'+
    '</div></div>';
}

function renderBSProgress(){
  const wrap=document.getElementById('bs-progress-wrap'); if(!wrap) return;
  const keys=Object.keys(budgetData).filter(k=>{const d=budgetData[k];return d&&(d.saved||d.draft||d.snapshot);}).sort();
  if(!keys.length){ wrap.innerHTML=''; return; }
  const weekCount=keys.length;
  const totalSaved=keys.reduce((s,k)=>s+weekSavedAmt(budgetData[k]),0);
  const goal=getSavingsGoal();
  const cumulativeGoal=goal*weekCount;
  const pct=cumulativeGoal>0?Math.min(100,Math.round(totalSaved/cumulativeGoal*100)):0;
  const onTrack=totalSaved>=cumulativeGoal*0.85;
  const barColor=onTrack?'var(--positive)':'var(--accent)';
  wrap.innerHTML='<div class="card bst-prog-card">'+
    '<div class="bst-prog-label">Total saved · '+weekCount+' week'+(weekCount>1?'s':'')+' tracked</div>'+
    '<div class="bst-prog-val">$'+Math.round(totalSaved).toLocaleString()+'</div>'+
    '<div class="bst-prog-goal">of $'+cumulativeGoal.toLocaleString()+' cumulative goal ($'+goal+'/wk)</div>'+
    '<div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden;margin-top:12px">'+
      '<div style="width:'+pct+'%;height:100%;background:'+barColor+';border-radius:4px;transition:width .4s ease"></div>'+
    '</div>'+
    '<div style="font-size:12px;color:var(--muted);margin-top:6px">'+pct+'% of goal</div>'+
  '</div>';
}

function renderBSBestWorst(){
  const wrap=document.getElementById('bs-bestworst-wrap'); if(!wrap) return;
  const keys=Object.keys(budgetData).filter(k=>budgetData[k]&&weekIncome(budgetData[k])>0);
  if(!keys.length){ wrap.innerHTML=''; return; }
  let bestKey=null,bestSav=-Infinity,worstKey=null,worstOver=-Infinity;
  keys.forEach(k=>{
    const d=budgetData[k];
    const sav=weekSavedAmt(d);
    const left=weekIncome(d)-weekSpending(d)-weekSavedAmt(d);
    if(sav>bestSav){bestSav=sav;bestKey=k;}
    if(left<0&&-left>worstOver){worstOver=-left;worstKey=k;}
  });
  const fmtWk=k=>k?new Date(k+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short'}):'—';
  wrap.innerHTML='<div class="bst-tiles">'+
    '<div class="bst-tile">'+
      '<div class="bst-tile-icon">🏆</div>'+
      '<div class="bst-tile-lbl">Best week</div>'+
      '<div class="bst-tile-date">'+fmtWk(bestKey)+'</div>'+
      '<div class="bst-tile-val" style="color:var(--positive)">'+(bestKey?'saved $'+Math.round(bestSav):'—')+'</div>'+
    '</div>'+
    '<div class="bst-tile">'+
      '<div class="bst-tile-icon">⚠️</div>'+
      '<div class="bst-tile-lbl">Worst week</div>'+
      '<div class="bst-tile-date">'+fmtWk(worstKey)+'</div>'+
      '<div class="bst-tile-val" style="color:var(--danger)">'+(worstKey?'over by $'+Math.round(worstOver):'No overspend 🎉')+'</div>'+
    '</div>'+
  '</div>';
}

// ── Stats: Nutrition sub-tab ──────────────────────────────────────
// Charts the archived daily calorie totals (daily_cal_history, written by
// recordCalorieHistory on every food log) plus today's live total.
let nutChart=null;
function renderNutrition(){
  const wrap=document.getElementById('nutrition-content'); if(!wrap) return;
  if(nutChart){ nutChart.destroy(); nutChart=null; }
  const today=getLocalDate();
  const todayTotal=S.dailyLog.date===today?S.dailyLog.entries.reduce((a,e)=>a+(e.kcal||0),0):0;
  const c=calcGoalCals();
  const goalCals=c?(c.goal==='cut'?c.cut:c.goal==='bulk'?c.bulk:c.maintain):null;

  // Recorded days (history + live today), most recent 30 with data
  const totals={...calorieHistory};
  if(todayTotal>0||totals[today]!==undefined) totals[today]=todayTotal;
  const days=Object.keys(totals).filter(d=>totals[d]>0).sort().slice(-30);

  let html='';
  const goalLine=goalCals
    ? '<div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin-bottom:10px"><span>Today: <b style="color:var(--text)">'+todayTotal+'</b> kcal</span><span>Goal: '+goalCals+' kcal ('+(c.goal||'maintain')+')</span></div>'
    : '<div style="font-size:13px;color:var(--muted);margin-bottom:10px">Set up your profile in Settings → Health to see a calorie goal line.</div>';

  if(days.length>=2){
    const vals=days.map(d=>totals[d]);
    const avg7=Math.round(vals.slice(-7).reduce((a,v)=>a+v,0)/Math.min(7,vals.length));
    html+='<div class="stats-grid" id="nut-stats-grid">'+[
      {l:'Today',v:todayTotal||'—'},
      {l:'7-day avg',v:avg7},
      {l:'Days tracked',v:days.length},
    ].map(s=>'<div class="stat-card"><div class="stat-val">'+s.v+'</div><div class="stat-lbl">'+s.l+'</div></div>').join('')+'</div>';
    html+='<div class="card" style="padding:0;overflow:hidden">'+
      '<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">🍽️ Calorie trend</div>'+
      '<div style="padding:14px 16px">'+goalLine+'<canvas id="nut-chart" style="max-height:360px"></canvas></div>'+
    '</div>';
  } else {
    html+=goalLine+emptyState('🍽️','Not enough data yet','Daily calorie totals are archived automatically as you log food — check back after a few days of logging');
  }
  wrap.innerHTML=html;
  animateStatVals(document.getElementById('nut-stats-grid'));

  if(days.length>=2){
    const ctx=document.getElementById('nut-chart'); if(!ctx) return;
    const {gc,tc}=budChartGridColors();
    const accent=(getComputedStyle(document.documentElement).getPropertyValue('--accent')||'#FF6B35').trim();
    const accentRgb=(getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb')||'255,107,53').trim();
    const datasets=[{label:'Eaten',data:days.map(d=>totals[d]),borderColor:accent,backgroundColor:'rgba('+accentRgb+',.08)',borderWidth:2.5,pointRadius:3,pointBackgroundColor:accent,fill:true,tension:0.3}];
    if(goalCals) datasets.push({label:'Goal',data:days.map(()=>goalCals),borderColor:'rgba(150,150,150,0.7)',borderDash:[6,4],borderWidth:1.5,pointRadius:0,fill:false});
    nutChart=new Chart(ctx,{
      type:'line',
      data:{labels:days.map(d=>new Date(d+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short'})),datasets},
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:cx=>cx.dataset.label+': '+cx.parsed.y+' kcal'}}},
        scales:{
          x:{grid:{color:gc},ticks:{color:tc,font:{size:11},maxTicksLimit:8}},
          y:{grid:{color:gc},ticks:{color:tc,font:{size:11}},beginAtZero:false}
        }
      }
    });
  }
}

// ── Stats: Overview (landing view) ────────────────────────────────
// At-a-glance tiles + the full week-in-review, inline. Shares buildWeekReviewHTML
// with the Home tab's week-review modal so the numbers can never disagree.
function renderStatsOverview(){
  const wrap=document.getElementById('overview-content'); if(!wrap) return;
  const {mondayStr,sundayStr}=getWeekBounds();
  const workoutDays=new Set(S.sessions.filter(s=>s.date>=mondayStr&&s.date<=sundayStr).map(s=>s.date)).size;
  const {current:streak}=calcSessionStreak();

  // Latest weight + direction vs the previous entry. Status tints (ov-pos/ov-neg) are light,
  // high-luminance greens/reds chosen to read clearly on the accent gradient in both themes.
  const sortedW=[...S.weights].sort((a,b)=>a.date<b.date?-1:1);
  let weightVal='—', weightSub='No entries yet';
  if(sortedW.length){
    const latest=sortedW[sortedW.length-1];
    weightVal=latest.weight+'<span class="ov-hs-unit"> kg</span>';
    if(sortedW.length>=2){
      const chg=+(latest.weight-sortedW[sortedW.length-2].weight).toFixed(1);
      const arrow=chg<0?'↓':chg>0?'↑':'→';
      const cls=chg<0?'ov-pos':chg>0?'ov-neg':'';
      weightSub='<span class="'+cls+'">'+arrow+' '+(chg>0?'+':'')+chg+'kg</span> since last entry';
    } else {
      weightSub='Logged '+fmtDate(latest.date);
    }
  }

  // Today's calories vs goal
  const cg=calcGoalCals();
  const goalCals=cg?(cg.goal==='cut'?cg.cut:cg.goal==='bulk'?cg.bulk:cg.maintain):null;
  const kcalTotal=S.dailyLog.entries.reduce((a,e)=>a+(e.kcal||0),0);
  const calVal=goalCals
    ? kcalTotal+'<span class="ov-hs-unit"> / '+goalCals+'</span>'
    : String(kcalTotal||'—');
  const calSub=goalCals?(kcalTotal<=goalCals?(goalCals-kcalTotal)+' kcal left':'<span class="ov-neg">'+(kcalTotal-goalCals)+' kcal over</span>'):'No goal set';

  // This week's budget status. The 🟢/🟡/🔴 emoji carries the status colour, so the sub text
  // itself stays white — only the leftover figure is tinted.
  const bd=budgetData[mondayStr];
  let budVal='—', budSub='No data this week';
  if(bd&&weekIncome(bd)>0){
    const left=weekLeftover(bd);
    budVal='<span class="'+(left>=0?'ov-pos':'ov-neg')+'">'+(left>=0?'+$':'-$')+Math.abs(left).toFixed(0)+'</span>';
    budSub=left>=50?'🟢 On track':left>=0?'🟡 Tight week':'🔴 Over budget';
  }

  // Single accent-gradient hero (matches Home / Budget), with the same 4 tappable stats laid
  // out as light-text sections. Light-mode gradient floor lives in .ov-hero (workout.css).
  wrap.innerHTML=
    '<div class="ov-hero">'+
      '<div class="ov-hero-grid">'+
        '<div class="ov-hs" onclick="setStatsTab(\'training\')">'+
          '<div class="ov-hs-label">Workouts this week</div>'+
          '<div class="ov-hs-val">'+workoutDays+'<span class="ov-hs-unit"> / '+scheduleLen()+'</span></div>'+
          '<div class="ov-hs-sub">🔥 '+streak+' day streak</div>'+
        '</div>'+
        '<div class="ov-hs" onclick="setStatsTab(\'body\')">'+
          '<div class="ov-hs-label">Weight</div>'+
          '<div class="ov-hs-val">'+weightVal+'</div>'+
          '<div class="ov-hs-sub">'+weightSub+'</div>'+
        '</div>'+
        '<div class="ov-hs" onclick="setStatsTab(\'nutrition\')">'+
          '<div class="ov-hs-label">Calories today</div>'+
          '<div class="ov-hs-val">'+calVal+'</div>'+
          '<div class="ov-hs-sub">'+calSub+'</div>'+
        '</div>'+
        '<div class="ov-hs" onclick="setStatsTab(\'finance\')">'+
          '<div class="ov-hs-label">Budget this week</div>'+
          '<div class="ov-hs-val">'+budVal+'</div>'+
          '<div class="ov-hs-sub">'+budSub+'</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="card"><div class="sec-label" style="margin-bottom:12px">🗓️ Week in review</div>'+buildWeekReviewHTML()+'</div>';
}
function setBSTrendRange(range){
  bsTrendRange=range;
  ['monthly','yearly','alltime'].forEach(r=>{
    const btn=document.getElementById('bst-'+r); if(!btn) return;
    const a=r===range;
    btn.style.background=a?'rgba(255,255,255,0.3)':'transparent';
    btn.style.color=a?'#fff':'rgba(255,255,255,0.65)';
  });
  renderBSTrend();
}
function renderBSTrend(){
  const wrap=document.getElementById('bs-trend-wrap'); if(!wrap) return;
  // Always destroy a prior chart first so re-rendering can't conflict on the canvas
  if(bsChart){bsChart.destroy();bsChart=null;}
  // Per-week spending: each saved week (daily_budget) is one bar. Grouping by month
  // previously hid everything until 2+ months existed; weeks within one month now show.
  const keys=Object.keys(budgetData)
    .filter(k=>{const d=budgetData[k]; return d && (d.saved || d.draft || d.snapshot);})
    .sort();
  // Range toggle controls how many recent weeks are shown
  const windowWeeks = bsTrendRange==='monthly' ? 12 : bsTrendRange==='yearly' ? 52 : keys.length;
  const shown = keys.slice(-windowWeeks);
  if(shown.length<1){
    wrap.innerHTML=emptyState('💰','No budget history yet','Save a week in the Budget tab to see your spending trend here');
    return;
  }
  const spent  = shown.map(k=>weekSpending(budgetData[k]));
  const labels = shown.map(k=>new Date(k+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short'}));
  // Budget goal reference line = the current plan's weekly spend (fixed + variable)
  const goal = configFixedTotal()+configVariableTotal();
  wrap.innerHTML='<canvas id="bs-trend-chart" style="max-height:360px"></canvas>';
  const ctx=document.getElementById('bs-trend-chart'); if(!ctx) return;
  const {gc,tc}=budChartGridColors();
  const accent=(getComputedStyle(document.documentElement).getPropertyValue('--accent')||'#FF6B35').trim();
  const datasets=[
    {type:'bar',label:'Spent',data:spent,backgroundColor:'rgba(231,76,60,0.6)',borderColor:BUD_CHART_COLORS.spending,borderWidth:1,borderRadius:6,maxBarThickness:48}
  ];
  if(goal>0){
    datasets.push({type:'line',label:'Budget goal',data:shown.map(()=>goal),borderColor:accent,borderWidth:2,borderDash:[6,4],pointRadius:0,fill:false,tension:0});
  }
  bsChart=new Chart(ctx,{
    data:{labels,datasets},
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:true,labels:{color:tc,font:{size:12},usePointStyle:true,pointStyleWidth:10}},
        tooltip:{callbacks:{label:c=>c.dataset.label+': $'+c.parsed.y.toFixed(0)}}
      },
      scales:{
        x:{grid:{color:gc},ticks:{color:tc,font:{size:11},maxTicksLimit:12}},
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>'$'+v},beginAtZero:true}
      }
    }
  });
}
function renderBSBalance(){
  const wrap=document.getElementById('bs-balance-wrap'); if(!wrap) return;
  if(bsBalChart){bsBalChart.destroy();bsBalChart=null;}
  const sorted=[...savingsLog].sort((a,b)=>a.date<b.date?-1:1);
  if(sorted.length<2){
    wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden"><div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">💰 Balance & net worth</div><div style="padding:14px 16px;text-align:center;color:var(--muted);font-size:13px">Log at least 2 balance entries in Budget → Month to see the chart.</div></div>';
    return;
  }
  // Net worth = savings balance − last-known CC debt at that date (dated ccLog history;
  // dates before the history starts use the earliest known CC value).
  const netData=sorted.map(e=>e.balance-ccBalanceAt(e.date));
  const curNet=netData[netData.length-1];
  const netCol=curNet>=0?'var(--success)':'var(--danger)';
  const accent=(getComputedStyle(document.documentElement).getPropertyValue('--accent')||'#FF6B35').trim();
  wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden">'+
    '<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);display:flex;justify-content:space-between;align-items:center">'+
      '<span>💰 Balance & net worth</span>'+
      '<span style="font-size:13px;font-weight:800;text-transform:none;letter-spacing:0;color:'+netCol+'">'+(curNet>=0?'+$':'-$')+Math.abs(Math.round(curNet)).toLocaleString()+' net</span>'+
    '</div>'+
    '<div style="padding:14px 16px"><canvas id="bs-bal-chart" style="max-height:360px"></canvas></div></div>';
  const ctx=document.getElementById('bs-bal-chart'); if(!ctx) return;
  const {gc,tc}=budChartGridColors();
  bsBalChart=new Chart(ctx,{
    type:'line',
    data:{
      labels:sorted.map(e=>e.date.substring(5)),
      datasets:[
        {label:'Savings',data:sorted.map(e=>e.balance),borderColor:'#94a3b8',backgroundColor:'rgba(148,163,184,0.12)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#94a3b8',fill:true,tension:0.3},
        {label:'Net (savings − CC)',data:netData,borderColor:accent,backgroundColor:'transparent',borderWidth:2.5,pointRadius:3,pointBackgroundColor:accent,fill:false,tension:0.3}
      ]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{
        legend:{display:true,labels:{color:tc,font:{size:12},usePointStyle:true,pointStyleWidth:10}},
        tooltip:{callbacks:{label:c=>c.dataset.label+': $'+c.parsed.y.toLocaleString()}}
      },
      scales:{
        x:{grid:{color:gc},ticks:{color:tc,font:{size:11},maxTicksLimit:8}},
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>'$'+v},beginAtZero:false}
      }
    }
  });
}
function renderBSConsist(){
  const wrap=document.getElementById('bs-consist-wrap'); if(!wrap) return;
  const allKeys=Object.keys(budgetData).sort().reverse().slice(0,8).reverse();
  if(!allKeys.length){
    wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden"><div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">📅 Budget consistency</div><div style="padding:14px 16px;text-align:center;color:var(--muted);font-size:13px">No weeks saved yet.</div></div>';
    return;
  }
  const cells=allKeys.map(k=>{
    const d=budgetData[k]; if(!d) return '';
    const inc=weekIncome(d);
    const leftover=inc>0?weekLeftover(d):null;
    const mon=new Date(k+'T12:00:00');
    const dayLbl=mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
    const status=leftover===null?'grey':leftover>=50?'green':leftover>=0?'amber':'red';
    const bg={green:'#52B788',amber:'#f59e0b',red:'#E74C3C',grey:'var(--border)'};
    const fg={green:'#fff',amber:'#fff',red:'#fff',grey:'var(--muted)'};
    const valLbl=leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'—';
    return '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px">'
      +'<div style="width:100%;height:48px;background:'+bg[status]+';border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:'+fg[status]+'">'+valLbl+'</div>'
      +'<div style="font-size:9px;color:var(--muted);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;padding:0 1px">'+dayLbl+'</div>'
      +'</div>';
  }).join('');
  wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden">'
    +'<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">📅 Budget consistency</div>'
    +'<div style="padding:14px 16px">'
    +'<div style="display:flex;gap:5px;margin-bottom:10px">'+cells+'</div>'
    +'<div style="display:flex;gap:14px;font-size:11px;color:var(--muted)">'
    +'<span><span style="display:inline-block;width:10px;height:10px;background:#52B788;border-radius:2px;vertical-align:middle;margin-right:3px"></span>On track</span>'
    +'<span><span style="display:inline-block;width:10px;height:10px;background:#f59e0b;border-radius:2px;vertical-align:middle;margin-right:3px"></span>Tight</span>'
    +'<span><span style="display:inline-block;width:10px;height:10px;background:#E74C3C;border-radius:2px;vertical-align:middle;margin-right:3px"></span>Over</span>'
    +'</div></div></div>';
}
function renderBSRecords(){
  const wrap=document.getElementById('bs-records-wrap'); if(!wrap) return;
  const keys=Object.keys(budgetData);
  if(keys.length<2){
    wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden"><div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">🏆 Personal records</div><div style="padding:14px 16px;text-align:center;color:var(--muted);font-size:13px">Save at least 2 weeks to see records.</div></div>';
    return;
  }
  let bestInc={val:0,key:null},bestSav={val:0,key:null},loSpend={val:Infinity,key:null};
  keys.forEach(k=>{
    const d=budgetData[k]; if(!d) return;
    const inc=weekIncome(d);
    const spend=weekSpending(d);
    const sav=weekSavedAmt(d);
    if(inc>0&&inc>bestInc.val){bestInc={val:inc,key:k};}
    if(sav>bestSav.val){bestSav={val:sav,key:k};}
    if(inc>0&&spend<loSpend.val){loSpend={val:spend,key:k};}
  });
  const fmtWk=k=>{if(!k) return '—'; return new Date(k+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'2-digit'});};
  const rows=[
    {icon:'💵',label:'Highest income',val:bestInc.key?'$'+bestInc.val.toFixed(0):'—',wk:fmtWk(bestInc.key)},
    {icon:'📉',label:'Lowest spending',val:loSpend.key&&isFinite(loSpend.val)?'$'+loSpend.val.toFixed(0):'—',wk:fmtWk(loSpend.key)},
    {icon:'🏅',label:'Most saved',val:bestSav.key?'$'+bestSav.val.toFixed(0):'—',wk:fmtWk(bestSav.key)},
  ];
  wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden">'
    +'<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">🏆 Personal records</div>'
    +'<div style="padding:2px 16px">'
    +rows.map(r=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid var(--border)">'
      +'<div style="display:flex;align-items:center;gap:10px"><span style="font-size:20px">'+r.icon+'</span>'
      +'<div><div style="font-size:13px;font-weight:600">'+r.label+'</div><div style="font-size:11px;color:var(--muted)">Week of '+r.wk+'</div></div></div>'
      +'<div style="font-size:18px;font-weight:800;color:var(--success)">'+r.val+'</div>'
      +'</div>').join('')
    +'</div></div>';
}
function renderBSGoals(){
  const wrap=document.getElementById('bs-goals-wrap'); if(!wrap) return;
  const goals=budDefaults.goals||[];
  const sortedLog=[...savingsLog].sort((a,b)=>a.date<b.date?-1:1);
  const curBal=sortedLog.length?sortedLog[sortedLog.length-1].balance:0;
  const goalsHTML=goals.map((g,i)=>{
    const pct=g.target>0?Math.min(100,Math.round(curBal/g.target*100)):0;
    const remaining=Math.max(0,g.target-curBal);
    const bc=pct>=100?'var(--success)':pct>=50?'var(--warn)':'#3b82f6';
    const weeksLeft=Math.max(0,(new Date(g.date+'T12:00:00')-new Date())/(7*864e5));
    const weeklyNeeded=weeksLeft>0&&remaining>0?'$'+Math.ceil(remaining/weeksLeft).toLocaleString()+'/wk needed':null;
    return `<div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="font-size:15px;font-weight:700">${g.name}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--muted)">$${g.target.toLocaleString()} by ${g.date}</span>
          <button onclick="deleteGoal(${i})" style="font-size:12px;color:var(--danger);background:none;border:none;cursor:pointer;padding:0">✕</button>
        </div>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:6px">
        <div style="width:${pct}%;height:100%;background:${bc};border-radius:3px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">
        <span>${pct}%${curBal>0?' ($'+curBal.toLocaleString()+')':''}</span>
        <span>${pct>=100?'🎉 Reached!':(remaining>0?'$'+remaining.toLocaleString()+' to go':'')+(weeklyNeeded?' · '+weeklyNeeded:'')}</span>
      </div>
    </div>`;
  }).join('');
  wrap.innerHTML=`<div class="card" style="padding:0;overflow:hidden">
    <div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">🎯 Savings goals</div>
    <div style="padding:14px 16px">
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${goals.length?'12px':'0'}">
        <input type="text" id="bs-goal-name" placeholder="Goal name" style="flex:1 1 100px;min-width:0;box-sizing:border-box;height:38px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;padding:0 8px;background:var(--card);color:var(--text)">
        <input type="number" id="bs-goal-target" inputmode="decimal" placeholder="$ Target" style="flex:1 1 70px;min-width:0;box-sizing:border-box;height:38px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;text-align:center;background:var(--card);color:var(--text)">
        <input type="date" id="bs-goal-date" style="flex:1 1 110px;min-width:0;box-sizing:border-box;height:38px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;padding:0 6px;background:var(--card);color:var(--text)">
        <button onclick="addBSGoal()" style="flex-shrink:0;padding:0 14px;height:38px;background:var(--header);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Add</button>
      </div>
      ${goals.length?goalsHTML:'<div style="text-align:center;color:var(--muted);font-size:13px;padding:12px 0">No goals yet — add one above</div>'}
    </div>
  </div>`;
}
function addBSGoal(){
  const name=document.getElementById('bs-goal-name')?.value.trim();
  const target=parseFloat(document.getElementById('bs-goal-target')?.value);
  const date=document.getElementById('bs-goal-date')?.value;
  if(!name||!target||!date) return;
  if(!budDefaults.goals) budDefaults.goals=[];
  budDefaults.goals.push({name,target,date});
  localStorage.setItem('daily_budget_defaults',JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();
  renderBSGoals();
}

// ── Home tab ──────────────────────────────────────────────────────
// ── Habits ────────────────────────────────────────────────────────
function loadHabits(){
  return lsLoad('daily_habits',
    ['Morning workout','Hit calorie goal','Log budget','8h sleep','Drink 2L water'],
    d=>Array.isArray(d)&&d.length>0);
}
function loadHabitsLog(){ return lsLoad('daily_habits_log', {}); }
function saveHabitsLog(){ lsSave('daily_habits_log', habitsLog, 'habitsLog'); }
function toggleHabit(idx){
  const today=getLocalDate();
  if(!habitsLog[today]) habitsLog[today]=[];
  const arr=habitsLog[today];
  const pos=arr.indexOf(idx);
  if(pos>=0) arr.splice(pos,1); else arr.push(idx);
  saveHabitsLog();
  refreshHabitsUI();
}
// Delegated: a tap survives the list re-rendering between press and release. An inline
// onclick on a row that gets rebuilt mid-tap is swallowed → "nothing happens, tap again".
document.addEventListener('click',function(e){
  const el=e.target.closest('[data-habit-toggle]'); if(!el) return;
  const i=parseInt(el.getAttribute('data-habit-toggle'),10);
  if(!isNaN(i)) toggleHabit(i);
});
function getWeekDates(){
  const monday=getMondayOf(0);
  return Array.from({length:7},(_,i)=>{
    const d=new Date(monday); d.setDate(monday.getDate()+i);
    return dateStr(d);
  });
}
function buildHabitsWeekGrid(){
  const today=getLocalDate();
  const dates=getWeekDates();
  const n=habitsData.length||1;
  const labels=['M','T','W','T','F','S','S'];
  return dates.map((date,i)=>{
    const done=(habitsLog[date]||[]).length;
    const isFuture=date>today;
    let bg='var(--border)',tc='var(--muted)';
    if(!isFuture&&done>=n){bg='var(--success)';tc='#fff';}
    else if(!isFuture&&done>0){bg='#f59e0b';tc='#fff';}
    const border=date===today?'border:2px solid var(--text);':'border:2px solid transparent;';
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">'
      +'<div style="width:30px;height:30px;border-radius:8px;background:'+bg+';'+border+'display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:'+tc+'">'
      +(!isFuture&&done>0?done:'')
      +'</div>'
      +'<div style="font-size:9px;color:var(--muted)">'+labels[i]+'</div>'
      +'</div>';
  }).join('');
}
// 30-day per-habit completion for the Stats tab (uses the existing index-based model:
// habit "done" on a date = its index is in habitsLog[date]).
function renderStatsHabits(){
  const el=document.getElementById('stats-habits-list');
  const section=document.getElementById('stats-habits-section');
  if(!el) return;
  if(!habitsData.length){ if(section) section.style.display='none'; return; }
  if(section) section.style.display='';
  const days=[]; const d0=localMidnight(getLocalDate());
  for(let i=0;i<30;i++){ const d=new Date(d0); d.setDate(d.getDate()-i); days.push(dateStr(d)); }
  el.innerHTML=habitsData.map((h,idx)=>{
    const completed=days.filter(day=>(habitsLog[day]||[]).indexOf(idx)>=0).length;
    const pct=Math.round(completed/30*100);
    const streak=calcHabitStreakIdx(idx);
    return '<div style="margin-bottom:18px">'+
      '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">'+
        '<span style="font-size:14px;font-weight:600;color:var(--text)">'+String(h).replace(/</g,'&lt;')+'</span>'+
        '<span style="font-size:12px;color:var(--muted)">'+completed+'/30 · 🔥 '+streak+'</span>'+
      '</div>'+
      '<div style="height:8px;background:var(--border);border-radius:4px;overflow:hidden">'+
        '<div style="height:100%;width:'+pct+'%;background:var(--accent);border-radius:4px;transition:width .4s ease"></div>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:4px">'+pct+'% this month</div>'+
    '</div>';
  }).join('');
}
function calcHabitStreakIdx(idx){
  let streak=0; const d=localMidnight(getLocalDate());
  while(true){ if((habitsLog[dateStr(d)]||[]).indexOf(idx)<0) break; streak++; d.setDate(d.getDate()-1); }
  return streak;
}
// Habits stats live in the Training sub-tab. Created dynamically and always
// re-appended to the end of #sub-training.
function ensureHabitsStatsInProgress(){
  const sub=document.getElementById('sub-training'); if(!sub) return;
  let sec=document.getElementById('stats-habits-section');
  if(!sec){
    sec=document.createElement('div');
    sec.id='stats-habits-section';
    sec.style.cssText='margin-top:24px;display:none';
    sec.innerHTML='<div class="sec-label" style="margin-bottom:12px">📋 Habit completion · last 30 days</div><div id="stats-habits-list"></div>';
  }
  sub.appendChild(sec); // move/keep at the end
  renderStatsHabits();
}
function buildHabitsWeekStats(){
  const today=getLocalDate();
  const dates=getWeekDates();
  const n=habitsData.length;
  let perfect=0,total=0,days=0;
  dates.forEach(d=>{
    if(d>today) return;
    days++;
    const done=(habitsLog[d]||[]).length;
    total+=done;
    if(done>=n) perfect++;
  });
  const avg=days>0?(total/days).toFixed(1):'0';
  return '<span style="font-size:12px;font-weight:600;color:var(--success)">'+perfect+' perfect day'+(perfect!==1?'s':'')+'</span>'
    +'<span style="font-size:12px;color:var(--muted);margin-left:8px">· avg '+avg+'/'+n+' per day</span>';
}
function buildTodayHabitsList(){
  const today=getLocalDate();
  const done=habitsLog[today]||[];
  return habitsData.map((h,i)=>{
    const checked=done.includes(i);
    const isLast=i===habitsData.length-1;
    return '<div data-habit-toggle="'+i+'" style="display:flex;align-items:center;gap:12px;padding:11px 0;'+(isLast?'':'border-bottom:1px solid var(--border);')+'cursor:pointer;-webkit-tap-highlight-color:transparent">'
      +'<div style="width:22px;height:22px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;'+(checked?'background:var(--accent);border:2px solid var(--accent);':'background:transparent;border:2px solid var(--border);')+'">'
      +(checked?'<svg viewBox="0 0 12 10" width="10" height="10" fill="none"><polyline points="1,5 4,8 11,1" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>':'')
      +'</div>'
      +'<span style="font-size:14px;'+(checked?'color:var(--muted);text-decoration:line-through;':'color:var(--text);')+'">'+h+'</span>'
      +'</div>';
  }).join('');
}
function refreshHabitsUI(){
  const g=document.getElementById('habits-week-grid');
  if(g) g.innerHTML=buildHabitsWeekGrid();
  const s=document.getElementById('habits-week-stats');
  if(s) s.innerHTML=buildHabitsWeekStats();
  const l=document.getElementById('habits-today-list');
  if(l) l.innerHTML=buildTodayHabitsList();
  const c=document.getElementById('habits-today-count');
  if(c){
    const today=getLocalDate();
    const n=habitsData.length;
    const doneN=(habitsLog[today]||[]).length;
    c.textContent=doneN+'/'+n;
    c.style.color='#fff';
    c.style.opacity=(doneN===n&&n>0)?'1':'0.75';
  }
}
function buildWeekSummaryCard(){
  const {mondayStr,sundayStr}=getWeekBounds();
  const workoutDays=new Set(S.sessions.filter(s=>s.date>=mondayStr&&s.date<=sundayStr).map(s=>s.date)).size;
  // Budget
  const bd=budgetData[mondayStr];
  let budHTML='<span style="font-size:18px;font-weight:800;color:var(--muted)">—</span>';
  if(bd){
    const inc=weekIncome(bd);
    if(inc>0){
      const left=weekLeftover(bd);
      const col=left>=0?'var(--success)':'var(--danger)';
      const pillCls=left>=50?'good':left>=0?'warn':'over';
      const pillTxt=left>=50?'On track':left>=0?'Tight':'Over';
      budHTML='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
        +'<span style="font-size:18px;font-weight:800;color:'+col+'">'+(left>=0?'+$':'-$')+Math.abs(left).toFixed(0)+'</span>'
        +'<span class="status-pill '+pillCls+'" style="font-size:10px;padding:2px 7px">'+pillTxt+'</span>'
        +'</div>';
    }
  }
  // Calories
  const cg=calcGoalCals();
  const goalCals=cg?(cg.goal==='cut'?cg.cut:cg.goal==='bulk'?cg.bulk:cg.maintain):null;
  const kcalTotal=S.dailyLog.entries.reduce((a,e)=>a+e.kcal,0);
  const calHTML=goalCals
    ?'<span style="font-size:18px;font-weight:800;color:'+(kcalTotal>goalCals?'var(--danger)':'var(--text)')+'">'+kcalTotal+'</span>'
     +'<span style="font-size:11px;color:var(--muted);margin-left:3px">/ '+goalCals+'</span>'
    :'<span style="font-size:18px;font-weight:800;color:var(--muted)">—</span>';
  // Weight
  const weekWeights=S.weights.filter(w=>w.date>=mondayStr&&w.date<=sundayStr).sort((a,b)=>a.date<b.date?-1:1);
  let weightHTML='<span style="font-size:18px;font-weight:800;color:var(--muted)">—</span>';
  if(weekWeights.length>=2){
    const chg=+(weekWeights[weekWeights.length-1].weight-weekWeights[0].weight).toFixed(1);
    const col=chg<0?'var(--success)':chg>0?'var(--danger)':'var(--muted)';
    weightHTML='<span style="font-size:18px;font-weight:800;color:'+col+'">'+(chg>0?'+':'')+chg+'<span style="font-size:12px;margin-left:1px">kg</span></span>';
  }
  return '<div class="card" style="padding:0;overflow:hidden">'
    +'<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);display:flex;justify-content:space-between;align-items:center">'
    +'<span>📋 Weekly review</span>'
    +'<button onclick="openWeekReviewModal()" style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--muted);cursor:pointer">Full review</button>'
    +'</div>'
    +'<div style="padding:14px 16px">'
    +'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:14px">'
    +'<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Workouts</div>'
    +'<span style="font-size:18px;font-weight:800">'+workoutDays+'</span><span style="font-size:11px;color:var(--muted);margin-left:3px">/ 6 days</span></div>'
    +'<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Budget</div>'+budHTML+'</div>'
    +'<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Cals today</div>'+calHTML+'</div>'
    +'<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Weight Δ</div>'+weightHTML+'</div>'
    +'</div>'
    +'<div style="border-top:1px solid var(--border);padding-top:12px">'
    +'<div id="habits-week-stats" style="margin-bottom:8px">'+buildHabitsWeekStats()+'</div>'
    +'<div id="habits-week-grid" style="display:flex;gap:4px">'+buildHabitsWeekGrid()+'</div>'
    +'</div>'
    +'</div>'
    +'</div>';
}
function buildTodayHabitsCard(){
  const today=getLocalDate();
  const doneCount=(habitsLog[today]||[]).length;
  const n=habitsData.length;
  const allDone=doneCount===n&&n>0;
  return '<div class="card" style="padding:0;overflow:hidden">'
    +'<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);display:flex;justify-content:space-between;align-items:center">'
    +'<span>Daily habits</span>'
    +'<div style="display:flex;align-items:center;gap:10px">'
    +'<span id="habits-today-count" style="font-size:13px;font-weight:700;color:var(--text);opacity:'+(allDone?'1':'0.75')+'">'+doneCount+'/'+n+'</span>'
    +'<button onclick="openHabitsEditModal()" style="background:transparent;border:1px solid var(--border);border-radius:8px;padding:4px 11px;cursor:pointer;color:var(--muted);font-size:12px;font-weight:600;line-height:1;-webkit-tap-highlight-color:transparent" title="Edit habits">Edit</button>'
    +'</div>'
    +'</div>'
    +'<div style="padding:14px 16px">'
    +'<div id="habits-today-list">'+buildTodayHabitsList()+'</div>'
    +'</div>'
    +'</div>';
}
// Habits management is now a full-screen settings section (#settings-habits-section, rendered
// into #habits-edit-sheet). Kept as a named entry point for the Home habits card + menu.
function openHabitsEditModal(){ if(typeof openSettingsSection==='function') openSettingsSection('habits'); }
function renderHabitsEditModal(){
  const sheet=document.getElementById('habits-edit-sheet'); if(!sheet) return;
  const rows=habitsData.map((h,i)=>
    '<div class="habit-edit-row" data-idx="'+i+'">'
    +'<span class="habit-drag-handle" aria-label="Drag to reorder" title="Drag to reorder">⠿</span>'
    +'<span style="flex:1;font-size:14px;color:var(--text)">'+h.replace(/</g,'&lt;')+'</span>'
    +'<button onclick="deleteHabitItem('+i+')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0">✕</button>'
    +'</div>'
  ).join('') || '<div style="font-size:13px;color:var(--muted);padding:8px 0">No habits yet</div>';
  sheet.innerHTML=
    (habitsData.length>1?'<div style="font-size:12px;color:var(--muted);margin-bottom:12px">Drag the ⠿ handle to reorder · tap ✕ to remove</div>':'<div style="font-size:12px;color:var(--muted);margin-bottom:12px">Add, remove and reorder your daily habits.</div>')
    +rows
    +'<div style="display:flex;gap:8px;margin-top:12px">'
    +'<input id="habit-new-input" type="text" placeholder="New habit…" style="flex:1;height:40px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;padding:0 10px;background:transparent;color:var(--text)">'
    +'<button onclick="addHabitItem()" style="padding:0 16px;height:40px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Add</button>'
    +'</div>';
}
// habitsRef is scoped to the auth callback, so it's not visible here — write to the cloud
// ref by uid directly. (Referencing habitsRef from these global fns threw a ReferenceError,
// which aborted them before the re-render — habits only appeared after close+reopen.)
function pushHabits(){
  try{ if(firebaseReady&&auth&&auth.currentUser&&db) db.ref('users/'+auth.currentUser.uid+'/habits').set(habitsData); }catch(e){}
}
function addHabitItem(){
  const inp=document.getElementById('habit-new-input'); if(!inp) return;
  const val=inp.value.trim(); if(!val) return;
  habitsData.push(val);
  localStorage.setItem('daily_habits',JSON.stringify(habitsData));
  pushHabits();
  inp.value='';
  renderHabitsEditModal();
  refreshTodayHabits();
}
function deleteHabitItem(i){
  habitsData.splice(i,1);
  // Keep completion history aligned: drop this index, shift higher indices down.
  Object.keys(habitsLog).forEach(date=>{
    habitsLog[date]=(habitsLog[date]||[]).filter(x=>x!==i).map(x=>x>i?x-1:x);
  });
  localStorage.setItem('daily_habits',JSON.stringify(habitsData));
  saveHabitsLog();
  pushHabits();
  renderHabitsEditModal();
  refreshTodayHabits();
}
// Apply the dragged habit order, remapping habitsLog indices so each habit's completion
// history follows it to the new position.
function applyHabitOrderFromDOM(){
  const rows=[...document.querySelectorAll('#habits-edit-sheet .habit-edit-row')];
  if(rows.length<2) return;
  const newOrder=rows.map(r=>parseInt(r.dataset.idx,10)); // old indices in their new order
  if(newOrder.some(isNaN)) return;
  const inv={}; newOrder.forEach((oldIdx,newPos)=>{ inv[oldIdx]=newPos; });
  habitsData=newOrder.map(oldIdx=>habitsData[oldIdx]);
  Object.keys(habitsLog).forEach(date=>{
    habitsLog[date]=(habitsLog[date]||[]).map(i=>inv[i]).filter(x=>x!==undefined).sort((a,b)=>a-b);
  });
  localStorage.setItem('daily_habits',JSON.stringify(habitsData));
  saveHabitsLog();
  pushHabits();
  renderHabitsEditModal();
  refreshTodayHabits();
}
// Pointer-based drag-to-reorder for the habits edit sheet (mouse + touch). Uses a floating
// clone that follows the pointer so it's obvious what you're holding and where it'll drop.
(function(){
  let row=null, clone=null, offY=0, parent=null;
  function onMove(e){
    if(!row) return;
    if(e.cancelable) e.preventDefault();
    clone.style.top=(e.clientY-offY)+'px';
    clone.style.display='none'; // hide clone so hit-test reads the row underneath
    const el=document.elementFromPoint(e.clientX,e.clientY);
    clone.style.display='';
    const over=(el&&el.closest)?el.closest('.habit-edit-row'):null;
    if(over&&over!==row&&over.parentElement===parent){
      const r=over.getBoundingClientRect();
      const after=e.clientY > r.top + r.height/2;
      parent.insertBefore(row, after?over.nextSibling:over);
    }
  }
  function onUp(){
    document.removeEventListener('pointermove',onMove);
    document.removeEventListener('pointerup',onUp);
    document.removeEventListener('pointercancel',onUp);
    if(!row) return;
    if(clone){ clone.remove(); clone=null; }
    row.style.opacity=''; row=null; parent=null;
    applyHabitOrderFromDOM();
  }
  document.addEventListener('pointerdown',function(e){
    const h=e.target.closest('.habit-drag-handle'); if(!h) return;
    row=h.closest('.habit-edit-row'); if(!row) return;
    parent=row.parentElement;
    const r=row.getBoundingClientRect();
    offY=e.clientY-r.top;
    clone=row.cloneNode(true);
    clone.classList.add('habit-dragging');
    clone.style.cssText='position:fixed;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;height:'+r.height+'px;z-index:9999;pointer-events:none;margin:0';
    document.body.appendChild(clone);
    row.style.opacity='.25';
    try{ if(h.setPointerCapture&&e.pointerId!=null) h.setPointerCapture(e.pointerId); }catch(err){}
    e.preventDefault();
    document.addEventListener('pointermove',onMove,{passive:false});
    document.addEventListener('pointerup',onUp);
    document.addEventListener('pointercancel',onUp);
  });
})();
function closeHabitsEditModal(){ if(typeof closeSettingsSection==='function') closeSettingsSection(); }
function refreshTodayHabits(){
  const list=document.getElementById('habits-today-list');
  if(list) list.innerHTML=buildTodayHabitsList();
  const today=getLocalDate();
  const doneCount=(habitsLog[today]||[]).length;
  const n=habitsData.length;
  const counter=document.getElementById('habits-today-count');
  if(counter){ counter.textContent=doneCount+'/'+n; counter.style.opacity=(doneCount===n&&n>0)?'1':'0.75'; }
}

// Time-of-day greeting + saved profile name (source of truth: profileData.name).
function getGreeting(){
  const hour=new Date().getHours();
  const nm=(profileData.name||S.personalInfo?.name||'').trim();
  const timeGreet=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  return nm?timeGreet+', '+nm:timeGreet;
}
// ── Credit card tracker (Home card + Budget input) ───────────────
function loadCCData(){ return lsLoad('daily_cc', {}); }
function saveCCData(d){ lsSave('daily_cc', d, 'creditCard'); }
function renderCCCard(){
  const d=loadCCData();
  const balance=parseFloat(d.balance)||0;
  const balEl=document.getElementById('home-cc-balance');
  if(balEl) balEl.textContent='$'+balance.toFixed(0);

  // Due date — exactly the date the user set (YYYY-MM-DD), or legacy ISO. No auto-guessing.
  let due=null;
  if(d.dueDate){ const s=String(d.dueDate); due=new Date(s.length<=10?s+'T12:00:00':s); if(isNaN(due.getTime())) due=null; }
  const dueEl=document.getElementById('home-cc-due');
  if(dueEl){
    if(due){
      const overdue = due < new Date(getLocalDate()+'T12:00:00');
      dueEl.textContent=(overdue?'Overdue · ':'Due ')+due.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
      dueEl.style.color = overdue ? 'var(--danger)' : '';
    } else {
      dueEl.textContent='Set due date in Budget';
      dueEl.style.color='';
    }
  }

  // Covered if the current savings balance covers what's owed on the card
  const savings=savingsLog.length?(parseFloat(savingsLog[savingsLog.length-1].balance)||0):0;
  const statusEl=document.getElementById('home-cc-status');
  if(statusEl){
    if(balance>0){
      const covered=savings>=balance;
      statusEl.textContent=covered?'✓ Covered':'⚠ Check funds';
      statusEl.className='home-cc-status '+(covered?'covered':'at-risk');
      statusEl.style.display='inline-block';
    } else {
      statusEl.textContent=''; statusEl.className='home-cc-status'; statusEl.style.display='none';
    }
  }
}
function updateCCBalance(){
  const val=parseFloat(document.getElementById('cc-balance-input')?.value)||0;
  const d=loadCCData();
  d.balance=val;            // due date is set explicitly via the date field — never auto-guessed
  saveCCData(d);
  recordCCHistory(val);     // dated history feeds the Finance net-worth trend
  renderCCCard();
}
function updateCCDue(){
  const v=document.getElementById('cc-due-input')?.value||'';
  const d=loadCCData();
  if(v) d.dueDate=v; else delete d.dueDate;
  saveCCData(d);
  renderCCCard();
}
// ── Budget tab: credit-card row (tap to expand → edit balance + repayment due) ──
let ccEditing=false;
function ccDueText(d){
  if(!d||!d.dueDate) return 'Set repayment date';
  const s=String(d.dueDate); const due=new Date(s.length<=10?s+'T12:00:00':s);
  if(isNaN(due.getTime())) return 'Set repayment date';
  const overdue = due < new Date(getLocalDate()+'T12:00:00');
  return (overdue?'Overdue · ':'Due ')+due.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
}
function ccToggleEdit(){
  ccEditing=!ccEditing;
  renderCCRow();
  if(ccEditing) setTimeout(()=>document.getElementById('cc-balance-input')?.focus(),60);
}
function renderCCRow(){
  const block=document.getElementById('cc-card-block'); if(!block) return;
  const d=loadCCData();
  const balance=parseFloat(d.balance)||0;
  const dueTxt=ccDueText(d);
  const overdue=dueTxt.indexOf('Overdue')===0;
  if(!ccEditing){
    block.innerHTML=
      '<div class="bud-row cc-row" onclick="ccToggleEdit()" style="cursor:pointer">'+
        '<div class="bud-row-left">'+
          '<div class="bud-row-name">💳 Card balance owed</div>'+
          '<div class="bud-row-budget"'+(overdue?' style="color:var(--danger)"':'')+'>'+dueTxt+'</div>'+
        '</div>'+
        '<div class="bud-row-calc" style="color:var(--text)">$'+balance.toFixed(0)+'</div>'+
      '</div>';
  } else {
    const dueVal = d.dueDate ? String(d.dueDate).slice(0,10) : '';
    block.innerHTML=
      '<div class="bud-row cc-row">'+
        '<div class="bud-row-name" onclick="ccToggleEdit()" style="cursor:pointer">💳 Card balance owed</div>'+
        '<input class="bud-row-input" type="number" inputmode="decimal" placeholder="$0" id="cc-balance-input" value="'+(d.balance!==undefined&&d.balance!==''?d.balance:'')+'" oninput="updateCCBalance()">'+
      '</div>'+
      '<div class="bud-row cc-row">'+
        '<div class="bud-row-name" style="font-weight:500;color:var(--muted)">Repayment due</div>'+
        '<input class="bud-row-input" type="date" id="cc-due-input" value="'+dueVal+'" onchange="updateCCDue()" style="width:150px">'+
      '</div>';
  }
}
function loadCCInput(){ renderCCRow(); }

function daysUntil(targetDay,today){
  const nowDay=new Date(today+'T12:00:00').getDay();
  let diff=(targetDay-nowDay+7)%7;
  return diff===0?'Today! 🎉':'in '+diff+' day'+(diff===1?'':'s');
}
function homeHeroContent(goalCals,kcalTotal,budLeft,budPillCls,budPillTxt){
  if(goalCals){
    const pct=Math.min(100,Math.round(kcalTotal/goalCals*100));
    const rem=goalCals-kcalTotal;
    const ringCol=rem<0?'var(--danger)':pct>80?'var(--warn)':'var(--success)';
    const R=44,circ=+(2*Math.PI*R).toFixed(1),offset=+(circ*(1-pct/100)).toFixed(1);
    return (
      '<div style="display:flex;align-items:center;gap:16px;justify-content:center;padding:6px 0">'+
      '<svg width="110" height="110" viewBox="0 0 110 110" style="flex-shrink:0">'+
        '<circle cx="55" cy="55" r="'+R+'" fill="none" stroke="var(--border)" stroke-width="9"/>'+
        '<circle cx="55" cy="55" r="'+R+'" fill="none" stroke="'+ringCol+'" stroke-width="9"'+
        ' stroke-dasharray="'+circ+'" stroke-dashoffset="'+offset+'"'+
        ' stroke-linecap="round" transform="rotate(-90 55 55)"/>'+
        '<text x="55" y="52" text-anchor="middle" dominant-baseline="middle" font-size="19" font-weight="800" fill="var(--text)">'+kcalTotal+'</text>'+
        '<text x="55" y="67" text-anchor="middle" font-size="10" fill="var(--muted)">eaten</text>'+
      '</svg>'+
      '<div>'+
        '<div style="font-size:30px;font-weight:700;letter-spacing:-1px;color:'+ringCol+';line-height:1">'+(rem>=0?rem:Math.abs(rem))+'</div>'+
        '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">'+(rem>=0?'kcal remaining':'kcal over target')+'</div>'+
        '<div style="font-size:11px;font-weight:600;color:var(--muted)">Goal: '+goalCals+' kcal</div>'+
      '</div>'+
      '</div>');
  } else if(budLeft!==null){
    const col=budLeft>=0?'var(--success)':'var(--danger)';
    return (
      '<div style="text-align:center;padding:14px 0">'+
        '<div style="font-size:30px;font-weight:700;letter-spacing:-1px;color:'+col+';line-height:1;margin-bottom:6px">'+(budLeft>=0?'+$':'-$')+Math.abs(budLeft).toFixed(0)+'</div>'+
        '<div style="font-size:13px;color:var(--muted);margin-bottom:10px">This week\'s leftover</div>'+
        '<span class="status-pill '+budPillCls+'">'+budPillTxt+'</span>'+
      '</div>');
  } else {
    return '<div style="text-align:center;padding:14px 0;font-size:13px;color:var(--muted)">Set up your profile to see calorie targets</div>';
  }
}
function homeSavingsInner(){
  const last8=savingsLog.slice(-8);
  if(last8.length){
    const latest=last8[last8.length-1];
    const diffDays=Math.floor((new Date()-new Date(latest.date))/(864e5));
    const ago=diffDays===0?'today':diffDays===1?'yesterday':diffDays+' days ago';
    const vals=last8.map(e=>e.balance);
    const maxV=Math.max(...vals),minV=Math.min(...vals),range=maxV-minV||maxV||1;
    const bars=last8.map((e,i)=>{
      const prev=i>0?last8[i-1].balance:e.balance;
      const col=e.balance<prev?'var(--danger)':'var(--success)';
      const h=Math.max(8,Math.round(((e.balance-minV)/range)*36+8));
      return '<div style="flex:1;display:flex;align-items:flex-end;padding:0 1px"><div style="width:100%;height:'+h+'px;background:'+col+';border-radius:2px 2px 0 0;opacity:0.85"></div></div>';
    }).join('');
    return (
      '<div style="display:flex;justify-content:space-between;align-items:flex-end">'+
        '<div>'+
          '<div style="font-size:22px;font-weight:800">$'+latest.balance.toLocaleString()+'</div>'+
          '<div style="font-size:11px;color:var(--muted)">Updated '+ago+'</div>'+
        '</div>'+
        '<button class="sav-update-btn" onclick="event.stopPropagation();updateSavingsBalance()">Update</button>'+
      '</div>'+
      '<div style="display:flex;align-items:flex-end;height:40px;gap:2px;margin-top:8px">'+bars+'</div>');
  } else {
    return (
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-size:22px;font-weight:800;color:var(--muted)">$—</div>'+
        '<button class="sav-update-btn" onclick="event.stopPropagation();updateSavingsBalance()">Update</button>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:4px">No balance logged</div>');
  }
}

function renderHome(){
  const wrap=document.getElementById('home-content'); if(!wrap) return;
  const name=profileData.name||S.personalInfo.name||'';

  // Greeting (time-of-day + saved profile name)
  const greetLine=getGreeting();

  // Calories
  const today=getLocalDate();
  if(S.dailyLog.date!==today){ S.dailyLog={date:today,entries:[]}; persistDailyLog(); }
  const c=calcGoalCals();
  const goalCals=c?(c.goal==='cut'?c.cut:c.goal==='bulk'?c.bulk:c.maintain):null;
  const kcalTotal=S.dailyLog.entries.reduce((a,e)=>a+e.kcal,0);

  // Budget leftover — from the CURRENT WEEK's saved data (same accessors as the Budget
  // tab: weekIncome / weekLeftover) so Home always matches what the Budget tab shows.
  let budLeft=null,budPillCls='good',budPillTxt='';
  const curWk=budgetData[weekKey(getMondayOf(0))];
  const incTot=curWk?weekIncome(curWk):0;
  if(incTot>0){
    budLeft=weekLeftover(curWk);
    budPillCls=budLeft>=50?'good':budLeft>=0?'warn':'over';
    budPillTxt=budLeft>=50?'🟢 On track':budLeft>=0?'🟡 Tight':'🔴 Over';
  }

  const heroContent=homeHeroContent(goalCals,kcalTotal,budLeft,budPillCls,budPillTxt);

  // Workout streak (consecutive days with logged sessions)
  const sessDates=[...new Set(S.sessions.map(s=>s.date))].sort();
  let wStreak=0;
  const dw=localMidnight(getLocalDate());
  while(true){ const ds=dateStr(dw); if(sessDates.includes(ds)){wStreak++;dw.setDate(dw.getDate()-1);}else break; }

  // Check-in streak
  const {current:ciStreak}=calcStreak();

  // This week's saved amount (the weekly-savings target was removed) + next workout
  const thisWeekSaved=Math.round(weekSavedAmt(budgetData[weekKey(getMondayOf(0))]||{}));
  const nextIdx=suggestDay();
  const nextType=type(nextIdx);
  const dayNum=nextIdx+1;

  // Pay day countdown tiles — one per named income source (loadIncCats), no hardcoded names.
  const payDayTiles=loadIncCats()
    .filter(c=>(c.name||'').trim())
    .map(c=>{
      const str=daysUntil(getPayDay(c.id),today);
      const nm=_catEscHtml(c.name.trim());
      return '<div class="card" onclick="setView(\'budget\')" style="margin-bottom:0;padding:14px;text-align:center;cursor:pointer">'+
        '<div style="font-size:22px;margin-bottom:2px">📅</div>'+
        '<div style="font-size:14px;font-weight:700;line-height:1.2;color:'+(str==='Today! 🎉'?'var(--accent)':'var(--text)')+'">'+str+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">'+nm+' pay</div>'+
      '</div>';
    }).join('');

  // Last week's total pay (sum of income sources recorded for the previous budget week)
  const lastWk=budgetData[weekKey(getMondayOf(-1))];
  const lastWeekPay=lastWk?weekIncome(lastWk):0;

  const savInner=homeSavingsInner();

  const heroHdrCol=goalCals?'#52B788':budLeft!==null?'#FF6B35':'#64748b';
  const heroHdrTxt=goalCals?'Calorie progress':budLeft!==null?'💰 Budget summary':'📊 Overview';

  // ── Momentum redesign: top-of-Home cards (display only; reuse existing data) ──
  const mCurType=type(S.dayIdx);
  const mExCount=mCurType.exercises.length;
  const mDone=S.checked.size;
  const mPct=mExCount?Math.round(mDone/mExCount*100):0;
  const mGoal=6;
  const mMon=getMondayOf(0);
  const mSessions=[...new Set(S.sessions.filter(s=>localMidnight(s.date)>=mMon).map(s=>s.date))].length;
  let mSegs=''; for(let i=0;i<mGoal;i++){ mSegs+='<div class="session-seg'+(i<mSessions?' done':'')+'"></div>'; }
  const mBudIncome=incTot>0?incTot:0;
  const mBudRem=incTot>0?budLeft:0;
  const mBudSpent=incTot>0?(incTot-budLeft):0;
  const mBudPct=mBudIncome>0?Math.min(mBudSpent/mBudIncome*100,100):0;
  const mBudOver=mBudRem<0;
  const mBudCol=mBudOver?'var(--danger)':'var(--positive)';
  const heroCard=
    '<div class="hero-workout-card">'+
      '<div class="hero-top">'+
        '<span class="hero-label">TODAY\'S SESSION</span>'+
        '<button class="hero-play-btn" aria-label="Go to workout" onclick="setView(\'log\')">'+
          '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M5 3.5l10 5.5-10 5.5V3.5z" fill="#e8541f"/></svg>'+
        '</button>'+
      '</div>'+
      '<p class="hero-workout-title" id="hero-day-name">'+mCurType.name+'</p>'+
      '<p class="hero-meta" id="hero-meta">'+mExCount+' exercise'+(mExCount!==1?'s':'')+'</p>'+
      '<div class="hero-progress-row">'+
        '<span class="hero-progress-text" id="hero-progress-text">'+mDone+' of '+mExCount+' done</span>'+
        '<span class="hero-progress-pct" id="hero-progress-pct">'+mPct+'%</span>'+
      '</div>'+
      '<div class="hero-progress-track"><div class="hero-progress-fill" id="hero-progress-fill" style="width:'+mPct+'%;"></div></div>'+
    '</div>';
  const statsSplit=
    '<div class="card stats-split-card">'+
      '<div class="stats-left">'+
        '<p class="card-label">Streak</p>'+
        '<p class="metric-num" id="home-streak">'+wStreak+'</p>'+
        '<p class="metric-unit">days</p>'+
      '</div>'+
      '<div class="stats-divider"></div>'+
      '<div class="stats-right">'+
        '<p class="card-label">This week</p>'+
        '<p class="metric-num" id="home-sessions">'+mSessions+' <span class="metric-unit">of '+mGoal+'</span></p>'+
        '<div class="sessions-bar-row" id="home-sessions-bar">'+mSegs+'</div>'+
      '</div>'+
    '</div>';
  const budgetSnapshot=
    '<div class="card budget-snapshot-card" onclick="setView(\'budget\')" style="cursor:pointer">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'+
        '<p class="card-label" style="margin:0">WEEKLY BUDGET</p>'+
        '<span class="budget-snap-pill'+(mBudOver?' over':'')+'" id="home-bud-status">'+(mBudOver?'Over budget':'On track')+'</span>'+
      '</div>'+
      '<p class="metric-num" id="home-bud-remaining" style="color:#fff;margin:8px 0 2px">'+(mBudRem>=0?'$':'-$')+Math.abs(Math.round(mBudRem))+'</p>'+
      '<p class="metric-unit" id="home-bud-label">left of $'+Math.round(mBudIncome)+'</p>'+
      '<div style="height:7px;background:rgba(255,255,255,.25);border-radius:5px;overflow:hidden;margin-top:12px"><div id="home-bud-bar" style="height:100%;border-radius:5px;background:#fff;width:'+mBudPct+'%;transition:width .3s"></div></div>'+
    '</div>';

  // Calorie / overview card
  const overviewCard=
    '<div class="card hero-card"'+(goalCals?' onclick="openCalorieOverlay()"':'')+' style="margin-bottom:12px;padding:0;overflow:hidden'+(goalCals?';cursor:pointer':'')+'">'+
      '<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">'+heroHdrTxt+'</div>'+
      '<div class="overview-content" style="padding:14px 16px">'+
        '<div class="overview-greeting" style="font-size:15px;font-weight:700;margin-bottom:12px">'+greetLine+'</div>'+
        heroContent+
      '</div>'+
    '</div>';

  // Savings balance + credit card tracker (side by side)
  const balanceRow=
    '<div class="home-balance-row">'+
      '<div class="card home-balance-card" onclick="setView(\'budget\')" style="padding:0;overflow:hidden;cursor:pointer">'+
        '<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">🏦 Savings balance</div>'+
        '<div style="padding:14px 16px">'+
          savInner+
        '</div>'+
      '</div>'+
      '<div class="card home-cc-card" onclick="setView(\'budget\')" style="cursor:pointer">'+
        '<div class="card-label">💳 Credit card</div>'+
        '<div class="home-cc-balance" id="home-cc-balance">$0</div>'+
        '<div class="home-cc-due" id="home-cc-due">Due —</div>'+
        '<div class="home-cc-status" id="home-cc-status" style="display:none"></div>'+
      '</div>'+
    '</div>';

  // Quick-info tiles (de-duplicated: no streak/next-workout — those live in the cards above)
  const quickTiles=
    '<div class="home-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px">'+
      '<div class="card" onclick="setView(\'budget\')" style="margin-bottom:0;padding:14px;text-align:center;cursor:pointer">'+
        '<div style="font-size:22px;margin-bottom:2px">💰</div>'+
        '<div style="font-size:22px;font-weight:800;line-height:1;color:var(--success)">$'+thisWeekSaved+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Saved this week</div>'+
      '</div>'+
      '<div class="card" onclick="setView(\'budget\')" style="margin-bottom:0;padding:14px;text-align:center;cursor:pointer">'+
        '<div style="font-size:22px;margin-bottom:2px">💵</div>'+
        '<div style="font-size:22px;font-weight:800;line-height:1">$'+Math.round(lastWeekPay)+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Last week\'s pay</div>'+
      '</div>'+
      payDayTiles+
    '</div>';

  // Each card is a draggable unit (data-card-id); assembled in the user's saved order
  // so a reorder survives the next renderHome. (Recent workout + Stats render separately.)
  const homeCards={
    session: heroCard,
    streak: statsSplit,
    calories: overviewCard,
    review: buildWeekSummaryCard(),
    habits: buildTodayHabitsCard(),
    budget: budgetSnapshot,
    balance: balanceRow,
    tiles: quickTiles,
    notes: buildHomeNotesCard()
  };
  wrap.innerHTML = homeOrderedKeys(homeCards)
    .map(k=>'<div class="home-card" data-card-id="'+k+'">'+homeCards[k]+'</div>').join('');
  document.querySelectorAll('#view-home .card').forEach((card, i) => {
    card.style.animationDelay = (i * 45) + 'ms';
    card.classList.add('home-card-enter');
    setTimeout(() => card.classList.remove('home-card-enter'), 600 + i * 45);
  });
  if(homeEditMode) applyHomeEditMode();

  renderHomeRecent();
  renderCCCard();
  applyDayColour();
}

// ── Home card reorder (iPhone-style edit mode) ────────────────────
const HOME_DEFAULT_ORDER=['session','streak','calories','review','habits','budget','balance','tiles','notes'];
function loadHomeOrder(){ return lsLoad('daily_home_order', null, Array.isArray); }
function saveHomeOrderArr(arr){ lsSave('daily_home_order', arr, 'homeOrder'); }
// Saved order first (only keys that still exist), then any defaults/new cards appended.
function homeOrderedKeys(cards){
  const saved=loadHomeOrder()||[]; const keys=[];
  saved.forEach(k=>{ if(cards[k]!==undefined && keys.indexOf(k)<0) keys.push(k); });
  HOME_DEFAULT_ORDER.forEach(k=>{ if(cards[k]!==undefined && keys.indexOf(k)<0) keys.push(k); });
  Object.keys(cards).forEach(k=>{ if(keys.indexOf(k)<0) keys.push(k); });
  return keys;
}
function saveHomeOrder(){
  const order=[...document.querySelectorAll('#home-content [data-card-id]')].map(c=>c.dataset.cardId);
  if(order.length) saveHomeOrderArr(order);
}
let homeEditMode=false;
function toggleHomeEdit(){
  homeEditMode=!homeEditMode;
  const btn=document.getElementById('home-edit-btn');
  if(btn){ btn.textContent=homeEditMode?'Done':'Edit'; btn.classList.toggle('active',homeEditMode); }
  applyHomeEditMode();
}
function applyHomeEditMode(){
  const hc=document.getElementById('home-content');
  if(hc) hc.classList.toggle('home-editing',homeEditMode);
  document.querySelectorAll('#home-content [data-card-id]').forEach(c=>c.classList.toggle('home-card-jiggle',homeEditMode));
}
// Touch drag-to-reorder with a floating clone. Active only in Home edit mode.
(function(){
  let card=null, clone=null, offY=0;
  document.addEventListener('touchstart',function(e){
    if(!homeEditMode || S.view!=='home') return;
    const c=e.target.closest('#home-content [data-card-id]'); if(!c) return;
    card=c;
    const t=e.touches[0], r=c.getBoundingClientRect(); offY=t.clientY-r.top;
    clone=c.cloneNode(true);
    clone.classList.remove('home-card-jiggle');
    clone.style.cssText='position:fixed;left:'+r.left+'px;top:'+r.top+'px;width:'+r.width+'px;opacity:.92;z-index:9999;pointer-events:none;transform:scale(1.03);box-shadow:0 14px 34px rgba(0,0,0,.45);animation:none;margin:0';
    document.body.appendChild(clone);
    c.style.opacity='.25';
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(!card||!clone) return;
    e.preventDefault();
    const t=e.touches[0];
    clone.style.top=(t.clientY-offY)+'px';
    clone.style.display='none';
    const el=document.elementFromPoint(t.clientX,t.clientY);
    clone.style.display='';
    const target=(el&&el.closest)?el.closest('#home-content [data-card-id]'):null;
    if(target&&target!==card&&target.parentElement===card.parentElement){
      const r=target.getBoundingClientRect();
      const after=t.clientY>r.top+r.height/2;
      card.parentElement.insertBefore(card, after?target.nextSibling:target);
    }
  },{passive:false});
  function endDrag(){ if(!card) return; card.style.opacity=''; if(clone){ clone.remove(); clone=null; } card=null; saveHomeOrder(); }
  document.addEventListener('touchend',endDrag);
  document.addEventListener('touchcancel',endDrag);
})();

// Persistent Home "Recent workout" card (last saved session, tap to expand exercises).
// Rendered separately from the draggable home-content cards, into its own #home-recent-card.
function renderHomeRecent(){
  const recent=document.getElementById('home-recent-card');
  if(recent){
    if(!S.sessions.length){
      recent.innerHTML='';
    } else {
      const s=S.sessions[S.sessions.length-1];
      const tc=splitTypes().find(t=>t.name===s.sessionType)||splitTypes()[0];
      const detail=s.exercises.map(ex=>
        '<div class="session-ex-row"><div class="session-ex-name">'+dn(ex.name)+'</div>'+
        ex.sets.map((set,si)=>'<div class="session-set-line">Set '+(si+1)+': '+(set.weight?set.weight+'kg':'—')+' × '+(set.reps||'—')+'</div>').join('')+
        '</div>').join('');
      recent.innerHTML=
        '<div class="card" style="cursor:pointer" onclick="var d=this.querySelector(\'.home-recent-detail\');d.style.display=d.style.display===\'block\'?\'none\':\'block\'">'+
          '<div class="settings-card-title" style="margin-bottom:10px">🏋️ Recent workout</div>'+
          '<div class="session-card-top">'+
            '<div class="session-date-str">'+fmtDate(s.date)+' · Day '+s.dayNum+'</div>'+
            '<div class="session-type-pill '+tc.id+'">'+s.sessionType+'</div>'+
          '</div>'+
          '<div class="session-summary">'+s.exercises.length+' exercise'+(s.exercises.length!==1?'s':'')+' · tap to '+'expand</div>'+
          '<div class="home-recent-detail" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">'+detail+'</div>'+
        '</div>';
    }
  }
}

// iOS standalone PWAs disable window.prompt(), which is why the old Update button
// "did nothing" on iPhone. Use an in-app modal instead.
function updateSavingsBalance(){
  const modal=document.getElementById('savings-modal');
  const input=document.getElementById('savings-input');
  if(!modal||!input) return;
  const latest=savingsLog.length?savingsLog[savingsLog.length-1].balance:'';
  input.value=latest===''?'':String(latest);
  modal.classList.remove('hidden');
  setTimeout(()=>{ input.focus(); input.select(); }, 50);
}
function closeSavingsModal(){
  const modal=document.getElementById('savings-modal');
  if(modal) modal.classList.add('hidden');
}
function confirmSavingsBalance(){
  const input=document.getElementById('savings-input');
  if(!input) return;
  const bal=parseFloat(String(input.value).replace(/[^0-9.]/g,''));
  if(isNaN(bal)||bal<0){ closeSavingsModal(); return; } // close even on an invalid entry
  const today=getLocalDate();
  savingsLog=savingsLog.filter(e=>e&&e.date!==today);
  savingsLog.push({date:today,balance:bal,t:Date.now()}); // t = edit time, used to win merges
  savingsLog.sort((a,b)=>a.date<b.date?-1:1);
  saveSavingsLog();      // persists locally + (safely) syncs to cloud
  closeSavingsModal();   // close before re-render so a render error can't keep it open
  try{ renderHome(); }catch(err){ console.error('renderHome after savings save failed', err); }
}

// Keep bottom-sheet modals above the iOS keyboard. Every .modal-overlay aligns its
// .modal-box to the bottom (flex-end) — exactly where the keyboard opens — so the Save
// button can end up hidden. When visualViewport shrinks, lift the visible modal's box by
// the keyboard height. One delegated handler covers savings, swap, kitchen form, etc.
// Defined at module scope (not inside an IIFE) so the focusin handler below can call it
// explicitly after the keyboard has fully appeared, covering devices where the resize
// event fires before the modal is rendered or mid-animation.
function adjustModalsForKeyboard(){
  if(!window.visualViewport) return;
  const kb = window.innerHeight - window.visualViewport.height;
  if(kb > 100){ // >100px ≈ a keyboard (ignore URL-bar / minor viewport jitter)
    document.querySelectorAll('.modal-overlay:not(.hidden) .modal-box').forEach(box=>{
      box.style.transition = 'margin-bottom 0.2s ease';
      box.style.marginBottom = kb + 'px';
      // Constrain the box to the space above the keyboard so its (pinned) buttons stay on screen.
      box.style.maxHeight = (window.visualViewport.height - 12) + 'px';
    });
  } else {
    document.querySelectorAll('.modal-box').forEach(box=>{ box.style.marginBottom = ''; box.style.maxHeight = ''; });
  }
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', adjustModalsForKeyboard);
  window.visualViewport.addEventListener('scroll', adjustModalsForKeyboard);
}

// On mobile, handle keyboard appearing over inputs:
// • Modal inputs: re-run the modal lift after 400 ms so the keyboard is fully up.
//   The visualViewport resize event alone isn't reliable — it can fire before the
//   modal is visible, or the final height isn't settled yet.
// • Non-modal inputs (budget rows, settings): scroll into view so they aren't hidden.
document.addEventListener('focusin', function(e){
  const el = e.target;
  if(!el || window.innerWidth >= 1024) return;
  if(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'){
    if(el.closest('.modal-overlay')){
      setTimeout(adjustModalsForKeyboard, 400);
    } else {
      // Delay until the keyboard has started to appear so the scroll target
      // accounts for the reduced visible area above it.
      setTimeout(function(){ el.scrollIntoView({behavior:'smooth', block:'center'}); }, 320);
    }
  }
});

// ── Onboarding ────────────────────────────────────────────────────
// Data-driven multi-step flow: the step order lives in OB_STEPS, so the progress dots
// and the Back/Skip logic derive from that array — adding or removing a step needs no
// dot markup and no renumbering. Every answer is staged in obData (not the DOM) so
// Back/forward navigation preserves what was entered.
const OB_VERSION = 2;             // bump when onboarding gains steps worth re-showing existing users
const OB_STEPS = ['welcome','theme','profile','body','split','habits','sync','done'];
const OB_FIX_CHIPS = ['Rent','Phone','Subscriptions','Transport','Gym'];
let obBudgetStarted = false;
const OB_HABIT_SUGGESTIONS = ['Morning workout','Hit calorie goal','Log budget','8h sleep','Drink 2L water','10k steps','Stretch 10 min','Read 20 min','No junk food','Meditate'];
let obStep = 0;
let obData = {};
let obAuthUnsub = null;
let obHabitOptions = [];

function obNum(v){ const n=parseFloat(v); return isFinite(n)?n:undefined; }
function obEsc(s){ return (s==null?'':String(s)).replace(/"/g,'&quot;'); }

function checkOnboarding(){
  const named = !!(profileData.name||'').trim();
  if(!named){ showOnboarding(); return; }
  // Existing user: reconcile their stored onboarding version against the current one.
  const v = profileData.onboardingVersion || 0;
  if(v < OB_VERSION){
    if(v === 0){
      // Pre-versioning user — they've already used the app, so silently seed them to the
      // current version. This means only FUTURE bumps (v≥1 → newer) can trigger a nudge.
      profileData.onboardingVersion = OB_VERSION;
      localStorage.setItem('daily_profile', JSON.stringify(profileData));
      syncProfileToFirebase();
    } else {
      // A later release bumps OB_VERSION and re-introduces new features here. The nudge UI
      // is intentionally NOT built yet — this is just the ready hook so it's wired up.
      showWhatsNew(v, OB_VERSION);
    }
  }
}
// Placeholder for the future "here's what's new" re-introduction shown to existing users
// after a version bump. Deliberately a no-op today so the version check is in place without
// disrupting anyone — a later release fills this in and marks the version handled.
function showWhatsNew(fromVersion, toVersion){ /* TODO: future what's-new nudge */ }

function showOnboarding(){
  obDetachAuthWatch();
  obStep = 0;
  obBudgetStarted = false;
  obSplitDraft = null;
  obData = { theme: S.theme, habits: (loadHabits()||[]).slice() };
  renderObStep();
  document.getElementById('onboarding-overlay').classList.remove('hidden');
}
// Blank the shared budgetConfig to a single empty income row + no fixed expenses, but ONLY
// for a genuinely new user (no budget saved yet). An existing account re-running onboarding
// keeps its real budget untouched. Runs once when the budget step is first shown.
function obEnsureBudgetStarter(){
  if(obBudgetStarted) return;
  obBudgetStarted = true;
  if(localStorage.getItem('daily_budget_config')==null){
    saveBudgetConfig({
      incomeStreams:[{id:'i'+Date.now(),name:'',weeklyAmount:0}],
      fixedExpenses:[],
      variableExpenses:[],
    });
  }
}
function obAddFixChip(name){
  if(!Array.isArray(budgetConfig.fixedExpenses)) budgetConfig.fixedExpenses=[];
  budgetConfig.fixedExpenses.push({id:'f'+Date.now(),name:name,weeklyAmount:0});
  saveBudgetConfig(budgetConfig);
  renderBudgetEditList('ob-fix-list','fixedExpenses');
}

// ── Training split editor (shared: onboarding 'split' step + Settings overlay) ──
// Works on a flat, editable list of "days" (each = name + its own exercise list). On save
// it becomes splitConfig.types with a 1:1 schedule. splitToDays expands an existing split's
// schedule so what you edit matches the rotation you actually see.
let obSplitDraft = null;
const SE = { days:[], target:-1, pickerQuery:'', container:'se-wrap' };
function splitToDays(cfg){
  const src=(cfg&&Array.isArray(cfg.types)&&cfg.types.length)?cfg:splitCfg();
  const sch=(Array.isArray(src.schedule)&&src.schedule.length)?src.schedule:src.types.map((_,i)=>i);
  return sch.map((idx,i)=>{
    const t=src.types[idx]||src.types[0]||{};
    return {
      id:'d'+i+'_'+Math.random().toString(36).slice(2,6),
      name:t.name||('Day '+(i+1)),
      colorKey:t.colorKey||'',
      barColor:t.barColor||SPLIT_PALETTE[i%SPLIT_PALETTE.length],
      exercises:(t.exercises||[]).map(e=>({...e})),
    };
  });
}
function daysToSplit(days){
  const types=(days||[]).map((d,i)=>({
    id:d.id||('d'+i+'_'+Math.random().toString(36).slice(2,6)),
    name:(d.name||('Day '+(i+1))).trim()||('Day '+(i+1)),
    colorKey:d.colorKey||'',
    barColor:d.barColor||SPLIT_PALETTE[i%SPLIT_PALETTE.length],
    exercises:(d.exercises||[]).filter(e=>e&&e.name).map(e=>({...e, sets:e.sets||1})),
  }));
  return { types, schedule: types.map((_,i)=>i) };
}
function seRerender(){ renderSplitEditor(SE.container); }
function renderSplitEditor(containerId){
  const el=document.getElementById(containerId||SE.container); if(!el) return;
  SE.container=containerId||SE.container;
  const days=SE.days;
  let html=days.map((d,i)=>
    '<div class="se-day-card">'+
      '<div class="se-day-head">'+
        '<span class="se-day-dot" style="background:'+typeGridColor(d)+'"></span>'+
        '<input class="se-day-name" value="'+_catEsc(d.name)+'" placeholder="Day name" oninput="seRenameDay('+i+',this.value)">'+
        (days.length>1?'<button class="se-day-del" onclick="seRemoveDay('+i+')" aria-label="Remove day">×</button>':'')+
      '</div>'+
      '<div class="se-ex-list">'+
        (d.exercises.length ? d.exercises.map((ex,j)=>
          '<div class="se-ex-row">'+
            '<span class="se-ex-name">'+_catEscHtml(ex.name)+'</span>'+
            '<input class="se-ex-sets" type="number" inputmode="numeric" min="1" max="12" value="'+(ex.sets||1)+'" onchange="seSetSets('+i+','+j+',this.value)" aria-label="Sets">'+
            '<span class="se-ex-setslbl">sets</span>'+
            '<button class="se-ex-del" onclick="seRemoveExercise('+i+','+j+')" aria-label="Remove exercise">×</button>'+
          '</div>'
        ).join('') : '<div class="se-ex-empty">No exercises yet — add some below.</div>')+
      '</div>'+
      '<button class="se-add-ex" onclick="seOpenPicker('+i+')">+ Add exercise</button>'+
    '</div>'
  ).join('');
  html+='<button class="se-add-day" onclick="seAddDay()">+ Add training day</button>';
  if(SE.target>=0 && SE.days[SE.target]){
    html+='<div class="se-picker-backdrop" onclick="seClosePicker()"></div>'+
      '<div class="se-picker">'+
        '<div class="se-picker-head">Add to “'+_catEscHtml(SE.days[SE.target].name||'day')+'”'+
          '<button class="se-picker-x" onclick="seClosePicker()" aria-label="Close">×</button></div>'+
        '<input class="se-picker-search" id="se-picker-search" placeholder="Search or type a new name…" value="'+_catEsc(SE.pickerQuery)+'" oninput="sePickerSearch(this.value)">'+
        '<div class="se-picker-list" id="se-picker-list">'+sePickerListHTML()+'</div>'+
      '</div>';
  }
  el.innerHTML=html;
  if(SE.target>=0){ setTimeout(()=>{ const s=document.getElementById('se-picker-search'); if(s){ s.focus(); s.setSelectionRange(s.value.length,s.value.length); } },30); }
}
function sePickerListHTML(){
  const d=SE.days[SE.target]; if(!d) return '';
  const lib=loadExerciseLib();
  const q=(SE.pickerQuery||'').toLowerCase().trim();
  const inDay=new Set((d.exercises||[]).map(e=>e.name.toLowerCase()));
  const filtered=lib.filter(e=>!inDay.has(e.name.toLowerCase())&&(!q||e.name.toLowerCase().includes(q)));
  let out=filtered.map(e=>
    '<button class="se-picker-item" onclick="sePick('+JSON.stringify(e.name).replace(/"/g,'&quot;')+')">'+
      '<span>'+_catEscHtml(e.name)+'</span><span class="se-picker-muscle">'+e.muscle+'</span></button>'
  ).join('');
  if(q && !lib.some(e=>e.name.toLowerCase()===q)){
    out+='<button class="se-picker-item se-picker-new" onclick="sePickCustom()">+ Add “'+_catEscHtml(SE.pickerQuery.trim())+'” as a new exercise</button>';
  }
  if(!out) out='<div class="se-ex-empty" style="padding:14px">Type a name above to add a new exercise.</div>';
  return out;
}
function seAddDay(){ const i=SE.days.length; SE.days.push({id:'d'+Date.now()+'_'+i,name:'Day '+(i+1),colorKey:'',barColor:SPLIT_PALETTE[i%SPLIT_PALETTE.length],exercises:[]}); seRerender(); }
function seRemoveDay(i){ if(SE.days.length<=1) return; SE.days.splice(i,1); seRerender(); }
function seRenameDay(i,val){ if(SE.days[i]) SE.days[i].name=val; } // no rerender — keep input focus
function seSetSets(i,j,val){ const n=Math.max(1,Math.min(12,parseInt(val)||1)); if(SE.days[i]&&SE.days[i].exercises[j]) SE.days[i].exercises[j].sets=n; }
function seRemoveExercise(i,j){ if(SE.days[i]&&SE.days[i].exercises) SE.days[i].exercises.splice(j,1); seRerender(); }
function seOpenPicker(i){ SE.target=i; SE.pickerQuery=''; seRerender(); }
function seClosePicker(){ SE.target=-1; SE.pickerQuery=''; seRerender(); }
function sePickerSearch(v){ SE.pickerQuery=v; const list=document.getElementById('se-picker-list'); if(list) list.innerHTML=sePickerListHTML(); }
function sePick(name){ const d=SE.days[SE.target]; if(d&&name&&!d.exercises.some(e=>e.name.toLowerCase()===String(name).toLowerCase())) d.exercises.push({name:String(name),sets:3}); SE.target=-1; SE.pickerQuery=''; seRerender(); }
function sePickCustom(){
  const name=(SE.pickerQuery||'').trim(); if(!name) return;
  const lib=loadExerciseLib();
  if(!lib.some(e=>e.name.toLowerCase()===name.toLowerCase())){ lib.push({id:'ex_custom_'+Date.now(),name,muscle:libGuessMuscle(name),custom:true}); saveExerciseLib(lib); }
  sePick(name);
}

// ── Onboarding 'split' step ──
function obSplitHTML(){
  if(!obSplitDraft) obSplitDraft = splitToDays(genericSplit());
  SE.days = obSplitDraft; SE.target=-1; SE.pickerQuery=''; SE.container='se-wrap';
  return '<div class="ob-head"><div class="ob-title">Build your split</div><div class="ob-desc">Add a day for each training session in your week, name it, and pick its exercises. Skip to start with a simple 3-day full-body split.</div></div>'+
    '<div id="se-wrap"></div>'+
    '<div class="ob-btn-row" style="margin-top:14px">'+
      '<button class="ob-btn-skip" onclick="obSkipSplit()">Skip</button>'+
      '<button class="ob-btn-primary ob-btn-inline" onclick="obNext()">Continue →</button>'+
    '</div>';
}
function obSkipSplit(){ obData.splitSkipped=true; obSplitDraft=null; obNext(); }

// ── Settings overlay entry points ──
function openSplitEditor(){
  SE.days = splitToDays(splitCfg()); SE.target=-1; SE.pickerQuery=''; SE.container='split-editor-wrap';
  const v=document.getElementById('view-split-editor'); if(!v) return;
  v.style.display='block';
  v.style.left=window.innerWidth>=1024?'260px':'0';
  renderSplitEditor('split-editor-wrap');
  if(typeof closeMenu==='function') closeMenu();
}
function closeSplitEditor(){ const v=document.getElementById('view-split-editor'); if(v){ v.style.display='none'; v.style.left='0'; } }
function saveSplitEditor(){
  const cfg=daysToSplit(SE.days);
  if(!cfg.types.length){ closeSplitEditor(); return; }
  splitConfig=cfg; saveSplit();
  if(S.dayIdx>=scheduleLen()) S.dayIdx=0;
  closeSplitEditor();
  if(S.view==='log'&&typeof renderLog==='function') renderLog();
  if(S.view==='home'&&typeof renderHome==='function') renderHome();
  if(S.view==='stats'&&statsSubTab==='training'&&typeof renderTraining==='function') renderTraining();
}

// ── Budget structural editor (Settings → Budget) ──────────────────
// Full-screen editor for the income / fixed / variable CATEGORY structure, built on the
// shared budgetConfig line-item system (add/update/deleteBudgetItem + renderBudgetEditList).
// Edits save live; the Budget tab keeps handling the week-to-week numbers as before.
function openBudgetEditor(){
  const v=document.getElementById('view-budget-editor'); if(!v) return;
  v.style.display='block';
  v.style.left=window.innerWidth>=1024?'260px':'0';
  renderBudgetEditor();
  if(typeof closeMenu==='function') closeMenu();
}
function renderBudgetEditor(){
  renderBudgetEditList('be-inc','incomeStreams');
  renderBudgetEditList('be-fix','fixedExpenses');
  renderBudgetEditList('be-var','variableExpenses');
  renderSubscriptionsSection();
}
function closeBudgetEditor(){ const v=document.getElementById('view-budget-editor'); if(v){ v.style.display='none'; v.style.left='0'; } }

// ── Navigation ──
function obGo(step){
  obCaptureCurrent();
  obStep = Math.max(0, Math.min(step, OB_STEPS.length-1));
  renderObStep();
}
function obNext(){ obGo(obStep+1); }
function obBack(){ obGo(obStep-1); }
function obProfileContinue(){
  const name=(document.getElementById('ob-name')?.value||'').trim();
  if(!name){ const e=document.getElementById('ob-error'); if(e) e.style.display='block'; return; }
  obNext();
}

// Read the current step's inputs into obData before the DOM is replaced. Theme, goal and
// habits are captured live by their own tap handlers, so only the text/number/select
// fields need reading here.
function obCaptureCurrent(){
  const step=OB_STEPS[obStep];
  const val=id=>{ const el=document.getElementById(id); return el?el.value:undefined; };
  if(step==='profile'){
    // Income + fixed expenses are edited live via the shared budgetConfig list editor
    // (renderBudgetEditList), so only name + savings need reading from the DOM here.
    obData.name=(val('ob-name')||'').trim();
    obData.savings=obNum(val('ob-savings'));
  } else if(step==='body'){
    obData.age=obNum(val('ob-age'));
    if(val('ob-sex')!==undefined) obData.sex=val('ob-sex');
    obData.height=obNum(val('ob-height'));
    obData.weight=obNum(val('ob-weight'));
    if(val('ob-activity')!==undefined) obData.activity=val('ob-activity');
    obData.wgTarget=obNum(val('ob-wg-target'));
    obData.wgDate=val('ob-wg-date')||'';
  }
}

// ── Live tap handlers ──
function obSetTheme(t){ obData.theme=t; setTheme(t); renderObStep(); } // re-themes overlay + app live
function obSetGoal(g){ obCaptureCurrent(); obData.goal=g; renderObStep(); }
function obToggleHabit(i){
  const h=obHabitOptions[i]; if(h==null) return;
  obCaptureCurrent();
  const idx=obData.habits.findIndex(x=>x.toLowerCase()===h.toLowerCase());
  if(idx>=0) obData.habits.splice(idx,1); else obData.habits.push(h);
  renderObStep();
}
function obAddCustomHabit(){
  const el=document.getElementById('ob-habit-custom');
  const v=(el?.value||'').trim(); if(!v) return;
  if(!obData.habits.some(h=>h.toLowerCase()===v.toLowerCase())) obData.habits.push(v);
  renderObStep();
  setTimeout(()=>{ const c=document.getElementById('ob-habit-custom'); if(c) c.focus(); },30);
}

// ── Cloud-sync step ──
function obSignIn(){
  if(!(firebaseReady&&auth)){ obNext(); return; }
  obAttachAuthWatch();
  handleAuth(); // opens the Google popup; the watcher advances to 'done' once it resolves
}
function obAttachAuthWatch(){
  if(!firebaseReady||!auth||obAuthUnsub) return;
  obAuthUnsub = auth.onAuthStateChanged(u=>{
    if(u && OB_STEPS[obStep]==='sync'){ obData.synced=true; obGo(OB_STEPS.indexOf('done')); }
  });
}
function obDetachAuthWatch(){ if(obAuthUnsub){ try{ obAuthUnsub(); }catch(e){} obAuthUnsub=null; } }

// ── Renderer ──
function renderObStep(){
  const box=document.getElementById('onboarding-box'); if(!box) return;
  const step=OB_STEPS[obStep];
  const dots='<div class="ob-dots">'+OB_STEPS.map((_,i)=>'<div class="ob-dot'+(i===obStep?' active':'')+'"></div>').join('')+'</div>';
  const showBack = obStep>0 && step!=='done';
  const topbar='<div class="ob-topbar">'+(showBack?'<button class="ob-back" onclick="obBack()">‹ Back</button>':'')+'</div>';
  if(step==='profile') obEnsureBudgetStarter(); // blank the budget for new users before we render its editors
  let inner='';
  if(step==='welcome') inner=obWelcomeHTML();
  else if(step==='theme') inner=obThemeHTML();
  else if(step==='profile') inner=obProfileHTML();
  else if(step==='body') inner=obBodyHTML();
  else if(step==='split') inner=obSplitHTML();
  else if(step==='habits') inner=obHabitsHTML();
  else if(step==='sync') inner=obSyncHTML();
  else inner=obDoneHTML();
  box.innerHTML=topbar+dots+inner;
  box.scrollTop=0;
  if(step==='profile'){
    // Live income + fixed-expense list editors (shared budgetConfig system)
    renderBudgetEditList('ob-inc-list','incomeStreams');
    renderBudgetEditList('ob-fix-list','fixedExpenses');
    setTimeout(()=>{ const el=document.getElementById('ob-name'); if(el&&!el.value) el.focus(); },50);
  }
  if(step==='split') renderSplitEditor('se-wrap');
  if(step==='sync' && !(auth&&auth.currentUser)) obAttachAuthWatch();
}

function obFeature(icon,text){ return '<li><span class="ob-feat-ic">'+icon+'</span>'+text+'</li>'; }
function obWelcomeHTML(){
  return '<div class="ob-center">'+
    '<div class="ob-logo">Daily</div>'+
    '<div class="ob-tagline">One place for your training, nutrition, budget, kitchen and notes — all in sync.</div>'+
    '<ul class="ob-feature-list">'+
      obFeature('🏋️','Log workouts &amp; track PRs')+
      obFeature('🍎','Calories, TDEE &amp; weight goals')+
      obFeature('💰','Weekly budget &amp; savings')+
      obFeature('🍳','Recipes, shopping &amp; pantry')+
    '</ul>'+
    '<button class="ob-btn-primary" onclick="obNext()">Get started →</button>'+
  '</div>';
}
function obThemeHTML(){
  const opt=(val,label,icon)=>{
    const sel=obData.theme===val;
    return '<div class="ob-theme-opt'+(sel?' selected':'')+'" onclick="obSetTheme(\''+val+'\')">'+
      '<div class="ob-theme-mini ob-theme-mini-'+val+'">'+
        '<div class="budget-hero-card ob-mini-hero">'+
          '<div class="ob-mini-cap">Income this week</div>'+
          '<div class="ob-mini-big">$1,240</div>'+
          '<div class="ob-mini-sub">Saved $300 · Left $180</div>'+
        '</div>'+
        '<div class="ob-mini-card"></div>'+
        '<div class="ob-mini-card ob-mini-card-sm"></div>'+
      '</div>'+
      '<div class="ob-theme-name">'+icon+' '+label+(sel?' <span class="ob-theme-check">✓</span>':'')+'</div>'+
    '</div>';
  };
  return '<div class="ob-head"><div class="ob-title">Pick your look</div><div class="ob-desc">Tap to preview live — you can change it anytime in Settings.</div></div>'+
    '<div class="ob-theme-grid">'+opt('light','Light','☀️')+opt('dark','Dark','🌙')+'</div>'+
    '<button class="ob-btn-primary" onclick="obNext()">Continue →</button>';
}
function obProfileHTML(){
  const v=k=>obData[k]!==undefined&&obData[k]!==null?obData[k]:'';
  const chips=OB_FIX_CHIPS.map(c=>'<button type="button" class="ob-add-chip" onclick="obAddFixChip(\''+c+'\')">+ '+c+'</button>').join('');
  return '<div class="ob-head"><div class="ob-title">Tell us about you</div><div class="ob-desc">Only your name is required. Add your income and any fixed weekly expenses — you can change these anytime.</div></div>'+
    '<div class="settings-field"><label>Your name <span style="color:var(--danger)">*</span></label><input type="text" id="ob-name" value="'+obEsc(v('name'))+'" placeholder="e.g. Alex" autocomplete="name"></div>'+
    '<div class="ob-section-label">Income sources</div>'+
    '<div id="ob-inc-list"></div>'+
    '<div class="ob-section-label">Weekly fixed expenses</div>'+
    '<div class="ob-desc" style="margin:-4px 0 8px">Tap to add common ones, or use “+ Add item”.</div>'+
    '<div class="ob-chip-row">'+chips+'</div>'+
    '<div id="ob-fix-list"></div>'+
    '<div class="settings-field" style="margin-top:10px"><label>Weekly savings target ($)</label><input type="number" id="ob-savings" value="'+obEsc(v('savings'))+'" placeholder="e.g. 200" inputmode="decimal"></div>'+
    '<div id="ob-error" style="display:none;color:var(--danger);font-size:13px;margin:6px 0 0">Please enter your name to continue.</div>'+
    '<button class="ob-btn-primary" onclick="obProfileContinue()">Continue →</button>';
}
function obBodyHTML(){
  const v=k=>obData[k]!==undefined&&obData[k]!==null?obData[k]:'';
  const curSex=obData.sex||'male';
  const curAct=obData.activity!==undefined?String(obData.activity):'1.55';
  const goal=obData.goal||'maintain';
  const sexSel=s=>curSex===s?' selected':'';
  const actSel=a=>curAct===a?' selected':'';
  const gopt=(g,label)=>'<button type="button" class="ob-seg-btn'+(goal===g&&obData.goal!==undefined?' on':'')+'" onclick="obSetGoal(\''+g+'\')">'+label+'</button>';
  return '<div class="ob-head"><div class="ob-title">Body &amp; goals</div><div class="ob-desc">Powers your calorie targets and weight tracker. Skip and add it later in Settings.</div></div>'+
    '<div class="settings-2col">'+
      '<div class="settings-field"><label>Age</label><input type="number" id="ob-age" value="'+obEsc(v('age'))+'" placeholder="years" min="10" max="100" inputmode="numeric"></div>'+
      '<div class="settings-field"><label>Sex</label><select id="ob-sex"><option value="male"'+sexSel('male')+'>Male</option><option value="female"'+sexSel('female')+'>Female</option></select></div>'+
    '</div>'+
    '<div class="settings-2col">'+
      '<div class="settings-field"><label>Height (cm)</label><input type="number" id="ob-height" value="'+obEsc(v('height'))+'" placeholder="cm" min="100" max="250" inputmode="decimal"></div>'+
      '<div class="settings-field"><label>Weight (kg)</label><input type="number" id="ob-weight" value="'+obEsc(v('weight'))+'" placeholder="kg" min="30" max="300" step="0.1" inputmode="decimal"></div>'+
    '</div>'+
    '<div class="settings-field"><label>Activity level</label><select id="ob-activity">'+
      '<option value="1.2"'+actSel('1.2')+'>Sedentary (little/no exercise)</option>'+
      '<option value="1.375"'+actSel('1.375')+'>Lightly active (1–3×/week)</option>'+
      '<option value="1.55"'+actSel('1.55')+'>Moderately active (3–5×/week)</option>'+
      '<option value="1.725"'+actSel('1.725')+'>Very active (6–7×/week)</option>'+
      '<option value="1.9"'+actSel('1.9')+'>Extra active (athlete + job)</option>'+
    '</select></div>'+
    '<div class="ob-section-label">Goal</div>'+
    '<div class="ob-seg">'+gopt('cut','Cut')+gopt('maintain','Maintain')+gopt('bulk','Bulk')+'</div>'+
    '<div class="ob-section-label">Weight goal (optional)</div>'+
    '<div class="settings-2col">'+
      '<div class="settings-field"><label>Target (kg)</label><input type="number" id="ob-wg-target" value="'+obEsc(v('wgTarget'))+'" placeholder="kg" min="30" max="300" step="0.1" inputmode="decimal"></div>'+
      '<div class="settings-field"><label>Target date</label><input type="date" id="ob-wg-date" value="'+obEsc(v('wgDate'))+'"></div>'+
    '</div>'+
    '<div class="ob-btn-row">'+
      '<button class="ob-btn-skip" onclick="obNext()">Skip for now</button>'+
      '<button class="ob-btn-primary ob-btn-inline" onclick="obNext()">Continue →</button>'+
    '</div>';
}
function obHabitsHTML(){
  const chosen=obData.habits||[];
  obHabitOptions=OB_HABIT_SUGGESTIONS.slice();
  chosen.forEach(h=>{ if(!obHabitOptions.some(x=>x.toLowerCase()===h.toLowerCase())) obHabitOptions.push(h); });
  const chips=obHabitOptions.map((h,i)=>{
    const on=chosen.some(x=>x.toLowerCase()===h.toLowerCase());
    return '<button type="button" class="ob-habit-chip'+(on?' on':'')+'" onclick="obToggleHabit('+i+')">'+(on?'✓ ':'')+h.replace(/</g,'&lt;')+'</button>';
  }).join('');
  return '<div class="ob-head"><div class="ob-title">Daily habits</div><div class="ob-desc">Pick a few to check off each day. Tap to toggle — edit anytime later.</div></div>'+
    '<div class="ob-habit-wrap">'+chips+'</div>'+
    '<div class="ob-habit-add"><input type="text" id="ob-habit-custom" placeholder="Add your own…" onkeydown="if(event.key===\'Enter\'){event.preventDefault();obAddCustomHabit();}"><button type="button" onclick="obAddCustomHabit()">Add</button></div>'+
    '<div class="ob-btn-row">'+
      '<button class="ob-btn-skip" onclick="obNext()">Skip</button>'+
      '<button class="ob-btn-primary ob-btn-inline" onclick="obNext()">Continue →</button>'+
    '</div>';
}
function obSyncHTML(){
  const signedIn = firebaseReady && auth && auth.currentUser;
  if(signedIn){
    const email=(auth.currentUser.email||'').replace(/</g,'&lt;');
    return '<div class="ob-head"><div class="ob-title">Cloud sync</div></div>'+
      '<div class="ob-sync-box"><div class="ob-sync-ic">☁️</div><div class="ob-sync-title">You\'re connected</div>'+
        '<div class="ob-sync-desc">Synced as '+(email||'your Google account')+'. Everything backs up across your devices automatically.</div></div>'+
      '<button class="ob-btn-primary" onclick="obNext()">Continue →</button>';
  }
  const canAuth = firebaseReady && auth;
  const googleBtn = canAuth
    ? '<button class="ob-btn-google" onclick="obSignIn()"><svg viewBox="0 0 24 24" width="18" height="18" style="flex-shrink:0"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>Sign in with Google</button>'
    : '<div class="ob-desc" style="text-align:center;margin-top:14px">Sync isn\'t available in this build.</div>';
  return '<div class="ob-head"><div class="ob-title">Sync across devices</div><div class="ob-desc">Optional — sign in to back up your data and pick up right where you left off on any device.</div></div>'+
    '<div class="ob-sync-box"><div class="ob-sync-ic">☁️</div><div class="ob-sync-title">Google sync</div>'+
      '<div class="ob-sync-desc">Free and private to your account. You can always sign in later from Settings.</div></div>'+
    googleBtn+
    '<button class="ob-btn-skip ob-btn-block" onclick="obNext()">Skip for now</button>';
}
function obDoneHTML(){
  const name=(obData.name||'').trim();
  const synced = obData.synced || (firebaseReady && auth && auth.currentUser);
  const bits=[];
  if(obData.age&&obData.height&&obData.weight) bits.push('calorie targets');
  if(obData.wgTarget!==undefined&&isFinite(obData.wgTarget)) bits.push('a weight goal');
  const habN=(obData.habits||[]).length;
  if(habN) bits.push(habN+' habit'+(habN!==1?'s':''));
  if(synced) bits.push('cloud sync');
  let line='Your tracker is ready.';
  if(bits.length){
    const list = bits.length===1?bits[0]:bits.slice(0,-1).join(', ')+' and '+bits[bits.length-1];
    line='We set up '+list+'.';
  }
  return '<div class="ob-center">'+
    '<div class="ob-done-emoji">🎉</div>'+
    '<div class="ob-title" style="font-size:26px">You\'re all set'+(name?', '+name.replace(/</g,'&lt;'):'')+'!</div>'+
    '<div class="ob-desc" style="margin:10px 0 40px">'+line+'<br>Update anything anytime in Settings.</div>'+
    '<button class="ob-btn-primary" onclick="finishOnboarding()">Go to app →</button>'+
  '</div>';
}

// Mirror the onboarding budgetConfig entries into the live per-week category stores the
// Budget tab reads. Only runs for stores that are still unset (a brand-new user), so an
// existing account is never overwritten.
function seedBudgetCategoriesFromConfig(){
  const wkKey=weekKey(getMondayOf(0));
  let touchedWeek=false;
  const ensureWeek=()=>{ if(!budgetData[wkKey]) budgetData[wkKey]={}; return budgetData[wkKey]; };
  if(localStorage.getItem('daily_budget_inc_cats')==null){
    const inc=(budgetConfig.incomeStreams||[]).filter(s=>(s.name||'').trim()||parseFloat(s.weeklyAmount)>0);
    const cats = inc.length ? inc.map((s,i)=>({id:'inc'+(i+1),name:(s.name||('Income '+(i+1))).trim()})) : [{id:'inc1',name:'Income'}];
    saveIncCats(cats);
    inc.forEach((s,i)=>{ const amt=parseFloat(s.weeklyAmount)||0; if(amt>0){ ensureWeek()['inc_inc'+(i+1)]=String(amt); touchedWeek=true; } });
  }
  if(localStorage.getItem('daily_budget_fix_cats')==null){
    const fx=(budgetConfig.fixedExpenses||[]).filter(s=>(s.name||'').trim()||parseFloat(s.weeklyAmount)>0);
    saveFixCats(fx.map((s,i)=>({id:'fix'+(i+1),name:(s.name||('Fixed '+(i+1))).trim()})));
    fx.forEach((s,i)=>{ const amt=parseFloat(s.weeklyAmount)||0; if(amt>0){ ensureWeek()['fix_fix'+(i+1)]=String(amt); touchedWeek=true; } });
  }
  if(touchedWeek && typeof budSaveData==='function'){
    budgetData[wkKey].updatedAt=Date.now();
    budSaveData(wkKey);
  }
}

function finishOnboarding(){
  obCaptureCurrent();
  const name=(obData.name||'').trim()||profileData.name||'';

  // Profile + version stamp
  profileData.name = name;
  profileData.onboardingVersion = OB_VERSION;
  localStorage.setItem('daily_profile', JSON.stringify(profileData));
  syncProfileToFirebase();

  // Savings target/goal feed getSavingsGoal + the Home projection. Income + fixed expenses
  // were captured live into budgetConfig by the profile step's list editors — nothing to
  // rebuild here.
  if(obData.savings!==undefined){ budDefaults.weeklySavings=obData.savings; budDefaults.savingsGoal=obData.savings; }
  localStorage.setItem('daily_budget_defaults', JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();

  // For a brand-new user, mirror the onboarding budget into the live category stores the
  // Budget tab actually reads (loadIncCats/loadFixCats) + seed this week's amounts, so the
  // tab reflects their entries and never falls back to the app's built-in sample names.
  // Gated on "unset" so an existing account (which already has these saved) is never touched.
  seedBudgetCategoriesFromConfig();

  // Training split — commit what they built (or the neutral default if skipped). Only for a
  // genuinely new account (no logged sessions), so an existing user who ever re-runs onboarding
  // keeps their migrated/edited split and workout history untouched.
  if(!S.sessions.length){
    if(obData.splitSkipped || !obSplitDraft){
      splitConfig = genericSplit();
    } else {
      const cfg = daysToSplit(obSplitDraft);
      splitConfig = cfg.types.length ? cfg : genericSplit();
    }
    saveSplit();
    S.dayIdx = 0;
    initDay(suggestDay());
  }

  // Personal info — same store Settings → Health + calcGoalCals()/renderTDEESection() use.
  // Only written when a real measurement or an explicit goal was given, so a fully-skipped
  // Body step leaves the store untouched.
  if(obData.age||obData.height||obData.weight||obData.goal){
    S.personalInfo = Object.assign({}, S.personalInfo, {
      name,
      age: obData.age||S.personalInfo.age||null,
      sex: obData.sex||S.personalInfo.sex||'male',
      height: obData.height||S.personalInfo.height||null,
      weight: obData.weight||S.personalInfo.weight||null,
      activity: obData.activity||S.personalInfo.activity||'1.55',
      goal: obData.goal||S.personalInfo.goal||'maintain',
    });
    localStorage.setItem('wt_personalinfo', JSON.stringify(S.personalInfo));
    syncPersonalInfoToFirebase();
  }

  // Weight goal (reuses the daily_weight_goal store + its Firebase sync)
  if(obData.wgTarget!==undefined && isFinite(obData.wgTarget)){
    weightGoal = { target: obData.wgTarget, date: obData.wgDate||null };
    localStorage.setItem('daily_weight_goal', JSON.stringify(weightGoal));
    syncWeightGoalToFirebase();
  }

  // Starter habits
  if(Array.isArray(obData.habits) && obData.habits.length){
    habitsData = obData.habits.slice();
    localStorage.setItem('daily_habits', JSON.stringify(habitsData));
    pushHabits();
  }

  obDetachAuthWatch();
  document.getElementById('onboarding-overlay').classList.add('hidden');
  renderHome();
}
function resetOnboarding(){
  profileData.name='';
  localStorage.setItem('daily_profile', JSON.stringify(profileData));
  showOnboarding();
}

// ── Reminders ────────────────────────────────────────────────────
function loadReminders(){ return lsLoad('daily_reminders', {}); }
function saveReminders(r){ lsSave('daily_reminders', r); }
function checkReminders(){
  if(!('Notification' in window)) return;
  const r=loadReminders();
  const today=getLocalDate();
  const now=new Date();
  const nowMins=now.getHours()*60+now.getMinutes();

  // Workout reminder
  const wr=r.workout||{};
  if(wr.enabled){
    const [wH,wM]=(wr.time||'07:00').split(':').map(Number);
    const wAck=localStorage.getItem('daily_reminder_workout_date');
    if(nowMins>=wH*60+wM && wAck!==today){
      if(Notification.permission==='granted'){
        const nxt=type(suggestDay());
        new Notification('Time to train 💪',{body:nxt.name+' is up — let\'s go.',icon:'/workout-tracker/icon-192.png'});
        localStorage.setItem('daily_reminder_workout_date',today);
      } else if(Notification.permission!=='denied'){
        Notification.requestPermission().then(p=>{ if(p==='granted') checkReminders(); });
      }
    }
  }

  // Budget reminder
  const br=r.budget||{};
  if(br.enabled){
    const todayDay=new Date(today+'T12:00:00').getDay();
    const [bH,bM]=(br.time||'20:00').split(':').map(Number);
    const bAck=localStorage.getItem('daily_reminder_budget_date');
    if(todayDay===(br.day??0) && nowMins>=bH*60+bM && bAck!==today){
      if(Notification.permission==='granted'){
        new Notification('Save your week 💰',{body:"Don't forget to log this week's budget before it resets.",icon:'/workout-tracker/icon-192.png'});
        localStorage.setItem('daily_reminder_budget_date',today);
      } else if(Notification.permission!=='denied'){
        Notification.requestPermission().then(p=>{ if(p==='granted') checkReminders(); });
      }
    }
  }
}
function renderRemindersSection(){
  const wrap=document.getElementById('reminders-inner'); if(!wrap) return;
  const r=loadReminders();
  const wr=r.workout||{enabled:false,time:'07:00'};
  const br=r.budget||{enabled:false,day:0,time:'20:00'};
  const denied='Notification' in window && Notification.permission==='denied';
  const deniedBanner=denied?'<div style="background:rgba(231,76,60,0.12);border:1px solid var(--danger);border-radius:8px;padding:10px 12px;font-size:12px;color:var(--danger);margin-bottom:12px">⚠️ Notifications blocked — enable them in your browser settings</div>':'';
  const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayOpts=days.map((d,i)=>`<option value="${i}"${i===(br.day??0)?' selected':''}>${d}</option>`).join('');
  wrap.innerHTML=`
    ${deniedBanner}
    <div class="settings-card">
      <div class="settings-card-title" style="cursor:default">🏋️ Daily workout reminder</div>
      <div class="settings-row" style="margin-bottom:12px">
        <span class="settings-row-label">Enable</span>
        <label class="toggle-switch"><input type="checkbox" id="rem-workout-enabled"${wr.enabled?' checked':''} onchange="saveReminderField('workout','enabled',this.checked)"><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-field"><label>Remind me at</label><input type="time" id="rem-workout-time" value="${wr.time||'07:00'}" onchange="saveReminderField('workout','time',this.value)" style="height:44px;border:1.5px solid var(--border);border-radius:8px;font-size:15px;padding:0 12px;background:var(--card);color:var(--text);width:100%"></div>
    </div>
    <div class="settings-card">
      <div class="settings-card-title" style="cursor:default">💰 Weekly budget reminder</div>
      <div class="settings-row" style="margin-bottom:12px">
        <span class="settings-row-label">Enable</span>
        <label class="toggle-switch"><input type="checkbox" id="rem-budget-enabled"${br.enabled?' checked':''} onchange="saveReminderField('budget','enabled',this.checked)"><span class="toggle-slider"></span></label>
      </div>
      <div class="settings-field"><label>Day</label><select id="rem-budget-day" onchange="saveReminderField('budget','day',parseInt(this.value))">${dayOpts}</select></div>
      <div class="settings-field"><label>Time</label><input type="time" id="rem-budget-time" value="${br.time||'20:00'}" onchange="saveReminderField('budget','time',this.value)" style="height:44px;border:1.5px solid var(--border);border-radius:8px;font-size:15px;padding:0 12px;background:var(--card);color:var(--text);width:100%"></div>
    </div>`;
}
function saveReminderField(type,field,value){
  const r=loadReminders();
  if(!r[type]) r[type]={};
  r[type][field]=value;
  saveReminders(r);
  if(field==='enabled' && value && 'Notification' in window && Notification.permission==='default'){
    Notification.requestPermission().then(()=>renderRemindersSection());
  }
}

// ══ KITCHEN: Recipe Book ══════════════════════════════════════════
function kitUUID(){
  return (crypto&&crypto.randomUUID)?crypto.randomUUID():'r'+Date.now()+Math.random().toString(16).slice(2);
}
function kitSeedRecipes(){
  const ig=(name,amount,unit)=>({name,amount,unit:unit||''});
  const mk=(o)=>Object.assign({id:kitUUID(),description:'',tags:[],calories:null,protein:null,carbs:null,fat:null,favourite:false,batchPrep:false,createdAt:Date.now()},o);
  return [
    mk({name:'French Toast with Berries',category:'breakfast',servings:2,
      description:'Golden eggy toast with fresh berries and maple syrup.',
      ingredients:[ig('Eggs',3,''),ig('Milk',0.25,'cup'),ig('Bread',4,'slices'),ig('Vanilla',1,'tsp'),ig('Cinnamon',0.5,'tsp'),ig('Butter',1,'tbsp'),ig('Mixed berries',1,'cup'),ig('Maple syrup',2,'tbsp')],
      steps:['Whisk eggs, milk, vanilla and cinnamon.','Dip bread in the mixture.','Cook in butter 2–3 min each side until golden.','Serve with berries and maple syrup.'],
      tags:['quick'],calories:420,protein:16,carbs:58,fat:14}),
    mk({name:'Hash Browns',category:'breakfast',servings:2,
      description:'Crispy golden potato patties.',
      ingredients:[ig('Potatoes',4,'medium'),ig('Canola oil',2,'tbsp'),ig('Salt','',''),ig('Pepper','','')],
      steps:['Grate potatoes.','Squeeze out moisture.','Season.','Form into patties.','Fry 4–5 min each side until crispy.'],
      tags:['quick','batch-prep'],calories:280,protein:4,carbs:48,fat:9,batchPrep:true}),
    mk({name:'Honey Soy Chicken Thighs + Basmati Rice',category:'lunch',servings:4,
      description:'Sticky honey soy chicken over fluffy basmati.',
      ingredients:[ig('Chicken thighs',800,'g'),ig('Soy sauce',3,'tbsp'),ig('Honey',2,'tbsp'),ig('Garlic',3,'cloves'),ig('Ginger',1,'tsp'),ig('Sesame oil',1,'tsp'),ig('Basmati rice',2,'cups'),ig('Spring onion',2,'')],
      steps:['Mix the marinade.','Marinate chicken 30 min.','Cook rice.','Pan-fry chicken 5–6 min each side.','Slice over rice and top with spring onion.'],
      tags:['batch-prep','high-protein'],calories:520,protein:42,carbs:48,fat:14,batchPrep:true}),
    mk({name:'Spiced Lamb Pan Fry + Basmati Rice',category:'lunch',servings:4,
      description:'Aromatic spiced lamb mince with lemon and parsley.',
      ingredients:[ig('Lamb mince',600,'g'),ig('Brown onion',1,''),ig('Garlic',3,'cloves'),ig('Garam masala',2,'tsp'),ig('Cumin',1,'tsp'),ig('Smoked paprika',1,'tsp'),ig('Basmati rice',2,'cups'),ig('Lemon',1,''),ig('Parsley','','')],
      steps:['Cook rice.','Fry onion.','Add garlic then lamb.','Add spices.','Squeeze lemon.','Serve over rice with parsley.'],
      tags:['batch-prep','high-protein'],calories:490,protein:38,carbs:44,fat:18,batchPrep:true}),
    mk({name:'Korean Crispy Beef Mince + Rice',category:'lunch',servings:4,
      description:'Crispy-edged beef in a sweet-savoury sauce.',
      ingredients:[ig('Beef mince',600,'g'),ig('Soy sauce',3,'tbsp'),ig('Brown sugar',1,'tbsp'),ig('Sesame oil',1,'tsp'),ig('Garlic',3,'cloves'),ig('Ginger',1,'tsp'),ig('Spring onion',3,''),ig('Basmati rice',2,'cups'),ig('Chilli flakes',0.5,'tsp')],
      steps:['Cook rice.','Mix the sauce.','Fry garlic and ginger.','Add mince and cook until crispy at the edges.','Add sauce.','Serve over rice.'],
      tags:['batch-prep','high-protein'],calories:510,protein:40,carbs:46,fat:16,batchPrep:true}),
    mk({name:'Butter Garlic Prawns',category:'dinner',servings:2,
      description:'Juicy prawns in lemon garlic butter.',
      ingredients:[ig('Prawns',400,'g peeled'),ig('Butter',60,'g'),ig('Garlic',4,'cloves'),ig('Lemon',1,''),ig('Parsley',1,'handful'),ig('Salt','',''),ig('Pepper','','')],
      steps:['Melt butter.','Add garlic for 30 sec.','Add prawns, 1–2 min each side until pink.','Squeeze lemon.','Finish with parsley.'],
      tags:['quick','high-protein'],calories:380,protein:36,carbs:4,fat:24}),
    mk({name:'Pan Burgers',category:'dinner',servings:2,
      description:'Caramelised onion cheeseburgers with burger sauce.',
      ingredients:[ig('Burger patties',2,'x150g'),ig('Cheese slices',2,''),ig('Brown onion',1,''),ig('Butter',1,'tbsp'),ig('Brioche buns',2,''),ig('Mayo',2,'tbsp'),ig('Ketchup',1,'tbsp'),ig('Dijon',1,'tsp'),ig('Rocket',1,'handful')],
      steps:['Caramelise onion ~20 min.','Cook patties 3–4 min each side.','Add cheese.','Mix burger sauce.','Toast buns.','Assemble.'],
      tags:['quick'],calories:720,protein:38,carbs:52,fat:38}),
    mk({name:'Turkish Bread Steak Sandwich',category:'dinner',servings:2,
      description:'Thin-sliced rump with steakhouse sauce on Turkish bread.',
      ingredients:[ig('Rump steak',400,'g'),ig('Turkish bread',1,'loaf'),ig('Brown onion',1,''),ig('Butter',1,'tbsp'),ig('Rocket',1,'handful'),ig('Mayo',2,'tbsp'),ig('Worcestershire',1,'tbsp'),ig('Dijon',1,'tsp'),ig('Salt','',''),ig('Pepper','','')],
      steps:['Caramelise onion.','Sear steak 2–3 min each side.','Rest 5 min.','Slice thin.','Mix steakhouse sauce.','Build the sandwich.'],
      tags:[],calories:680,protein:44,carbs:54,fat:26}),
    mk({name:'Reverse Sear Rump Steak with Pan Sauce and Noodles',category:'dinner',servings:2,
      description:'Reverse-seared steak with a glossy pan sauce over noodles.',
      ingredients:[ig('Rump steak',500,'g'),ig('Mi Goreng noodles',2,'packs'),ig('Butter',30,'g'),ig('Garlic',2,'cloves'),ig('Soy sauce',2,'tbsp'),ig('Worcestershire',1,'tbsp'),ig('Balsamic',1,'tsp'),ig('Salt','',''),ig('Pepper','','')],
      steps:['Bake steak at 120°C until 50°C internal (~35 min).','Sear 1 min each side.','Make pan sauce with butter, garlic, soy, Worcestershire and balsamic.','Cook noodles.','Slice steak over noodles with pan sauce.'],
      tags:['high-protein'],calories:620,protein:52,carbs:44,fat:22}),
  ];
}
function kitLoadRecipes(){
  try{
    const raw=localStorage.getItem('kitchen_recipes');
    if(raw){ const arr=JSON.parse(raw); if(Array.isArray(arr)) return arr; }
  }catch(e){}
  const seeded=kitSeedRecipes();
  localStorage.setItem('kitchen_recipes',JSON.stringify(seeded));
  return seeded;
}
let kitRecipes=kitLoadRecipes();
function kitSaveRecipes(){ lsSave('kitchen_recipes', kitRecipes, 'kitRecipes'); }
const kitState={tab:'recipes',cat:'all',search:'',filter:'all',selectedId:null,scaleServings:null};
const KIT_CATS=[['all','All'],['breakfast','Breakfast'],['lunch','Lunch'],['dinner','Dinner'],['dessert','Dessert']];

function kitEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function kitTrim(n){ let s=(Math.round(n*10)/10).toFixed(1); return s.endsWith('.0')?s.slice(0,-2):s; }
function kitScaledAmount(amount,baseServings,curServings){
  const n=parseFloat(amount);
  if(isNaN(n)||!baseServings) return amount===0?'':String(amount||'');
  return kitTrim((n/baseServings)*curServings);
}

function kitRender(){ kitSetTab(kitState.tab); }
function kitSetTab(tab){
  kitState.tab=tab;
  ['recipes','shopping','pantry'].forEach(t=>{
    const pane=document.getElementById('kit-'+t); if(pane) pane.classList.toggle('hidden',t!==tab);
    const btn=document.getElementById('kit-tab-'+t); if(btn) btn.classList.toggle('active',t===tab);
  });
  if(tab==='recipes') kitRenderList();
  if(tab==='shopping') kitShopRender();
  else if(typeof kitShopRenderAddBar==='function') kitShopRenderAddBar(false);
  if(tab==='pantry') kitPantryRender();
}
function kitOnSearch(v){ kitState.search=v||''; kitRenderList(); }
function kitSetCat(c){ kitState.cat=c; kitRenderList(); }

function kitRenderCatPills(){
  const wrap=document.getElementById('kit-cat-pills'); if(!wrap) return;
  wrap.innerHTML=KIT_CATS.map(([v,l])=>
    '<button class="kit-cat-pill'+(kitState.cat===v?' active':'')+'" onclick="kitSetCat(\''+v+'\')">'+l+'</button>'
  ).join('');
}
// step normalisation helpers — seeded recipes have string steps, new ones use {text,timerMinutes}
function kitStepText(s){ return (s&&typeof s==='object') ? (s.text||'') : (s||''); }
function kitStepTimer(s){ return (s&&typeof s==='object'&&s.timerMinutes>0) ? s.timerMinutes : null; }

function kitFilteredRecipes(){
  const q=kitState.search.trim().toLowerCase();
  const f=kitState.filter;
  return kitRecipes.filter(r=>{
    if(kitState.cat!=='all' && r.category!==kitState.cat) return false;
    if(f==='favourites' && !r.favourite) return false;
    if(f==='recent' && !r.lastCooked) return false;
    if(!q) return true;
    if((r.name||'').toLowerCase().includes(q)) return true;
    return (r.ingredients||[]).some(i=>(i.name||'').toLowerCase().includes(q));
  });
}
function kitSetFilter(f){
  kitState.filter=f;
  kitRenderList();
}
function kitRenderFilterChips(){
  const wrap=document.getElementById('kit-filter-chips'); if(!wrap) return;
  const chips=[['all','All'],['favourites','Favourites ♥'],['recent','Recently Cooked 🕐']];
  wrap.innerHTML=chips.map(([v,l])=>
    '<button class="kit-fchip'+(kitState.filter===v?' active':'')+'" onclick="kitSetFilter(\''+v+'\')">'+l+'</button>'
  ).join('');
}

// ── Cooking mode ──────────────────────────────────────────────────
const kitCookState={recipeId:null,step:0,timerTotal:0,timerRemaining:0,timerStart:null,timerRunning:false,wakeLock:null,tickId:null};
function kitStartCooking(id){
  const r=kitRecipes.find(x=>x.id===id); if(!r) return;
  kitCookState.recipeId=id;
  kitCookState.step=0;
  kitCookState.timerRunning=false;
  kitCookState.timerStart=null;
  kitCookState.timerTotal=0;
  kitCookState.timerRemaining=0;
  if(kitCookState.tickId){ clearInterval(kitCookState.tickId); kitCookState.tickId=null; }
  const ov=document.getElementById('kit-cook-overlay'); if(!ov) return;
  ov.style.cssText='display:flex;flex-direction:column;position:fixed;inset:0;background:var(--bg);z-index:200;overflow:hidden;padding:env(safe-area-inset-top,16px) 0 env(safe-area-inset-bottom,16px)';
  kitCookRender();
  // wake lock
  if(navigator.wakeLock) navigator.wakeLock.request('screen').then(wl=>{ kitCookState.wakeLock=wl; }).catch(()=>{});
}
function kitExitCooking(){
  if(kitCookState.tickId){ clearInterval(kitCookState.tickId); kitCookState.tickId=null; }
  if(kitCookState.wakeLock){ kitCookState.wakeLock.release().catch(()=>{}); kitCookState.wakeLock=null; }
  const ov=document.getElementById('kit-cook-overlay');
  if(ov) ov.style.display='none';
  kitCookState.recipeId=null;
}
function kitCookFinish(){
  const r=kitRecipes.find(x=>x.id===kitCookState.recipeId);
  if(r){ r.lastCooked=Date.now(); kitSaveRecipes(); }
  kitExitCooking();
  kitShowToast('Well done! 🎉');
  kitRenderList();
  if(kitCookState.recipeId && window.innerWidth>=1024) kitRefreshOpenDetail();
}
function kitCookGo(dir){
  const r=kitRecipes.find(x=>x.id===kitCookState.recipeId); if(!r) return;
  const steps=r.steps||[];
  const next=kitCookState.step+dir;
  if(next<0||next>=steps.length) return;
  kitCookState.step=next;
  if(kitCookState.tickId){ clearInterval(kitCookState.tickId); kitCookState.tickId=null; }
  kitCookState.timerRunning=false;
  kitCookState.timerStart=null;
  kitCookRender();
}
function kitCookTimerToggle(){
  const r=kitRecipes.find(x=>x.id===kitCookState.recipeId); if(!r) return;
  const s=r.steps[kitCookState.step];
  const mins=kitStepTimer(s)||0; if(!mins) return;
  if(kitCookState.timerRunning){
    // pause: store remaining
    kitCookState.timerRemaining=Math.max(0,kitCookState.timerRemaining-Math.floor((Date.now()-kitCookState.timerStart)/1000));
    kitCookState.timerRunning=false;
    kitCookState.timerStart=null;
    if(kitCookState.tickId){ clearInterval(kitCookState.tickId); kitCookState.tickId=null; }
    kitCookRenderTimer();
  } else {
    // start / resume
    if(kitCookState.timerTotal!==mins*60||kitCookState.timerRemaining<=0){
      kitCookState.timerTotal=mins*60;
      kitCookState.timerRemaining=mins*60;
    }
    kitCookState.timerStart=Date.now();
    kitCookState.timerRunning=true;
    kitCookState.tickId=setInterval(kitCookTick,500);
    kitCookRenderTimer();
  }
}
function kitCookTimerReset(){
  const r=kitRecipes.find(x=>x.id===kitCookState.recipeId); if(!r) return;
  const s=r.steps[kitCookState.step];
  const mins=kitStepTimer(s)||0;
  if(kitCookState.tickId){ clearInterval(kitCookState.tickId); kitCookState.tickId=null; }
  kitCookState.timerRunning=false;
  kitCookState.timerStart=null;
  kitCookState.timerTotal=mins*60;
  kitCookState.timerRemaining=mins*60;
  kitCookRenderTimer();
}
function kitCookTick(){
  if(!kitCookState.timerRunning) return;
  const elapsed=Math.floor((Date.now()-kitCookState.timerStart)/1000);
  const rem=Math.max(0,kitCookState.timerRemaining-elapsed);
  if(rem===0){
    clearInterval(kitCookState.tickId); kitCookState.tickId=null;
    kitCookState.timerRunning=false;
    kitCookState.timerRemaining=0;
    kitCookRenderTimer();
    if(navigator.vibrate) navigator.vibrate([300,100,300]);
    kitShowToast('Timer done! ⏰');
  } else {
    kitCookRenderTimer();
  }
}
function kitCookTimerSec(){
  if(!kitCookState.timerRunning) return kitCookState.timerRemaining;
  return Math.max(0,kitCookState.timerRemaining-Math.floor((Date.now()-kitCookState.timerStart)/1000));
}
function kitCookRenderTimer(){
  const r=kitRecipes.find(x=>x.id===kitCookState.recipeId); if(!r) return;
  const s=r.steps[kitCookState.step];
  const mins=kitStepTimer(s)||0;
  const tWrap=document.getElementById('kit-cook-timer'); if(!tWrap) return;
  if(!mins){ tWrap.innerHTML=''; return; }
  const sec=kitCookTimerSec();
  const mm=String(Math.floor(sec/60)).padStart(2,'0');
  const ss=String(sec%60).padStart(2,'0');
  const done=sec===0;
  const total=kitCookState.timerTotal||mins*60;
  const pct=total>0?Math.round((1-sec/total)*100):0;
  tWrap.innerHTML=
    '<div class="kit-cook-timer-ring" style="--pct:'+pct+'%">'+
      '<svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" stroke="var(--border)" stroke-width="6" fill="none"/><circle cx="40" cy="40" r="34" stroke="'+(done?'var(--danger)':'var(--accent)')+'" stroke-width="6" fill="none" stroke-dasharray="213.6" stroke-dashoffset="'+Math.round((1-pct/100)*213.6)+'" stroke-linecap="round" transform="rotate(-90 40 40)"/></svg>'+
      '<div class="kit-cook-timer-time'+(done?' done':'')+'">'+mm+':'+ss+'</div>'+
    '</div>'+
    '<div class="kit-cook-timer-btns">'+
      '<button class="kit-cook-tbtn" onclick="kitCookTimerToggle()">'+(kitCookState.timerRunning?'⏸ Pause':'▶ Start')+'</button>'+
      '<button class="kit-cook-tbtn secondary" onclick="kitCookTimerReset()">↺ Reset</button>'+
    '</div>';
}
function kitCookRender(){
  const r=kitRecipes.find(x=>x.id===kitCookState.recipeId); if(!r) return;
  const ov=document.getElementById('kit-cook-overlay'); if(!ov) return;
  const steps=r.steps||[];
  const idx=kitCookState.step;
  const total=steps.length;
  const s=steps[idx];
  const text=kitStepText(s);
  const hasPrev=idx>0;
  const hasNext=idx<total-1;
  const pct=total>1?Math.round(((idx+1)/total)*100):100;
  // reset timer state when step changes
  const mins=kitStepTimer(s)||0;
  if(kitCookState.timerTotal!==mins*60){
    kitCookState.timerTotal=mins*60;
    kitCookState.timerRemaining=mins*60;
    kitCookState.timerRunning=false;
    kitCookState.timerStart=null;
    if(kitCookState.tickId){ clearInterval(kitCookState.tickId); kitCookState.tickId=null; }
  }
  ov.innerHTML=
    '<div class="kit-cook-topbar">'+
      '<button class="kit-cook-exit" onclick="kitExitCooking()">✕ Exit</button>'+
      '<div class="kit-cook-recipe-name">'+kitEsc(r.emoji||'🍽️')+' '+kitEsc(r.name)+'</div>'+
      '<div></div>'+
    '</div>'+
    '<div class="kit-cook-progress-bar"><div class="kit-cook-progress-fill" style="width:'+pct+'%"></div></div>'+
    '<div class="kit-cook-step-label">Step '+( idx+1)+' of '+total+'</div>'+
    '<div class="kit-cook-body">'+
      '<div class="kit-cook-step-text">'+kitEsc(text)+'</div>'+
      '<div id="kit-cook-timer"></div>'+
    '</div>'+
    '<div class="kit-cook-nav">'+
      '<button class="kit-cook-nav-btn" onclick="kitCookGo(-1)"'+(hasPrev?'':' disabled')+'>← Prev</button>'+
      (hasNext
        ? '<button class="kit-cook-nav-btn primary" onclick="kitCookGo(1)">Next →</button>'
        : '<button class="kit-cook-nav-btn finish" onclick="kitCookFinish()">🎉 Finish Cooking</button>')+
    '</div>';
  kitCookRenderTimer();
}

// toast helper
let kitToastTimer=null;
function kitShowToast(msg){
  const el=document.getElementById('kit-toast'); if(!el) return;
  el.textContent=msg;
  el.style.display='block';
  el.classList.add('visible');
  if(kitToastTimer) clearTimeout(kitToastTimer);
  kitToastTimer=setTimeout(()=>{ el.classList.remove('visible'); setTimeout(()=>{ el.style.display='none'; },300); },2500);
}
function kitRenderFeatured(){
  const wrap=document.getElementById('kitchen-featured'); if(!wrap) return;
  if(!kitRecipes.length){ wrap.innerHTML=''; return; }
  // Featured = most recently cooked, else most recently added
  const byRecent=[...kitRecipes].sort((a,b)=>(b.lastCooked||0)-(a.lastCooked||0)||(b.createdAt||0)-(a.createdAt||0));
  const r=byRecent[0]; if(!r){ wrap.innerHTML=''; return; }
  const label=r.lastCooked?'Last cooked':'Latest recipe';
  const cal=r.calories!=null?'<span class="kitchen-hero-cal">'+r.calories+' cal</span>':'';
  const time=r.cookTime?'<span class="kitchen-hero-time">'+(cal?'· ':'')+r.cookTime+' min</span>':'';
  wrap.innerHTML=
    '<div class="kitchen-hero-card">'+
      '<p class="card-label">'+label+'</p>'+
      '<p class="kitchen-hero-name">'+(r.emoji?r.emoji+' ':'')+kitEsc(r.name)+'</p>'+
      ((cal||time)?'<div style="display:flex;gap:8px;align-items:center;margin-top:8px">'+cal+time+'</div>':'')+
      '<button class="kitchen-hero-btn" onclick="kitOpenDetail(\''+r.id+'\')">View Recipe →</button>'+
    '</div>';
}
function kitRenderList(){
  kitRenderFeatured();
  kitRenderFilterChips();
  kitRenderCatPills();
  const list=document.getElementById('kit-list'); if(!list) return;
  const items=kitFilteredRecipes();
  // Favourites first, then by name
  items.sort((a,b)=>(b.favourite?1:0)-(a.favourite?1:0)||(a.name||'').localeCompare(b.name||''));
  if(!items.length){
    list.innerHTML='<div class="empty" style="padding:48px 16px"><div style="font-size:40px">🍽️</div><div style="font-size:15px;font-weight:600;margin-top:10px">No recipes found</div><div style="font-size:13px;color:var(--muted);margin-top:4px">Try a different search or add a new recipe.</div></div>';
  } else {
    list.innerHTML=items.map(r=>{
      const sel=r.id===kitState.selectedId?' kit-card-active':'';
      const cal=r.calories!=null?'<span class="kit-cal-badge">'+r.calories+' cal</span>':'';
      const batch=r.batchPrep?'<span class="kit-batch-badge">🍱 Batch</span>':'';
      const cookTime=r.cookTime?'<span class="kit-cal-badge">⏱ '+r.cookTime+'m</span>':'';
      let cookedLabel='';
      if(r.lastCooked){
        const days=Math.floor((Date.now()-r.lastCooked)/86400000);
        cookedLabel='<div class="kit-cooked-ago">'+(days===0?'Cooked today':days===1?'Cooked yesterday':'Cooked '+days+' days ago')+'</div>';
      }
      return '<div class="kit-card kit-c-'+(r.category||'dinner')+sel+'" onclick="kitOpenDetail(\''+r.id+'\')">'+
        '<div class="kit-card-top">'+
          '<div class="kit-card-name">'+(r.emoji?'<span class="kit-card-emoji">'+r.emoji+'</span>':'')+kitEsc(r.name)+'</div>'+
          '<div class="kit-card-actions" onclick="event.stopPropagation()">'+
            '<button class="kit-fav'+(r.favourite?' on':'')+'" onclick="kitToggleFav(\''+r.id+'\')" aria-label="Favourite">'+(r.favourite?'⭐':'☆')+'</button>'+
            '<button class="kit-menu-btn" onclick="kitToggleMenu(\''+r.id+'\',event)">⋯</button>'+
          '</div>'+
        '</div>'+
        '<div class="kit-card-meta"><span class="kit-cat-tag kit-cat-'+r.category+'">'+r.category+'</span>'+cal+cookTime+batch+'</div>'+
        (r.description?'<div class="kit-card-desc">'+kitEsc(r.description)+'</div>':'')+
        '<div class="kit-card-serv">🍽️ '+r.servings+' serving'+(r.servings!=1?'s':'')+'</div>'+
        cookedLabel+
        (kitMenuOpenId===r.id?
          '<div class="kit-menu-dropdown" onclick="event.stopPropagation()">'+
            '<button onclick="kitMenuOpenId=null;kitOpenForm(\''+r.id+'\')">✏️ Edit</button>'+
            '<button class="danger" onclick="kitMenuOpenId=null;kitDeleteRecipe(\''+r.id+'\')">🗑️ Delete</button>'+
          '</div>':'')+
      '</div>';
    }).join('');
  }
  // Desktop: keep the persistent detail column in sync
  if(window.innerWidth>=1024){
    const col=document.getElementById('kit-detail-col');
    if(col){
      if(kitState.selectedId && kitRecipes.some(r=>r.id===kitState.selectedId)) kitRenderDetail(kitState.selectedId,col);
      else col.innerHTML='<div class="empty" style="padding-top:80px"><div style="font-size:48px">🍳</div><div style="font-size:16px;font-weight:600;margin-top:12px">Select a recipe</div><div style="font-size:13px;color:var(--muted);margin-top:6px">Pick one from the list to see the full method.</div></div>';
    }
  }
}
let kitMenuOpenId=null;
function kitToggleMenu(id,e){
  if(e) e.stopPropagation();
  kitMenuOpenId=(kitMenuOpenId===id)?null:id;
  kitRenderList();
}
// close menu on outside tap
document.addEventListener('click',()=>{ if(kitMenuOpenId){ kitMenuOpenId=null; kitRenderList(); } });
function kitToggleFav(id){
  const r=kitRecipes.find(x=>x.id===id); if(!r) return;
  r.favourite=!r.favourite;
  kitSaveRecipes();
  kitRenderList();
  if(kitState.selectedId===id) kitRefreshOpenDetail();
}

function kitOpenDetail(id){
  kitState.selectedId=id;
  const r=kitRecipes.find(x=>x.id===id); if(!r) return;
  kitState.scaleServings=r.servings;
  if(window.innerWidth>=1024){
    kitRenderList(); // re-render list (highlight) + detail column
  } else {
    const ov=document.getElementById('kit-detail-overlay');
    kitRenderDetail(id,document.getElementById('kit-detail-overlay-inner'));
    if(ov) ov.style.display='flex';
  }
}
function kitCloseDetail(){
  const ov=document.getElementById('kit-detail-overlay');
  if(ov) ov.style.display='none';
  kitState.selectedId=null;
  if(window.innerWidth>=1024) kitRenderList();
}
function kitRefreshOpenDetail(){
  if(window.innerWidth>=1024){
    const col=document.getElementById('kit-detail-col');
    if(col&&kitState.selectedId) kitRenderDetail(kitState.selectedId,col);
  } else {
    const inner=document.getElementById('kit-detail-overlay-inner');
    if(inner&&kitState.selectedId) kitRenderDetail(kitState.selectedId,inner);
  }
}
function kitScale(delta){
  const r=kitRecipes.find(x=>x.id===kitState.selectedId); if(!r) return;
  const next=(kitState.scaleServings||r.servings)+delta;
  if(next<1) return;
  kitState.scaleServings=next;
  kitRefreshOpenDetail();
}
function kitRenderDetail(id,target){
  if(!target) return;
  const r=kitRecipes.find(x=>x.id===id);
  if(!r){ target.innerHTML=''; return; }
  const cur=kitState.scaleServings||r.servings;
  const ingRows=(r.ingredients||[]).map(i=>{
    const amt=kitScaledAmount(i.amount,r.servings,cur);
    const right=[amt,i.unit].filter(x=>x!=='' && x!=null).join(' ');
    return '<div class="kit-ing-row"><span>'+kitEsc(i.name)+'</span><span class="kit-ing-amt">'+kitEsc(right)+'</span></div>';
  }).join('');
  const stepRows=(r.steps||[]).map((s,i)=>{
    const text=kitStepText(s);
    const timer=kitStepTimer(s);
    return '<div class="kit-step-row"><span class="kit-step-n">'+(i+1)+'</span><div class="kit-step-body"><span>'+kitEsc(text)+'</span>'+(timer?'<span class="kit-step-timer-badge">⏱ '+timer+' min</span>':'')+'</div></div>';
  }).join('');
  const tags=(r.tags||[]).map(t=>'<span class="kit-tag">'+kitEsc(t)+'</span>').join('');
  let macros='';
  if(r.calories!=null||r.protein!=null||r.carbs!=null||r.fat!=null){
    const scl=v=>v==null?'—':Math.round(v*cur/r.servings);
    macros='<div class="kit-macros">'+
      '<div class="kit-macro"><div class="kit-macro-v">'+scl(r.calories)+'</div><div class="kit-macro-l">cal</div></div>'+
      '<div class="kit-macro"><div class="kit-macro-v">'+scl(r.protein)+'</div><div class="kit-macro-l">protein</div></div>'+
      '<div class="kit-macro"><div class="kit-macro-v">'+scl(r.carbs)+'</div><div class="kit-macro-l">carbs</div></div>'+
      '<div class="kit-macro"><div class="kit-macro-v">'+scl(r.fat)+'</div><div class="kit-macro-l">fat</div></div>'+
    '</div>';
  }
  const cookInfo=(r.cookTime?'<span class="kit-cal-badge">⏱ '+r.cookTime+' min</span>':'');
  const backBtn=window.innerWidth>=1024?'':'<button class="kit-back" onclick="kitCloseDetail()" aria-label="Back">←</button>';
  target.innerHTML=
    '<div class="kit-detail-head">'+backBtn+
      '<button class="kit-fav'+(r.favourite?' on':'')+'" onclick="kitToggleFav(\''+r.id+'\')" style="margin-left:auto" aria-label="Favourite">'+(r.favourite?'⭐':'☆')+'</button>'+
    '</div>'+
    (r.emoji?'<div class="kit-detail-emoji">'+r.emoji+'</div>':'')+
    '<div class="kit-detail-name">'+kitEsc(r.name)+'</div>'+
    '<div class="kit-card-meta" style="margin-bottom:14px"><span class="kit-cat-tag kit-cat-'+r.category+'">'+r.category+'</span>'+(r.batchPrep?'<span class="kit-batch-badge">🍱 Batch</span>':'')+cookInfo+tags+'</div>'+
    (r.description?'<div class="kit-card-desc" style="margin-bottom:16px">'+kitEsc(r.description)+'</div>':'')+
    '<button class="kit-start-cooking-btn" onclick="kitStartCooking(\''+r.id+'\')">▶ Start Cooking</button>'+
    '<div class="kit-scaler">'+
      '<button class="kit-scale-btn" onclick="kitScale(-1)" aria-label="Fewer servings">−</button>'+
      '<div class="kit-scale-val"><div class="kit-scale-num">'+cur+'</div><div class="kit-scale-lbl">servings</div></div>'+
      '<button class="kit-scale-btn" onclick="kitScale(1)" aria-label="More servings">+</button>'+
    '</div>'+
    macros+
    '<div class="kit-sec-label">Ingredients</div><div class="kit-ing-list">'+ingRows+'</div>'+
    '<div class="kit-sec-label">Method</div><div class="kit-step-list">'+stepRows+'</div>'+
    '<div class="kit-detail-actions">'+
      '<button class="kit-act kit-act-primary" onclick="kitLogMeal(\''+r.id+'\')">🍴 Log this meal</button>'+
      '<button class="kit-act" onclick="kitOpenForm(\''+r.id+'\')">✏️ Edit</button>'+
      '<button class="kit-act kit-act-danger" onclick="kitDeleteRecipe(\''+r.id+'\')">🗑️ Delete</button>'+
    '</div>';
}
function kitLogMeal(id){
  const r=kitRecipes.find(x=>x.id===id); if(!r) return;
  const cur=kitState.scaleServings||r.servings;
  const kcal=r.calories!=null?Math.round(r.calories*cur/r.servings):0;
  const today=getLocalDate();
  if(S.dailyLog.date!==today){ S.dailyLog={date:today,entries:[]}; }
  S.dailyLog.entries.push({name:r.name,kcal,category:'other'});
  persistDailyLog();
  if(typeof renderCalorieLog==='function') renderCalorieLog();
  // Dismiss the mobile recipe overlay so the calorie overlay isn't hidden behind it
  const dov=document.getElementById('kit-detail-overlay');
  if(dov) dov.style.display='none';
  openCalorieOverlay();
}
function kitDeleteRecipe(id){
  const r=kitRecipes.find(x=>x.id===id); if(!r) return;
  if(!confirm('Delete "'+r.name+'"?')) return;
  kitRecipes=kitRecipes.filter(x=>x.id!==id);
  kitSaveRecipes();
  if(window.innerWidth<1024) kitCloseDetail();
  else { kitState.selectedId=null; }
  kitRenderList();
}

// ── Add / edit form ───────────────────────────────────────────────
const KIT_STANDARD_TAGS=[
  {val:'high-protein',label:'High Protein'},
  {val:'low-carb',label:'Low Carb'},
  {val:'quick',label:'Quick'},
  {val:'vegetarian',label:'Vegetarian'},
  {val:'bulk-cook',label:'Bulk Cook'},
];
const KIT_UNITS=['g','ml','cup','tbsp','tsp','piece','oz','lb'];
function kitOpenForm(id){
  const editing=id?kitRecipes.find(x=>x.id===id):null;
  const r=editing||{name:'',emoji:'🍽️',category:'dinner',description:'',servings:2,cookTime:null,
    ingredients:[{name:'',amount:'',unit:'g'}],steps:[{text:'',timerMinutes:null}],
    tags:[],calories:null,protein:null,carbs:null,fat:null};
  const box=document.getElementById('kit-form-box'); if(!box) return;
  const catOpts=['breakfast','lunch','dinner','dessert'].map(c=>'<option value="'+c+'"'+(r.category===c?' selected':'')+'>'+c.charAt(0).toUpperCase()+c.slice(1)+'</option>').join('');
  const tagChips=KIT_STANDARD_TAGS.map(t=>{
    const on=(r.tags||[]).includes(t.val)||(t.val==='bulk-cook'&&r.batchPrep);
    return '<button type="button" class="kit-tag-chip'+(on?' active':'')+'" data-tag="'+t.val+'" onclick="this.classList.toggle(\'active\')">'+t.label+'</button>';
  }).join('');
  box.innerHTML=
    '<div class="kit-form-topbar">'+
      '<button class="kit-back" onclick="kitCloseForm()">←</button>'+
      '<div class="modal-title">'+(editing?'Edit Recipe':'New Recipe')+'</div>'+
      '<div style="width:36px"></div>'+
    '</div>'+
    '<input type="hidden" id="kit-f-id" value="'+(editing?editing.id:'')+'">'+
    '<div class="kit-f-emoji-row">'+
      '<input id="kit-f-emoji" class="kit-f-emoji-input" type="text" value="'+(r.emoji||'🍽️')+'" maxlength="4" placeholder="🍽️">'+
      '<input id="kit-f-name" class="kit-f-name-input" type="text" value="'+kitEsc(r.name||'')+'" placeholder="Recipe name" autocomplete="off">'+
    '</div>'+
    '<div class="settings-2col">'+
      '<div class="settings-field"><label>Category</label><select id="kit-f-cat">'+catOpts+'</select></div>'+
      '<div class="settings-field"><label>Servings</label><input id="kit-f-serv" type="number" min="1" inputmode="numeric" value="'+(r.servings||2)+'"></div>'+
    '</div>'+
    '<div class="settings-field"><label>Cook time (min)</label><input id="kit-f-time" type="number" min="0" inputmode="numeric" value="'+(r.cookTime||'')+'" placeholder="e.g. 25"></div>'+
    '<div class="settings-field"><label>Description</label><input id="kit-f-desc" type="text" value="'+kitEsc(r.description||'')+'" placeholder="Short description"></div>'+
    '<div class="settings-field"><label>Macros (per recipe)</label><div class="kit-macro-grid">'+
      '<input id="kit-f-cal" type="number" inputmode="numeric" placeholder="cal" value="'+(r.calories??'')+'">'+
      '<input id="kit-f-pro" type="number" inputmode="numeric" placeholder="protein" value="'+(r.protein??'')+'">'+
      '<input id="kit-f-carb" type="number" inputmode="numeric" placeholder="carbs" value="'+(r.carbs??'')+'">'+
      '<input id="kit-f-fat" type="number" inputmode="numeric" placeholder="fat" value="'+(r.fat??'')+'">'+
    '</div></div>'+
    '<div class="settings-field"><label>Ingredients</label><div id="kit-f-ings"></div>'+
      '<button class="kit-add-row" onclick="kitFormAddIng()">+ Add ingredient</button></div>'+
    '<div class="settings-field"><label>Steps <span style="font-size:11px;font-weight:400;color:var(--muted)">(add a timer if the step needs one)</span></label>'+
      '<div id="kit-f-steps"></div>'+
      '<button class="kit-add-row" onclick="kitFormAddStep()">+ Add step</button></div>'+
    '<div class="settings-field"><label>Tags</label><div class="kit-tag-chips-wrap" id="kit-f-tag-chips">'+tagChips+'</div></div>'+
    '<button class="kit-f-save-btn" onclick="kitSaveForm()">Save Recipe</button>'+
    '<div style="height:24px"></div>';
  document.getElementById('kit-f-ings').innerHTML='';
  (r.ingredients&&r.ingredients.length?r.ingredients:[{name:'',amount:'',unit:'g'}]).forEach(i=>kitFormAddIng(i));
  document.getElementById('kit-f-steps').innerHTML='';
  (r.steps&&r.steps.length?r.steps:[{text:'',timerMinutes:null}]).forEach(s=>kitFormAddStep(s));
  const ov=document.getElementById('kit-form-overlay');
  ov.classList.remove('hidden');
  // full-screen on mobile
  if(window.innerWidth<1024){
    ov.style.cssText='position:fixed;inset:0;background:var(--bg);z-index:180;display:flex;flex-direction:column;overflow-y:auto;padding:env(safe-area-inset-top,16px) 0 env(safe-area-inset-bottom,24px);align-items:stretch;justify-content:flex-start';
    const mb=document.getElementById('kit-form-box');
    if(mb) mb.style.cssText='width:100%;max-width:none;border-radius:0;box-shadow:none;max-height:none;margin:0;flex:1';
  } else {
    ov.style.cssText='';
    const mb=document.getElementById('kit-form-box');
    if(mb) mb.style.cssText='';
  }
}
function kitFormAddIng(data){
  const wrap=document.getElementById('kit-f-ings'); if(!wrap) return;
  const d=(data&&typeof data==='object')?data:{name:'',amount:'',unit:'g'};
  const unitSel=KIT_UNITS.map(u=>'<option value="'+u+'"'+((d.unit||'g')===u?' selected':'')+'>'+u+'</option>').join('');
  const row=document.createElement('div');
  row.className='kit-f-ing-row';
  row.innerHTML=
    '<input class="kit-fi-amt" type="text" inputmode="decimal" placeholder="Qty" value="'+kitEsc(String(d.amount||''))+'">'+
    '<select class="kit-fi-unit-sel">'+unitSel+'</select>'+
    '<input class="kit-fi-name" type="text" placeholder="Ingredient" value="'+kitEsc(d.name||'')+'">'+
    '<button class="kit-f-del" onclick="this.parentElement.remove()" aria-label="Remove">✕</button>';
  wrap.appendChild(row);
}
function kitFormAddStep(data){
  const wrap=document.getElementById('kit-f-steps'); if(!wrap) return;
  const text=kitStepText(data);
  const timer=kitStepTimer(data);
  const row=document.createElement('div');
  row.className='kit-f-step-row';
  row.innerHTML=
    '<textarea class="kit-fs-text" rows="2" placeholder="Describe this step">'+kitEsc(text)+'</textarea>'+
    '<input class="kit-fs-timer" type="number" inputmode="numeric" min="0" placeholder="⏱ min" value="'+(timer||'')+'" title="Timer (minutes)">'+
    '<button class="kit-f-del" onclick="this.parentElement.remove()" aria-label="Remove">✕</button>';
  wrap.appendChild(row);
}
function kitCloseForm(){
  const ov=document.getElementById('kit-form-overlay');
  if(ov){ ov.classList.add('hidden'); ov.style.cssText=''; }
  const mb=document.getElementById('kit-form-box');
  if(mb) mb.style.cssText='';
}
function kitSaveForm(){
  const num=v=>{ const n=parseFloat(v); return isNaN(n)?null:n; };
  const name=(document.getElementById('kit-f-name')?.value||'').trim();
  if(!name){ alert('Please enter a recipe name.'); return; }
  const ings=[...document.querySelectorAll('#kit-f-ings .kit-f-ing-row')].map(row=>({
    name:(row.querySelector('.kit-fi-name')?.value||'').trim(),
    amount:(()=>{ const v=(row.querySelector('.kit-fi-amt')?.value||'').trim(); const n=parseFloat(v); return (v!==''&&!isNaN(n))?n:v; })(),
    unit:(row.querySelector('.kit-fi-unit-sel')?.value||row.querySelector('.kit-fi-unit')?.value||'').trim(),
  })).filter(i=>i.name);
  const steps=[...document.querySelectorAll('#kit-f-steps .kit-f-step-row')].map(row=>{
    const t=(row.querySelector('.kit-fs-text')?.value||'').trim();
    const m=parseInt(row.querySelector('.kit-fs-timer')?.value||'');
    return {text:t,timerMinutes:(!isNaN(m)&&m>0)?m:null};
  }).filter(s=>s.text);
  const tags=[...document.querySelectorAll('#kit-f-tag-chips .kit-tag-chip.active')].map(b=>b.dataset.tag);
  const id=document.getElementById('kit-f-id')?.value||'';
  const data={
    name,
    emoji:(document.getElementById('kit-f-emoji')?.value||'🍽️').trim()||'🍽️',
    category:document.getElementById('kit-f-cat')?.value||'dinner',
    description:(document.getElementById('kit-f-desc')?.value||'').trim(),
    servings:Math.max(1,parseInt(document.getElementById('kit-f-serv')?.value)||1),
    cookTime:num(document.getElementById('kit-f-time')?.value),
    ingredients:ings,
    steps,
    tags,
    calories:num(document.getElementById('kit-f-cal')?.value),
    protein:num(document.getElementById('kit-f-pro')?.value),
    carbs:num(document.getElementById('kit-f-carb')?.value),
    fat:num(document.getElementById('kit-f-fat')?.value),
    batchPrep:tags.includes('batch-prep')||tags.includes('bulk-cook'),
  };
  if(id){
    const r=kitRecipes.find(x=>x.id===id);
    if(r) Object.assign(r,data);
  } else {
    kitRecipes.push(Object.assign({id:kitUUID(),favourite:false,lastCooked:null,createdAt:Date.now()},data));
    kitState.selectedId=null;
  }
  kitSaveRecipes();
  kitCloseForm();
  kitRenderList();
  if(id&&kitState.selectedId===id) kitRefreshOpenDetail();
}

// ══ KITCHEN: Shopping List ════════════════════════════════════════
const PANTRY_STAPLES = new Set([
  'extra virgin olive oil','olive oil','salted butter','butter','canola oil',
  'soy sauce','worcestershire sauce','balsamic vinegar','white vinegar',
  'bbq sauce','teriyaki sauce','mayonnaise','chipotle in adobo',
  'eggs','salt','black pepper','curry powder','sugar','brown sugar',
  'plain flour','cinnamon','vanilla extract','garlic','onion','brown onion',
  'smoked paprika','paprika','coriander','cumin','chilli','chilli flakes',
  'garam masala','garlic powder','garlic salt','onion powder','parsley',
  'rosemary','oregano','italian herbs','allspice','roast chicken seasoning',
  'bay leaves','cloves','cayenne pepper','ginger','ginger powder','sesame oil'
]);
function kitGetIngredientCategory(name){
  const n=name.toLowerCase();
  if(/prawn|beef|chicken|lamb|steak|mince|patty|patties|pork|fish|tuna|salmon|egg/.test(n)) return 'Protein';
  if(/milk|cheese|butter|yoghurt|cream|feta/.test(n)) return 'Dairy';
  if(/lettuce|rocket|spinach|tomato|carrot|potato|onion|lemon|lime|berry|berries|apple|banana|capsicum|zucchini|mushroom|spring onion|basil|coriander leaf/.test(n)) return 'Produce';
  if(/bread|bun|noodle|rice|flour|pasta|oat|cereal|cracker|wrap|tortilla/.test(n)) return 'Bakery & Grains';
  return 'Other';
}
const KITSHOP_CAT_ORDER=['Produce','Protein','Dairy','Bakery & Grains','Other'];

function kitShopLoadSelected(){ return lsLoad('kitchen_shopping_selected', [], Array.isArray); }
function kitShopSaveSelected(){ lsSave('kitchen_shopping_selected', kitShopSelected, 'kitShopSelected'); }
function kitShopLoadChecked(){ return lsLoad('kitchen_shopping_checked', {}); }
function kitShopSaveChecked(){ lsSave('kitchen_shopping_checked', kitShopChecked, 'kitShopChecked'); }
function kitShopLoadManual(){ return lsLoad('kitchen_shopping_manual', [], Array.isArray); }
function kitShopSaveManual(){ lsSave('kitchen_shopping_manual', kitShopManual, 'kitShopManual'); }
let kitShopSelected = kitShopLoadSelected();
let kitShopChecked  = kitShopLoadChecked();
let kitShopManual   = kitShopLoadManual();
// If a list was already built (selections exist), reopen on the list view
let kitShopView = kitShopSelected.length ? 'list' : 'selector';

function kitShopRender(){
  const sel=document.getElementById('kitshop-selector');
  const list=document.getElementById('kitshop-list');
  if(!sel||!list) return;
  const onList=kitShopView==='list' && kitShopSelected.length>0;
  sel.classList.toggle('hidden',onList);
  list.classList.toggle('hidden',!onList);
  if(onList) kitShopRenderList(); else kitShopRenderSelector();
}

// ── State 1: recipe selector ──
function kitShopSelEntry(id){ return kitShopSelected.find(s=>s.recipeId===id); }
function kitShopToggleRecipe(id){
  const r=kitRecipes.find(x=>x.id===id); if(!r) return;
  const i=kitShopSelected.findIndex(s=>s.recipeId===id);
  if(i>=0) kitShopSelected.splice(i,1);
  else kitShopSelected.push({recipeId:id,servings:r.servings});
  kitShopSaveSelected();
  kitShopRenderSelector();
}
function kitShopAdjustServings(id,delta){
  const e=kitShopSelEntry(id); if(!e) return;
  const next=e.servings+delta;
  if(next<1) return;
  e.servings=next;
  kitShopSaveSelected();
  kitShopRenderSelector();
}
function kitShopRenderSelector(){
  const wrap=document.getElementById('kitshop-selector'); if(!wrap) return;
  if(!kitRecipes.length){
    wrap.innerHTML='<div class="empty" style="padding-top:64px"><div style="font-size:48px">🛒</div><div style="font-size:16px;font-weight:600;margin-top:12px">No recipes yet</div><div style="font-size:13px;color:var(--muted);margin-top:6px">Add recipes first, then build a list.</div></div>';
    return;
  }
  const recs=[...kitRecipes].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  let html='<div class="kitshop-heading">What are you cooking this week?</div>';
  html+='<div class="kitshop-sel-list">';
  recs.forEach(r=>{
    const e=kitShopSelEntry(r.id);
    const on=!!e;
    const servings=e?e.servings:r.servings;
    html+='<div class="kitshop-sel-card'+(on?' selected':'')+'" onclick="kitShopToggleRecipe(\''+r.id+'\')">'+
      '<div class="kitshop-sel-check">'+(on?'✓':'')+'</div>'+
      '<div class="kitshop-sel-body">'+
        '<div class="kitshop-sel-name">'+kitEsc(r.name)+'</div>'+
        '<div class="kit-card-meta"><span class="kit-cat-tag kit-cat-'+r.category+'">'+r.category+'</span></div>'+
      '</div>'+
      (on?
        '<div class="kitshop-serv" onclick="event.stopPropagation()">'+
          '<button class="kitshop-serv-btn" onclick="kitShopAdjustServings(\''+r.id+'\',-1)" aria-label="Fewer">−</button>'+
          '<div class="kitshop-serv-num">'+servings+'</div>'+
          '<button class="kitshop-serv-btn" onclick="kitShopAdjustServings(\''+r.id+'\',1)" aria-label="More">+</button>'+
        '</div>'
        :'<div class="kitshop-serv-hint">'+r.servings+' serv</div>')+
    '</div>';
  });
  html+='</div>';
  const n=kitShopSelected.length;
  html+='<button class="kitshop-build-btn" onclick="kitShopBuild()"'+(n?'':' disabled')+'>Build shopping list →</button>';
  wrap.innerHTML=html;
}
function kitShopBuild(){
  if(!kitShopSelected.length) return;
  kitShopView='list';
  kitShopRender();
}

// ── Quantity combining ──
function kitShopNorm(name){ return (name||'').toLowerCase().trim(); }
function kitShopItemKey(name,unit){ return kitShopNorm(name)+'-'+(unit||'').toLowerCase().trim(); }
function kitShopComputeItems(){
  // map: key -> {name, unit, amount(number|null), hasNumeric, category}
  const map={};
  kitShopSelected.forEach(sel=>{
    const r=kitRecipes.find(x=>x.id===sel.recipeId); if(!r) return;
    const factor=(sel.servings||r.servings)/(r.servings||1);
    (r.ingredients||[]).forEach(ing=>{
      const nm=ing.name||'';
      if(!nm) return;
      if(PANTRY_STAPLES.has(kitShopNorm(nm))) return; // exclude staples
      const unit=(ing.unit||'').trim();
      const key=kitShopItemKey(nm,unit);
      const n=parseFloat(ing.amount);
      if(!map[key]){
        map[key]={name:nm,unit,amount:isNaN(n)?null:0,hasNumeric:!isNaN(n),category:kitGetIngredientCategory(nm)};
      }
      if(!isNaN(n)){
        map[key].amount=(map[key].amount||0)+n*factor;
        map[key].hasNumeric=true;
      }
    });
  });
  // manual items (always 'Other' or their stored category)
  kitShopManual.forEach(m=>{
    const key=kitShopItemKey(m.name,'');
    if(!map[key]) map[key]={name:m.name,unit:'',amount:null,hasNumeric:false,category:m.category||'Other',manual:true,manualId:m.id};
  });
  return map;
}
function kitShopRenderList(){
  const wrap=document.getElementById('kitshop-list'); if(!wrap) return;
  const map=kitShopComputeItems();
  const keys=Object.keys(map);
  // group by category
  const groups={};
  keys.forEach(k=>{ const it=map[k]; (groups[it.category]=groups[it.category]||[]).push(Object.assign({key:k},it)); });
  const needs=(typeof kitPantryNeeds==='function')?kitPantryNeeds():[];
  const totalItems=keys.length+needs.length;
  let html='';
  html+='<div class="kitshop-list-head">'+
    '<button class="kit-back" onclick="kitShopBackToSelector()" aria-label="Back">←</button>'+
    '<div class="kitshop-list-title">Shopping list<span class="kitshop-count">'+totalItems+'</span></div>'+
    '<button class="kitshop-clear-checked" onclick="kitShopClearChecked()">Clear checked</button>'+
  '</div>';
  if(!totalItems){
    html+='<div class="empty" style="padding:48px 16px"><div style="font-size:40px">✅</div><div style="font-size:15px;font-weight:600;margin-top:10px">Nothing to buy</div><div style="font-size:13px;color:var(--muted);margin-top:4px">Everything\'s a pantry staple — or add an item below.</div></div>';
  }
  // Pantry needs (out of stock / running low) — separate from recipe ingredients
  if(needs.length){
    html+='<div class="kitshop-cat-head kitshop-pantry-head">🥫 Pantry needs</div>';
    needs.forEach(it=>{
      html+='<label class="kitshop-item">'+
        '<input type="checkbox" class="kitshop-cb" onchange="kitPantryRestock(\''+it.id+'\')">'+
        '<span class="kitshop-item-name">'+kitEsc(it.name)+'</span>'+
        '<span class="kitshop-item-qty kitshop-need-tag '+(it.inStock?'low':'out')+'">'+(it.inStock?'⚠ Low':'Out')+'</span>'+
      '</label>';
    });
  }
  KITSHOP_CAT_ORDER.forEach(cat=>{
    const items=groups[cat]; if(!items||!items.length) return;
    items.sort((a,b)=>a.name.localeCompare(b.name));
    html+='<div class="kitshop-cat-head">'+cat+'</div>';
    items.forEach(it=>{
      const checked=!!kitShopChecked[it.key];
      let qty='';
      if(it.hasNumeric&&it.amount!=null){ qty=kitTrim(it.amount)+(it.unit?' '+it.unit:''); }
      else if(it.unit){ qty=it.unit; }
      html+='<label class="kitshop-item'+(checked?' checked':'')+'">'+
        '<input type="checkbox" class="kitshop-cb"'+(checked?' checked':'')+' onchange="kitShopToggleCheck(\''+it.key.replace(/'/g,"\\'")+'\',this.checked)">'+
        '<span class="kitshop-item-name">'+kitEsc(it.name)+'</span>'+
        (qty?'<span class="kitshop-item-qty">'+kitEsc(qty)+'</span>':'')+
        (it.manual?'<button class="kitshop-item-del" onclick="event.preventDefault();kitShopDeleteManual(\''+it.manualId+'\')" aria-label="Remove">✕</button>':'')+
      '</label>';
    });
  });
  html+='<button class="kitshop-clear-all" onclick="kitShopClearAll()">Clear all & start over</button>';
  wrap.innerHTML=html;
  // Manual-add bar (fixed) lives outside the scroll list
  kitShopRenderAddBar(true);
}
function kitShopRenderAddBar(show){
  let bar=document.getElementById('kitshop-addbar');
  if(!show){ if(bar) bar.remove(); return; }
  if(!bar){
    bar=document.createElement('div');
    bar.id='kitshop-addbar';
    bar.className='kitshop-addbar';
    bar.innerHTML='<input id="kitshop-add-input" type="text" placeholder="Add an item…" onkeydown="if(event.key===\'Enter\')kitShopAddManual()"><button onclick="kitShopAddManual()">Add</button>';
    document.body.appendChild(bar);
  }
  bar.style.display='flex';
}
function kitShopBackToSelector(){
  kitShopView='selector';
  kitShopRenderAddBar(false);
  kitShopRender();
}
function kitShopToggleCheck(key,checked){
  if(checked) kitShopChecked[key]=true; else delete kitShopChecked[key];
  kitShopSaveChecked();
  // update row styling without full re-render
  kitShopRenderList();
}
function kitShopClearChecked(){
  kitShopChecked={};
  kitShopSaveChecked();
  kitShopRenderList();
}
function kitShopAddManual(){
  const inp=document.getElementById('kitshop-add-input'); if(!inp) return;
  const name=inp.value.trim(); if(!name) return;
  kitShopManual.push({id:kitUUID(),name,category:'Other'});
  kitShopSaveManual();
  inp.value='';
  kitShopRenderList();
}
function kitShopDeleteManual(id){
  const m=kitShopManual.find(x=>x.id===id);
  kitShopManual=kitShopManual.filter(x=>x.id!==id);
  if(m) delete kitShopChecked[kitShopItemKey(m.name,'')];
  kitShopSaveManual(); kitShopSaveChecked();
  kitShopRenderList();
}
function kitShopClearAll(){
  if(!confirm('Clear the whole list and start over?')) return;
  kitShopSelected=[]; kitShopChecked={}; kitShopManual=[];
  kitShopSaveSelected(); kitShopSaveChecked(); kitShopSaveManual();
  kitShopView='selector';
  kitShopRenderAddBar(false);
  kitShopRender();
}

// ══ KITCHEN: Spice & Pantry Tracker ═══════════════════════════════
const KITPANTRY_CATS=[
  ['spices','Spices',['Smoked paprika','Paprika (ground)','Coriander (ground)','Cumin (ground)','Chilli flakes','Garam masala','Garlic powder','Garlic salt','Onion powder','Allspice (ground)','Roast chicken seasoning','Cayenne pepper','Ginger powder']],
  ['herbs','Dried Herbs',['Parsley (dried)','Rosemary leaves','Oregano leaves','Italian herbs','Bay leaves','Cloves (whole)']],
  ['dry','Dry Goods',['Salt','Black pepper','Curry powder','Cinnamon','Sugar','Brown sugar','Plain flour','Vanilla extract']],
  ['oils','Oils & Fats',['Extra virgin olive oil','Canola oil','Salted butter','Sesame oil']],
  ['sauces','Sauces & Condiments',['Soy sauce','Worcestershire sauce','Balsamic vinegar','White vinegar','BBQ sauce','Teriyaki sauce','Mayonnaise','Chipotle in adobo','Tomato ketchup','Dijon mustard']],
];
function kitPantryId(name){ return name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
// Seed item metadata (id -> {name, cat}); custom items carry their own metadata in the store
const KITPANTRY_SEED_META={};
KITPANTRY_CATS.forEach(([cat,,items])=>items.forEach(nm=>{ KITPANTRY_SEED_META[kitPantryId(nm)]={name:nm,cat}; }));
function kitPantryLoad(){
  try{
    const raw=localStorage.getItem('kitchen_pantry');
    if(raw){ const o=JSON.parse(raw); if(o&&typeof o==='object') return o; }
  }catch(e){}
  const seed={};
  KITPANTRY_CATS.forEach(([cat,,items])=>items.forEach(nm=>{ seed[kitPantryId(nm)]={inStock:true,runningLow:false}; }));
  localStorage.setItem('kitchen_pantry',JSON.stringify(seed));
  return seed;
}
let kitPantryData=kitPantryLoad();
function kitPantrySave(){ lsSave('kitchen_pantry', kitPantryData, 'kitPantry'); }
// All items (seed + custom) grouped by category key
function kitPantryItemsByCat(){
  const groups={}; KITPANTRY_CATS.forEach(([cat])=>groups[cat]=[]);
  // seed items in their defined order
  KITPANTRY_CATS.forEach(([cat,,items])=>items.forEach(nm=>{
    const id=kitPantryId(nm);
    const st=kitPantryData[id]||{inStock:true,runningLow:false};
    groups[cat].push({id,name:nm,cat,inStock:st.inStock!==false,runningLow:!!st.runningLow});
  }));
  // custom items (have name+cat stored in the value)
  Object.keys(kitPantryData).forEach(id=>{
    const v=kitPantryData[id];
    if(v&&v.custom&&v.name){
      const cat=v.cat&&groups[v.cat]?v.cat:'sauces';
      groups[cat].push({id,name:v.name,cat,inStock:v.inStock!==false,runningLow:!!v.runningLow,custom:true});
    }
  });
  return groups;
}
function kitPantryNeeds(){
  // Items out of stock OR running low — for the shopping list
  const out=[];
  const seen={};
  const push=(id,name,inStock)=>{ if(seen[id])return; seen[id]=1; out.push({id,name,inStock}); };
  Object.keys(kitPantryData).forEach(id=>{
    const v=kitPantryData[id]||{};
    const meta=KITPANTRY_SEED_META[id];
    const name=(v.custom&&v.name)?v.name:(meta?meta.name:null);
    if(!name) return;
    if(v.inStock===false || v.runningLow===true) push(id,name,v.inStock!==false);
  });
  out.sort((a,b)=>a.name.localeCompare(b.name));
  return out;
}
function kitPantryToggleStock(id){
  const v=kitPantryData[id]||(kitPantryData[id]={inStock:true,runningLow:false});
  v.inStock=v.inStock===false; // flip (running-low flag is left untouched)
  kitPantrySave();
  kitPantryRender();
}
function kitPantryToggleLow(id){
  const v=kitPantryData[id]||(kitPantryData[id]={inStock:true,runningLow:false});
  v.runningLow=!v.runningLow;
  kitPantryData[id]=v;
  kitPantrySave();
  kitPantryRender();
}
function kitPantryRestock(id){
  const v=kitPantryData[id]||{};
  v.inStock=true; v.runningLow=false;
  // preserve custom metadata
  kitPantryData[id]=Object.assign(kitPantryData[id]||{},v);
  kitPantrySave();
  // refresh whichever kitchen view is active
  if(kitState.tab==='pantry') kitPantryRender();
  if(kitState.tab==='shopping') kitShopRenderList();
}
function kitPantryAddCustom(catKey){
  const inp=document.getElementById('kitpantry-add-'+catKey);
  if(!inp) return;
  const name=inp.value.trim(); if(!name) return;
  let id='custom_'+Date.now();
  kitPantryData[id]={inStock:true,runningLow:false,custom:true,name,cat:catKey};
  kitPantrySave();
  inp.value='';
  kitPantryRender();
}
function kitPantryRender(){
  const wrap=document.getElementById('kitpantry'); if(!wrap) return;
  const groups=kitPantryItemsByCat();
  // Summary counts
  let inStock=0,low=0,out=0;
  Object.keys(groups).forEach(cat=>groups[cat].forEach(it=>{
    if(!it.inStock) out++; else { inStock++; if(it.runningLow) low++; }
  }));
  let html='<div class="kitpantry-summary">'+
    '<span class="kitpantry-badge good">'+inStock+' in stock</span>'+
    '<span class="kitpantry-badge warn">'+low+' running low</span>'+
    '<span class="kitpantry-badge bad">'+out+' out of stock</span>'+
  '</div>';
  KITPANTRY_CATS.forEach(([cat,label])=>{
    html+='<div class="kitpantry-cat-head">'+label+'</div>';
    groups[cat].forEach(it=>{
      html+='<div class="kitpantry-item'+(it.inStock?'':' out')+'">'+
        '<input type="checkbox" class="kitpantry-cb"'+(it.inStock?' checked':'')+' onchange="kitPantryToggleStock(\''+it.id+'\')" aria-label="In stock">'+
        '<span class="kitpantry-name">'+kitEsc(it.name)+'</span>'+
        '<button class="kitpantry-low'+(it.runningLow?' on':'')+'" onclick="kitPantryToggleLow(\''+it.id+'\')">⚠ Low</button>'+
        (it.custom?'<button class="kitpantry-del" onclick="kitPantryDeleteCustom(\''+it.id+'\')" aria-label="Remove">✕</button>':'')+
      '</div>';
    });
    html+='<div class="kitpantry-add"><input id="kitpantry-add-'+cat+'" type="text" placeholder="+ Add item" onkeydown="if(event.key===\'Enter\')kitPantryAddCustom(\''+cat+'\')"><button onclick="kitPantryAddCustom(\''+cat+'\')">Add</button></div>';
  });
  wrap.innerHTML=html;
}
function kitPantryDeleteCustom(id){
  delete kitPantryData[id];
  kitPantrySave();
  kitPantryRender();
}

// ── Boot ──────────────────────────────────────────────────────────
// Wrapped so a single render/init error surfaces a visible message instead of
// leaving a blank black screen — and so later steps (like the SW registration
// that ships fresh code) still run even if an earlier step throws.
try {
  recoverBudgetData(); // one-time: normalise legacy budget weeks, strip shadowing snapshots
  // Weight-log consolidation: fold any legacy daily_weight_log entries into wt_weight.
  // The local key is only removed by the signed-in path (after the merged copy is safely
  // in the cloud), so a signed-out merge can never lose data to the next cloud pull.
  if(mergeLegacyWeightEntries()) persistWeights();
  // Seed the CC balance history from the current balance so the net-worth line has a start.
  if(!ccLog.length){
    const _ccBal=parseFloat(loadCCData().balance);
    if(_ccBal>0) recordCCHistory(_ccBal);
  }
  applyTheme();
  applyLogoDayColour();
  buildSideMenu();
  applyDayColour();
  logCheckin();
  // Restore an in-progress workout from earlier today (survives refresh); else fresh day.
  if(!restoreSetData()) initDay(suggestDay());
  renderHome();
  updateHeaderAvatar();
  updateDesktopSidebar();
  // Event delegation on the stable sidebar parent — one listener, never double-binds
  const _dsSidebar=document.getElementById('desktop-sidebar');
  if(_dsSidebar) _dsSidebar.addEventListener('click',e=>{
    const item=e.target.closest('.ds-item');
    if(item&&item.dataset.tab) setView(item.dataset.tab);
  });
  document.querySelectorAll('.ds-item').forEach(b=>b.classList.toggle('active',b.dataset.tab==='home'));
  updateNavPill('home');
  updateStatsPill('home');
  updateNavBadges();
  (function(){
    const _bn=document.getElementById('bottom-nav');
    if(!_bn) return;
    _bn.addEventListener('click', function(e){
      const btn=e.target.closest('.nav-btn');
      if(!btn) return;
      const icon=btn.querySelector('svg');
      if(!icon) return;
      icon.classList.remove('nav-icon-bounce');
      void icon.offsetWidth;
      icon.classList.add('nav-icon-bounce');
      icon.addEventListener('animationend', ()=>icon.classList.remove('nav-icon-bounce'), {once:true});
    });
  })();
  checkOnboarding();
  checkReminders();
} catch(e) {
  console.error('App init failed:', e);
  const main=document.getElementById('app-main');
  if(main) main.innerHTML='<div style="padding:24px;color:var(--text);font-size:14px;line-height:1.6">'+
    '<div style="font-size:32px;margin-bottom:8px">⚠️</div>'+
    '<div style="font-weight:700;margin-bottom:6px">Something went wrong loading the app</div>'+
    '<div style="color:var(--muted);font-size:13px;margin-bottom:12px">'+(e&&e.message?String(e.message).replace(/</g,'&lt;'):'Unknown error')+'</div>'+
    '<button onclick="try{if(typeof budSaveCurrentWeek===\'function\')budSaveCurrentWeek()}catch(e){};location.reload(true)" style="padding:10px 20px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer">Reload</button>'+
    '</div>';
}

// Always register the (network-first) service worker so fresh code reaches the
// device even if boot above threw — this is what replaces stale cached code.
if('serviceWorker' in navigator){
  // When a new SW (skipWaiting + clients.claim) takes control, the page is still
  // running the OLD cached JS/CSS until it reloads. Reload once automatically so
  // updates apply on the very next launch instead of needing a manual second relaunch.
  // Guarded against loops: only fires after an existing controller is replaced.
  let _swRefreshing=false;
  if(navigator.serviceWorker.controller){
    navigator.serviceWorker.addEventListener('controllerchange', function(){
      if(_swRefreshing) return;
      _swRefreshing=true;
      location.reload();
    });
  }
  navigator.serviceWorker.register('/workout-tracker/service-worker.js');
}

// ── Keep #app-main bottom padding in sync with the real bottom-nav height ──
// The nav height varies with the device safe-area inset, so measure it rather than
// hardcoding. Floored + small gap so a mistimed measurement can never clip content;
// falls back to the stylesheet value on desktop (nav hidden) or if measuring fails.
function syncNavPadding(){
  var nav=document.getElementById('bottom-nav');
  var main=document.getElementById('app-main');
  if(!nav||!main) return;
  var h=Math.round(nav.getBoundingClientRect().height);
  if(h>0){
    main.style.paddingBottom=Math.max(h+12, 88)+'px';
    document.documentElement.style.setProperty('--nav-height', h+'px');
  } else {
    main.style.paddingBottom='';
    document.documentElement.style.removeProperty('--nav-height');
  }
}
window.addEventListener('load', syncNavPadding);
window.addEventListener('resize', syncNavPadding);
window.addEventListener('orientationchange', function(){ setTimeout(syncNavPadding,150); });
setTimeout(syncNavPadding, 0);

// ── iOS standalone PWA cold-launch layout fix ──
// On a fresh launch from the Home Screen, iOS can render before env(safe-area-inset-*)
// resolve (they come back 0) and with a mis-measured viewport — the app "fixes itself"
// only after the user rotates. Force the same reflow a few times after launch / on
// resume so the safe-area insets + nav padding settle without needing a rotation.
// (Scroll position is preserved; the display toggle is synchronous so it never paints.)
function pinAppHeight(){
  // #app now fills the viewport via CSS (position:fixed; inset:0), which iOS resolves
  // correctly at launch — so never set an explicit JS height (it would override the
  // insets). Only clear any stale inline height left by an earlier app version.
  var app=document.getElementById('app');
  if(app && app.style.height) app.style.height='';
}
function nudgeLayout(){
  // Note: the old viewport-fit (cover→auto→cover) toggle was REMOVED — it raced with how
  // iOS resolves env(safe-area-inset-top) and intermittently double-counted it, dragging
  // the header down on some launches. With #app on position:fixed (stable dvh) the toggle
  // is unnecessary; we only keep the nav-padding sync here.
  pinAppHeight();
  if(typeof syncNavPadding==='function') syncNavPadding();
}
// ── Notes ──────────────────────────────────────────────────────────
function renderNotes(){
  const wrap=document.getElementById('notes-content'); if(!wrap) return;
  const notes=loadNotes();
  const today=getLocalDate();

  let html=`<button onclick="notesOpenEdit(null)" style="width:100%;padding:12px;border-radius:14px;border:none;background:var(--accent);color:#fff;font-size:15px;font-weight:700;margin-bottom:16px">+ New note</button>`;

  html+=`<div style="display:flex;gap:8px;margin-bottom:16px">
    <button onclick="notesFilter('all')" id="nf-all" style="flex:1;padding:8px;border-radius:10px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600">All</button>
    <button onclick="notesFilter('work')" id="nf-work" style="flex:1;padding:8px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;font-weight:600">Work</button>
    <button onclick="notesFilter('personal')" id="nf-personal" style="flex:1;padding:8px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;font-weight:600">Personal</button>
  </div>`;

  if(!notes.length){
    html+=`<div style="text-align:center;padding:60px 20px;color:var(--muted)"><div style="font-size:40px;margin-bottom:12px">📝</div><div style="font-size:16px;font-weight:600;margin-bottom:6px">No notes yet</div><div style="font-size:14px">Tap + New note to get started</div></div>`;
  } else {
    const sorted=[...notes].sort((a,b)=>{
      if(a.priority!==b.priority) return a.priority?-1:1;
      if(a.date&&b.date) return a.date<b.date?-1:1;
      if(a.date) return -1; if(b.date) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
    sorted.forEach(n=>{
      const typeColor=n.type==='work'?'#3b82f6':'#52B788';
      const typeLabel=n.type==='work'?'Work':'Personal';
      let dateBadge='';
      if(n.date&&n.dateType!=='none'){
        const diff=Math.ceil((new Date(n.date)-new Date(today))/(1000*60*60*24));
        const label=n.dateType==='expiry'?'Expires':'Reminder';
        const urgentColor=diff<=7?'var(--danger)':diff<=30?'#f59e0b':'var(--success)';
        dateBadge=`<span style="background:${urgentColor};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${label}: ${diff<=0?'Today':diff===1?'Tomorrow':n.date}</span>`;
      }
      html+=`<div style="background:var(--card);border-radius:16px;padding:14px 16px;margin-bottom:10px;position:relative" onclick="notesOpenEdit('${n.id}')">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="background:${typeColor};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${typeLabel}</span>
          ${n.priority?'<span style="font-size:13px">⭐</span>':''}
          ${dateBadge}
        </div>
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">${n.title}</div>
        ${n.body?`<div style="font-size:13px;color:var(--muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${n.body}</div>`:''}
      </div>`;
    });
  }

  wrap.innerHTML=html;
  wrap.dataset.filter='all';
}

function notesFilter(f){
  ['all','work','personal'].forEach(t=>{
    const btn=document.getElementById('nf-'+t);
    if(btn){ btn.style.background=t===f?'var(--accent)':'var(--card)'; btn.style.color=t===f?'#fff':'var(--text)'; btn.style.border=t===f?'none':'1px solid var(--border)'; }
  });
  const wrap=document.getElementById('notes-content'); if(!wrap) return;
  wrap.dataset.filter=f;
  const notes=f==='all'?loadNotes():loadNotes().filter(n=>n.type===f);
  const today=getLocalDate();
  const sorted=[...notes].sort((a,b)=>{
    if(a.priority!==b.priority) return a.priority?-1:1;
    if(a.date&&b.date) return a.date<b.date?-1:1;
    if(a.date) return -1; if(b.date) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  // Replace only the card area (everything after the 2 fixed buttons)
  let cardsHtml='';
  if(!sorted.length){
    cardsHtml=`<div style="text-align:center;padding:60px 20px;color:var(--muted)"><div style="font-size:40px;margin-bottom:12px">📝</div><div style="font-size:16px;font-weight:600;margin-bottom:6px">No notes</div></div>`;
  } else {
    sorted.forEach(n=>{
      const typeColor=n.type==='work'?'#3b82f6':'#52B788';
      const typeLabel=n.type==='work'?'Work':'Personal';
      let dateBadge='';
      if(n.date&&n.dateType!=='none'){
        const diff=Math.ceil((new Date(n.date)-new Date(today))/(1000*60*60*24));
        const label=n.dateType==='expiry'?'Expires':'Reminder';
        const urgentColor=diff<=7?'var(--danger)':diff<=30?'#f59e0b':'var(--success)';
        dateBadge=`<span style="background:${urgentColor};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${label}: ${diff<=0?'Today':diff===1?'Tomorrow':n.date}</span>`;
      }
      cardsHtml+=`<div style="background:var(--card);border-radius:16px;padding:14px 16px;margin-bottom:10px;position:relative" onclick="notesOpenEdit('${n.id}')">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="background:${typeColor};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${typeLabel}</span>
          ${n.priority?'<span style="font-size:13px">⭐</span>':''}
          ${dateBadge}
        </div>
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:4px">${n.title}</div>
        ${n.body?`<div style="font-size:13px;color:var(--muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${n.body}</div>`:''}
      </div>`;
    });
  }
  // Splice into wrap: keep first 2 children (new-btn + filter-row), replace rest
  const kids=[...wrap.children];
  kids.slice(2).forEach(k=>k.remove());
  const tmp=document.createElement('div'); tmp.innerHTML=cardsHtml;
  while(tmp.firstChild) wrap.appendChild(tmp.firstChild);
}

function notesOpenEdit(id){
  const notes=loadNotes();
  const note=id?notes.find(n=>n.id===id):null;
  const n=note||{id:'note_'+Date.now(),title:'',body:'',type:'personal',dateType:'none',date:'',priority:false,createdAt:getLocalDate()};

  const overlay=document.createElement('div');
  overlay.className='modal-overlay';
  overlay.id='note-edit-overlay';
  overlay.innerHTML=`<div class="modal-box" style="max-width:480px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-size:17px;font-weight:700">${id?'Edit note':'New note'}</div>
      <div style="display:flex;align-items:center;gap:4px">
        <button onclick="notesViewFullscreen()" aria-label="Read fullscreen" title="Read fullscreen" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:4px;display:flex;-webkit-tap-highlight-color:transparent"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button>
        <button onclick="this.closest('.modal-overlay').remove()" aria-label="Close" style="background:none;border:none;font-size:22px;color:var(--muted);cursor:pointer;padding:0 4px">×</button>
      </div>
    </div>
    <input id="ne-title" placeholder="Title" value="${n.title}" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:15px;margin-bottom:10px;box-sizing:border-box">
    <textarea id="ne-body" placeholder="Note body (optional)" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px;min-height:80px;box-sizing:border-box;resize:vertical;margin-bottom:10px">${n.body}</textarea>
    <div style="display:flex;gap:8px;margin-bottom:10px">
      <select id="ne-type" style="flex:1;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px">
        <option value="personal" ${n.type==='personal'?'selected':''}>Personal</option>
        <option value="work" ${n.type==='work'?'selected':''}>Work</option>
      </select>
      <select id="ne-datetype" style="flex:1;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px" onchange="document.getElementById('ne-date').style.display=this.value==='none'?'none':'block'">
        <option value="none" ${n.dateType==='none'?'selected':''}>No date</option>
        <option value="reminder" ${n.dateType==='reminder'?'selected':''}>Reminder</option>
        <option value="expiry" ${n.dateType==='expiry'?'selected':''}>Expiry</option>
      </select>
    </div>
    <input type="date" id="ne-date" value="${n.date}" style="width:100%;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:14px;margin-bottom:10px;box-sizing:border-box;display:${n.dateType==='none'?'none':'block'}">
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;font-size:14px;color:var(--text);cursor:pointer">
      <input type="checkbox" id="ne-priority" ${n.priority?'checked':''} style="width:16px;height:16px;accent-color:var(--accent)"> Priority note
    </label>
    <div style="display:flex;gap:8px">
      ${id?`<button onclick="notesDelete('${id}');this.closest('.modal-overlay').remove()" style="flex:1;padding:11px;border-radius:12px;border:1px solid var(--danger);background:transparent;color:var(--danger);font-weight:600;font-size:14px">Delete</button>`:''}
      <button onclick="notesSave('${n.id}')" style="flex:1;padding:11px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-weight:700;font-size:14px">Save</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);
}

// Read the current note fullscreen for comfortable reading of long notes (e.g. saved prompts).
// Uses the live edit-modal values so unsaved text shows too; exits back to the Notes list.
let _noteViewText='';
function notesViewFullscreen(){
  const title=(document.getElementById('ne-title')?.value||'').trim();
  const body=document.getElementById('ne-body')?.value||'';
  document.getElementById('note-edit-overlay')?.remove(); // close the edit modal; return lands on the list
  showNoteView(title, body);
}
function showNoteView(title, body){
  const t=document.getElementById('note-view-title'); if(t) t.textContent=title||'Note';
  const b=document.getElementById('note-view-body'); if(b) b.textContent=body||'';
  _noteViewText=(title?title+'\n\n':'')+(body||'');
  const v=document.getElementById('note-view-overlay');
  if(v){ v.style.display='block'; v.scrollTop=0; }
}
function closeNoteView(){ const v=document.getElementById('note-view-overlay'); if(v) v.style.display='none'; }
function copyNoteView(){
  const btn=document.getElementById('note-view-copy');
  const done=()=>{ if(btn){ const o=btn.textContent; btn.textContent='Copied ✓'; setTimeout(()=>{ btn.textContent=o; },1500); } };
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(_noteViewText).then(done,()=>{}); return; }
  }catch(e){}
  // Fallback for insecure contexts / older webviews
  try{
    const ta=document.createElement('textarea'); ta.value=_noteViewText; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done();
  }catch(e){}
}

function notesSave(id){
  const title=document.getElementById('ne-title')?.value?.trim();
  if(!title){ alert('Add a title'); return; }
  const notes=loadNotes();
  const idx=notes.findIndex(n=>n.id===id);
  const updated={
    id, title,
    body: document.getElementById('ne-body')?.value?.trim()||'',
    type: document.getElementById('ne-type')?.value||'personal',
    dateType: document.getElementById('ne-datetype')?.value||'none',
    date: document.getElementById('ne-date')?.value||'',
    priority: document.getElementById('ne-priority')?.checked||false,
    createdAt: idx>=0?notes[idx].createdAt:getLocalDate()
  };
  if(idx>=0) notes[idx]=updated; else notes.push(updated);
  saveNotes(notes);
  document.getElementById('note-edit-overlay')?.remove();
  renderNotes();
  renderHomeNotesBubble();
}

function notesDelete(id){
  const notes=loadNotes().filter(n=>n.id!==id);
  saveNotes(notes);
  renderNotes();
  renderHomeNotesBubble();
}

function buildHomeNotesCard(){
  const today=getLocalDate();
  const in7=new Date(today); in7.setDate(in7.getDate()+7);
  const in7Str=dateStr(in7);
  const notes=loadNotes().filter(n=>n.date&&n.dateType!=='none');
  const urgent=notes.filter(n=>!n.priority&&n.date<=in7Str&&n.date>=today);
  const upcoming=notes.filter(n=>!n.priority&&n.date>in7Str);
  // Whole card taps through to the Notes tab (rows inherit the click via bubbling).
  let html='<div class="card" onclick="setView(\'notes\')" style="cursor:pointer">';
  html+='<div style="font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px">Notes</div>';
  if(!urgent.length&&!upcoming.length){
    html+='<div style="font-size:13px;color:var(--muted)">No upcoming notes</div>';
  } else {
    urgent.forEach(n=>{
      const diff=Math.ceil((new Date(n.date)-new Date(today))/(1000*60*60*24));
      const label=diff<=0?'Today':diff===1?'Tomorrow':'In '+diff+' days';
      html+=`<div style="display:flex;align-items:center;gap:10px;padding:6px 0"><span style="width:8px;height:8px;border-radius:50%;background:var(--danger);flex-shrink:0"></span><div style="flex:1;font-size:14px;font-weight:600;color:var(--text)">${n.title}</div><div style="font-size:12px;color:var(--danger);font-weight:600">${label}</div></div>`;
    });
    upcoming.forEach(n=>{
      html+=`<div style="display:flex;align-items:center;gap:10px;padding:6px 0"><span style="width:8px;height:8px;border-radius:50%;background:var(--muted);flex-shrink:0"></span><div style="flex:1;font-size:14px;color:var(--text)">${n.title}</div><div style="font-size:12px;color:var(--muted)">${n.date}</div></div>`;
    });
  }
  html+='</div>';
  return html;
}
function renderHomeNotesBubble(){
  const el=document.querySelector('#home-content [data-card-id="notes"]');
  if(el) el.innerHTML=buildHomeNotesCard();
}

// ── Plans ──────────────────────────────────────────────────────────
function renderPlans(){
  const wrap=document.getElementById('plans-content'); if(!wrap) return;
  const data=loadPlans();
  const active=data.plans.find(p=>p.id===data.activePlanId)||data.plans[0]||null;

  const today=getLocalDate();
  if(active && data.streak.lastDate!==today){
    const yesterday=new Date(today); yesterday.setDate(yesterday.getDate()-1);
    const yStr=dateStr(yesterday);
    if(data.streak.lastDate===yStr){
      data.streak.count++;
    } else if(data.streak.lastDate!==today){
      data.streak.count=0;
    }
    data.streak.lastDate=today;
    savePlans(data);
  }

  let html='';

  if(active){
    html+=`<div style="background:linear-gradient(135deg,rgba(var(--accent-rgb),.15),rgba(var(--accent-rgb),.05));border-radius:16px;padding:16px 20px;margin-bottom:16px;display:flex;align-items:center;gap:14px">
      <div style="font-size:32px">🔥</div>
      <div>
        <div style="font-size:24px;font-weight:800;color:var(--accent);font-family:var(--font-num)">${data.streak.count} day streak</div>
        <div style="font-size:13px;color:var(--muted)">Active: ${active.name}</div>
      </div>
    </div>`;
  }

  html+=`<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
    <button onclick="plansImport()" style="flex:1;padding:10px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;font-weight:600">⬆ JSON</button>
    <button onclick="plansImportHTML()" style="flex:1;padding:10px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;font-weight:600">⬆ HTML</button>
    <button onclick="plansExport()" style="flex:1;padding:10px;border-radius:12px;border:1px solid var(--border);background:var(--card);color:var(--text);font-size:13px;font-weight:600">⬇ Export</button>
    <button onclick="plansNew()" style="flex:1;padding:10px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:13px;font-weight:600">+ New</button>
  </div>`;

  if(!data.plans.length){
    html+=`<div style="text-align:center;padding:60px 20px;color:var(--muted)"><div style="font-size:40px;margin-bottom:12px">📋</div><div style="font-size:16px;font-weight:600;margin-bottom:6px">No plans yet</div><div style="font-size:14px">Create a plan or import one via JSON</div></div>`;
  } else {
    html+=`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${data.plans.map(p=>`<button onclick="plansSetActive('${p.id}')" style="padding:6px 14px;border-radius:20px;border:none;background:${p.id===data.activePlanId?'var(--accent)':'var(--card-2)'};color:${p.id===data.activePlanId?'#fff':'var(--text)'};font-size:13px;font-weight:600">${p.name}</button>`).join('')}</div>`;

    if(active){
      if(active.type==='html'){
        // HTML plan — show open button and a preview description
        html+=`<div style="background:var(--card);border-radius:16px;padding:20px;margin-bottom:12px;text-align:center">
          <div style="font-size:36px;margin-bottom:10px">📄</div>
          <div style="font-size:16px;font-weight:700;margin-bottom:6px;color:var(--text)">${active.name}</div>
          <div style="font-size:13px;color:var(--muted);margin-bottom:16px">HTML plan · tap to open full screen</div>
          <button onclick="plansOpenHTML('${active.id}')" style="width:100%;padding:13px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:15px;font-weight:700">Open</button>
        </div>`;
      } else if(!active.days && Array.isArray(active.exercises)){
        // Legacy "daily routine" plan — a flat exercise list, no 7-day grid. Render the list
        // so the plan's real content shows instead of an empty week of rest days.
        html+=`<div style="background:var(--card);border-radius:16px;padding:16px;margin-bottom:12px">`;
        html+=`<div style="font-size:16px;font-weight:700;margin-bottom:${active.description?6:12}px;color:var(--text)">${active.name}</div>`;
        if(active.description) html+=`<div style="font-size:13px;color:var(--muted);margin-bottom:12px">${active.description}</div>`;
        active.exercises.forEach(e=>{
          const detail=e.detail||(e.sets&&e.reps?e.sets+'×'+e.reps:'');
          html+=`<div style="border-bottom:1px solid var(--border);padding:10px 0">
            <div style="font-weight:600;color:var(--text);font-size:14px">${e.name||''}</div>
            ${detail?`<div style="font-size:12px;color:var(--muted);margin-top:2px">${detail}</div>`:''}
          </div>`;
        });
        html+=`</div>`;
      } else {
        // Workout plan — existing 7-day grid
        const dayNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
        html+=`<div style="background:var(--card);border-radius:16px;padding:16px;margin-bottom:12px">`;
        html+=`<div style="font-size:16px;font-weight:700;margin-bottom:12px;color:var(--text)">${active.name}</div>`;
        if(active.description) html+=`<div style="font-size:13px;color:var(--muted);margin-bottom:12px">${active.description}</div>`;
        for(let d=0;d<7;d++){
          const day=active.days&&active.days[String(d)];
          const dayLabel=day?.name||dayNames[d];
          const exs=day?.exercises||[];
          const isRest=!exs.length;
          html+=`<div style="border-bottom:1px solid var(--border);padding:10px 0">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:${isRest?0:6}px">
              <div style="width:32px;height:32px;border-radius:8px;background:${isRest?'var(--card-2)':'rgba(var(--accent-rgb),.12)'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${isRest?'var(--muted)':'var(--accent)'}">${dayNames[d]}</div>
              <div style="font-weight:600;color:${isRest?'var(--muted)':'var(--text)'};font-size:14px">${dayLabel}</div>
            </div>
            ${exs.map(e=>`<div style="padding:4px 0 4px 40px;font-size:13px;color:var(--text)">${e.name}${e.sets&&e.reps?' — '+e.sets+'×'+e.reps:''}</div>`).join('')}
          </div>`;
        }
        html+=`</div>`;
      }
      html+=`<button onclick="plansDelete('${active.id}')" style="width:100%;padding:10px;border-radius:12px;border:1px solid var(--danger);background:transparent;color:var(--danger);font-size:14px;font-weight:600">Delete this plan</button>`;
    }
  }

  wrap.innerHTML=html;
}

function plansSetActive(id){
  const data=loadPlans();
  data.activePlanId=id;
  savePlans(data);
  renderPlans();
}

function plansDelete(id){
  if(!confirm('Delete this plan?')) return;
  const data=loadPlans();
  data.plans=data.plans.filter(p=>p.id!==id);
  if(data.activePlanId===id) data.activePlanId=data.plans[0]?.id||null;
  savePlans(data);
  renderPlans();
}

function plansNew(){
  const name=prompt('Plan name?');
  if(!name) return;
  const data=loadPlans();
  const id='plan_'+Date.now();
  data.plans.push({id,name,description:'',days:{'0':{name:'Day 1',exercises:[]},'1':{name:'Day 2',exercises:[]},'2':{name:'Day 3',exercises:[]},'3':{name:'Day 4',exercises:[]},'4':{name:'Day 5',exercises:[]},'5':{name:'Day 6',exercises:[]},'6':{name:'Rest',exercises:[]}}});
  if(!data.activePlanId) data.activePlanId=id;
  savePlans(data);
  renderPlans();
}

function plansImport(){
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='.json';
  inp.onchange=e=>{
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const plan=JSON.parse(ev.target.result);
        if(!plan.name||!plan.days) throw new Error('Invalid plan format');
        const data=loadPlans();
        if(!plan.id) plan.id='plan_'+Date.now();
        data.plans=data.plans.filter(p=>p.id!==plan.id);
        data.plans.push(plan);
        if(!data.activePlanId) data.activePlanId=plan.id;
        savePlans(data);
        renderPlans();
      }catch(err){ alert('Import failed: '+err.message); }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function plansImportHTML(){
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='.html,.htm';
  inp.onchange=e=>{
    const file=e.target.files[0]; if(!file) return;
    const name=prompt('Name this plan?', file.name.replace(/\.html?$/i,'').replace(/[-_]/g,' '))||file.name;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const content=ev.target.result;
        const data=loadPlans();
        const id='plan_'+Date.now();
        data.plans.push({id, name, type:'html', content});
        if(!data.activePlanId) data.activePlanId=id;
        savePlans(data);
        renderPlans();
      }catch(err){ alert('Import failed: '+err.message); }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function plansOpenHTML(id){
  const data=loadPlans();
  const plan=data.plans.find(p=>p.id===id);
  if(!plan||plan.type!=='html') return;
  const overlay=document.getElementById('plan-html-overlay');
  const frame=document.getElementById('plan-html-frame');
  const title=document.getElementById('plan-html-title');
  if(!overlay||!frame) return;
  if(title) title.textContent=plan.name;
  frame.srcdoc=plan.content;
  overlay.style.display='flex';
}

function plansCloseHTML(){
  const overlay=document.getElementById('plan-html-overlay');
  const frame=document.getElementById('plan-html-frame');
  if(overlay) overlay.style.display='none';
  if(frame) frame.srcdoc='';
}

function plansExport(){
  const data=loadPlans();
  const active=data.plans.find(p=>p.id===data.activePlanId)||data.plans[0];
  if(!active){ alert('No plan to export'); return; }
  if(active.type==='html'){
    const blob=new Blob([active.content],{type:'text/html'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=active.name.replace(/\s+/g,'_')+'.html';
    a.click();
  } else {
    const blob=new Blob([JSON.stringify(active,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=active.name.replace(/\s+/g,'_')+'.json';
    a.click();
  }
}

// Keep bottom-sheet modals reachable while the on-screen keyboard is up. The keyboard
// shrinks only the VISUAL viewport — position:fixed overlays still span the full layout
// viewport — so the bottom-aligned modal box (and its sticky Cancel/Save row) ends up
// behind the keyboard. Track the obscured height and expose it as --kb-inset;
// .modal-overlay pads its bottom by it (see nutrition-modals.css).
function syncKeyboardInset(){
  const vv=window.visualViewport;
  const inset=vv?Math.max(0, window.innerHeight - vv.height - vv.offsetTop):0;
  document.documentElement.style.setProperty('--kb-inset', Math.round(inset)+'px');
}
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', syncKeyboardInset);
  window.visualViewport.addEventListener('scroll', syncKeyboardInset);
  syncKeyboardInset();
}

// Pin as early as possible (deferred script runs before first paint) and on every
// viewport change, so the dvh mis-measurement is corrected without waiting for a rotation.
pinAppHeight();
requestAnimationFrame(function(){ pinAppHeight(); nudgeLayout(); });
window.addEventListener('resize', pinAppHeight);
window.addEventListener('orientationchange', function(){ setTimeout(pinAppHeight,150); });
if(window.visualViewport){ window.visualViewport.addEventListener('resize', pinAppHeight); }
window.addEventListener('load', function(){ nudgeLayout(); setTimeout(nudgeLayout,300); setTimeout(nudgeLayout,800); });
document.addEventListener('visibilitychange', function(){ if(!document.hidden) setTimeout(nudgeLayout,80); });
window.addEventListener('pageshow', function(){ setTimeout(nudgeLayout,80); if(typeof applyLogoDayColour==='function') applyLogoDayColour(); });
