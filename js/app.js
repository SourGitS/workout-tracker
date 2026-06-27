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
function syncProfileToFirebase(){
  if(!firebaseReady||!auth||!auth.currentUser||!db) return;
  db.ref('users/'+auth.currentUser.uid+'/profile').set(profileData);
}
function syncBudDefaultsToFirebase(){
  if(!firebaseReady||!auth||!auth.currentUser||!db) return;
  db.ref('users/'+auth.currentUser.uid+'/budgetDefaults').set(budDefaults);
}
function syncBudgetDataToFirebase(){
  if(!firebaseReady||!auth||!auth.currentUser||!db) return;
  db.ref('users/'+auth.currentUser.uid+'/budgetData').set(budgetData);
}
function syncSettingsCollapsedToFirebase(){
  if(!firebaseReady||!auth||!auth.currentUser||!db) return;
  db.ref('users/'+auth.currentUser.uid+'/settingsCollapsed').set(settingsCollapsed);
}
// ── Generic blob sync (Realtime Database) for simple localStorage keys ──
// Stores the raw localStorage string under users/<uid>/<path>. Used for data added
// after the original sync was built (budget categories, credit card, weight log).
function syncBlobPush(path, lsKey){
  if(!firebaseReady||!auth||!auth.currentUser||!db) return;
  setSyncStatus('Syncing…');
  db.ref('users/'+auth.currentUser.uid+'/'+path).set(localStorage.getItem(lsKey)||'')
    .then(()=>setSyncStatus('Synced ✓')).catch(()=>setSyncStatus('Sync failed'));
}
function syncBlobListen(uid, path, lsKey, onUpdate){
  const ref=db.ref('users/'+uid+'/'+path);
  ref.once('value').then(snap=>{
    const local=localStorage.getItem(lsKey);
    if(!snap.exists() && local!=null && local!=='') ref.set(local); // seed cloud from this device
  });
  ref.on('value', snap=>{
    const v=snap.val();
    if(v==null || v==='') return;
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

if(firebaseReady){
  try{
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db   = firebase.database();
    auth.getRedirectResult().catch(()=>{});
    auth.onAuthStateChanged(user=>{
  let piRef, savRef, habitsRef, budDataRef, incCatRef, fixCatRef, varCatRef, ccRef, weightLogRef;
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
      if(S.view==='history') renderHistory();
      if(S.view==='progress') renderProgress();
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
      localStorage.setItem('wt_weight', JSON.stringify(S.weights));
      if(S.view==='progress') renderWeightSection();
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
      const local = JSON.parse(localStorage.getItem('daily_habits')||'null');
      if(!snap.exists() && local) habitsRef.set(local);
    });
    habitsRef.on('value', snap=>{
      if(!snap.val()) return;
      localStorage.setItem('daily_habits', JSON.stringify(snap.val()));
      if(typeof renderHome==='function') renderHome();
    });

    // Sync profile
    db.ref('users/'+user.uid+'/profile').once('value').then(snap=>{
      if(snap.exists()){
        profileData=snap.val()||{};
        localStorage.setItem('daily_profile',JSON.stringify(profileData));
        renderAccountSection();
        renderSettingsProfile();
        renderHome();
      } else if(Object.keys(profileData).length>0){
        db.ref('users/'+user.uid+'/profile').set(profileData);
      }
    });

    // Sync budget defaults
    db.ref('users/'+user.uid+'/budgetDefaults').once('value').then(snap=>{
      if(snap.exists()){
        budDefaults=snap.val()||{};
        localStorage.setItem('daily_budget_defaults',JSON.stringify(budDefaults));
        if(S.view==='budget') renderBudgetTab();
      } else if(Object.keys(budDefaults).length>0){
        db.ref('users/'+user.uid+'/budgetDefaults').set(budDefaults);
      }
    });

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
        const scrubbed=scrubSavingsTarget(data); // strip the removed savings target from incoming cloud data
        budgetData=data;
        localStorage.setItem('daily_budget',JSON.stringify(budgetData));
        if(scrubbed) budDataRef.set(data); // write the cleaned copy back so it doesn't keep coming back

        // Don't re-render over an input the user is actively editing
        const active=document.activeElement;
        const editing=active&&(active.tagName==='INPUT'||active.tagName==='TEXTAREA');
        if(S.view==='budget'&&!editing) renderBudgetTab();
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
    db.ref('users/'+user.uid+'/settingsCollapsed').once('value').then(snap=>{
      if(snap.exists()){
        settingsCollapsed=snap.val()||{};
        localStorage.setItem('daily_settings_collapsed',JSON.stringify(settingsCollapsed));
        if(S.view==='settings') applySettingsCollapsed();
      } else if(Object.keys(settingsCollapsed).length>0){
        db.ref('users/'+user.uid+'/settingsCollapsed').set(settingsCollapsed);
      }
    });

    // Sync weight goal
    db.ref('users/'+user.uid+'/weightGoal').once('value').then(snap=>{
      if(snap.exists()){
        weightGoal=snap.val()||{};
        localStorage.setItem('daily_weight_goal',JSON.stringify(weightGoal));
        if(S.view==='stats') renderWeightGoal();
      } else if(weightGoal.target){
        db.ref('users/'+user.uid+'/weightGoal').set(weightGoal);
      }
    });

    // Sync subscriptions
    db.ref('users/'+user.uid+'/subscriptions').once('value').then(snap=>{
      if(snap.exists()){
        const val=snap.val();
        subscriptionsData=Array.isArray(val)?val:Object.values(val||{});
        localStorage.setItem('daily_subscriptions',JSON.stringify(subscriptionsData));
        applySubscriptionsToBudget();
        if(S.view==='settings') renderSubscriptionsSection();
      } else if(subscriptionsData.length>0){
        db.ref('users/'+user.uid+'/subscriptions').set(subscriptionsData);
      }
    });

    // ── Sync data added after the original sync was built ──
    const budEditing=()=>{ const a=document.activeElement; return a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'); };
    incCatRef = syncBlobListen(user.uid,'budgetIncCats','daily_budget_inc_cats',()=>{ if(S.view==='budget'&&!budEditing()) renderBudgetTab(); });
    fixCatRef = syncBlobListen(user.uid,'budgetFixCats','daily_budget_fix_cats',()=>{ if(S.view==='budget'&&!budEditing()) renderBudgetTab(); });
    varCatRef = syncBlobListen(user.uid,'budgetVarCats','daily_budget_var_cats',()=>{ if(S.view==='budget'&&!budEditing()) renderBudgetTab(); });
    ccRef     = syncBlobListen(user.uid,'creditCard','daily_cc',()=>{ if(S.view==='home'&&typeof renderHome==='function') renderHome(); });
    weightLogRef = syncBlobListen(user.uid,'weightLog','daily_weight_log',()=>{ wtLog=loadWeightLog(); if(S.view==='stats'&&typeof renderWeightStatsTab==='function') renderWeightStatsTab(); });
    // ── Cross-device sync for everything else that was previously local-only ──
    // These keys are all unset until the user changes them, so an untouched device can't
    // seed empty data over a device that has real data (last-writer-wins is safe here).
    syncBlobListen(user.uid,'homeOrder','daily_home_order',()=>{ if(S.view==='home'&&typeof renderHome==='function') renderHome(); });
    syncBlobListen(user.uid,'habitsLog','daily_habits_log',()=>{ try{ habitsLog=loadHabitsLog(); }catch(e){} if(S.view==='home'&&typeof renderHome==='function') renderHome(); if(typeof refreshTodayHabits==='function') refreshTodayHabits(); });
    syncBlobListen(user.uid,'dynamicColours','daily_dynamic_colours',()=>{ if(typeof applyDayColour==='function') applyDayColour(); });
    syncBlobListen(user.uid,'accentColor','daily_accent_color',()=>{ if(typeof applyAccent==='function'&&typeof getAccent==='function') applyAccent(getAccent()); });
    syncBlobListen(user.uid,'appTheme','wt_theme',()=>{ S.theme=localStorage.getItem('wt_theme')||S.theme; if(typeof applyTheme==='function') applyTheme(); });
    syncBlobListen(user.uid,'swaps','wt_swaps',()=>{ try{ S.swaps=JSON.parse(localStorage.getItem('wt_swaps')||'{}')||{}; }catch(e){} if(S.view==='log'&&typeof renderLog==='function') renderLog(); });
    syncBlobListen(user.uid,'dayCustom','wt_day_custom',()=>{ try{ dayCustom=JSON.parse(localStorage.getItem('wt_day_custom')||'{}')||{}; }catch(e){} if(S.view==='log'&&typeof renderLog==='function') renderLog(); if(S.view==='home'&&typeof renderHome==='function') renderHome(); });
    syncBlobListen(user.uid,'exerciseLib','wt_exercise_lib',()=>{ if(typeof renderExerciseLibList==='function') renderExerciseLibList(); });
    syncBlobListen(user.uid,'exerciseUnilateral','wt_exercise_unilateral',()=>{ if(typeof renderExerciseLibList==='function') renderExerciseLibList(); });
    syncBlobListen(user.uid,'wtPlans','wt_plans',()=>{ const v=document.getElementById('view-plans'); if(v&&v.style.display!=='none'&&typeof renderPlansView==='function') renderPlansView(); });
    syncBlobListen(user.uid,'wtNotes','wt_notes',()=>{ const v=document.getElementById('view-notes'); if(v&&v.style.display!=='none'&&typeof renderNotesTab==='function') renderNotesTab(); if(typeof renderHomeNotesBubble==='function') renderHomeNotesBubble(); });
    // ── Kitchen sync ──
    syncBlobListen(user.uid,'kitRecipes','kitchen_recipes',()=>{ try{ kitRecipes=kitLoadRecipes(); }catch(e){} if(S.view==='kitchen'&&typeof kitRender==='function') kitRender(); });
    syncBlobListen(user.uid,'kitShopSelected','kitchen_shopping_selected',()=>{ try{ kitShopSelected=kitShopLoadSelected(); kitShopView=kitShopSelected.length?'list':'selector'; }catch(e){} if(S.view==='kitchen'&&typeof kitShopRender==='function') kitShopRender(); });
    syncBlobListen(user.uid,'kitShopChecked','kitchen_shopping_checked',()=>{ try{ kitShopChecked=kitShopLoadChecked(); }catch(e){} if(S.view==='kitchen'&&typeof kitShopRenderList==='function') kitShopRenderList(); });
    syncBlobListen(user.uid,'kitShopManual','kitchen_shopping_manual',()=>{ try{ kitShopManual=kitShopLoadManual(); }catch(e){} if(S.view==='kitchen'&&typeof kitShopRenderList==='function') kitShopRenderList(); });
    syncBlobListen(user.uid,'kitPantry','kitchen_pantry',()=>{ try{ kitPantryData=kitPantryLoad(); }catch(e){} if(S.view==='kitchen'&&typeof kitPantryRender==='function') kitPantryRender(); });
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
    if(weightLogRef){ weightLogRef.off(); weightLogRef=null; }
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

// ── Program ─────────────────────────────────────────────────────
const TYPES = [
  {
    id:'cb', name:'Chest & Back', pillClass:'cb', barColor:'#ef4444',
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
    id:'sa', name:'Shoulders & Arms', pillClass:'sa', barColor:'#3b82f6',
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
    id:'lg', name:'Legs', pillClass:'lg', barColor:'#10b981',
    exercises:[
      {name:'Standing calf raise', sets:4, priority:'calves'},
      {name:'Smith machine squat', sets:3, warmupSets:1},
      {name:'Seated leg curl', sets:3},
      {name:'Leg extension', sets:3},
      {name:'Abs', sets:2, priority:'abs'},
    ]
  }
];

const DAYS = [0,1,2,0,1,2].map((t,i)=>({dayNum:i+1,typeIdx:t}));
const ALL_EX = [...new Set(TYPES.flatMap(t=>t.exercises.map(e=>e.name)))];

// ── Categorised exercise database (reference list shown in the Exercise Library) ──
// unilateral:true → tracks left/right separately by default (used by later L/R features).
const EXERCISE_DB = {
  Chest: [
    {name:'Barbell Bench Press'},{name:'Incline Barbell Press'},{name:'Decline Barbell Press'},
    {name:'Dumbbell Bench Press'},{name:'Incline Dumbbell Press'},{name:'Cable Chest Fly'},
    {name:'Dumbbell Fly'},{name:'Pec Deck'},{name:'Push Up'},{name:'Chest Dips'}
  ],
  Back: [
    {name:'Deadlift'},{name:'Barbell Row'},{name:'T-Bar Row'},{name:'Lat Pulldown'},
    {name:'Pull Up'},{name:'Chin Up'},{name:'Seated Cable Row'},
    {name:'Single-Arm Dumbbell Row',unilateral:true},{name:'Straight-Arm Pulldown'},{name:'Face Pull'}
  ],
  Shoulders: [
    {name:'Overhead Barbell Press'},{name:'Overhead Dumbbell Press'},{name:'Arnold Press'},
    {name:'Lateral Raise'},{name:'Front Raise'},{name:'Rear Delt Fly'},
    {name:'Upright Row'},{name:'Shrugs'},{name:'Cable Lateral Raise',unilateral:true}
  ],
  Biceps: [
    {name:'Barbell Curl'},{name:'Dumbbell Curl'},{name:'Hammer Curl'},
    {name:'Incline Dumbbell Curl',unilateral:true},{name:'Concentration Curl',unilateral:true},
    {name:'Cable Curl'},{name:'Preacher Curl'},{name:'EZ Bar Curl'}
  ],
  Triceps: [
    {name:'Skull Crusher'},{name:'Tricep Pushdown'},{name:'Overhead Tricep Extension'},
    {name:'Close-Grip Bench Press'},{name:'Tricep Dips'},{name:'Tricep Kickback',unilateral:true},
    {name:'EZ Bar Skull Crusher'}
  ],
  Legs: [
    {name:'Barbell Squat'},{name:'Leg Press'},{name:'Romanian Deadlift'},
    {name:'Leg Curl'},{name:'Leg Extension'},{name:'Lunges',unilateral:true},
    {name:'Bulgarian Split Squat',unilateral:true},{name:'Hack Squat'},
    {name:'Calf Raise'},{name:'Single-Leg Calf Raise',unilateral:true},
    {name:'Hip Thrust'},{name:'Goblet Squat'}
  ],
  Core: [
    {name:'Plank'},{name:'Crunch'},{name:'Russian Twist'},{name:'Hanging Leg Raise'},
    {name:'Cable Crunch'},{name:'Ab Rollout'},{name:'Bicycle Crunch'},
    {name:'Decline Crunch'},{name:'Side Plank',unilateral:true}
  ]
};
const EXERCISE_DB_CATS = Object.keys(EXERCISE_DB);
// DB names flagged unilateral → the default L/R state.
const _EX_DB_UNI = (function(){ const s={}; EXERCISE_DB_CATS.forEach(c=>EXERCISE_DB[c].forEach(e=>{ if(e.unilateral) s[e.name]=true; })); return s; })();
function exDbUnilateralDefault(name){ return !!_EX_DB_UNI[name]; }
// Program exercise names (lowercased) → "in program" indicator.
const _PROG_NAMES_LC = new Set(ALL_EX.map(n=>String(n).toLowerCase()));
function exInProgram(name){ return _PROG_NAMES_LC.has(String(name||'').toLowerCase()); }
// Unilateral (L/R) state per exercise. localStorage stores only OVERRIDES of the DB default,
// so a DB-unilateral exercise reads true even with nothing stored (verification #6).
function isUnilateral(name){
  try{ const d=JSON.parse(localStorage.getItem('wt_exercise_unilateral')||'{}'); return (name in d)?!!d[name]:exDbUnilateralDefault(name); }
  catch(e){ return exDbUnilateralDefault(name); }
}
function setUnilateral(name, val){
  try{
    const d=JSON.parse(localStorage.getItem('wt_exercise_unilateral')||'{}');
    if(!!val===exDbUnilateralDefault(name)) delete d[name]; else d[name]=!!val; // store only when it differs from the default
    localStorage.setItem('wt_exercise_unilateral', JSON.stringify(d));
    try{ if(typeof syncBlobPush==='function') syncBlobPush('exerciseUnilateral','wt_exercise_unilateral'); }catch(e){}
  }catch(e){}
}

// ── Storage helpers ──────────────────────────────────────────────
function load(){
  try{ return JSON.parse(localStorage.getItem('wt_sessions')||'[]'); }
  catch{ return []; }
}
function loadWeights(){
  try{ return JSON.parse(localStorage.getItem('wt_weight')||'[]'); }
  catch{ return []; }
}
function loadSwaps(){
  try{ return JSON.parse(localStorage.getItem('wt_swaps')||'{}'); }
  catch{ return {}; }
}
function loadTheme(){
  // Default dark (the momentum look). Users opt into light via Settings.
  return localStorage.getItem('wt_theme')||'dark';
}
function loadPersonalInfo(){
  try{ return JSON.parse(localStorage.getItem('wt_personalinfo')||'{}'); }
  catch{ return {}; }
}
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
function loadCalorieHistory(){
  try{ return JSON.parse(localStorage.getItem('daily_cal_history')||'{}'); }
  catch{ return {}; }
}
let calorieHistory = loadCalorieHistory();
function recordCalorieHistory(){
  if(!S.dailyLog||!S.dailyLog.date) return;
  const total=S.dailyLog.entries.reduce((a,e)=>a+(e.kcal||0),0);
  calorieHistory[S.dailyLog.date]=total;
  localStorage.setItem('daily_cal_history', JSON.stringify(calorieHistory));
}
function loadSavingsLog(){
  try{ return JSON.parse(localStorage.getItem('daily_savings_log')||'[]'); }
  catch{ return []; }
}
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
function loadProfileData(){
  try{ return JSON.parse(localStorage.getItem('daily_profile')||'{}'); }
  catch{ return {}; }
}

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
};

let exCollapsed = new Set(); // session-only exercise card collapse state

// ── Persist ──────────────────────────────────────────────────────
function persist(){
  localStorage.setItem('wt_sessions', JSON.stringify(S.sessions));
  if(dbRef){
    const data={};
    S.sessions.forEach(s=>{ data[s.id]=s; });
    dbRef.set(data).catch(e=>console.error('Firebase sync error:',e));
  }
}
function persistWeights(){
  localStorage.setItem('wt_weight', JSON.stringify(S.weights));
  if(weightDbRef){
    const data={};
    S.weights.forEach(w=>{ data[w.date.replace(/-/g,'')]=w; });
    weightDbRef.set(data).catch(e=>console.error('Firebase weight sync error:',e));
  }
}
function saveSwaps(){ localStorage.setItem('wt_swaps', JSON.stringify(S.swaps)); try{ if(typeof syncBlobPush==='function') syncBlobPush('swaps','wt_swaps'); }catch(e){} }
function persistDailyLog(){ localStorage.setItem('wt_calories', JSON.stringify(S.dailyLog)); recordCalorieHistory(); }

// ── Helpers ──────────────────────────────────────────────────────
// Per-day-type exercise customisation (permanent, overlay model): `added` extra exercises
// and `hidden` removed names, keyed by TYPES id (cb/sa/lg). Cached in memory; saved on change.
let dayCustom = (function(){ try{ const o=JSON.parse(localStorage.getItem('wt_day_custom')); if(o&&typeof o==='object') return o; }catch(e){} return {}; })();
function saveDayCustom(){ localStorage.setItem('wt_day_custom', JSON.stringify(dayCustom)); try{ if(typeof syncBlobPush==='function') syncBlobPush('dayCustom','wt_day_custom'); }catch(e){} }
function dayCustomFor(typeId){ return dayCustom[typeId] || (dayCustom[typeId]={added:[],hidden:[]}); }
function effectiveExercises(base){
  const c=dayCustom[base.id]||{};
  const hidden=new Set(c.hidden||[]);
  const added=(c.added||[]).map(a=>({name:a.name, sets:a.sets||1, muscle:a.muscle, custom:true}));
  let list=[...base.exercises, ...added].filter(ex=>!hidden.has(ex.name));
  if(c.order && c.order.length){
    // Apply the user's drag-reordered sequence; anything not in `order` (e.g. just added) trails.
    const pos=n=>{ const i=c.order.indexOf(n); return i<0?1e6:i; };
    list=list.map((ex,i)=>[ex,i]).sort((a,b)=>(pos(a[0].name)-pos(b[0].name))||(a[1]-b[1])).map(p=>p[0]);
  }
  return list;
}
// Returns a shallow clone of the day's program type with its EFFECTIVE (customised) exercise
// list, so every consumer (render/save/Home counts) sees the same add/remove edits.
function type(i){ const base=TYPES[DAYS[i].typeIdx]; return {...base, exercises:effectiveExercises(base)}; }
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
  localStorage.setItem('wt_theme', t);
  try{ if(typeof syncBlobPush==='function') syncBlobPush('appTheme','wt_theme'); }catch(e){}
  applyTheme();
  if(S.view==='progress') renderProgress();
}

// ── Accent colour ─────────────────────────────────────────────────
const ACCENT_OPTIONS = [
  {name:'Orange',hex:'#FF6B35'},
  {name:'Lime',hex:'#C8F135'},
  {name:'Blue',hex:'#4F8EF7'},
  {name:'Purple',hex:'#A78BFA'},
  {name:'Pink',hex:'#F472B6'},
];
function hexToRgb(hex){
  const h=hex.replace('#','');
  return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)].join(',');
}
function applyAccent(hex){
  document.documentElement.style.setProperty('--accent', hex);
  document.documentElement.style.setProperty('--accent-rgb', hexToRgb(hex));
}
function getAccent(){
  return localStorage.getItem('daily_accent_color') || '#FF6B35';
}
function setAccent(hex){
  localStorage.setItem('daily_accent_color', hex);
  try{ if(typeof syncBlobPush==='function') syncBlobPush('accentColor','daily_accent_color'); }catch(e){}
  applyAccent(hex);
  renderAccentSwatches();
}
function renderAccentSwatches(){
  const wrap=document.getElementById('accent-swatches');
  if(!wrap) return;
  const cur=getAccent();
  wrap.innerHTML=ACCENT_OPTIONS.map(o=>{
    const active=o.hex.toLowerCase()===cur.toLowerCase();
    return `<button onclick="setAccent('${o.hex}')" aria-label="${o.name}" title="${o.name}"
      style="width:32px;height:32px;border-radius:50%;background:${o.hex};border:none;cursor:pointer;flex-shrink:0;-webkit-tap-highlight-color:transparent;${active?'outline:3px solid #fff;outline-offset:2px;':''}"></button>`;
  }).join('');
}

// ── Dynamic day colours ───────────────────────────────────────────
// When enabled, the accent (and everything that uses var(--accent)) shifts to match
// today's scheduled muscle group. When disabled, the app keeps the user's chosen accent
// (orange by default) — so this never regresses the manual accent picker above.
const DAY_COLOURS = {
  'chest-back':      { accent: '#3B82F6', rgb: '59,130,246',  grad: 'linear-gradient(150deg,#3B82F6,#2563EB 55%,#1D4ED8)' },
  'shoulders-arms':  { accent: '#8B5CF6', rgb: '139,92,246',  grad: 'linear-gradient(150deg,#8B5CF6,#7C3AED 55%,#6D28D9)' },
  'legs':            { accent: '#EF4444', rgb: '239,68,68',    grad: 'linear-gradient(150deg,#EF4444,#DC2626 55%,#B91C1C)' },
  'rest':            { accent: '#FF6B35', rgb: '255,107,53',   grad: 'linear-gradient(150deg,#FF6B35,#e8541f 55%,#c2410c)' }
};
// Arnold Split 6-day cycle → muscle group. Reuses the app's existing day index
// (S.dayIdx, set by suggestDay()/initDay()) and the TYPES order: 0 Chest&Back, 1
// Shoulders&Arms, 2 Legs. Anything outside that falls back to 'rest' (orange).
function getTodayMuscleGroup(){
  const day = DAYS[S.dayIdx];
  if(!day) return 'rest';
  return (['chest-back','shoulders-arms','legs'])[day.typeIdx] || 'rest';
}
function applyDayColour(){
  if(typeof applyLogoDayColour==='function') applyLogoDayColour(); // keep the wordmark in sync
  const enabled = localStorage.getItem('daily_dynamic_colours') === 'true';
  const hero = document.querySelector('.hero-workout-card');
  const rtBar = document.getElementById('rt-bar');
  if(!enabled){
    // Restore the user's chosen accent (default orange) and let the hero / timer bar
    // fall back to their CSS defaults.
    applyAccent(getAccent());
    if(hero){ hero.style.background=''; hero.style.boxShadow=''; }
    if(rtBar) rtBar.style.boxShadow='';
    return;
  }
  const colours = DAY_COLOURS[getTodayMuscleGroup()] || DAY_COLOURS['rest'];
  const root = document.documentElement;
  root.style.setProperty('--accent', colours.accent);
  root.style.setProperty('--accent-rgb', colours.rgb);
  // Hero background + shadow now come from CSS via var(--accent-rgb) (set just above), which
  // keeps the vignette + inner glow; clear any stale inline override so CSS governs.
  if(hero){ hero.style.background=''; hero.style.boxShadow=''; }
  if(rtBar) rtBar.style.boxShadow = '0 8px 24px rgba(' + colours.rgb + ',.30)';
}
function onDynamicColoursToggle(enabled){
  localStorage.setItem('daily_dynamic_colours', enabled ? 'true' : 'false');
  try{ if(typeof syncBlobPush==='function') syncBlobPush('dynamicColours','daily_dynamic_colours'); }catch(e){}
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
function updateLapFab(){
  const f=document.getElementById('lap-fab'); if(!f) return;
  f.style.display=(rtRunning && S.view==='log') ? 'flex' : 'none';
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
  return last.dayNum % 6;
}

// ── Init day ─────────────────────────────────────────────────────
function initDay(idx){
  S.dayIdx = idx;
  S.checked = new Set();
  S.sessionNote = '';
  S.sessionStart = null;
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
let statsSubTab = 'history';
function setView(v, direction){
  const prev=S.view;
  // Default direction from tab order if not given by the swipe handler
  if(!direction){
    const a=NAV_ORDER.indexOf(prev), b=NAV_ORDER.indexOf(v);
    direction=(a>=0&&b>=0&&b<a)?'back':'forward';
  }
  S.view = v;
  document.querySelectorAll('#app-main > section').forEach(el=>el.classList.add('hidden'));
  const incoming=document.getElementById('view-'+v);
  incoming.classList.remove('hidden');
  // Directional slide on mobile only
  if(window.innerWidth<1024 && prev!==v && incoming){
    incoming.classList.remove('tab-slide-in-right','tab-slide-in-left');
    void incoming.offsetWidth; // force reflow so the animation restarts
    const cls=direction==='back'?'tab-slide-in-left':'tab-slide-in-right';
    incoming.classList.add(cls);
    incoming.addEventListener('animationend',function h(){ incoming.classList.remove(cls); incoming.removeEventListener('animationend',h); });
  }
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
  // Stats folds into Home on mobile, but is also reachable as a standalone view from the
  // desktop sidebar. Pull the shared #view-stats node back out before showing it here.
  if(v==='stats'){ unmountStatsToMain(); if(statsSubTab==='history') renderHistory(); else if(statsSubTab==='progress') renderProgress(); else if(statsSubTab==='budget') renderBudgetStats(); else renderWeightStatsTab(); }
  if(v==='budget') renderBudgetTab();
  if(v==='kitchen') kitRender();
  else if(typeof kitShopRenderAddBar==='function') kitShopRenderAddBar(false); // hide fixed shopping add-bar off-tab
  if(v==='settings') renderSettings();
  updateNavPill(v);
  updateStatsPill(v);
  if(typeof updateLapFab==='function') updateLapFab();
  if(v!=='home' && homeEditMode){ homeEditMode=false; const b=document.getElementById('home-edit-btn'); if(b){ b.textContent='Edit layout'; b.classList.remove('active'); } }
  updateNavBadges();
}
const NAV_ORDER=['home','budget','log','kitchen'];

// ── Swipe navigation ─────────────────────────────────────────────
// Switches between the five nav tabs on a deliberate horizontal flick. Gated so it
// never fires on a vertical scroll or a slow drag (which made it feel "clumsy"):
//   • far enough   — |dx| ≥ 45px
//   • horizontal   — |dy| < |dx| × 0.8 (rejects diagonal scrolls)
//   • a flick      — under 600ms (a slow deliberate drag isn't a tab swipe)
(function(){
  let x0=0,y0=0,t0=0;
  const main=document.getElementById('app-main');
  if(!main) return;
  main.addEventListener('touchstart',e=>{ x0=e.touches[0].clientX; y0=e.touches[0].clientY; t0=Date.now(); },{passive:true});
  main.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-x0;
    const dy=e.changedTouches[0].clientY-y0;
    const dt=Date.now()-t0;
    if(Math.abs(dx)<45) return;                 // not far enough
    if(Math.abs(dy)>Math.abs(dx)*0.8) return;   // too vertical (a scroll)
    if(dt>600) return;                          // too slow to be a flick
    const cur=NAV_ORDER.indexOf(S.view);
    if(cur===-1) return;                        // standalone views (e.g. Stats) aren't in the nav row
    if(dx<0&&cur<NAV_ORDER.length-1) setView(NAV_ORDER[cur+1],'forward');
    else if(dx>0&&cur>0) setView(NAV_ORDER[cur-1],'back');
  },{passive:true});
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
    if(S.view==='home' && main.scrollTop===0){ startY=e.touches[0].clientY; pulling=true; }
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
    // Dynamic day colours on → follow the workout's muscle-group accent (e.g. legs = red),
    // so the wordmark matches the rest of the dynamically-themed UI.
    c=(DAY_COLOURS[getTodayMuscleGroup()]||DAY_COLOURS['rest']).accent;
  } else {
    // Off → vibrant rainbow keyed to the weekday (Sun..Sat).
    c=['#8B5CF6','#EF4444','#F97316','#F59E0B','#22C55E','#3B82F6','#6366F1'][new Date().getDay()];
  }
  document.documentElement.style.setProperty('--day-color', c);
  // Belt-and-suspenders: also set the colour inline so the wordmark tints even if the
  // CSS custom-property chain ever fails to resolve on a given device.
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
  if(typeof setStatsTab==='function') setStatsTab(ctx==='budget' ? 'budget' : 'history');
}
function openProfile(){ setView('settings'); if(typeof openSettingsSection==='function') openSettingsSection('profile'); }

// ── Slide-out settings menu ───────────────────────────────────────
const MENU_SECTIONS=[
  {id:'profile',label:'Profile'},
  {id:'appearance',label:'Appearance'},
  {id:'health',label:'Health'},
  {id:'habits',label:'Habits'},
  {id:'reminders',label:'Reminders'},
  {id:'subscriptions',label:'Subscriptions'},
  {id:'account',label:'Account'},
  {id:'export',label:'Export'}
];
function buildSideMenu(){
  const list=document.getElementById('side-menu-list');
  if(!list) return;
  const chev='<svg class="smi-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  list.innerHTML =
    '<button class="side-menu-item" data-action="open-exercise-library"><span class="smi-label">Exercise Library</span>'+chev+'</button>'+
    '<button class="side-menu-item" data-action="open-plans"><span class="smi-label">Plans</span>'+chev+'</button>'+
    '<button class="side-menu-item" data-action="open-notes"><span class="smi-label">Notes</span>'+chev+'</button>'+
    '<div class="side-menu-divider"></div>'+
    '<button class="side-menu-item" onclick="openMenuSection(\'\')"><span class="smi-label">All settings</span>'+chev+'</button>'+
    '<div class="side-menu-divider"></div>'+
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
  const defaults=ALL_EX.map(name=>({
    id:'ex_def_'+name.toLowerCase().replace(/[^a-z0-9]+/g,'_'),
    name, muscle:libGuessMuscle(name), custom:false
  }));
  return [...defaults, ...customs];
}
function saveExerciseLib(lib){
  // Persist only the user's customs; defaults always regenerate from the program.
  localStorage.setItem('wt_exercise_lib', JSON.stringify(lib.filter(e=>e.custom)));
  try{ if(typeof syncBlobPush==='function') syncBlobPush('exerciseLib','wt_exercise_lib'); }catch(e){}
}
let _libMuscle='all';
function openExerciseLibrary(){
  const v=document.getElementById('view-exercise-library'); if(!v) return;
  v.style.display='block';
  const s=document.getElementById('lib-search'); if(s) s.value='';
  _libMuscle='all';
  document.querySelectorAll('[data-action="lib-filter-muscle"]').forEach(b=>b.classList.toggle('active',b.dataset.muscle==='all'));
  renderExerciseLibList();
  if(typeof closeMenu==='function') closeMenu();
}
function closeExerciseLibrary(){
  const v=document.getElementById('view-exercise-library'); if(v) v.style.display='none';
}
let _libCatCollapsed={};
const _LIB_FILTER_CATS={all:EXERCISE_DB_CATS,chest:['Chest'],back:['Back'],shoulders:['Shoulders'],arms:['Biceps','Triceps'],legs:['Legs'],core:['Core']};
function _libExRow(name,opts){
  const uni=isUnilateral(name);
  return '<div class="lib-row">'+
    '<div class="lib-row-main">'+
      '<span class="lib-row-name">'+_catEscHtml(name)+'</span>'+
      (exInProgram(name)?'<span class="lib-inprog-pill">In program</span>':'')+
    '</div>'+
    '<div class="lib-row-actions">'+
      '<button class="lib-lr-toggle'+(uni?' on':'')+'" data-action="lib-toggle-unilateral" data-name="'+_catEsc(name)+'" aria-pressed="'+(uni?'true':'false')+'" title="Track left & right separately">L|R</button>'+
      (opts&&opts.del?'<button class="lib-del-btn" data-action="lib-delete-exercise" data-id="'+opts.id+'" aria-label="Delete exercise">×</button>':'')+
    '</div>'+
  '</div>';
}
function renderExerciseLibList(){
  const el=document.getElementById('exercise-lib-list'); if(!el) return;
  const q=(document.getElementById('lib-search')?.value||'').toLowerCase().trim();
  const cats=_LIB_FILTER_CATS[_libMuscle]||EXERCISE_DB_CATS;
  const section=(key,label,items,rowOpts)=>{
    if(!items.length) return '';
    const collapsed=q?false:!!_libCatCollapsed[key]; // a search query forces every section open
    let h='<button class="lib-cat-head" data-action="lib-toggle-cat" data-cat="'+key+'">'+
      '<span class="lib-cat-name">'+label+'</span>'+
      '<span class="lib-cat-meta">'+items.length+'<span class="lib-cat-chev'+(collapsed?'':' open')+'">›</span></span>'+
    '</button>';
    if(!collapsed) h+=items.map(rowOpts).join('');
    return h;
  };
  let html='';
  cats.forEach(cat=>{
    const items=EXERCISE_DB[cat].filter(e=>!q||e.name.toLowerCase().includes(q));
    html+=section(cat,cat,items,e=>_libExRow(e.name));
  });
  const customs=loadExerciseLib().filter(e=>e.custom&&(_libMuscle==='all'||e.muscle===_libMuscle)&&(!q||e.name.toLowerCase().includes(q)));
  html+=section('__custom','Custom',customs,e=>_libExRow(e.name,{del:true,id:e.id}));
  el.innerHTML=html||'<div style="padding:32px 0;text-align:center;color:var(--muted)">No exercises found</div>';
}
// New-exercise modal — replaces window.prompt() (blocked in iOS standalone PWAs)
let _newExMuscle='other';
function openNewExercise(){
  _newExMuscle='other';
  const nm=document.getElementById('exlib-new-name'); if(nm) nm.value='';
  document.querySelectorAll('[data-action="exlib-pick-muscle"]').forEach(b=>b.classList.toggle('active',b.dataset.muscle==='other'));
  const m=document.getElementById('exlib-add-modal'); if(m) m.classList.remove('hidden');
  setTimeout(()=>{ if(nm) nm.focus(); }, 50);
}
function closeNewExercise(){ const m=document.getElementById('exlib-add-modal'); if(m) m.classList.add('hidden'); }
function confirmNewExercise(){
  const nm=document.getElementById('exlib-new-name');
  const name=(nm?nm.value:'').trim();
  if(!name){ closeNewExercise(); return; }
  const lib=loadExerciseLib();
  lib.push({id:'ex_custom_'+Date.now(), name, muscle:_newExMuscle, custom:true});
  saveExerciseLib(lib);
  closeNewExercise();
  renderExerciseLibList();
}
// One delegated listener for all Exercise Library actions (iOS-reliable taps)
document.addEventListener('click',function(e){
  if(e.target.closest('[data-action="open-exercise-library"]')){ openExerciseLibrary(); return; }
  if(e.target.closest('[data-action="close-exercise-library"]')){ closeExerciseLibrary(); return; }
  const f=e.target.closest('[data-action="lib-filter-muscle"]');
  if(f){ _libMuscle=f.dataset.muscle; document.querySelectorAll('[data-action="lib-filter-muscle"]').forEach(b=>b.classList.toggle('active',b===f)); renderExerciseLibList(); return; }
  const tc=e.target.closest('[data-action="lib-toggle-cat"]');
  if(tc){ const c=tc.dataset.cat; _libCatCollapsed[c]=!_libCatCollapsed[c]; renderExerciseLibList(); return; }
  const tu=e.target.closest('[data-action="lib-toggle-unilateral"]');
  if(tu){ const n=tu.dataset.name; setUnilateral(n,!isUnilateral(n)); renderExerciseLibList(); return; }
  const del=e.target.closest('[data-action="lib-delete-exercise"]');
  if(del){ saveExerciseLib(loadExerciseLib().filter(x=>x.id!==del.dataset.id)); renderExerciseLibList(); return; } // confirm() is a no-op in iOS PWAs
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
  const base=TYPES[DAYS[S.dayIdx].typeIdx];
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
  const base=TYPES[DAYS[S.dayIdx].typeIdx];
  const c=dayCustomFor(base.id);
  if((c.added||[]).some(a=>a.name===name)) c.added=c.added.filter(a=>a.name!==name); // drop an added one
  else c.hidden=[...new Set([...(c.hidden||[]), name])];                              // hide a built-in
  saveDayCustom();
  delete S.setData[name];
  recomputeChecked(); saveSetData(); renderLog();
}
function logAddExercise(name, muscle){
  if(!name) return;
  const base=TYPES[DAYS[S.dayIdx].typeIdx];
  const c=dayCustomFor(base.id);
  if((c.hidden||[]).includes(name)){ c.hidden=c.hidden.filter(h=>h!==name); }       // un-hide a removed built-in
  else if(!base.exercises.some(e=>e.name===name) && !(c.added||[]).some(a=>a.name===name)){
    c.added=[...(c.added||[]), {name, muscle:muscle||'other'}];                       // add new entry
  }
  saveDayCustom();
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
function setStatsTab(tab){
  statsSubTab = tab;
  const paneIds={history:'sub-history',progress:'sub-progress',budget:'sub-budget',weight:'sub-weight'};
  const btnIds={history:'st-hist-btn',progress:'st-prog-btn',budget:'st-bud-btn',weight:'st-wt-btn'};
  Object.keys(paneIds).forEach(t=>{
    const pane=document.getElementById(paneIds[t]); if(pane) pane.classList.toggle('hidden',t!==tab);
    const btn=document.getElementById(btnIds[t]); if(!btn) return;
    const a=t===tab;
    btn.style.background=a?'var(--card)':'transparent';
    btn.style.fontWeight=a?'700':'500';
    btn.style.color=a?'var(--text)':'var(--muted)';
    btn.style.boxShadow=a?'0 1px 3px rgba(0,0,0,0.1)':'none';
  });
  if(tab==='history') renderHistory();
  if(tab==='progress') renderProgress();
  if(tab==='budget') renderBudgetStats();
  if(tab==='weight') renderWeightStatsTab();
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
  const dc = DAY_COLOURS[getTodayMuscleGroup()] || DAY_COLOURS['rest'];
  const isToday = S.dayIdx === suggestDay();
  const heroEl = document.getElementById('log-day-hero');
  if(heroEl){
    heroEl.innerHTML =
      '<div class="log-day-hero-card" style="background:linear-gradient(150deg, rgba('+dc.rgb+',.9), rgba('+dc.rgb+',.55) 55%, rgba('+dc.rgb+',.35));box-shadow:0 16px 40px rgba('+dc.rgb+',.3)">'+
        '<div class="ldh-nav">'+
          '<button class="ldh-arrow" onclick="logDayStep(-1)" aria-label="Previous day">&#8249;</button>'+
          '<div class="ldh-center" onclick="logGoToday()">'+
            '<div class="ldh-name">'+t.name+'</div>'+
            '<div class="ldh-sub">Day '+(S.dayIdx+1)+' of '+DAYS.length+(isToday?'<span class="ldh-today">TODAY</span>':'')+'</div>'+
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
  }
  const tag = document.getElementById('header-tag');
  if(tag){ tag.textContent=`Day ${S.dayIdx+1} · ${t.name}`; tag.style.color=t.barColor; }

  document.getElementById('exercise-list').innerHTML = t.exercises.map(renderExCard).join('');

  // Edit-mode controls: button label + the add-exercise button visibility
  const eb=document.getElementById('log-edit-btn');
  if(eb){ eb.textContent=logEditMode?'Done':'Edit'; eb.classList.toggle('active',logEditMode); }
  const ab=document.getElementById('log-add-exercise-btn');
  if(ab) ab.style.display=logEditMode?'block':'none';

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

function selectDay(idx){ logEditMode=false; activeExIdx=-1; exCollapsed.clear(); initDay(idx); saveSetData(); rtResetAll(); renderLog(); rtUpdateSessionLabels(); }
// Day hero arrows — wrap around the 6-day split; centre taps back to today's suggested day.
function logDayStep(dir){ const n=DAYS.length; selectDay(((S.dayIdx+dir)%n+n)%n); }
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
  recomputeChecked(); saveSetData();
  const nowDone = S.checked.has(ei);
  renderLog();
  if(nowDone){ setTimeout(()=>{ exCollapsed.add(ei); renderLog(); }, 400); } // auto-collapse when complete
}

// ── In-progress persistence ───────────────────────────────────────
// S.setData is rebuilt fresh by initDay and was lost on refresh. Persist the current
// day's in-progress sets (incl. warmup/done) so a reload mid-workout restores them.
function saveSetData(){
  try{
    localStorage.setItem('wt_setdata', JSON.stringify({
      date:getLocalDate(), dayIdx:S.dayIdx, setData:S.setData,
      checked:[...S.checked], sessionStart:S.sessionStart, note:S.sessionNote
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
function openWeekReviewModal(){
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
    const fixed=bd.snapshot?parseFloat(bd.snapshot.fixed)||0:configFixedTotal();
    const variable=bd.snapshot?parseFloat(bd.snapshot.variable)||0:configVariableTotal();
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

  document.getElementById('wr-modal-body').innerHTML=
    '<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:8px">Workouts ('+workoutDays+'/6 days)</div>'+sessionHTML+'</div>'
    +'<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Budget</div>'+budHTML+'</div>'
    +calHTML
    +'<div style="margin-bottom:16px"><div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);margin-bottom:4px">Weight this week</div>'+weightHTML+'</div>'
    +habitsModalHTML;

  document.getElementById('wr-modal').classList.remove('hidden');
}
function closeWeekReviewModal(){
  document.getElementById('wr-modal').classList.add('hidden');
}

// ── Exercise swap ─────────────────────────────────────────────────
function openSwapModal(ei){
  S.swapTarget = ei;
  const ex = type(S.dayIdx).exercises[ei];
  const lbl=document.getElementById('swap-original-label'); if(lbl) lbl.textContent = `Replace "${dn(ex.name)}" — pick one of your exercises, or type a custom name.`;
  const inp=document.getElementById('swap-input'); if(inp) inp.value='';
  renderSwapList();
  document.getElementById('swap-modal').classList.remove('hidden');
}
// Build the swap picker list: your program exercises first, then customs, then the DB.
function _swapExerciseOptions(){
  const seen=new Set(); const out=[];
  const add=name=>{ if(!name) return; const k=String(name).toLowerCase(); if(seen.has(k)) return; seen.add(k); out.push({name,inProg:_PROG_NAMES_LC.has(k)}); };
  ALL_EX.forEach(add);
  try{ loadExerciseLib().filter(e=>e.custom).forEach(e=>add(e.name)); }catch(e){}
  try{ EXERCISE_DB_CATS.forEach(c=>EXERCISE_DB[c].forEach(e=>add(e.name))); }catch(e){}
  return out;
}
function renderSwapList(){
  const el=document.getElementById('swap-list'); if(!el) return;
  const ex=type(S.dayIdx).exercises[S.swapTarget];
  const cur=ex?String(S.swaps[ex.name]||ex.name).toLowerCase():'';
  const q=(document.getElementById('swap-input')?.value||'').toLowerCase().trim();
  const opts=_swapExerciseOptions().filter(o=>!q||o.name.toLowerCase().includes(q));
  el.innerHTML=opts.map(o=>
    '<button class="swap-pick'+(o.name.toLowerCase()===cur?' sel':'')+'" data-action="swap-pick" data-name="'+_catEsc(o.name)+'">'+
      '<span class="swap-pick-name">'+_catEscHtml(o.name)+'</span>'+
      (o.inProg?'<span class="swap-pick-tag">you do this</span>':'')+
    '</button>'
  ).join('')||'<div style="padding:14px 0;text-align:center;color:var(--muted);font-size:13px">No matches — type a name and tap Save name</div>';
}
function swapPickExercise(name){
  const ex=type(S.dayIdx).exercises[S.swapTarget]; if(!ex) return;
  if(name && name!==ex.name) S.swaps[ex.name]=name; else delete S.swaps[ex.name];
  saveSwaps();
  closeSwapModal();
  renderLog();
}
document.addEventListener('click',function(e){
  const p=e.target.closest('[data-action="swap-pick"]'); if(!p) return;
  swapPickExercise(p.dataset.name);
});
function closeSwapModal(){
  document.getElementById('swap-modal').classList.add('hidden');
}
function confirmSwap(){
  const ex = type(S.dayIdx).exercises[S.swapTarget];
  const newName = document.getElementById('swap-input').value.trim();
  if(newName && newName !== ex.name){
    S.swaps[ex.name] = newName;
  } else {
    delete S.swaps[ex.name];
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
    const tc = TYPES.find(t=>t.name===s.sessionType)||TYPES[0];
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
          <button class="session-del-x" onclick="askDeleteSession(this,'${s.id}')" title="Delete session" aria-label="Delete session">✕</button>
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
  // No confirm() — it's a no-op in iOS standalone PWAs (which is why the ✕ "did nothing").
  S.sessions = S.sessions.filter(s=>s.id!==id);
  persist(); renderHistory();
}
// Two-tap guard for the small ✕: first tap arms it (turns into "Delete?"), second tap deletes.
// Avoids both an accidental wipe and the blocked native confirm().
function askDeleteSession(btn,id){
  if(!btn){ deleteSession(id); return; }
  if(btn.dataset.armed==='1'){ deleteSession(id); return; }
  document.querySelectorAll('.session-del-x[data-armed="1"]').forEach(b=>{ b.dataset.armed='0'; b.classList.remove('confirming'); b.textContent='✕'; });
  btn.dataset.armed='1';
  btn.classList.add('confirming');
  btn.textContent='Delete?';
  setTimeout(()=>{ if(btn&&btn.dataset.armed==='1'){ btn.dataset.armed='0'; btn.classList.remove('confirming'); btn.textContent='✕'; } },3000);
}

// ── WEIGHT tracking ──────────────────────────────────────────────
function logWeight(){
  const dateEl  = document.getElementById('weight-date');
  const inputEl = document.getElementById('weight-input');
  const weight  = parseFloat(inputEl.value);
  const date    = dateEl.value;
  if(!weight || !date) return;
  S.weights = S.weights.filter(w=>w.date!==date);
  S.weights.push({date, weight});
  persistWeights();
  inputEl.value='';
  renderWeightSection();
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
        ${sorted.length>=2?`<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px"><canvas id="weight-chart"></canvas></div>`:''}
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

  if(sorted.length>=2){
    if(S.weightChart){ S.weightChart.destroy(); S.weightChart=null; }
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
        responsive:true,maintainAspectRatio:true,
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

// ── PROGRESS view ─────────────────────────────────────────────────
function renderProgress(){
  if(!S.sessions.length){
    document.getElementById('sub-progress').innerHTML=emptyState('📊','No workout data yet','Complete and save a session to see your progress charts here');
    ensureHabitsStatsInProgress();
    return;
  }
  const sel = document.getElementById('pr-select');
  const prev = sel.value;
  sel.innerHTML = ALL_EX.map(n=>`<option value="${n}"${n===prev?' selected':''}>${dn(n)}</option>`).join('');
  if(!sel.value && ALL_EX.length) sel.value = ALL_EX[0];
  renderWeightSection();
  renderWeightGoal();
  renderWeeklyGrid();
  renderConsistStats();
  renderChart();
  renderPRBoard();
  ensureHabitsStatsInProgress();
}

function renderWeeklyGrid(targetId){
  const TYPE_ID = {'Chest & Back':'cb','Shoulders & Arms':'sa','Legs':'lg'};
  const sessionMap = {};
  S.sessions.forEach(s=>{ sessionMap[s.date] = TYPE_ID[s.sessionType]||''; });

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
      const typeClass=sessionMap[ds]||'';
      const isToday=ds===todayStr?' today':'';
      const isFuture=cellDate>today?' style="opacity:0.25"':'';
      html+=`<div class="day-cell ${typeClass}${isToday}"${isFuture}></div>`;
    }
    html+='</div>';
  }
  html+=`<div class="week-legend">
    <div class="legend-item"><div class="legend-dot" style="background:var(--danger)"></div>Chest & Back</div>
    <div class="legend-item"><div class="legend-dot" style="background:#3b82f6"></div>Shoulders & Arms</div>
    <div class="legend-item"><div class="legend-dot" style="background:var(--success)"></div>Legs</div>
  </div></div>`;
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

  document.getElementById('consist-stats').innerHTML=[
    {l:'This week',v:`${thisWeek}/6`},
    {l:'Last 4 weeks',v:`${last4}/24`},
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
      responsive:true,maintainAspectRatio:true,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'kg'}}},
      scales:{
        x:{grid:{color:gc},ticks:{color:tc,font:{size:11},maxTicksLimit:6}},
        y:{grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>v+'kg'},beginAtZero:false}
      }
    }
  });
}

function renderPRBoard(){
  document.getElementById('pr-board').innerHTML = TYPES.map(t=>`
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
function openSettingsSection(key){
  const panel=document.getElementById('settings-active-panel');
  const title=document.getElementById('settings-panel-title');
  if(!panel) return;
  // Desktop: every section is already visible — nav only highlights + scrolls
  if(window.innerWidth>=1024){
    ['account','profile','health','habits','reminders','subscriptions','appearance','export'].forEach(k=>{
      const btn=document.getElementById('sgb-'+k);
      if(btn) btn.classList.toggle('sg-active',k===key);
    });
    const sec=document.getElementById('settings-'+key+'-section');
    if(sec) sec.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  ['account','profile','health','habits','reminders','subscriptions','appearance','export'].forEach(k=>{
    const el=document.getElementById('settings-'+k+'-section');
    if(el) el.classList.add('hidden');
    const btn=document.getElementById('sgb-'+k);
    if(btn) btn.classList.remove('sg-active');
  });
  panel.classList.remove('hidden');
  const titles={account:'Account',profile:'Profile',budget:'Budget',health:'Health',habits:'Habits',reminders:'Reminders',subscriptions:'Subscriptions',appearance:'Appearance',export:'Export'};
  if(title) title.textContent=titles[key]||key;
  const sec=document.getElementById('settings-'+key+'-section');
  if(sec) sec.classList.remove('hidden');
  const btn=document.getElementById('sgb-'+key);
  if(btn) btn.classList.add('sg-active');
  if(key==='account') renderAccountSection();
  if(key==='profile') renderSettingsProfile();
  if(key==='health'){
    const pi=S.personalInfo;
    ['name','age','sex','height','weight','activity'].forEach(f=>{
      const el=document.getElementById('pi-'+f); if(el&&pi[f]!=null) el.value=pi[f];
    });
    renderTDEESection(); renderCalorieLog(); renderSavedFoods();
  }
  if(key==='appearance'){ const t=document.getElementById('theme-toggle'); if(t) t.checked=S.theme==='dark'; const dc=document.getElementById('toggle-dynamic-colours'); if(dc) dc.checked=localStorage.getItem('daily_dynamic_colours')==='true'; renderAccentSwatches(); }
  if(key==='subscriptions') renderSubscriptionsSection();
  if(key==='reminders') renderRemindersSection();
  panel.scrollIntoView({behavior:'smooth',block:'start'});
}
function closeSettingsSection(){
  const panel=document.getElementById('settings-active-panel');
  if(panel) panel.classList.add('hidden');
  ['account','profile','health','habits','reminders','subscriptions','appearance','export'].forEach(k=>{
    const btn=document.getElementById('sgb-'+k);
    if(btn) btn.classList.remove('sg-active');
  });
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
  const wrap=document.getElementById('subscriptions-content');
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
  closeSettingsSection();

  const pi = S.personalInfo;
  const fields = ['name','age','sex','height','weight','activity'];
  fields.forEach(f=>{
    const el = document.getElementById('pi-'+f);
    if(el && pi[f]!=null) el.value = pi[f];
  });

  renderInstallCard();
  renderTDEESection();
  renderCalorieLog();
  renderSavedFoods();
  renderAccountSection();
  renderSettingsProfile();
  applySettingsCollapsed();

  // Desktop (≥1024px): all sections are visible at once, so render the ones
  // that mobile only populates on icon tap
  if(window.innerWidth>=1024){
    renderRemindersSection();
    renderSubscriptionsSection();
    renderAccentSwatches();
    const t=document.getElementById('theme-toggle'); if(t) t.checked=S.theme==='dark';
    const dc=document.getElementById('toggle-dynamic-colours'); if(dc) dc.checked=localStorage.getItem('daily_dynamic_colours')==='true';
    // Reveal the panel and every section so they stack in the right column
    const panel=document.getElementById('settings-active-panel');
    if(panel) panel.classList.remove('hidden');
    ['account','profile','health','habits','reminders','subscriptions','appearance','export'].forEach(k=>{
      const el=document.getElementById('settings-'+k+'-section');
      if(el) el.classList.remove('hidden');
    });
  }
}

function renderAccountSection(){
  const wrap=document.getElementById('settings-account-section'); if(!wrap) return;
  const user=(firebaseReady&&auth)?auth.currentUser:null;
  let inner;
  if(user){
    const photo=user.photoURL;
    const uname=user.displayName||'Google user';
    const email=user.email||'';
    const avatar=photo
      ?'<img src="'+photo+'" referrerpolicy="no-referrer" style="width:46px;height:46px;border-radius:50%;object-fit:cover;flex-shrink:0">'
      :'<div style="width:46px;height:46px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;color:#fff;flex-shrink:0">'+uname.charAt(0).toUpperCase()+'</div>';
    inner=
      '<div class="settings-card">'+
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
    inner=
      '<div class="settings-card">'+
        '<div style="font-size:13px;color:var(--muted);margin-bottom:14px">Not signed in — sign in to sync your data across devices.</div>'+
        '<button onclick="handleAuth()" style="width:100%;padding:10px;border-radius:10px;border:none;background:#4285f4;color:#fff;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">'+
          '<svg viewBox="0 0 24 24" style="width:16px;height:16px;flex-shrink:0"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>'+
          'Sign in with Google'+
        '</button>'+
      '</div>';
  }
  wrap.innerHTML=inner;
  renderSettingsTopCard();
}

function renderSettingsProfile(){
  const wrap=document.getElementById('settings-profile-section'); if(!wrap) return;
  wrap.innerHTML=`
    <div class="settings-card">
      <div class="settings-field">
        <label>Your name</label>
        <input type="text" id="profile-name" placeholder="e.g. Francois" value="${(profileData.name||'').replace(/"/g,'&quot;')}" autocomplete="name">
      </div>
      <button class="settings-save-btn" id="profile-save-btn" onclick="saveProfileSection()" style="margin-top:4px">Save</button>
    </div>`;
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
function loadSavedFoods(){
  try{ return JSON.parse(localStorage.getItem('daily_saved_foods')||'[]'); }
  catch{ return []; }
}
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
function loadWeightLog(){ try{ return JSON.parse(localStorage.getItem('daily_weight_log')||'[]'); }catch{ return []; } }
function saveWeightLog(){ localStorage.setItem('daily_weight_log', JSON.stringify(wtLog)); syncBlobPush('weightLog','daily_weight_log'); }
let wtLog = loadWeightLog();
let wtChart = null;
let profileData        = loadProfileData();
let settingsCollapsed  = (()=>{try{return JSON.parse(localStorage.getItem('daily_settings_collapsed')||'{}');}catch{return {};}})();
function loadWeightGoal(){ try{ return JSON.parse(localStorage.getItem('daily_weight_goal'))||{}; }catch(e){ return {}; } }
let weightGoal = loadWeightGoal();
function loadSubscriptions(){ try{ return JSON.parse(localStorage.getItem('daily_subscriptions'))||[]; }catch(e){ return []; } }
let subscriptionsData = loadSubscriptions();
let habitsData         = loadHabits();
let habitsLog          = loadHabitsLog();
let budChart           = null;
let budDonutChart      = null;
let budTrendRange      = 'monthly';
let bsChart            = null;
let bsBalChart         = null;
let bsTrendRange       = 'monthly';

// ── Budget storage ────────────────────────────────────────────────
function budLoadData(){
  try{ return JSON.parse(localStorage.getItem('daily_budget')||'{}'); }
  catch{ return {}; }
}
function budSaveData(){
  localStorage.setItem('daily_budget', JSON.stringify(budgetData));
  syncBudgetDataToFirebase();
}
function budLoadDefaults(){
  try{ return JSON.parse(localStorage.getItem('daily_budget_defaults')||'{}'); }
  catch{ return {}; }
}
function budSaveDefaults(){
  budDefaults.fine      = parseFloat(document.getElementById('fix-fine')?.value)      || DEFAULT_FINE;
  budDefaults.subs      = parseFloat(document.getElementById('fix-subs')?.value)      || DEFAULT_SUBS;
  budDefaults.gym       = parseFloat(document.getElementById('fix-gym')?.value)       || DEFAULT_GYM;
  budDefaults.transport = parseFloat(document.getElementById('fix-transport')?.value) || DEFAULT_TRANSPORT;
  localStorage.setItem('daily_budget_defaults', JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();
}
function getWeeklySavings(){ return 0; } // weekly-savings target was removed; no-op for legacy callers
function inc1Label()   { return budDefaults.inc1_label  || 'Fujifilm'; }
function inc1Amount()  { return budDefaults.inc1_amount ?? 507; }
function inc2Label()   { return budDefaults.inc2_label  || "McDonald's"; }
function inc2Amount()  { return budDefaults.inc2_amount ?? 278; }
function inc3Label()   { return budDefaults.inc3_label  || ''; }
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

// ── Timezone-aware date helpers (Australia/Sydney) ────────────────
function getLocalDate(){
  return new Date().toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'});
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
  // AEST-aware: the week rolls at midnight Monday AEST, not at 10am (which is what
  // local/UTC midnight would give for clients running in UTC). We compute the Monday
  // in AEST and return it as a local-midnight Date so callers (weekKey/fmtWeekLabel
  // and the various monday.setDate(...) arithmetic) keep working unchanged.
  const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;
  const nowAEST = new Date(Date.now() + AEST_OFFSET_MS);
  const day = nowAEST.getUTCDay();
  const diffToMonday = (day === 0) ? 6 : day - 1;
  const monday = new Date(nowAEST);
  monday.setUTCDate(nowAEST.getUTCDate() - diffToMonday + (weekOffset * 7));
  monday.setUTCHours(0, 0, 0, 0);
  return localMidnight(monday.toISOString().slice(0, 10));
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
  const now=localMidnight(getLocalDate()); return new Date(now.getFullYear(),now.getMonth()+offset,1);
}
function getMondaysInMonth(monthDate){
  const year=monthDate.getFullYear(),month=monthDate.getMonth();
  const mondays=[];
  Object.keys(budgetData).forEach(k=>{
    const mon=new Date(k+'T12:00:00');
    const fri=new Date(mon); fri.setDate(mon.getDate()+6);
    if((mon.getMonth()===month&&mon.getFullYear()===year)||
       (fri.getMonth()===month&&fri.getFullYear()===year)){
      if(!mondays.includes(k)) mondays.push(k);
    }
  });
  return mondays.sort();
}
function fmtMonthLabel(d){ return d.toLocaleDateString('en-AU',{month:'long',year:'numeric'}); }

// ── Budget view toggle ────────────────────────────────────────────
function setBudgetView(v){
  budgetView=v;
  const wBtn=document.getElementById('bv-week-btn');
  const mBtn=document.getElementById('bv-month-btn');
  if(wBtn){ wBtn.style.background=v==='week'?'var(--card)':'transparent'; wBtn.style.fontWeight=v==='week'?'700':'500'; wBtn.style.color=v==='week'?'var(--text)':'var(--muted)'; wBtn.style.boxShadow=v==='week'?'0 1px 3px rgba(0,0,0,0.1)':'none'; }
  if(mBtn){ mBtn.style.background=v==='month'?'var(--card)':'transparent'; mBtn.style.fontWeight=v==='month'?'700':'500'; mBtn.style.color=v==='month'?'var(--text)':'var(--muted)'; mBtn.style.boxShadow=v==='month'?'0 1px 3px rgba(0,0,0,0.1)':'none'; }
  document.getElementById('budget-week-view').classList.toggle('hidden',v!=='week');
  document.getElementById('budget-month-view').classList.toggle('hidden',v!=='month');
  if(v==='week') renderBudgetTab();
  if(v==='month') renderMonth();
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
// Drop the legacy old-model "sav_extra" marker from CURRENT/FUTURE weeks. It must NOT touch
// sav_amount — doing so was wiping legitimately-entered savings (e.g. a real 300) on reload.
// The old target can no longer auto-appear anyway (getWeeklySavings()===0 + the display only
// reads sav_amount). Past weeks were frozen by recoverBudgetData and are left untouched.
function scrubSavingsTarget(data){
  if(!data||typeof data!=='object') return false;
  const curWk=(typeof getMondayOf==='function'&&typeof weekKey==='function')?weekKey(getMondayOf(0)):'';
  if(!curWk) return false;
  let changed=false;
  Object.keys(data).forEach(wk=>{
    if(wk<curWk) return; // current + future only; past weeks stay frozen
    const w=data[wk]; if(!w||typeof w!=='object') return;
    if(w.sav_extra!==undefined){ delete w.sav_extra; changed=true; } // legacy marker only — never sav_amount
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
  try{ const a=JSON.parse(localStorage.getItem('daily_budget_fix_cats')); if(Array.isArray(a)) return a; }catch(e){}
  return [
    {id:'fine',      name:'⚖️ Fine repayment',     default:budDefaults.fine??25},
    {id:'subs',      name:'📱 Subscriptions',       default:budDefaults.subs??17},
    {id:'transport', name:'🚌 Transport (Opal)',    default:budDefaults.transport??50},
    {id:'gym',       name:'🏋️ Anytime Fitness',     default:budDefaults.gym??27},
  ];
}
function saveFixCats(cats){ localStorage.setItem('daily_budget_fix_cats', JSON.stringify(cats)); syncBlobPush('budgetFixCats','daily_budget_fix_cats'); }
function loadVarCats(){
  try{ const a=JSON.parse(localStorage.getItem('daily_budget_var_cats')); if(Array.isArray(a)) return a; }catch(e){}
  return [
    {id:'food',     name:'🍔 Food'},
    {id:'pub',      name:'🍺 Pub & social'},
    {id:'personal', name:'👜 Personal'},
  ];
}
function saveVarCats(cats){ localStorage.setItem('daily_budget_var_cats', JSON.stringify(cats)); syncBlobPush('budgetVarCats','daily_budget_var_cats'); }
// Income sources — ids match the legacy field suffixes (fuji/mcd) so per-week storage
// d['inc_'+id] stays compatible with existing saved weeks (d.inc_fuji / d.inc_mcd).
function loadIncCats(){
  try{ const a=JSON.parse(localStorage.getItem('daily_budget_inc_cats')); if(Array.isArray(a)) return a; }catch(e){}
  return [
    {id:'fuji', name:'Fujifilm'},
    {id:'mcd',  name:"McDonald's"},
  ];
}
function saveIncCats(cats){ localStorage.setItem('daily_budget_inc_cats', JSON.stringify(cats)); syncBlobPush('budgetIncCats','daily_budget_inc_cats'); }
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
// ── Budget inline calculator ───────────────────────────────────────
let _budCalcExpr = '';
let _budCalcTarget = null;
function ensureBudCalcDOM(){
  if(document.getElementById('bud-calc')) return;
  const wrap=document.createElement('div');
  wrap.innerHTML=
    '<div id="bud-calc-overlay" onclick="budCalcDismiss()" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.35)"></div>'+
    '<div id="bud-calc" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:1001;max-width:540px;margin:0 auto">'+
      '<div class="bud-calc-sheet">'+
        '<div class="bud-calc-expr" id="bud-calc-expr"></div>'+
        '<div class="bud-calc-result" id="bud-calc-result"></div>'+
        '<div class="bud-calc-grid">'+
          '<button class="bud-calc-btn op" onclick="budCalcClear()">C</button>'+
          '<button class="bud-calc-btn del" onclick="budCalcDel()">⌫</button>'+
          '<button class="bud-calc-btn op" onclick="budCalcOp(\'÷\')">÷</button>'+
          '<button class="bud-calc-btn op" onclick="budCalcOp(\'×\')">×</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'7\')">7</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'8\')">8</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'9\')">9</button>'+
          '<button class="bud-calc-btn op" onclick="budCalcOp(\'−\')">−</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'4\')">4</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'5\')">5</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'6\')">6</button>'+
          '<button class="bud-calc-btn op" onclick="budCalcOp(\'+\')">+</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'1\')">1</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'2\')">2</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'3\')">3</button>'+
          '<button class="bud-calc-btn eq" onclick="budCalcConfirm()" style="grid-row:span 2">=</button>'+
          '<button class="bud-calc-btn zero" onclick="budCalcDigit(\'0\')">0</button>'+
          '<button class="bud-calc-btn" onclick="budCalcDigit(\'.\')">.</button>'+
        '</div>'+
        '<div style="display:flex;justify-content:flex-end;padding:8px 4px 0">'+
          '<button class="bud-calc-done" onclick="budCalcConfirm()">Done</button>'+
        '</div>'+
      '</div>'+
    '</div>';
  while(wrap.firstChild) document.body.appendChild(wrap.firstChild);
}
function budCalcOpen(input){
  _budCalcTarget=input;
  _budCalcExpr=String(input.value||'');
  budCalcUpdateDisplay();
  const sheet=document.getElementById('bud-calc');
  const overlay=document.getElementById('bud-calc-overlay');
  if(!sheet) return;
  sheet.style.display='block';
  if(overlay) overlay.style.display='block';
  requestAnimationFrame(()=>sheet.classList.add('open'));
}
function budCalcDismiss(){
  const sheet=document.getElementById('bud-calc');
  const overlay=document.getElementById('bud-calc-overlay');
  if(!sheet) return;
  sheet.classList.remove('open');
  if(overlay) overlay.style.display='none';
  setTimeout(()=>{ sheet.style.display='none'; },260);
  _budCalcTarget=null; _budCalcExpr='';
}
// Evaluate a calculator expression. Whitelisted chars only, then Function() (no CSP here).
function budCalcEval(expr){
  if(!expr) return '';
  const safe=String(expr).replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-');
  if(!/^[\d.+\-*/()\s]+$/.test(safe)) return '';
  try{
    const result=Function('return ('+safe+')')();
    if(typeof result!=='number'||!isFinite(result)) return '';
    return String(Math.round(result*100)/100);
  }catch(e){ return ''; }
}
function budCalcUpdateDisplay(){
  const exprEl=document.getElementById('bud-calc-expr');
  const resEl=document.getElementById('bud-calc-result');
  if(exprEl) exprEl.textContent=_budCalcExpr||'';
  if(resEl){
    const hasOp=/[+−×÷\-*/]/.test(_budCalcExpr.slice(1));
    const evaluated=hasOp?budCalcEval(_budCalcExpr):'';
    resEl.textContent=evaluated?('= '+evaluated):(_budCalcExpr||'0');
  }
}
function budCalcDigit(d){ _budCalcExpr+=d; budCalcUpdateDisplay(); }
function budCalcOp(op){
  if(_budCalcExpr&&/[+−×÷]$/.test(_budCalcExpr.trim())) _budCalcExpr=_budCalcExpr.trim().slice(0,-1);
  if(!_budCalcExpr&&op!=='−') return; // don't start with an operator (allow a leading minus)
  _budCalcExpr+=op; budCalcUpdateDisplay();
}
function budCalcClear(){ _budCalcExpr=''; budCalcUpdateDisplay(); }
function budCalcDel(){ _budCalcExpr=_budCalcExpr.slice(0,-1); budCalcUpdateDisplay(); }
function budCalcConfirm(){
  if(!_budCalcTarget){ budCalcDismiss(); return; }
  const result=budCalcEval(_budCalcExpr)||_budCalcExpr;
  const num=parseFloat(result);
  if(!isNaN(num)){
    _budCalcTarget.value=Math.round(num*100)/100;
    _budCalcTarget.dispatchEvent(new Event('input',{bubbles:true}));
  }
  budCalcDismiss();
}
// Open the calc on tap/click and block the input from focusing (so no native keyboard on
// mobile and no caret on desktop). Same path for both pointer types.
document.addEventListener('mousedown',function(e){
  const inp=e.target;
  if(!inp||!inp.matches||!inp.matches('.bud-row-input[data-calc="1"]')) return;
  e.preventDefault();
  budCalcOpen(inp);
});
document.addEventListener('touchstart',function(e){
  const inp=e.target;
  if(!inp||!inp.matches||!inp.matches('.bud-row-input[data-calc="1"]')) return;
  e.preventDefault();
  budCalcOpen(inp);
},{passive:false});
// While the calc is open (desktop), drive it with the physical keyboard.
document.addEventListener('keydown',function(e){
  if(!_budCalcTarget) return; // only when the calc is open
  const k=e.key;
  if(k>='0'&&k<='9'){ budCalcDigit(k); }
  else if(k==='.'){ budCalcDigit('.'); }
  else if(k==='+'){ budCalcOp('+'); }
  else if(k==='-'){ budCalcOp('−'); }
  else if(k==='*'){ budCalcOp('×'); }
  else if(k==='/'){ budCalcOp('÷'); }
  else if(k==='Enter'||k==='='){ budCalcConfirm(); }
  else if(k==='Backspace'){ budCalcDel(); }
  else if(k==='Escape'){ budCalcDismiss(); }
  else { return; } // let other keys pass through
  e.preventDefault();
});
function renderFixedCard(data,isCur){
  const editing=budEditMode.fix && isCur;
  const cats=loadFixCats();
  const rows=cats.map(c=>{
    const raw=data['fix_'+c.id];
    const val=(raw!==undefined&&raw!=='')?raw:(c.default!=null?c.default:'');
    return '<div class="bud-row bud-cat-row" data-cat-id="'+c.id+'">'+
      budCatNameHtml('fix',c,isCur,editing)+
      '<input class="bud-row-input" type="number" inputmode="decimal" id="fix-'+c.id+'" placeholder="$'+(c.default||0)+'" value="'+val+'" oninput="budRecalc()"'+(isCur?' data-calc="1"':' disabled')+'>'+
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
      '<input class="bud-row-input" type="number" inputmode="decimal" id="var-'+c.id+'" placeholder="$0" value="'+val+'" oninput="budRecalc()"'+(isCur?' data-calc="1"':' disabled')+'>'+
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
      '<input class="bud-row-input" type="number" inputmode="decimal" id="inc-'+c.id+'" placeholder="$0" value="'+val+'" oninput="budRecalc()"'+(isCur?' data-calc="1"':' disabled')+'>'+
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
  ensureBudCalcDOM();
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
    // Same inline-calculator wiring as the category inputs (editable weeks only)
    if(editable) savEl.setAttribute('data-calc','1'); else savEl.removeAttribute('data-calc');
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

  budRecalc();
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
  const buildSel=(id,cur)=>{
    const el=document.getElementById(id); if(!el) return;
    el.innerHTML=BUD_DAY_NAMES.map((d,v)=>'<option value="'+v+'"'+(v===cur?' selected':'')+'>'+d+'</option>').join('');
  };
  buildSel('bud-cfg-fuji-payday', budDefaults.fujifilmPayDay??4);
  buildSel('bud-cfg-mcds-payday', budDefaults.mcdonaldsPayDay??2);
  budUpdateIncomeHints();
}
function budUpdateIncomeHints(){
  // Income sources are dynamic now — no hardcoded per-source budget/pay-day hints.
}
function budSaveConfig(){
  const sg=document.getElementById('bud-cfg-savings-goal');
  const fp=document.getElementById('bud-cfg-fuji-payday');
  const mp=document.getElementById('bud-cfg-mcds-payday');
  if(sg){ const n=parseFloat(sg.value); budDefaults.savingsGoal = isNaN(n)?undefined:n; }
  if(fp){ const v=parseInt(fp.value); if(!isNaN(v)) budDefaults.fujifilmPayDay=v; }
  if(mp){ const v=parseInt(mp.value); if(!isNaN(v)) budDefaults.mcdonaldsPayDay=v; }
  localStorage.setItem('daily_budget_defaults', JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();
  budUpdateIncomeHints();
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
function budRecalc(){
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
    if(barEl) barEl.style.width=Math.min(100,pct)+'%';
    if(barL) barL.textContent='$'+totalOut.toFixed(0)+' spent';
    if(barR) barR.textContent=pct+'% of income';
  } else {
    if(barEl) barEl.style.width='0%';
    if(barL) barL.textContent='Enter income to see breakdown';
    if(barR) barR.textContent='';
  }
  budSaveDraft();
  renderNetPosition();
}
// Net-position summary in the budget hero: savings (newest by date) − card debt. Display only;
// shares the same source data as the savings/CC cards, so it can't disagree with them.
function renderNetPosition(){
  const sEl=document.getElementById('bud-net-savings');
  const dEl=document.getElementById('bud-net-debt');
  const nEl=document.getElementById('bud-net-net');
  if(!sEl&&!dEl&&!nEl) return;
  const sorted=[...savingsLog].filter(e=>e&&e.date).sort((a,b)=>a.date<b.date?-1:1);
  const savings=sorted.length?(parseFloat(sorted[sorted.length-1].balance)||0):0;
  const debt=parseFloat(loadCCData().balance)||0;
  const net=savings-debt;
  const fmt=n=>(n<0?'-$':'$')+Math.abs(Math.round(n)).toLocaleString();
  if(sEl) sEl.textContent=fmt(savings);
  if(dEl) dEl.textContent=fmt(debt);
  if(nEl){ nEl.textContent=fmt(net); nEl.style.color = net>0 ? '#4ade80' : net<0 ? '#f87171' : 'rgba(255,255,255,.78)'; }
}

// Write the per-week editable fields from the DOM into a week record
function budWriteFields(d){
  const gv=id=>document.getElementById(id)?.value||'';
  d.sav_amount      = gv('sav-amount');
  loadIncCats().forEach(c=>{ const el=document.getElementById('inc-'+c.id); if(el) d['inc_'+c.id]=el.value||''; });
  loadFixCats().forEach(c=>{ const el=document.getElementById('fix-'+c.id); if(el) d['fix_'+c.id]=el.value||''; });
  loadVarCats().forEach(c=>{ const el=document.getElementById('var-'+c.id); if(el) d['var_'+c.id]=el.value||''; });
  d.notes           = gv('week-notes');
}
function budSaveDraft(){
  // Current week always auto-persists; a past week persists only while unlocked for editing.
  if(currentWeekIdx !== 0 && !budPastEdit) return;
  const key=weekKey(getMondayOf(currentWeekIdx)); // write to the VIEWED week, not always "this" week
  if(!budgetData[key]) budgetData[key]={};
  const d=budgetData[key];
  budWriteFields(d);
  if(!d.saved) d.draft=true;
  budSaveData();
}

function budSaveCurrentWeek(){
  const monday=getMondayOf(currentWeekIdx);
  const key=weekKey(monday);
  if(!budgetData[key]) budgetData[key]={};
  const d=budgetData[key];
  budWriteFields(d);
  d.saved=true; delete d.draft;
  budSaveData(); renderPrevWeeks(); updateNavBadges();
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

// Safety net: persist the current week if the page is being torn down (tab close,
// navigation, PWA reload) before an input's save has flushed.
window.addEventListener('beforeunload', () => {
  if (typeof budSaveCurrentWeek === 'function') budSaveCurrentWeek();
});

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
  const collapsed=JSON.parse(localStorage.getItem('daily_collapsed')||'{}');
  if(isCollapsed) collapsed[id]=true; else delete collapsed[id];
  localStorage.setItem('daily_collapsed',JSON.stringify(collapsed));
}
function restoreCardCollapse(){
  const collapsed=JSON.parse(localStorage.getItem('daily_collapsed')||'{}');
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
  if(sg) sg.innerHTML=[
    {val:totalIncome>0?'$'+totalIncome.toFixed(0):'—',lbl:'Income',color:'var(--success)'},
    {val:weekCount>0?'$'+totalSaved.toFixed(0):'—',lbl:'Saved',color:'var(--blue)'},
    {val:leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'—',lbl:'Left over',
     color:leftover!==null?(leftover>=0?'var(--success)':'var(--danger)'):'var(--muted)'},
  ].map(s=>'<div class="sum-card"><div class="sum-card-val" style="color:'+s.color+'">'+s.val+'</div><div class="sum-card-lbl">'+s.lbl+'</div></div>').join('');

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
  if(wl){
    if(!keys.length){wl.innerHTML=emptyState('📅','No weeks saved yet','Save a week using the Week view to see it here');}
    else wl.innerHTML=keys.map(k=>{
      const d=budgetData[k]; if(!d) return '';
      const inc=weekIncome(d);
      const out=weekSavedAmt(d)+weekSpending(d);
      const left=inc>0?inc-out:null;
      const mon=new Date(k+'T12:00:00'),fri=new Date(mon); fri.setDate(mon.getDate()+4);
      const lbl=mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' – '+fri.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
      return '<div class="month-week-row"><div class="month-week-lbl">'+lbl+'</div>'
        +'<div class="month-week-val" style="color:'+(left===null?'var(--muted)':left>=0?'var(--green-dark)':'var(--amber-dark)')+'">'+
        (left!==null?(left>=0?'+$':'-$')+Math.abs(left).toFixed(0):'—')+'</div></div>';
    }).join('');
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
    cutoff.setMonth(cutoff.getMonth()-11);
    cutoff.setDate(1);
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
  const isDark=S.theme==='dark';
  const gc=isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)';
  const tc=isDark?'#888':'#94a3b8';
  budChart=new Chart(ctx,{
    type:'line',
    data:{
      labels:points.map(p=>p.label),
      datasets:[
        {label:'Income',data:points.map(p=>p.income),borderColor:'#52B788',backgroundColor:'rgba(82,183,136,0.08)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#52B788',fill:false,tension:0.3},
        {label:'Spending',data:points.map(p=>p.spending),borderColor:'#E74C3C',backgroundColor:'rgba(231,76,60,0.08)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#E74C3C',fill:false,tension:0.3},
        {label:'Saved',data:points.map(p=>p.saved),borderColor:'#3b82f6',backgroundColor:'rgba(59,130,246,0.08)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#3b82f6',fill:false,tension:0.3},
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
  renderNetPosition();
}
function logSavingsBalance(){
  const dateEl=document.getElementById('sav-log-date');
  const balEl=document.getElementById('sav-log-bal');
  const bal=parseFloat(balEl.value);
  const date=dateEl.value;
  if(!bal||!date) return;
  savingsLog=savingsLog.filter(e=>e.date!==date);
  savingsLog.push({date,balance:bal,t:Date.now()}); // t lets this win the newest-per-date merge
  saveSavingsLog();
  balEl.value='';
  renderSavingsCard();
  if(statsSubTab==='budget'){ renderBSBalance(); renderBSTrend(); }
}
function deleteSavingsEntry(date){
  savingsLog=savingsLog.filter(e=>e.date!==date);
  saveSavingsLog();
  renderSavingsCard();
  if(statsSubTab==='budget'){ renderBSBalance(); renderBSTrend(); }
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
  renderBSBalance();
  renderBSConsist();
  renderBSRecords();
  renderBSGoals();
}

function renderBSProgress(){
  const wrap=document.getElementById('bs-progress-wrap'); if(!wrap) return;
  const keys=Object.keys(budgetData).filter(k=>{const d=budgetData[k];return d&&(d.saved||d.snapshot);}).sort();
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

// ── Stats: Weight sub-tab ─────────────────────────────────────────
function toggleWeightLogRow(){
  const row=document.getElementById('wt-log-row'); if(!row) return;
  const hidden=row.classList.toggle('hidden');
  if(!hidden){ setTimeout(()=>document.getElementById('wt-kg-input')?.focus(),50); }
}

function saveWeightEntry(){
  const kgEl=document.getElementById('wt-kg-input');
  const dateEl=document.getElementById('wt-date-input');
  const kg=parseFloat(kgEl?.value);
  const date=dateEl?.value||getLocalDate();
  if(!kg||kg<20||kg>300) return;
  wtLog=wtLog.filter(e=>e.date!==date);
  wtLog.push({date,kg});
  saveWeightLog();
  if(kgEl) kgEl.value='';
  const row=document.getElementById('wt-log-row');
  if(row) row.classList.add('hidden');
  renderWeightStatsTab();
}

function deleteWeightEntry(date){
  wtLog=wtLog.filter(e=>e.date!==date);
  saveWeightLog();
  renderWeightStatsTab();
}

function renderWeightStatsTab(){
  const wrap=document.getElementById('sub-weight'); if(!wrap) return;
  const sorted=[...wtLog].sort((a,b)=>a.date<b.date?-1:1);
  const latest=sorted.length?sorted[sorted.length-1]:null;
  const today=getLocalDate();

  let html='<div style="display:flex;justify-content:flex-end;margin-bottom:14px">'+
    '<button class="wt-log-btn" onclick="toggleWeightLogRow()">+ Log Weight</button>'+
  '</div>'+
  '<div class="wt-log-row hidden" id="wt-log-row">'+
    '<input class="wt-kg-input" id="wt-kg-input" type="number" inputmode="decimal" step="0.1" min="20" max="300" placeholder="kg">'+
    '<input class="wt-date-inp" id="wt-date-input" type="date" value="'+today+'">'+
    '<button class="wt-save-btn" onclick="saveWeightEntry()">Save</button>'+
  '</div>';

  if(!latest){
    html+=emptyState('⚖️','No weight logged yet','Tap Log Weight above to start tracking');
  } else {
    const daysDiff=Math.floor((new Date(today+'T00:00:00')-new Date(latest.date+'T00:00:00'))/86400000);
    const agoTxt=daysDiff===0?'today':daysDiff===1?'yesterday':daysDiff+' days ago';
    html+='<div class="card wt-cur-card">'+
      '<div class="wt-cur-num"><span class="wt-num">'+latest.kg+'</span><span class="wt-unit"> kg</span></div>'+
      '<div class="wt-cur-sub">Last logged '+agoTxt+'</div>'+
    '</div>';

    if(sorted.length>=2){
      html+='<div class="card wt-chart-card"><canvas id="wt-chart"></canvas></div>';
    }

    const last10=[...sorted].reverse().slice(0,10);
    html+='<div class="card" style="padding:0 16px">';
    last10.forEach(e=>{
      html+='<div class="wt-hist-row">'+
        '<span class="wt-hist-date">'+fmtDate(e.date)+'</span>'+
        '<div style="display:flex;align-items:center;gap:10px">'+
          '<span class="wt-hist-val">'+e.kg+' kg</span>'+
          '<button onclick="deleteWeightEntry(\''+e.date+'\')" class="wt-del-btn">✕</button>'+
        '</div>'+
      '</div>';
    });
    html+='</div>';
  }

  wrap.innerHTML=html;

  if(sorted.length>=2){
    const canvas=document.getElementById('wt-chart'); if(!canvas) return;
    if(wtChart){wtChart.destroy();wtChart=null;}
    const shown=sorted.slice(-30);
    const vals=shown.map(e=>e.kg);
    const minV=Math.min(...vals), maxV=Math.max(...vals);
    const isDark=S.theme==='dark';
    const gc=isDark?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.06)';
    const tc=isDark?'#888':'#94a3b8';
    const accent=(getComputedStyle(document.documentElement).getPropertyValue('--accent')||'#FF6B35').trim();
    const accentRgb=(getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb')||'255,107,53').trim();
    wtChart=new Chart(canvas,{
      type:'line',
      data:{
        labels:shown.map(e=>new Date(e.date+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short'})),
        datasets:[{
          data:vals,
          borderColor:accent,backgroundColor:'rgba('+accentRgb+',.08)',
          borderWidth:2,tension:0.3,fill:true,
          pointRadius:5,pointBackgroundColor:accent
        }]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+' kg'}}},
        scales:{
          x:{border:{display:false},grid:{color:gc},ticks:{color:tc,font:{size:11},maxTicksLimit:8}},
          y:{border:{display:false},grid:{color:gc},ticks:{color:tc,font:{size:11},callback:v=>v+'kg'},
             min:Math.max(0,minV-2),max:maxV+2}
        }
      }
    });
  }
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
    .filter(k=>{const d=budgetData[k]; return d && (d.snapshot || d.saved);})
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
  wrap.innerHTML='<canvas id="bs-trend-chart"></canvas>';
  const ctx=document.getElementById('bs-trend-chart'); if(!ctx) return;
  const isDark=S.theme==='dark';
  const gc=isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)';
  const tc=isDark?'#888':'#94a3b8';
  const accent=(getComputedStyle(document.documentElement).getPropertyValue('--accent')||'#FF6B35').trim();
  const datasets=[
    {type:'bar',label:'Spent',data:spent,backgroundColor:'rgba(231,76,60,0.6)',borderColor:'#E74C3C',borderWidth:1,borderRadius:6,maxBarThickness:48}
  ];
  if(goal>0){
    datasets.push({type:'line',label:'Budget goal',data:shown.map(()=>goal),borderColor:accent,borderWidth:2,borderDash:[6,4],pointRadius:0,fill:false,tension:0});
  }
  bsChart=new Chart(ctx,{
    data:{labels,datasets},
    options:{
      responsive:true,maintainAspectRatio:true,
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
    wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden"><div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">💰 Account balance</div><div style="padding:14px 16px;text-align:center;color:var(--muted);font-size:13px">Log at least 2 balance entries in Budget → Month to see the chart.</div></div>';
    return;
  }
  wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden"><div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">💰 Account balance</div><div style="padding:14px 16px"><canvas id="bs-bal-chart"></canvas></div></div>';
  const ctx=document.getElementById('bs-bal-chart'); if(!ctx) return;
  const isDark=S.theme==='dark';
  const gc=isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)';
  const tc=isDark?'#888':'#94a3b8';
  bsBalChart=new Chart(ctx,{
    type:'line',
    data:{
      labels:sorted.map(e=>e.date.substring(5)),
      datasets:[{label:'Balance',data:sorted.map(e=>e.balance),borderColor:'#94a3b8',backgroundColor:'rgba(148,163,184,0.12)',borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#94a3b8',fill:true,tension:0.3}]
    },
    options:{
      responsive:true,maintainAspectRatio:true,
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:c=>'$'+c.parsed.y.toLocaleString()}}
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
  try{
    const d=JSON.parse(localStorage.getItem('daily_habits')||'null');
    if(Array.isArray(d)&&d.length) return d;
  }catch{}
  return ['Morning workout','Hit calorie goal','Log budget','8h sleep','Drink 2L water'];
}
function loadHabitsLog(){
  try{ return JSON.parse(localStorage.getItem('daily_habits_log')||'{}'); }
  catch{ return {}; }
}
function saveHabitsLog(){
  localStorage.setItem('daily_habits_log',JSON.stringify(habitsLog));
  try{ if(typeof syncBlobPush==='function') syncBlobPush('habitsLog','daily_habits_log'); }catch(e){}
}
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
// Habits stats live in the Progress sub-tab. Created dynamically so the empty-state innerHTML
// reset in renderProgress can't wipe it; always re-appended to the end of #sub-progress.
function ensureHabitsStatsInProgress(){
  const sub=document.getElementById('sub-progress'); if(!sub) return;
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
  return '<div class="card weekly-review-card" style="padding:0;overflow:hidden">'
    +'<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);display:flex;justify-content:space-between;align-items:center">'
    +'<span>📋 Weekly review</span>'
    +'<button onclick="openWeekReviewModal()" style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;border:1.5px solid rgba(255,255,255,0.5);background:transparent;color:#fff;cursor:pointer">Full review</button>'
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
function openHabitsEditModal(){
  const overlay=document.getElementById('habits-edit-overlay');
  if(overlay){ renderHabitsEditModal(); overlay.classList.remove('hidden'); return; }
  const div=document.createElement('div');
  div.id='habits-edit-overlay';
  div.className='modal-overlay'; // standard modal → gets the keyboard-lift + solid sheet
  div.onclick=function(e){ if(e.target===div) closeHabitsEditModal(); };
  div.innerHTML='<div id="habits-edit-sheet" class="modal-box"></div>';
  document.body.appendChild(div);
  renderHabitsEditModal();
}
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
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:'+(habitsData.length>1?'8px':'16px')+'">'
    +'<span style="font-size:16px;font-weight:700;color:var(--text)">Edit daily habits</span>'
    +'<button onclick="closeHabitsEditModal()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:6px 16px;font-size:13px;font-weight:600;cursor:pointer">Done</button>'
    +'</div>'
    +(habitsData.length>1?'<div style="font-size:12px;color:var(--muted);margin-bottom:12px">Drag the ⠿ handle to reorder · tap ✕ to remove</div>':'')
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
function closeHabitsEditModal(){
  const ov=document.getElementById('habits-edit-overlay');
  if(ov) ov.classList.add('hidden');
}
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
  const hour=+new Date().toLocaleString('en-AU',{timeZone:'Australia/Sydney',hour:'2-digit',hour12:false}).split(':')[0];
  const nm=(profileData.name||S.personalInfo?.name||'').trim();
  const timeGreet=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  return nm?timeGreet+', '+nm:timeGreet;
}
// ── Credit card tracker (Home card + Budget input) ───────────────
function loadCCData(){ try{ return JSON.parse(localStorage.getItem('daily_cc')||'{}'); }catch{ return {}; } }
function saveCCData(d){ localStorage.setItem('daily_cc', JSON.stringify(d)); syncBlobPush('creditCard','daily_cc'); }
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
  renderNetPosition();
}
function loadCCInput(){ renderCCRow(); }

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

  // Hero card content
  let heroContent;
  if(goalCals){
    const pct=Math.min(100,Math.round(kcalTotal/goalCals*100));
    const rem=goalCals-kcalTotal;
    const ringCol=rem<0?'var(--danger)':pct>80?'var(--warn)':'var(--success)';
    const R=44,circ=+(2*Math.PI*R).toFixed(1),offset=+(circ*(1-pct/100)).toFixed(1);
    heroContent=
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
      '</div>';
  } else if(budLeft!==null){
    const col=budLeft>=0?'var(--success)':'var(--danger)';
    heroContent=
      '<div style="text-align:center;padding:14px 0">'+
        '<div style="font-size:30px;font-weight:700;letter-spacing:-1px;color:'+col+';line-height:1;margin-bottom:6px">'+(budLeft>=0?'+$':'-$')+Math.abs(budLeft).toFixed(0)+'</div>'+
        '<div style="font-size:13px;color:var(--muted);margin-bottom:10px">This week\'s leftover</div>'+
        '<span class="status-pill '+budPillCls+'">'+budPillTxt+'</span>'+
      '</div>';
  } else {
    heroContent='<div style="text-align:center;padding:14px 0;font-size:13px;color:var(--muted)">Set up your profile to see calorie targets</div>';
  }

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

  // Pay day countdowns
  function daysUntil(targetDay){
    const nowDay=new Date(today+'T12:00:00').getDay(); // 0=Sun
    let diff=(targetDay-nowDay+7)%7;
    return diff===0?'Today! 🎉':'in '+diff+' day'+(diff===1?'':'s');
  }
  const fujiDay=budDefaults.fujifilmPayDay??4;
  const mcdsDay=budDefaults.mcdonaldsPayDay??2;
  const fujiStr=daysUntil(fujiDay);
  const mcdsStr=daysUntil(mcdsDay);

  // Last week's total pay (sum of income sources recorded for the previous budget week)
  const lastWk=budgetData[weekKey(getMondayOf(-1))];
  const lastWeekPay=lastWk?weekIncome(lastWk):0;

  // Savings balance card inner
  const last8=savingsLog.slice(-8);
  let savInner;
  if(last8.length){
    const latest=last8[last8.length-1];
    const diffDays=Math.floor((new Date()-new Date(latest.date))/(864e5));
    const ago=diffDays===0?'today':diffDays===1?'yesterday':diffDays+' days ago';
    const vals=last8.map(e=>e.balance);
    const maxV=Math.max(...vals),minV=Math.min(...vals),range=maxV-minV||maxV||1;
    const bars=last8.map((e,i)=>{
      const prev=i>0?last8[i-1].balance:e.balance;
      const col=e.balance<prev?'var(--danger)':'var(--success)'; // green when up/flat, red when down
      const h=Math.max(8,Math.round(((e.balance-minV)/range)*36+8));
      return '<div style="flex:1;display:flex;align-items:flex-end;padding:0 1px"><div style="width:100%;height:'+h+'px;background:'+col+';border-radius:2px 2px 0 0;opacity:0.85"></div></div>';
    }).join('');
    savInner=
      '<div style="display:flex;justify-content:space-between;align-items:flex-end">'+
        '<div>'+
          '<div style="font-size:22px;font-weight:800">$'+latest.balance.toLocaleString()+'</div>'+
          '<div style="font-size:11px;color:var(--muted)">Updated '+ago+'</div>'+
        '</div>'+
        '<button class="sav-update-btn" onclick="event.stopPropagation();updateSavingsBalance()">Update</button>'+
      '</div>'+
      '<div style="display:flex;align-items:flex-end;height:40px;gap:2px;margin-top:8px">'+bars+'</div>';
  } else {
    savInner=
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-size:22px;font-weight:800;color:var(--muted)">$—</div>'+
        '<button class="sav-update-btn" onclick="event.stopPropagation();updateSavingsBalance()">Update</button>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:4px">No balance logged</div>';
  }

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
      '<div class="card" onclick="setView(\'budget\')" style="margin-bottom:0;padding:14px;text-align:center;cursor:pointer">'+
        '<div style="font-size:22px;margin-bottom:2px">📅</div>'+
        '<div style="font-size:14px;font-weight:700;line-height:1.2;color:'+(fujiStr==='Today! 🎉'?'var(--accent)':'var(--text)')+'">'+fujiStr+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Fujifilm pay</div>'+
      '</div>'+
      '<div class="card" onclick="setView(\'budget\')" style="margin-bottom:0;padding:14px;text-align:center;cursor:pointer">'+
        '<div style="font-size:22px;margin-bottom:2px">📅</div>'+
        '<div style="font-size:14px;font-weight:700;line-height:1.2;color:'+(mcdsStr==='Today! 🎉'?'var(--accent)':'var(--text)')+'">'+mcdsStr+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Maccas pay</div>'+
      '</div>'+
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
    tiles: quickTiles
  };
  homeCards.notes=buildHomeNotesBubble(); // permanent card: shows pinned notes, or a prompt when none
  wrap.innerHTML = homeOrderedKeys(homeCards)
    .map(k=>'<div class="home-card" data-card-id="'+k+'">'+homeCards[k]+'</div>').join('');
  if(homeEditMode) applyHomeEditMode();

  renderHomeStats();
  renderCCCard();
  applyDayColour(); // re-tint the freshly rendered hero to today's muscle group
}

// ── Home card reorder (iPhone-style edit mode) ────────────────────
const HOME_DEFAULT_ORDER=['session','streak','calories','review','notes','habits','budget','balance','tiles'];
function loadHomeOrder(){ try{ const a=JSON.parse(localStorage.getItem('daily_home_order')); if(Array.isArray(a)) return a; }catch(e){} return null; }
function saveHomeOrderArr(arr){ localStorage.setItem('daily_home_order', JSON.stringify(arr)); try{ if(typeof syncBlobPush==='function') syncBlobPush('homeOrder','daily_home_order'); }catch(e){} }
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

// ── Home stats integration (Stats folded into Home) ───────────────
// Relocate the standalone #view-stats DOM into the collapsible Home card once,
// so all existing stats render functions keep targeting their original ids.
function mountStatsIntoHome(){
  if(S.view==='stats') return; // don't reclaim the node while the standalone Stats view is open
  const stats=document.getElementById('view-stats');
  const body=document.getElementById('home-stats-body');
  if(!stats||!body) return;
  if(stats.parentElement===body) return; // already mounted
  const topbar=stats.querySelector('.desktop-topbar');
  if(topbar) topbar.classList.add('hidden'); // the Home card header already says "Stats"
  stats.classList.remove('hidden');
  body.appendChild(stats);
}
// Desktop: move #view-stats back out to be a standalone top-level section (it gets
// folded into the Home card by mountStatsIntoHome). Lets the sidebar Stats item show it.
function unmountStatsToMain(){
  const stats=document.getElementById('view-stats');
  const main=document.getElementById('app-main');
  if(!stats||!main) return;
  const topbar=stats.querySelector('.desktop-topbar');
  if(topbar) topbar.classList.remove('hidden'); // restore the standalone "Stats" title
  if(stats.parentElement!==main) main.appendChild(stats);
  stats.classList.remove('hidden');
}
let homeStatsOpen=false;
function toggleHomeStats(){
  const body=document.getElementById('home-stats-body');
  const chev=document.getElementById('home-stats-chevron');
  if(!body) return;
  homeStatsOpen=!homeStatsOpen;
  body.classList.toggle('hidden',!homeStatsOpen);
  if(chev) chev.style.transform=homeStatsOpen?'':'rotate(-90deg)';
  if(homeStatsOpen) setStatsTab(statsSubTab); // render the active sub-tab
}
function renderHomeStats(){
  mountStatsIntoHome();
  // Card 1 — Recent workout (last saved session), tap to expand exercises
  const recent=document.getElementById('home-recent-card');
  if(recent){
    if(!S.sessions.length){
      recent.innerHTML='';
    } else {
      const s=S.sessions[S.sessions.length-1];
      const tc=TYPES.find(t=>t.name===s.sessionType)||TYPES[0];
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
  // (8-week consistency chart removed from Home — it lives on the Stats tab instead.)
  // Collapsible Stats card re-renders its active sub-tab if currently open
  if(homeStatsOpen) setStatsTab(statsSubTab);
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
  saveSavingsLog();      // persists locally + (safely) syncs to cloud
  closeSavingsModal();   // close before re-render so a render error can't keep it open
  try{ renderHome(); }catch(err){ console.error('renderHome after savings save failed', err); }
}

// Keep bottom-sheet modals above the iOS keyboard. Every .modal-overlay aligns its
// .modal-box to the bottom (flex-end) — exactly where the keyboard opens — so the Save
// button can end up hidden. When visualViewport shrinks, lift the visible modal's box by
// the keyboard height. One delegated handler covers savings, swap, kitchen form, etc.
(function(){
  if(!window.visualViewport) return;
  function adjustModalsForKeyboard(){
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
  window.visualViewport.addEventListener('resize', adjustModalsForKeyboard);
  window.visualViewport.addEventListener('scroll', adjustModalsForKeyboard);
})();

// iOS standalone PWA (#app is position:fixed) doesn't reliably scroll a focused field above the
// keyboard, so inline save/log buttons (e.g. the Savings account card's Log) can sit hidden behind
// it. When a non-modal input is focused and ends up under the keyboard, centre it in the viewport.
document.addEventListener('focusin', function(e){
  const el=e.target;
  if(!el||(el.tagName!=='INPUT'&&el.tagName!=='TEXTAREA')) return;
  if(el.closest('.modal-box')) return; // modals are handled by the keyboard-lift above
  setTimeout(()=>{
    try{
      const vh=window.visualViewport?window.visualViewport.height:window.innerHeight;
      const r=el.getBoundingClientRect();
      if(r.bottom>vh-24) el.scrollIntoView({block:'center',behavior:'smooth'});
    }catch(_){}
  }, 350);
});

// ── Onboarding ────────────────────────────────────────────────────
let obData={};
let obStep=1;

function checkOnboarding(){
  if(!(profileData.name||'').trim()) showOnboarding();
}
function showOnboarding(){
  obStep=1; obData={};
  renderObStep();
  document.getElementById('onboarding-overlay').classList.remove('hidden');
}
function renderObStep(){
  const box=document.getElementById('onboarding-box');
  if(!box) return;
  const dots=
    '<div class="ob-dots">'+
    '<div class="ob-dot'+(obStep===1?' active':'')+'"></div>'+
    '<div class="ob-dot'+(obStep===2?' active':'')+'"></div>'+
    '<div class="ob-dot'+(obStep===3?' active':'')+'"></div>'+
    '</div>';
  if(obStep===1){
    box.innerHTML=dots+
      '<div style="text-align:center;padding-top:8px">'+
        '<div style="font-size:56px;font-weight:800;letter-spacing:-2px;line-height:1;margin-bottom:14px">Daily</div>'+
        '<div style="font-size:16px;color:var(--muted);line-height:1.6;margin-bottom:52px">Your personal tracker for<br>workouts, calories, and budget.</div>'+
        '<button onclick="nextObStep()" style="width:100%;padding:16px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:16px;font-weight:700;cursor:pointer">Get started →</button>'+
      '</div>';
  } else if(obStep===2){
    box.innerHTML=dots+
      '<div style="margin-bottom:22px">'+
        '<div style="font-size:24px;font-weight:800;margin-bottom:4px">Tell us about you</div>'+
        '<div style="font-size:14px;color:var(--muted)">You can update these anytime in Settings.</div>'+
      '</div>'+
      '<div class="settings-field">'+
        '<label>Your name <span style="color:var(--danger)">*</span></label>'+
        '<input type="text" id="ob-name" placeholder="e.g. Alex" autocomplete="name">'+
      '</div>'+
      '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin:18px 0 10px">Income sources</div>'+
      '<div class="settings-2col">'+
        '<div class="settings-field"><label>Job 1 label</label><input type="text" id="ob-inc1-label" placeholder="e.g. Main job"></div>'+
        '<div class="settings-field"><label>Weekly ($)</label><input type="number" id="ob-inc1-amount" placeholder="0" inputmode="decimal"></div>'+
      '</div>'+
      '<div class="settings-2col">'+
        '<div class="settings-field"><label>Job 2 label</label><input type="text" id="ob-inc2-label" placeholder="e.g. Side job"></div>'+
        '<div class="settings-field"><label>Weekly ($)</label><input type="number" id="ob-inc2-amount" placeholder="0" inputmode="decimal"></div>'+
      '</div>'+
      '<div class="settings-field"><label>Other income (optional)</label><input type="text" id="ob-inc3-label" placeholder="e.g. Freelance"></div>'+
      '<div class="settings-field" style="margin-top:6px">'+
        '<label>Weekly savings target ($)</label>'+
        '<input type="number" id="ob-savings" placeholder="e.g. 200" inputmode="decimal">'+
      '</div>'+
      '<div id="ob-error" style="display:none;color:var(--danger);font-size:13px;margin-bottom:8px;margin-top:-4px">Please enter your name to continue.</div>'+
      '<button onclick="nextObStep()" style="width:100%;padding:16px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:16px;font-weight:700;cursor:pointer;margin-top:10px">Continue →</button>';
  } else {
    box.innerHTML=dots+
      '<div style="text-align:center;padding-top:8px">'+
        '<div style="font-size:52px;margin-bottom:18px">🎉</div>'+
        '<div style="font-size:26px;font-weight:800;margin-bottom:10px">You\'re all set, '+obData.name+'!</div>'+
        '<div style="font-size:15px;color:var(--muted);line-height:1.6;margin-bottom:52px">Your tracker is ready.<br>Update your details anytime in Settings.</div>'+
        '<button onclick="finishOnboarding()" style="width:100%;padding:16px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:16px;font-weight:700;cursor:pointer">Go to app →</button>'+
      '</div>';
  }
}
function nextObStep(){
  if(obStep===1){
    obStep=2; renderObStep();
    setTimeout(()=>{ const el=document.getElementById('ob-name'); if(el) el.focus(); },50);
  } else if(obStep===2){
    const name=(document.getElementById('ob-name')?.value||'').trim();
    if(!name){ const e=document.getElementById('ob-error'); if(e) e.style.display='block'; return; }
    obData={
      name,
      inc1Label:(document.getElementById('ob-inc1-label')?.value||'').trim(),
      inc1Amount:parseFloat(document.getElementById('ob-inc1-amount')?.value)||undefined,
      inc2Label:(document.getElementById('ob-inc2-label')?.value||'').trim(),
      inc2Amount:parseFloat(document.getElementById('ob-inc2-amount')?.value)||undefined,
      inc3Label:(document.getElementById('ob-inc3-label')?.value||'').trim(),
      savings:parseFloat(document.getElementById('ob-savings')?.value)||undefined
    };
    obStep=3; renderObStep();
  }
}
function finishOnboarding(){
  profileData.name=obData.name;
  localStorage.setItem('daily_profile',JSON.stringify(profileData));
  syncProfileToFirebase();
  if(obData.inc1Label) budDefaults.inc1_label=obData.inc1Label;
  if(obData.inc1Amount!==undefined) budDefaults.inc1_amount=obData.inc1Amount;
  if(obData.inc2Label) budDefaults.inc2_label=obData.inc2Label;
  if(obData.inc2Amount!==undefined) budDefaults.inc2_amount=obData.inc2Amount;
  if(obData.inc3Label) budDefaults.inc3_label=obData.inc3Label;
  if(obData.savings!==undefined) budDefaults.weeklySavings=obData.savings;
  localStorage.setItem('daily_budget_defaults',JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();
  // Seed income streams from onboarding entries
  const obStreams=[];
  if(obData.inc1Label||obData.inc1Amount!==undefined) obStreams.push({id:'1',name:obData.inc1Label||'Income 1',weeklyAmount:obData.inc1Amount||0});
  if(obData.inc2Label||obData.inc2Amount!==undefined) obStreams.push({id:'2',name:obData.inc2Label||'Income 2',weeklyAmount:obData.inc2Amount||0});
  if(obData.inc3Label) obStreams.push({id:'3',name:obData.inc3Label,weeklyAmount:0});
  if(obStreams.length){ incomeStreams=obStreams; saveIncomeStreams(); }
  document.getElementById('onboarding-overlay').classList.add('hidden');
  renderHome();
}
function resetOnboarding(){
  profileData.name='';
  localStorage.setItem('daily_profile',JSON.stringify(profileData));
  showOnboarding();
}

// ── Reminders ────────────────────────────────────────────────────
function loadReminders(){
  try{ return JSON.parse(localStorage.getItem('daily_reminders'))||{}; }catch{ return {}; }
}
function saveReminders(r){ localStorage.setItem('daily_reminders',JSON.stringify(r)); }
function checkReminders(){
  if(!('Notification' in window)) return;
  const r=loadReminders();
  const today=getLocalDate();
  const nowSyd=new Date().toLocaleString('en-AU',{timeZone:'Australia/Sydney',hour:'2-digit',minute:'2-digit',hour12:false});
  const [nowH,nowM]=nowSyd.split(':').map(Number);
  const nowMins=nowH*60+nowM;

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
  const wrap=document.getElementById('settings-reminders-section'); if(!wrap) return;
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
function kitSaveRecipes(){ localStorage.setItem('kitchen_recipes',JSON.stringify(kitRecipes)); try{ if(typeof syncBlobPush==='function') syncBlobPush('kitRecipes','kitchen_recipes'); }catch(e){} }
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

// ── Plans (importable routines with per-day streak tracking) ──────
let _plansDetailId=null;
let _planChecked=new Set();
let _planImportConfirmId=null;
function plansLoad(){ try{ const a=JSON.parse(localStorage.getItem('wt_plans')); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function plansSave(plans){ localStorage.setItem('wt_plans', JSON.stringify(plans)); try{ if(typeof syncBlobPush==='function') syncBlobPush('wtPlans','wt_plans'); }catch(e){} }
function _planExKey(ex,i){ return (ex&&ex.id)?String(ex.id):('idx'+i); }
function _planRel(iso){
  if(!iso) return '';
  const today=new Date().toISOString().slice(0,10);
  if(iso===today) return 'today';
  const d=new Date(); d.setDate(d.getDate()-1);
  if(iso===d.toISOString().slice(0,10)) return 'yesterday';
  return 'on '+iso;
}
function openPlansView(){ _plansDetailId=null; _planChecked=new Set(); const v=document.getElementById('view-plans'); if(!v) return; v.style.display='block'; renderPlansView(); if(typeof closeMenu==='function') closeMenu(); }
function closePlansView(){ const v=document.getElementById('view-plans'); if(v) v.style.display='none'; _plansDetailId=null; }
function plansGoHome(){ closePlansView(); if(typeof setView==='function') setView('home'); }
const _PLANS_HOME_BTN='<button class="plans-home" onclick="plansGoHome()" aria-label="Home"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg><span>Home</span></button>';
function openPlanDetail(id){ _plansDetailId=id; _planChecked=new Set(); renderPlansView(); }
function backToPlans(){ _plansDetailId=null; renderPlansView(); }
function renderPlansView(){
  const el=document.getElementById('plans-content'); if(!el) return;
  if(_plansDetailId){ const h=_plansDetailHTML(_plansDetailId); if(h){ el.innerHTML=h; return; } _plansDetailId=null; }
  const plans=plansLoad();
  let body;
  if(!plans.length){
    body='<div class="plans-empty"><div class="plans-empty-title">No plans yet</div>'+
      '<div class="plans-empty-sub">Import a plan to get started.</div>'+
      '<button class="plan-import-btn" onclick="openPlanImport()">Import Plan</button></div>';
  } else {
    body=plans.map(p=>{
      const last=p.lastCompleted?('Last completed '+_planRel(p.lastCompleted)):'Not completed yet';
      return '<button class="plan-card" data-action="open-plan" data-id="'+_catEsc(p.id)+'">'+
        '<div class="plan-card-top"><span class="plan-card-name">'+_catEscHtml(p.name||p.id)+'</span>'+
          '<span class="plan-streak">🔥 '+(p.streak||0)+'</span></div>'+
        (p.description?'<div class="plan-card-desc">'+_catEscHtml(p.description)+'</div>':'')+
        '<div class="plan-card-last">'+last+'</div>'+
      '</button>';
    }).join('')+'<button class="plan-import-btn" style="margin-top:14px" onclick="openPlanImport()">Import Plan</button>';
  }
  el.innerHTML='<div class="plans-head">'+_PLANS_HOME_BTN+'<span class="plans-title">Plans</span>'+
    '<button class="plans-x" onclick="closePlansView()" aria-label="Close">×</button></div>'+
    '<div class="plans-body">'+body+'</div>';
}
function _plansDetailHTML(id){
  const p=plansLoad().find(x=>x.id===id); if(!p) return '';
  const exs=Array.isArray(p.exercises)?p.exercises:[];
  const order=[]; const map={};
  exs.forEach((ex,i)=>{ const s=(ex&&ex.section)||'Exercises'; if(!map[s]){ map[s]=[]; order.push(s); } map[s].push({ex,i}); });
  const total=exs.length;
  const done=exs.filter((ex,i)=>_planChecked.has(_planExKey(ex,i))).length;
  const pct=total?Math.round(done/total*100):0;
  const allDone=total>0&&done===total;
  let rows='';
  order.forEach(s=>{
    rows+='<div class="plan-sec-head">'+_catEscHtml(s)+'</div>';
    map[s].forEach(({ex,i})=>{
      const key=_planExKey(ex,i); const ck=_planChecked.has(key);
      rows+='<button class="plan-ex-row'+(ck?' done':'')+'" data-action="plan-toggle-ex" data-key="'+_catEsc(key)+'">'+
        '<span class="plan-ex-check">'+(ck?'✓':'')+'</span>'+
        '<span class="plan-ex-main"><span class="plan-ex-name">'+_catEscHtml((ex&&ex.name)||'')+'</span>'+
          (ex&&ex.detail?'<span class="plan-ex-detail">'+_catEscHtml(ex.detail)+'</span>':'')+
          (ex&&ex.cue?'<span class="plan-ex-cue">'+_catEscHtml(ex.cue)+'</span>':'')+
        '</span></button>';
    });
  });
  const last=p.lastCompleted?('Last completed '+_planRel(p.lastCompleted)):'Not completed yet';
  return '<div class="plans-head">'+
      '<div style="display:flex;align-items:center;gap:12px;min-width:0">'+_PLANS_HOME_BTN+'<button class="plans-back" onclick="backToPlans()">‹ Plans</button></div>'+
      '<button class="plan-export-btn" onclick="openPlanExport(\''+_catEsc(p.id)+'\')">Share / Export</button></div>'+
    '<div class="plans-body">'+
      '<div class="plan-detail-top"><span class="plan-detail-name">'+_catEscHtml(p.name||p.id)+'</span><span class="plan-streak">🔥 '+(p.streak||0)+'</span></div>'+
      (p.description?'<div class="plan-card-desc" style="margin-bottom:6px">'+_catEscHtml(p.description)+'</div>':'')+
      '<div class="plan-card-last" style="margin-bottom:14px">'+last+'</div>'+
      rows+
      '<div class="plan-progress-track"><div class="plan-progress-fill" style="width:'+pct+'%"></div></div>'+
      '<div class="plan-progress-label">'+done+' / '+total+' done</div>'+
      '<button class="plan-done-btn" onclick="planMarkToday()"'+(allDone?'':' disabled')+'>Mark today done</button>'+
    '</div>';
}
function planMarkToday(){
  const plans=plansLoad(); const p=plans.find(x=>x.id===_plansDetailId); if(!p) return;
  const exs=Array.isArray(p.exercises)?p.exercises:[];
  if(!exs.length||exs.some((ex,i)=>!_planChecked.has(_planExKey(ex,i)))) return; // all must be checked
  const today=new Date().toISOString().slice(0,10);
  if(p.lastCompleted===today){ kitShowToast('Already logged today'); return; }
  const d=new Date(); d.setDate(d.getDate()-1); const yest=d.toISOString().slice(0,10);
  p.streak=(p.lastCompleted===yest)?((p.streak||0)+1):1;
  p.lastCompleted=today;
  if(!Array.isArray(p.history)) p.history=[];
  if(p.history.indexOf(today)<0) p.history.push(today);
  plansSave(plans);
  kitShowToast('Marked done · 🔥 '+p.streak);
  renderPlansView();
}
function openPlanImport(){ _planImportConfirmId=null; const ta=document.getElementById('plan-import-text'); if(ta) ta.value=''; const err=document.getElementById('plan-import-err'); if(err) err.textContent=''; const m=document.getElementById('plan-import-modal'); if(m) m.classList.remove('hidden'); }
function closePlanImport(){ const m=document.getElementById('plan-import-modal'); if(m) m.classList.add('hidden'); }
function confirmPlanImport(){
  const ta=document.getElementById('plan-import-text'); const err=document.getElementById('plan-import-err');
  let obj; try{ obj=JSON.parse(ta?ta.value:''); }catch(e){ _planImportConfirmId=null; if(err) err.textContent='Invalid plan JSON'; return; }
  if(!obj||typeof obj!=='object'||!obj.id||!obj.name||!Array.isArray(obj.exercises)){ _planImportConfirmId=null; if(err) err.textContent='Invalid plan JSON'; return; }
  const plan={ id:String(obj.id), name:String(obj.name), description:obj.description?String(obj.description):'', exercises:obj.exercises, streak:obj.streak||0, lastCompleted:obj.lastCompleted||null, history:Array.isArray(obj.history)?obj.history:[] };
  const plans=plansLoad();
  const idx=plans.findIndex(p=>p.id===plan.id);
  if(idx>=0 && _planImportConfirmId!==plan.id){ // iOS-safe replace confirm: tap Import again
    _planImportConfirmId=plan.id;
    if(err) err.textContent='A plan "'+plan.name+'" already exists — tap Import again to replace it.';
    return;
  }
  if(idx>=0) plans[idx]=plan; else plans.push(plan);
  _planImportConfirmId=null;
  plansSave(plans); closePlanImport(); renderPlansView();
}
function openPlanExport(id){
  const p=plansLoad().find(x=>x.id===id); if(!p) return;
  const clean={ id:p.id, name:p.name, description:p.description||'', exercises:p.exercises }; // strip streak/history/lastCompleted
  const ta=document.getElementById('plan-export-text'); if(ta) ta.value=JSON.stringify(clean,null,2);
  const m=document.getElementById('plan-export-modal'); if(m) m.classList.remove('hidden');
}
function closePlanExport(){ const m=document.getElementById('plan-export-modal'); if(m) m.classList.add('hidden'); }
function copyPlanExport(){ const ta=document.getElementById('plan-export-text'); if(!ta) return; try{ ta.select(); document.execCommand('copy'); kitShowToast('Copied'); }catch(e){ try{ navigator.clipboard.writeText(ta.value).then(()=>kitShowToast('Copied')); }catch(e2){} } }
// One delegated listener for all plan actions (iOS-reliable + avoids interpolating ids into onclick)
document.addEventListener('click',function(e){
  if(e.target.closest('[data-action="open-plans"]')){ openPlansView(); return; }
  const tog=e.target.closest('[data-action="plan-toggle-ex"]');
  if(tog){ const k=tog.dataset.key; if(_planChecked.has(k)) _planChecked.delete(k); else _planChecked.add(k); renderPlansView(); return; }
  const op=e.target.closest('[data-action="open-plan"]');
  if(op){ openPlanDetail(op.dataset.id); return; }
  const exp=e.target.closest('[data-action="plan-export"]');
  if(exp){ openPlanExport(exp.dataset.id); return; }
});

// ── Notes (hamburger overlay + reorderable home bubble + Firebase sync) ──
let _noteEditId=null;
let _noteEditType='reminder';
let _noteEditPinned=false;
function notesLoad(){ try{ const a=JSON.parse(localStorage.getItem('wt_notes')); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function notesSave(notes){ localStorage.setItem('wt_notes', JSON.stringify(notes)); try{ if(typeof syncBlobPush==='function') syncBlobPush('wtNotes','wt_notes'); }catch(e){} renderHomeNotesBubble(); }
function _noteDaysUntil(iso){ if(!iso) return null; const t=new Date(); t.setHours(0,0,0,0); const d=new Date(iso+'T00:00:00'); if(isNaN(d)) return null; return Math.round((d-t)/86400000); }
function _noteDateLabel(n){ if(!n||!n.date) return ''; const d=new Date(n.date+'T00:00:00'); if(isNaN(d)) return ''; const f=d.toLocaleDateString('en-AU',{day:'numeric',month:'short'}); return (n.dateType==='expiry'?'Due ':'Reminder ')+f; }
function _noteFirstLine(b){ return b?String(b).split('\n')[0].trim():''; }
function openNotesView(){ const v=document.getElementById('view-notes'); if(!v) return; v.style.display='block'; renderNotesTab(); if(typeof closeMenu==='function') closeMenu(); }
function closeNotesView(){ const v=document.getElementById('view-notes'); if(v) v.style.display='none'; }
function notesSortedAll(){
  const notes=notesLoad();
  const dated=notes.filter(n=>n.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));       // soonest first
  const undated=notes.filter(n=>!n.date).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))); // newest first
  return [...dated,...undated];
}
function renderNotesTab(){
  const el=document.getElementById('notes-content'); if(!el) return;
  const notes=notesSortedAll();
  let body;
  if(!notes.length){
    body='<div class="notes-empty"><div class="notes-empty-title">No notes yet</div><div class="notes-empty-sub">Jot down expiries, reminders or anything else.</div><button class="note-add-btn" onclick="openNoteEdit()">+ New note</button></div>';
  } else {
    body=notes.map(n=>{
      const du=_noteDaysUntil(n.date);
      const soon=(du!==null&&du>=0&&du<=7);
      const dateHtml=n.date?'<span class="note-date'+(soon?' soon':'')+'">'+_catEscHtml(_noteDateLabel(n))+'</span>':'';
      const first=_noteFirstLine(n.body);
      return '<button class="note-card" data-action="open-note" data-id="'+_catEsc(n.id)+'">'+
        '<div class="note-card-top"><span class="note-card-title">'+_catEscHtml(n.title||'(untitled)')+'</span>'+dateHtml+'</div>'+
        (first?'<div class="note-card-body">'+_catEscHtml(first)+'</div>':'')+
      '</button>';
    }).join('');
  }
  el.innerHTML='<div class="plans-head">'+
    '<button class="plans-x" onclick="closeNotesView()" aria-label="Close">×</button>'+
    '<span class="plans-title">Notes</span>'+
    '<button class="note-new-btn" onclick="openNoteEdit()" aria-label="New note">+</button></div>'+
    '<div class="plans-body">'+body+'</div>';
}
function openNoteEdit(id){
  _noteEditId=id||null;
  const n=id?notesLoad().find(x=>x.id===id):null;
  const g=i=>document.getElementById(i);
  if(g('note-edit-title-input')) g('note-edit-title-input').value=n?(n.title||''):'';
  if(g('note-edit-body-input')) g('note-edit-body-input').value=n?(n.body||''):'';
  if(g('note-edit-date-input')) g('note-edit-date-input').value=(n&&n.date)?n.date:'';
  _noteEditType=(n&&n.dateType)?n.dateType:'reminder';
  _noteEditPinned=!!(n&&n.pinned);
  if(g('note-edit-err')) g('note-edit-err').textContent='';
  const del=g('note-edit-delete'); if(del){ del.style.display=n?'':'none'; del.dataset.armed='0'; del.textContent='Delete'; }
  if(g('note-edit-modal-title')) g('note-edit-modal-title').textContent=n?'Edit note':'New note';
  updateNoteTypeRow();
  updateNotePinToggle();
  if(g('note-edit-modal')) g('note-edit-modal').classList.remove('hidden');
  if(!n) setTimeout(()=>{ const t=g('note-edit-title-input'); if(t) t.focus(); }, 60);
}
function closeNoteEdit(){ const m=document.getElementById('note-edit-modal'); if(m) m.classList.add('hidden'); }
function onNoteDateChange(){ const dv=(document.getElementById('note-edit-date-input')||{}).value||''; if(dv&&!_noteEditType) _noteEditType='reminder'; updateNoteTypeRow(); }
function setNoteType(t){ _noteEditType=t; updateNoteTypeRow(); }
function toggleNotePin(){ _noteEditPinned=!_noteEditPinned; updateNotePinToggle(); }
function updateNotePinToggle(){ const b=document.getElementById('note-pin-toggle'); if(b) b.classList.toggle('active',!!_noteEditPinned); }
function updateNoteTypeRow(){
  const dv=(document.getElementById('note-edit-date-input')||{}).value||'';
  const row=document.getElementById('note-type-row'); if(!row) return;
  row.style.display=dv?'flex':'none';
  const r=document.getElementById('note-type-reminder'), x=document.getElementById('note-type-expiry');
  if(r) r.classList.toggle('active',_noteEditType==='reminder');
  if(x) x.classList.toggle('active',_noteEditType==='expiry');
}
function saveNote(){
  const title=((document.getElementById('note-edit-title-input')||{}).value||'').trim();
  const err=document.getElementById('note-edit-err');
  if(!title){ if(err) err.textContent='Add a title'; return; }
  const body=(document.getElementById('note-edit-body-input')||{}).value||'';
  const date=((document.getElementById('note-edit-date-input')||{}).value||'')||null;
  const dateType=date?(_noteEditType||'reminder'):null;
  const now=new Date().toISOString();
  const notes=notesLoad();
  if(_noteEditId){
    const i=notes.findIndex(x=>x.id===_noteEditId);
    if(i>=0) notes[i]=Object.assign({},notes[i],{title,body,date,dateType,pinned:_noteEditPinned,updatedAt:now});
    else notes.push({id:_noteEditId,title,body,date,dateType,pinned:_noteEditPinned,createdAt:now,updatedAt:now});
  } else {
    notes.push({id:Date.now().toString(),title,body,date,dateType,pinned:_noteEditPinned,createdAt:now,updatedAt:now});
  }
  notesSave(notes);
  closeNoteEdit();
  renderNotesTab();
}
function deleteNote(){
  if(!_noteEditId){ closeNoteEdit(); return; }
  const btn=document.getElementById('note-edit-delete');
  if(btn&&btn.dataset.armed==='1'){ notesSave(notesLoad().filter(x=>x.id!==_noteEditId)); closeNoteEdit(); renderNotesTab(); return; }
  if(btn){ btn.dataset.armed='1'; btn.textContent='Tap again to delete'; setTimeout(()=>{ if(btn){ btn.dataset.armed='0'; btn.textContent='Delete'; } },3000); }
}
// Permanent reorderable home card showing the notes the user has pinned ("Show on home").
function buildHomeNotesBubble(){
  const notes=notesLoad();
  const pinned=notes.filter(n=>n&&n.pinned);
  const dated=pinned.filter(n=>n.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));     // soonest first
  const undated=pinned.filter(n=>!n.date).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  const list=[...dated,...undated];
  const top=list.slice(0,5), more=list.length-top.length;
  let inner;
  if(!list.length){
    inner='<div class="home-note-empty" data-action="open-notes">No notes pinned yet — tap to choose which notes show here.</div>';
  } else {
    inner=top.map(n=>{
      const du=_noteDaysUntil(n.date);
      const soon=(du!==null&&du>=0&&du<=7);
      const pill=n.date?'<span class="home-note-pill'+(soon?' soon':'')+'">'+_catEscHtml(_noteDateLabel(n))+'</span>':'';
      return '<button class="home-note-row" data-action="open-note" data-id="'+_catEsc(n.id)+'"><span class="home-note-title">'+_catEscHtml(n.title||'(untitled)')+'</span>'+pill+'</button>';
    }).join('')+(more>0?'<button class="home-note-more" data-action="open-notes">+ '+more+' more</button>':'');
  }
  return '<div class="card home-notes-card">'+
    '<div class="home-notes-head"><span class="sec-label" style="margin:0">📝 Notes</span><button class="home-notes-open" data-action="open-notes">Open ›</button></div>'+
    inner+
  '</div>';
}
function renderHomeNotesBubble(){ if(S.view==='home'&&typeof renderHome==='function') renderHome(); }
document.addEventListener('click',function(e){
  if(e.target.closest('[data-action="open-notes"]')){ openNotesView(); return; }
  const on=e.target.closest('[data-action="open-note"]');
  if(on){ openNoteEdit(on.dataset.id); return; }
});
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

function kitShopLoadSelected(){ try{ const a=JSON.parse(localStorage.getItem('kitchen_shopping_selected')||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function kitShopSaveSelected(){ localStorage.setItem('kitchen_shopping_selected',JSON.stringify(kitShopSelected)); try{ if(typeof syncBlobPush==='function') syncBlobPush('kitShopSelected','kitchen_shopping_selected'); }catch(e){} }
function kitShopLoadChecked(){ try{ return JSON.parse(localStorage.getItem('kitchen_shopping_checked')||'{}')||{}; }catch(e){ return {}; } }
function kitShopSaveChecked(){ localStorage.setItem('kitchen_shopping_checked',JSON.stringify(kitShopChecked)); try{ if(typeof syncBlobPush==='function') syncBlobPush('kitShopChecked','kitchen_shopping_checked'); }catch(e){} }
function kitShopLoadManual(){ try{ const a=JSON.parse(localStorage.getItem('kitchen_shopping_manual')||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function kitShopSaveManual(){ localStorage.setItem('kitchen_shopping_manual',JSON.stringify(kitShopManual)); try{ if(typeof syncBlobPush==='function') syncBlobPush('kitShopManual','kitchen_shopping_manual'); }catch(e){} }
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
function kitPantrySave(){ localStorage.setItem('kitchen_pantry',JSON.stringify(kitPantryData)); try{ if(typeof syncBlobPush==='function') syncBlobPush('kitPantry','kitchen_pantry'); }catch(e){} }
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
  applyTheme();
  applyLogoDayColour();
  buildSideMenu();
  applyAccent(getAccent());
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
  navigator.serviceWorker.register('/workout-tracker/service-worker.js', { updateViaCache: 'none' });
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
