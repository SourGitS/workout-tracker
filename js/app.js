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

if(firebaseReady){
  try{
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db   = firebase.database();
    auth.getRedirectResult().catch(()=>{});
    auth.onAuthStateChanged(user=>{
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
        if(S.view==='settings') renderSettingsBudgetCustom();
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
    db.ref('users/'+user.uid+'/budgetData').on('value', snap=>{
      const data=snap.val();
      if(data){
        budgetData=data;
        localStorage.setItem('daily_budget',JSON.stringify(budgetData));
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
          if(S.view==='settings') renderSettingsBudgetCustom();
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

  } else {
    if(dbRef){ dbRef.off(); dbRef=null; }
    if(weightDbRef){ weightDbRef.off(); weightDbRef=null; }
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
  return localStorage.getItem('wt_theme')||'light';
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
function saveSavingsLog(){
  localStorage.setItem('daily_savings_log', JSON.stringify(savingsLog));
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
function saveSwaps(){ localStorage.setItem('wt_swaps', JSON.stringify(S.swaps)); }
function persistDailyLog(){ localStorage.setItem('wt_calories', JSON.stringify(S.dailyLog)); recordCalorieHistory(); }

// ── Helpers ──────────────────────────────────────────────────────
function type(i){ return TYPES[DAYS[i].typeIdx]; }
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
  document.documentElement.setAttribute('data-theme', S.theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = S.theme==='dark' ? '#080808' : '#ffffff';
}
function setTheme(t){
  S.theme = t;
  localStorage.setItem('wt_theme', t);
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
function sessionClockStr(){
  if(!S.sessionStart) return '';
  const secs=Math.floor((Date.now()-S.sessionStart)/1000);
  return 'Session: '+Math.floor(secs/60)+':'+String(secs%60).padStart(2,'0');
}
function rtRenderSessionClock(){
  const el=document.getElementById('rt-session-clock'); if(!el) return;
  if(!S.sessionStart){ el.style.display='none'; return; }
  el.style.display='block';
  el.textContent=sessionClockStr();
}

// ── Rest Timer ────────────────────────────────────────────────────
const RT_PRESETS=[60,90,120,180];
const RT={preset:90,remaining:90,running:false,interval:null,clockInterval:null,laps:[],started:false};

function openRestTimer(){
  const ov=document.getElementById('rt-overlay');
  ov.classList.remove('hidden');
  ov.classList.remove('timer-hidden'); // mobile: show the full-screen modal
  rtRenderPresets();
  rtRenderDisplay();
  rtRenderLaps();
  rtRenderSessionClock();
  if(!RT.clockInterval) RT.clockInterval=setInterval(rtRenderSessionClock,1000);
}
function closeRestTimer(){
  document.getElementById('rt-overlay').classList.add('hidden');
  clearInterval(RT.clockInterval); RT.clockInterval=null;
}

// Desktop: drag the rest timer panel by its header
(function(){
  const ov=document.getElementById('rt-overlay');
  const hdr=document.getElementById('rt-header');
  if(!ov||!hdr) return;
  let dragging=false,dx=0,dy=0;
  hdr.addEventListener('mousedown',e=>{
    if(window.innerWidth<1024) return;
    const r=ov.firstElementChild.getBoundingClientRect();
    dragging=true; dx=e.clientX-r.left; dy=e.clientY-r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!dragging) return;
    const w=ov.firstElementChild.offsetWidth, h=ov.firstElementChild.offsetHeight;
    const x=Math.min(Math.max(0,e.clientX-dx),window.innerWidth-w);
    const y=Math.min(Math.max(0,e.clientY-dy),window.innerHeight-h);
    ov.style.left=x+'px'; ov.style.top=y+'px';
    ov.style.right='auto'; ov.style.bottom='auto';
  });
  document.addEventListener('mouseup',()=>{ dragging=false; });
  // Proximity hit-test: the docked panel is click-through (pointer-events:none) when
  // idle so it doesn't block the Save button beneath it. Enable interaction only
  // while the cursor is actually over it. Global mousemove fires regardless of the
  // panel's pointer-events, sidestepping the :hover chicken-and-egg.
  document.addEventListener('mousemove',e=>{
    if(window.innerWidth<1024||ov.classList.contains('timer-hidden')) return;
    const panel=ov.firstElementChild; if(!panel) return;
    const r=panel.getBoundingClientRect();
    const inside=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
    ov.classList.toggle('timer-hover',inside);
  });
})();
function rtFmt(s){
  return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
}
function rtSetPreset(secs){
  RT.preset=secs;
  if(!RT.running){RT.remaining=secs;RT.started=false;}
  rtRenderPresets();
  rtRenderDisplay();
}
function rtCustom(){
  const v=prompt('Rest time in seconds:');
  if(v===null) return;
  const n=parseInt(v);
  if(isNaN(n)||n<1) return;
  rtSetPreset(n);
}
function rtRenderPresets(){
  const c=document.getElementById('rt-presets');
  if(!c) return;
  const isCustom=!RT_PRESETS.includes(RT.preset);
  const lbl={60:'1:00',90:'1:30',120:'2:00',180:'3:00'};
  c.innerHTML=RT_PRESETS.map(s=>{
    const a=RT.preset===s;
    return '<button onclick="rtSetPreset('+s+')" style="padding:9px 18px;border-radius:20px;border:2px solid '+(a?'var(--accent)':'var(--border)')+';background:'+(a?'var(--accent)':'transparent')+';color:'+(a?'#fff':'var(--text)')+';font-size:14px;font-weight:600;cursor:pointer">'+lbl[s]+'</button>';
  }).join('')+'<button onclick="rtCustom()" style="padding:9px 18px;border-radius:20px;border:2px solid '+(isCustom?'var(--accent)':'var(--border)')+';background:'+(isCustom?'var(--accent)':'transparent')+';color:'+(isCustom?'#fff':'var(--text)')+';font-size:14px;font-weight:600;cursor:pointer">'+(isCustom?rtFmt(RT.preset):'Custom')+'</button>';
}
function rtRenderDisplay(){
  const d=document.getElementById('rt-display');
  if(d) d.textContent=rtFmt(RT.remaining);
  const b=document.getElementById('rt-start-btn');
  if(b) b.textContent=RT.running?'Pause':'Start';
  // While running, the docked desktop panel stays click-interactive (so you can
  // pause/stop it); idle, it lets clicks pass through to the content beneath.
  const ov=document.getElementById('rt-overlay');
  if(ov) ov.classList.toggle('timer-running',!!RT.running);
}
function rtToggle(){
  if(RT.running){
    clearInterval(RT.interval);RT.interval=null;RT.running=false;
  } else {
    RT.running=true;RT.started=true;
    RT.interval=setInterval(()=>{
      RT.remaining=Math.max(0,RT.remaining-1);
      rtRenderDisplay();
      if(RT.remaining===0) rtFinish();
    },1000);
  }
  rtRenderDisplay();
}
function rtReset(){
  clearInterval(RT.interval);RT.interval=null;
  RT.running=false;RT.started=false;RT.remaining=RT.preset;
  rtRenderDisplay();
}
function rtFinish(){
  clearInterval(RT.interval);RT.interval=null;
  RT.running=false;RT.started=false;
  rtBeep();
  if(navigator.vibrate) navigator.vibrate([400,100,400]);
  RT.remaining=RT.preset;
  rtRenderDisplay();
}
function rtBeep(){
  try{
    const ctx=new(window.AudioContext||window.webkitAudioContext)();
    [0,0.4,0.75].forEach(t=>{
      const o=ctx.createOscillator(),g=ctx.createGain();
      o.connect(g);g.connect(ctx.destination);
      o.type='sine';o.frequency.value=880;
      g.gain.setValueAtTime(0,ctx.currentTime+t);
      g.gain.linearRampToValueAtTime(0.45,ctx.currentTime+t+0.04);
      g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+t+0.32);
      o.start(ctx.currentTime+t);o.stop(ctx.currentTime+t+0.33);
    });
  }catch(e){}
}
function rtLap(){
  if(!RT.started) return;
  const elapsed=RT.preset-RT.remaining;
  RT.laps.unshift({n:RT.laps.length+1,secs:elapsed});
  if(RT.laps.length>5) RT.laps.length=5;
  rtRenderLaps();
}
function rtRenderLaps(){
  const el=document.getElementById('rt-laps');
  if(!el) return;
  if(!RT.laps.length){el.innerHTML='';return;}
  el.innerHTML='<div style="font-size:11px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Recent laps</div>'
    +RT.laps.map(l=>'<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);font-size:14px"><span style="color:var(--muted)">Lap '+l.n+'</span><span style="font-weight:700;font-family:monospace">'+rtFmt(l.secs)+'</span></div>').join('');
}

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
  const last = lastSessionOf(t.name);
  S.setData = {};
  t.exercises.forEach(ex=>{
    const total = ex.sets + (ex.warmupSets||0);
    S.setData[ex.name] = Array(total).fill(null).map((_,si)=>({
      weight: '', reps: '', hint: hintWeight(last, ex.name, si)
    }));
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
  // Show the docked rest timer only on the Log tab (JS toggle — no :has() needed)
  const rtOv=document.getElementById('rt-overlay');
  if(rtOv) rtOv.classList.toggle('timer-hidden', v!=='log');
  if(v==='home') renderHome();
  if(v==='log'){
    renderLog();
    // Desktop: timer panel is always visible, so keep its UI rendered
    if(window.innerWidth>=1024){
      rtRenderPresets(); rtRenderDisplay(); rtRenderLaps(); rtRenderSessionClock();
      if(!RT.clockInterval) RT.clockInterval=setInterval(rtRenderSessionClock,1000);
    }
  }
  // Stats is no longer a top-level tab — its content lives inside Home. The
  // render below stays so any internal call to setView('stats') still works.
  if(v==='stats'){ if(statsSubTab==='history') renderHistory(); else if(statsSubTab==='progress') renderProgress(); else renderBudgetStats(); }
  if(v==='budget') renderBudgetTab();
  if(v==='kitchen') kitRender();
  else if(typeof kitShopRenderAddBar==='function') kitShopRenderAddBar(false); // hide fixed shopping add-bar off-tab
  if(v==='settings') renderSettings();
  updateNavPill(v);
  updateNavBadges();
}
const NAV_ORDER=['home','log','kitchen','budget','settings'];

// ── Swipe navigation ─────────────────────────────────────────────
(function(){
  let x0=0,y0=0;
  const main=document.getElementById('app-main');
  if(!main) return;
  main.addEventListener('touchstart',e=>{ x0=e.touches[0].clientX; y0=e.touches[0].clientY; },{passive:true});
  main.addEventListener('touchend',e=>{
    const dx=e.changedTouches[0].clientX-x0;
    const dy=e.changedTouches[0].clientY-y0;
    if(Math.abs(dx)<50||Math.abs(dx)<=Math.abs(dy)) return;
    const cur=NAV_ORDER.indexOf(S.view);
    if(dx<0&&cur<NAV_ORDER.length-1) setView(NAV_ORDER[cur+1],'forward');
    else if(dx>0&&cur>0) setView(NAV_ORDER[cur-1],'back');
  },{passive:true});
})();

function updateNavPill(v){
  const idx=NAV_ORDER.indexOf(v);
  const pill=document.getElementById('nav-pill');
  if(pill) pill.style.left=(idx*20)+'%';
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
  ['history','progress','budget'].forEach(t=>{
    const ids={history:'sub-history',progress:'sub-progress',budget:'sub-budget'};
    document.getElementById(ids[t]).classList.toggle('hidden',t!==tab);
    const bids={history:'st-hist-btn',progress:'st-prog-btn',budget:'st-bud-btn'};
    const btn=document.getElementById(bids[t]); if(!btn) return;
    const a=t===tab;
    btn.style.background=a?'var(--card)':'transparent';
    btn.style.fontWeight=a?'700':'500';
    btn.style.color=a?'var(--text)':'var(--muted)';
    btn.style.boxShadow=a?'0 1px 3px rgba(0,0,0,0.1)':'none';
  });
  if(tab==='history') renderHistory();
  if(tab==='progress') renderProgress();
  if(tab==='budget') renderBudgetStats();
}

// ── LOG view ─────────────────────────────────────────────────────
function renderLog(){
  if(!Object.keys(S.setData).length) initDay(S.dayIdx);
  const t = type(S.dayIdx);

  document.getElementById('day-selector').innerHTML = DAYS.map((d,i)=>{
    const tc = TYPES[d.typeIdx];
    return `<button class="day-pill ${i===S.dayIdx?tc.pillClass:''}" onclick="selectDay(${i})">Day ${d.dayNum}</button>`;
  }).join('');

  document.getElementById('day-name').textContent = t.name;
  const tag = document.getElementById('header-tag');
  if(tag){ tag.textContent=`Day ${S.dayIdx+1} · ${t.name}`; tag.style.color=t.barColor; }
  const done=S.checked.size, total=t.exercises.length;
  document.getElementById('comp-text').textContent = `${done}/${total}`;
  document.getElementById('pbar').style.width = Math.round(done/total*100)+'%';
  document.getElementById('pbar').style.background = t.barColor;

  document.getElementById('exercise-list').innerHTML = t.exercises.map(renderExCard).join('');

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
}

function renderExCard(ex, ei){
  const done = S.checked.has(ei);
  const badge = ex.priority ? `<span class="badge badge-${ex.priority}">${ex.priority==='grip'?'dead hangs':ex.priority}</span>` : '';
  const unit = ex.unit||'reps';
  const displayName = dn(ex.name);
  const isSwapped = S.swaps[ex.name] && S.swaps[ex.name] !== ex.name;

  const warmupCount = ex.warmupSets||0;
  const setRows = (S.setData[ex.name]||[]).map((s,si)=>{
    const isWarmup = si < warmupCount;
    const setLabel = isWarmup ? 'W' : String(si - warmupCount + 1);
    const minAttr = ex.allowNegative ? 'min="-999"' : 'min="0"';
    const wPlaceholder = isWarmup ? 'bw' : (s.hint||'kg');
    return `
    <div class="set-row">
      <div class="set-num" style="${isWarmup?'background:#e2e8f0;color:#94a3b8;font-size:11px;font-weight:700':''}">${setLabel}</div>
      <div class="set-input-wrap">
        <input type="number" inputmode="decimal" ${minAttr} step="0.5"
          placeholder="${wPlaceholder}" value="${s.weight}"
          onchange="updSet(${ei},${si},'weight',this.value)">
        ${s.hint&&!isWarmup?`<div class="last-hint">last: ${s.hint}kg</div>`:'<div class="last-hint"></div>'}
      </div>
      <input type="number" inputmode="numeric" min="0"
        placeholder="${unit}" value="${s.reps}"
        onchange="updSet(${ei},${si},'reps',this.value)">
    </div>`;
  }).join('');

  const barColor = type(S.dayIdx).barColor;
  const collapsed = exCollapsed.has(ei);
  const workSets = (S.setData[ex.name]||[]).slice(warmupCount).filter(s=>s.reps||s.weight);
  let exSummary = '';
  if(workSets.length){
    const last=workSets[workSets.length-1];
    exSummary=workSets.length+'×'+(last.reps||'?');
    if(last.weight) exSummary+=' @ '+last.weight+'kg';
  }
  return `<div class="ex-card${done?' done':''}${collapsed?' collapsed':''}" id="ec${ei}">
    <div class="ex-top ex-top-bar" style="background:transparent">
      <div class="ex-left">
        <div class="ex-name">${displayName}</div>
        ${exSummary?`<div class="ex-collapse-summary">${exSummary}</div>`:''}
        ${isSwapped?`<div class="swap-badge">swapped</div>`:''}
        ${ex.note?`<div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:2px">${ex.note}</div>`:''}
        ${badge?`<div class="ex-badges">${badge}</div>`:''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="swap-btn" onclick="openSwapModal(${ei})" title="Swap exercise" aria-label="Swap exercise">
          <svg viewBox="0 0 24 24"><path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/></svg>
        </button>
        <button class="ex-collapse-btn" onclick="toggleExCollapse(${ei})" aria-label="Toggle collapse">
          <svg class="card-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <button class="check-btn${done?' done':''}" onclick="toggleDone(${ei})" aria-label="Mark complete">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
    </div>
    <div class="ex-collapse-body"${collapsed?' style="height:0;opacity:0;overflow:hidden"':''}>
      <div class="set-col-labels">
        <div class="set-col-label">#</div>
        <div class="set-col-label">Weight (kg)</div>
        <div class="set-col-label">${unit}</div>
      </div>
      ${setRows}
      <button class="add-set-btn" onclick="addSet(${ei})">+ Add set</button>
    </div>
  </div>`;
}

function selectDay(idx){ exCollapsed.clear(); initDay(idx); renderLog(); }

function updSet(ei, si, field, val){
  const ex = type(S.dayIdx).exercises[ei];
  S.setData[ex.name][si][field] = val;
  if(!S.sessionStart && val.trim()){
    S.sessionStart = Date.now();
    if(!RT.clockInterval) RT.clockInterval=setInterval(rtRenderSessionClock,1000);
    const el=document.getElementById('rt-session-clock');
    if(el){ el.style.display='block'; el.textContent=sessionClockStr(); }
  }
}
function toggleDone(ei){
  const wasDone=S.checked.has(ei);
  wasDone ? S.checked.delete(ei) : S.checked.add(ei);
  if(wasDone) exCollapsed.delete(ei);
  renderLog();
  if(!wasDone){
    setTimeout(()=>{ exCollapsed.add(ei); renderLog(); }, 400);
  }
}
function toggleExCollapse(ei){
  exCollapsed.has(ei) ? exCollapsed.delete(ei) : exCollapsed.add(ei);
  renderLog();
}
function addSet(ei){
  const ex = type(S.dayIdx).exercises[ei];
  S.setData[ex.name].push({weight:'',reps:'',hint:''});
  renderLog();
}

// ── Save session ─────────────────────────────────────────────────
function saveSession(){
  const t = type(S.dayIdx);
  const exercises = t.exercises.map(ex=>({
    name: ex.name,
    sets: S.setData[ex.name]
      .map(s=>({weight:parseFloat(s.weight)||0, reps:parseInt(s.reps)||0}))
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

  // Reset note and session clock
  S.sessionNote = '';
  S.sessionStart = null;
  clearInterval(RT.clockInterval); RT.clockInterval=null;
  const el=document.getElementById('rt-session-clock'); if(el) el.style.display='none';
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
  document.getElementById('swap-original-label').textContent = `Default name: ${ex.name}`;
  document.getElementById('swap-input').value = S.swaps[ex.name] || ex.name;
  document.getElementById('swap-modal').classList.remove('hidden');
  setTimeout(()=>document.getElementById('swap-input').focus(), 100);
}
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
        <div class="session-type-pill ${tc.id}">${s.sessionType}</div>
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
    av.innerHTML=photo?'<img src="'+photo+'" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover">':'<span style="font-size:20px;font-weight:700;color:var(--accent)">'+uname.charAt(0).toUpperCase()+'</span>';
    if(nm) nm.textContent=uname;
    if(em) em.textContent=user.email||'';
    if(sy){ sy.textContent='● Synced to cloud'; sy.style.color='var(--success)'; }
  } else {
    const name=profileData.name||S.personalInfo?.name||'';
    av.innerHTML=name?'<span style="font-size:20px;font-weight:700;color:var(--accent)">'+name.charAt(0).toUpperCase()+'</span>':'<span style="font-size:20px;color:var(--muted)">?</span>';
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
    ['account','profile','budget','health','habits','reminders','subscriptions','appearance','export'].forEach(k=>{
      const btn=document.getElementById('sgb-'+k);
      if(btn) btn.classList.toggle('sg-active',k===key);
    });
    const sec=document.getElementById('settings-'+key+'-section');
    if(sec) sec.scrollIntoView({behavior:'smooth',block:'start'});
    return;
  }
  ['account','profile','budget','health','habits','reminders','subscriptions','appearance','export'].forEach(k=>{
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
  if(key==='budget'){ renderSettingsBudgetCustom(); applySettingsCollapsed(); }
  if(key==='health'){
    const pi=S.personalInfo;
    ['name','age','sex','height','weight','activity'].forEach(f=>{
      const el=document.getElementById('pi-'+f); if(el&&pi[f]!=null) el.value=pi[f];
    });
    renderTDEESection(); renderCalorieLog(); renderSavedFoods();
  }
  if(key==='appearance'){ const t=document.getElementById('theme-toggle'); if(t) t.checked=S.theme==='dark'; renderAccentSwatches(); }
  if(key==='subscriptions') renderSubscriptionsSection();
  if(key==='reminders') renderRemindersSection();
  panel.scrollIntoView({behavior:'smooth',block:'start'});
}
function closeSettingsSection(){
  const panel=document.getElementById('settings-active-panel');
  if(panel) panel.classList.add('hidden');
  ['account','profile','budget','health','habits','reminders','subscriptions','appearance','export'].forEach(k=>{
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
          <button onclick="deleteSubscription(${i})" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0">✕</button>
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
  renderSettingsBudgetCustom();
  applySettingsCollapsed();

  // Desktop (≥1024px): all sections are visible at once, so render the ones
  // that mobile only populates on icon tap
  if(window.innerWidth>=1024){
    renderRemindersSection();
    renderSubscriptionsSection();
    renderAccentSwatches();
    const t=document.getElementById('theme-toggle'); if(t) t.checked=S.theme==='dark';
    // Reveal the panel and every section so they stack in the right column
    const panel=document.getElementById('settings-active-panel');
    if(panel) panel.classList.remove('hidden');
    ['account','profile','budget','health','habits','reminders','subscriptions','appearance','export'].forEach(k=>{
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

function renderSettingsBudgetCustom(){
  const wrap=document.getElementById('settings-budget-section'); if(!wrap) return;
  const bd=budDefaults;
  const cv=key=>settingsCollapsed[key]?1:0;
  wrap.innerHTML=`
    <div class="settings-card">
      <div id="sh-income" class="settings-card-title" onclick="toggleSettingsSection('income')" style="cursor:pointer;margin-bottom:${cv('income')?0:14}px">
        Income sources<span id="sc-income" class="settings-chevron" style="${cv('income')?'transform:rotate(-90deg)':''}">▼</span>
      </div>
      <div id="ssc-income" style="${cv('income')?'display:none':''}">
        <div id="settings-income-list"></div>
        <div class="settings-2col" style="margin-top:12px">
          ${['s-fuji-payday','s-mcds-payday'].map((id,i)=>{
            const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
            const def=i===0?4:2;
            const cur=i===0?(bd.fujifilmPayDay??def):(bd.mcdonaldsPayDay??def);
            const opts=days.map((d,v)=>`<option value="${v}"${v===cur?' selected':''}>${d}</option>`).join('');
            return `<div class="settings-field"><label>${i===0?'Fujifilm':'Maccas'} pay day</label><select id="${id}">${opts}</select></div>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div class="settings-card">
      <div id="sh-savings-target" class="settings-card-title" onclick="toggleSettingsSection('savings-target')" style="cursor:pointer;margin-bottom:${cv('savings-target')?0:14}px">
        Weekly savings target<span id="sc-savings-target" class="settings-chevron" style="${cv('savings-target')?'transform:rotate(-90deg)':''}">▼</span>
      </div>
      <div id="ssc-savings-target" style="${cv('savings-target')?'display:none':''}">
        <div class="settings-field"><label>Target ($)</label><input type="number" id="s-weekly-savings" inputmode="decimal" placeholder="350" value="${bd.weeklySavings??''}"></div>
      </div>
    </div>
    <div class="settings-card">
      <div id="sh-fixed" class="settings-card-title" onclick="toggleSettingsSection('fixed')" style="cursor:pointer;margin-bottom:${cv('fixed')?0:14}px">
        Fixed expenses<span id="sc-fixed" class="settings-chevron" style="${cv('fixed')?'transform:rotate(-90deg)':''}">▼</span>
      </div>
      <div id="ssc-fixed" style="${cv('fixed')?'display:none':''}"><div id="settings-fixed-list"></div></div>
    </div>
    <div class="settings-card">
      <div id="sh-variable" class="settings-card-title" onclick="toggleSettingsSection('variable')" style="cursor:pointer;margin-bottom:${cv('variable')?0:14}px">
        Variable spending<span id="sc-variable" class="settings-chevron" style="${cv('variable')?'transform:rotate(-90deg)':''}">▼</span>
      </div>
      <div id="ssc-variable" style="${cv('variable')?'display:none':''}"><div id="settings-variable-list"></div></div>
    </div>
    <div class="settings-card">
      <button class="settings-save-btn" id="settings-all-save-btn" onclick="saveAllSettings()">Save settings</button>
      <div id="settings-all-save-msg" style="display:none;text-align:center;color:var(--accent);font-size:14px;font-weight:500;padding:8px 0">Saved ✓</div>
    </div>`;
  renderBudgetEditList('settings-income-list','incomeStreams');
  renderBudgetEditList('settings-fixed-list','fixedExpenses');
  renderBudgetEditList('settings-variable-list','variableExpenses');
}

function saveAllSettings(){
  // Profile name
  profileData.name = document.getElementById('profile-name')?.value.trim()||'';
  localStorage.setItem('daily_profile', JSON.stringify(profileData));
  syncProfileToFirebase();
  updateHeaderAvatar();

  // Budget defaults
  const gn=id=>document.getElementById(id)?.value.trim()||'';
  const gf=id=>parseFloat(document.getElementById(id)?.value)||undefined;
  // Budget line items (income/fixed/variable) auto-save on each edit via
  // updateBudgetItem(), so nothing to capture here.
  budDefaults.weeklySavings   = gf('s-weekly-savings');
  budDefaults.fine_label      = gn('s-fine-label');
  budDefaults.fine            = gf('s-fine-amt');
  budDefaults.subs_label      = gn('s-subs-label');
  budDefaults.subs            = gf('s-subs-amt');
  budDefaults.transport_label = gn('s-transport-label');
  budDefaults.transport       = gf('s-transport-amt');
  budDefaults.gym_label       = gn('s-gym-label');
  budDefaults.gym             = gf('s-gym-amt');
  budDefaults.food_bud        = gf('s-food-bud');
  budDefaults.pub_bud         = gf('s-pub-bud');
  budDefaults.personal_bud    = gf('s-personal-bud');
  const fp=parseInt(document.getElementById('s-fuji-payday')?.value); if(!isNaN(fp)) budDefaults.fujifilmPayDay=fp;
  const mp=parseInt(document.getElementById('s-mcds-payday')?.value); if(!isNaN(mp)) budDefaults.mcdonaldsPayDay=mp;
  localStorage.setItem('daily_budget_defaults', JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();

  // Button feedback
  const btn=document.getElementById('settings-all-save-btn');
  if(btn){
    btn.textContent='Saved ✓';
    btn.style.background='var(--accent)';
    setTimeout(()=>{ btn.textContent='Save settings'; btn.style.background=''; }, 2000);
  }
  // Card flash — profile section + all budget cards except the button card
  [
    ...document.querySelectorAll('#settings-profile-section .settings-card'),
    ...document.querySelectorAll('#settings-budget-section .settings-card')
  ].forEach(el=>{
    if(el.querySelector('#settings-all-save-btn')) return;
    el.classList.remove('settings-saved-flash');
    void el.offsetWidth; // restart animation if already running
    el.classList.add('settings-saved-flash');
    setTimeout(()=>el.classList.remove('settings-saved-flash'), 1500);
  });
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


// ── Budget constants (fallback defaults) ──────────────────────────
const DEFAULT_SAVINGS   = 350;
const DEFAULT_FINE      = 25;
const DEFAULT_SUBS      = 17;
const DEFAULT_GYM       = 27;
const DEFAULT_TRANSPORT = 50;
const DEFAULT_FOOD      = 70;
const DEFAULT_PUB       = 100;
const DEFAULT_PERSONAL  = 60;

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
  else if(S.view==='settings') renderSettingsBudgetCustom();
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
  // Legacy fallback: weeks saved before dynamic income streams existed
  return (parseFloat(d.inc_fuji)||0)+(parseFloat(d.inc_mcd)||0)+(parseFloat(d.inc_other)||0);
}
function weekSpending(d){
  if(d&&d.snapshot) return (parseFloat(d.snapshot.fixed)||0)+(parseFloat(d.snapshot.variable)||0);
  // Legacy fallback
  const transport=parseFloat(d&&d.fix_transport)||dTransport();
  return dFine()+dSubs()+transport+dGym()+(parseFloat(d&&d.var_food)||0)+(parseFloat(d&&d.var_pub)||0)+(parseFloat(d&&d.var_personal)||0);
}
function weekSavedAmt(d){
  if(d&&d.snapshot) return parseFloat(d.snapshot.saved)||0;
  return getWeeklySavings()+(parseFloat(d&&d.sav_extra)||0);
}
function weekLeftover(d){
  if(d&&d.snapshot) return parseFloat(d.snapshot.leftover)||0;
  return weekIncome(d)-weekSpending(d)-weekSavedAmt(d);
}
let savingsLog         = loadSavingsLog();
let profileData        = loadProfileData();
let settingsCollapsed  = (()=>{try{return JSON.parse(localStorage.getItem('daily_settings_collapsed')||'{}');}catch{return {};}})();
function loadWeightGoal(){ try{ return JSON.parse(localStorage.getItem('daily_weight_goal'))||{}; }catch(e){ return {}; } }
let weightGoal = loadWeightGoal();
function loadSubscriptions(){ try{ return JSON.parse(localStorage.getItem('daily_subscriptions'))||[]; }catch(e){ return []; } }
let subscriptionsData = loadSubscriptions();
let habitsData         = loadHabits();
let habitsLog          = loadHabitsLog();
let budChart           = null;
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
function getWeeklySavings(){ return budDefaults.weeklySavings ?? DEFAULT_SAVINGS; }
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
function getMondayOf(offset){
  const today=localMidnight(getLocalDate());
  const dow=today.getDay(), daysToMon=dow===0?-6:1-dow;
  const mon=new Date(today); mon.setDate(today.getDate()+daysToMon+offset*7);
  return mon;
}
function weekKey(monday){ return dateStr(monday); }
function fmtWeekLabel(monday){
  const fri = new Date(monday); fri.setDate(monday.getDate()+4);
  const opts = {day:'numeric',month:'short'};
  return monday.toLocaleDateString('en-AU',opts)+' – '+fri.toLocaleDateString('en-AU',opts);
}
function getBudWeekData(key){
  return budgetData[key]||{
    inc_fuji:'',inc_mcd:'',inc_other:'',inc_other_label:'',
    sav_extra:'',fix_transport:'',
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
  currentWeekIdx+=dir; renderBudgetTab();
}
function changeMonth(dir){
  if(dir>0&&currentMonthOffset>=0) return;
  currentMonthOffset+=dir; renderMonth();
}

// ── Render budget tab ─────────────────────────────────────────────
function renderBudgetTab(){
  const monday=getMondayOf(currentWeekIdx);
  const key=weekKey(monday);
  const data=getBudWeekData(key);
  const isCur=currentWeekIdx===0;

  document.getElementById('week-label-main').textContent=
    isCur?'This week':currentWeekIdx===-1?'Last week':Math.abs(currentWeekIdx)+' weeks ago';
  document.getElementById('week-label-sub').textContent=fmtWeekLabel(monday);
  document.getElementById('week-next-btn').style.opacity=currentWeekIdx>=0?'0.3':'1';

  // Editable plan line-item lists (shared config — single source of truth)
  renderBudgetEditList('bud-income-list','incomeStreams');
  renderBudgetEditList('bud-fixed-list','fixedExpenses');
  renderBudgetEditList('bud-variable-list','variableExpenses');

  // Extra savings is still per-week
  const se=document.getElementById('sav-extra');
  if(se){ se.value=data.sav_extra||''; se.disabled=!isCur; se.style.opacity=isCur?'1':'0.7'; }

  const setText=(id,t)=>{ const el=document.getElementById(id); if(el) el.textContent=t; };
  setText('savings-target-lbl', '$'+getWeeklySavings());

  const notesEl=document.getElementById('week-notes');
  if(notesEl){ notesEl.value=data.notes||''; notesEl.disabled=!isCur; }

  const saveBtn=document.getElementById('save-week-btn');
  const saveMsg=document.getElementById('save-week-msg');
  if(saveBtn) saveBtn.style.display=isCur?'block':'none';
  if(saveMsg) saveMsg.style.display='none';

  budRecalc();
  renderPrevWeeks();
  restoreCardCollapse();
}

function budRecalc(){
  const savExtra    = parseFloat(document.getElementById('sav-extra')?.value)||0;
  const totalIncome = configIncomeTotal();
  const totalFixed  = configFixedTotal();
  const totalVar    = configVariableTotal();
  const totalSaved  = getWeeklySavings()+savExtra;
  const totalOut    = totalSaved+totalFixed+totalVar;
  const leftover    = totalIncome>0?totalIncome-totalOut:null;

  const $ = (id,t) => { const el=document.getElementById(id); if(el) el.textContent=t; };
  $('calc-income',  totalIncome>0?'$'+totalIncome.toFixed(0):'—');
  $('calc-saved',   '$'+totalSaved.toFixed(0));
  $('calc-fixed',   '$'+totalFixed.toFixed(0));
  $('calc-variable',totalVar>0?'$'+totalVar.toFixed(0):'—');
  $('calc-leftover',leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'—');

  const pill=document.getElementById('week-status-pill');
  if(pill){
    if(leftover===null){pill.className='status-pill good';pill.textContent='⏳ Enter income';}
    else if(leftover>=50){pill.className='status-pill good';pill.textContent='🟢 On track';}
    else if(leftover>=0){pill.className='status-pill warn';pill.textContent='🟡 Tight week';}
    else{pill.className='status-pill over';pill.textContent='🔴 Over budget';}
  }

  const sumEl=document.getElementById('budget-summary');
  if(sumEl) sumEl.innerHTML=[
    {val:totalIncome>0?'$'+totalIncome.toFixed(0):'—',lbl:'Income',color:'var(--success)'},
    {val:'$'+totalSaved.toFixed(0),lbl:'Saved',color:'var(--blue)'},
    {val:leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'—',lbl:'Left over',
     color:leftover!==null?(leftover>=0?'var(--success)':'var(--danger)'):'var(--muted)'},
  ].map(s=>'<div class="sum-card"><div class="sum-card-val" style="color:'+s.color+'">'+s.val+'</div><div class="sum-card-lbl">'+s.lbl+'</div></div>').join('');

  const barEl=document.getElementById('budget-bar');
  const barL=document.getElementById('budget-bar-label-l');
  const barR=document.getElementById('budget-bar-label-r');
  if(totalIncome>0){
    const pct=Math.min(110,Math.round(totalOut/totalIncome*100));
    const bc=pct>100?'var(--danger)':pct>85?'var(--warn)':'var(--success)';
    if(barEl){barEl.style.width=Math.min(100,pct)+'%';barEl.style.background=bc;}
    if(barL) barL.textContent='$'+totalOut.toFixed(0)+' spent';
    if(barR) barR.textContent=pct+'% of income';
  } else {
    if(barEl) barEl.style.width='0%';
    if(barL) barL.textContent='Enter income to see breakdown';
    if(barR) barR.textContent='';
  }
  const setSum=(id,text)=>{const el=document.getElementById(id+'-summary');if(el) el.textContent=text;};
  setSum('bud-card-income',  totalIncome>0?'$'+totalIncome.toFixed(0):'—');
  setSum('bud-card-savings', '$'+totalSaved.toFixed(0));
  setSum('bud-card-fixed',   totalFixed>0?'$'+totalFixed.toFixed(0):'—');
  setSum('bud-card-variable',totalVar>0?'$'+totalVar.toFixed(0):'—');
  setSum('bud-card-result',  leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'—');

  budSaveDraft();
}

// Snapshot the current plan totals for the week (history reads these)
function budSnapshot(){
  const totalIncome=configIncomeTotal();
  const totalFixed=configFixedTotal();
  const totalVar=configVariableTotal();
  const savExtra=parseFloat(document.getElementById('sav-extra')?.value)||0;
  const totalSaved=getWeeklySavings()+savExtra;
  return {income:totalIncome,fixed:totalFixed,variable:totalVar,saved:totalSaved,
          leftover:totalIncome-totalSaved-totalFixed-totalVar};
}
function budSaveDraft(){
  if(currentWeekIdx !== 0) return;
  const key=weekKey(getMondayOf(0));
  if(!budgetData[key]) budgetData[key]={};
  const d=budgetData[key];
  d.snapshot=budSnapshot();
  d.sav_extra=document.getElementById('sav-extra')?.value||'';
  d.notes=document.getElementById('week-notes')?.value||'';
  if(!d.saved) d.draft=true;
  budSaveData();
}

function budSaveCurrentWeek(){
  const monday=getMondayOf(currentWeekIdx);
  const key=weekKey(monday);
  if(!budgetData[key]) budgetData[key]={};
  const d=budgetData[key];
  d.snapshot=budSnapshot();
  d.sav_extra=document.getElementById('sav-extra')?.value||'';
  d.notes=document.getElementById('week-notes')?.value||'';
  d.saved=true; delete d.draft;
  budSaveData(); renderPrevWeeks(); updateNavBadges();
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
  let totalIncome=0,totalSaved=0,totalFixed=0,totalVar=0,weekCount=0;
  keys.forEach(k=>{
    const d=budgetData[k]; if(!d) return; weekCount++;
    totalIncome+=weekIncome(d);
    totalSaved+=weekSavedAmt(d);
    totalFixed+=(d.snapshot?parseFloat(d.snapshot.fixed)||0:configFixedTotal());
    totalVar+=(d.snapshot?parseFloat(d.snapshot.variable)||0:configVariableTotal());
  });
  const totalOut=totalSaved+totalFixed+totalVar;
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
  const catMax=Math.max(totalFixed,totalVar,totalSaved,1);
  if(catEl) catEl.innerHTML=[
    {label:'📌 Fixed',val:totalFixed,color:'#f59e0b'},
    {label:'🛒 Variable',val:totalVar,color:'#52B788'},
    {label:'🏦 Saved',val:totalSaved,color:'#6366f1'},
  ].map(c=>{
    const pct=Math.min(100,Math.round(c.val/catMax*100));
    return '<div class="month-cat-row"><div class="month-cat-label">'+c.label+'</div>'
      +'<div class="month-cat-bar-wrap"><div class="month-cat-bar-fill" style="width:'+pct+'%;background:'+c.color+'"></div></div>'
      +'<div class="month-cat-amount">'+( c.val>0?'$'+c.val.toFixed(0):'—')+'</div></div>';
  }).join('');

  const wl=document.getElementById('month-weeks-list');
  if(wl){
    if(!keys.length){wl.innerHTML=emptyState('📅','No weeks saved yet','Save a week using the Week view to see it here');}
    else wl.innerHTML=keys.map(k=>{
      const d=budgetData[k]; if(!d) return '';
      const inc=weekIncome(d);
      const left=inc>0?weekLeftover(d):null;
      const mon=new Date(k+'T12:00:00'),fri=new Date(mon); fri.setDate(mon.getDate()+4);
      const lbl=mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' – '+fri.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
      return '<div class="month-week-row"><div class="month-week-lbl">'+lbl+'</div>'
        +'<div class="month-week-val" style="color:'+(left===null?'var(--muted)':left>=0?'var(--green-dark)':'var(--amber-dark)')+'">'+
        (left!==null?(left>=0?'+$':'-$')+Math.abs(left).toFixed(0):'—')+'</div></div>';
    }).join('');
  }
  renderSavingsCard();
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
}
function logSavingsBalance(){
  const dateEl=document.getElementById('sav-log-date');
  const balEl=document.getElementById('sav-log-bal');
  const bal=parseFloat(balEl.value);
  const date=dateEl.value;
  if(!bal||!date) return;
  savingsLog=savingsLog.filter(e=>e.date!==date);
  savingsLog.push({date,balance:bal});
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
  renderBSBalance();
  renderBSConsist();
  renderBSRecords();
  renderBSGoals();
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
  if(bsChart){bsChart.destroy();bsChart=null;}
  const points=getBudTrendPoints(bsTrendRange);
  if(points.length<2){
    wrap.innerHTML=emptyState('💰','No budget history yet','Save your first week in the Budget tab to see trends here');
    return;
  }
  wrap.innerHTML='<canvas id="bs-trend-chart"></canvas>';
  const ctx=document.getElementById('bs-trend-chart'); if(!ctx) return;
  const isDark=S.theme==='dark';
  const gc=isDark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.06)';
  const tc=isDark?'#888':'#94a3b8';
  bsChart=new Chart(ctx,{
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
    return '<div onclick="toggleHabit('+i+')" style="display:flex;align-items:center;gap:12px;padding:11px 0;'+(isLast?'':'border-bottom:1px solid var(--border);')+'cursor:pointer;-webkit-tap-highlight-color:transparent">'
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
    +'<button onclick="openWeekReviewModal()" style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;border:1.5px solid rgba(255,255,255,0.5);background:transparent;color:#fff;cursor:pointer">Full review</button>'
    +'</div>'
    +'<div style="padding:14px 16px">'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">'
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
    +'<span>✅ Daily habits</span>'
    +'<div style="display:flex;align-items:center;gap:10px">'
    +'<span id="habits-today-count" style="font-size:13px;font-weight:700;color:#fff;opacity:'+(allDone?'1':'0.75')+'">'+doneCount+'/'+n+'</span>'
    +'<button onclick="openHabitsEditModal()" style="background:rgba(255,255,255,0.2);border:none;border-radius:6px;padding:3px 7px;cursor:pointer;color:#fff;font-size:14px;line-height:1" title="Edit habits">✏️</button>'
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
  div.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;display:flex;align-items:flex-end;justify-content:center';
  div.innerHTML='<div id="habits-edit-sheet" style="background:var(--card);border-radius:18px 18px 0 0;width:100%;max-width:480px;padding:20px 16px 32px;max-height:80vh;overflow-y:auto"></div>';
  document.body.appendChild(div);
  renderHabitsEditModal();
}
function renderHabitsEditModal(){
  const sheet=document.getElementById('habits-edit-sheet'); if(!sheet) return;
  const rows=habitsData.map((h,i)=>
    '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">'
    +'<span style="flex:1;font-size:14px;color:var(--text)">'+h.replace(/</g,'&lt;')+'</span>'
    +'<button onclick="deleteHabitItem('+i+')" style="background:none;border:none;color:var(--danger);font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0">✕</button>'
    +'</div>'
  ).join('') || '<div style="font-size:13px;color:var(--muted);padding:8px 0">No habits yet</div>';
  sheet.innerHTML=
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">'
    +'<span style="font-size:16px;font-weight:700;color:var(--text)">Edit daily habits</span>'
    +'<button onclick="closeHabitsEditModal()" style="background:var(--accent);color:#fff;border:none;border-radius:8px;padding:6px 16px;font-size:13px;font-weight:600;cursor:pointer">Done</button>'
    +'</div>'
    +rows
    +'<div style="display:flex;gap:8px;margin-top:12px">'
    +'<input id="habit-new-input" type="text" placeholder="New habit…" style="flex:1;height:40px;border:1.5px solid var(--border);border-radius:8px;font-size:14px;padding:0 10px;background:var(--card);color:var(--text)">'
    +'<button onclick="addHabitItem()" style="padding:0 16px;height:40px;background:var(--accent);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">Add</button>'
    +'</div>';
}
function addHabitItem(){
  const inp=document.getElementById('habit-new-input'); if(!inp) return;
  const val=inp.value.trim(); if(!val) return;
  habitsData.push(val);
  localStorage.setItem('daily_habits',JSON.stringify(habitsData));
  inp.value='';
  renderHabitsEditModal();
  refreshTodayHabits();
}
function deleteHabitItem(i){
  habitsData.splice(i,1);
  localStorage.setItem('daily_habits',JSON.stringify(habitsData));
  renderHabitsEditModal();
  refreshTodayHabits();
}
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

function renderHome(){
  const wrap=document.getElementById('home-content'); if(!wrap) return;
  const name=profileData.name||S.personalInfo.name||'';

  // Greeting
  const hour=+new Date().toLocaleString('en-AU',{timeZone:'Australia/Sydney',hour:'2-digit',hour12:false}).split(':')[0];
  const greeting=hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
  const greetLine=name?greeting+', '+name:greeting;

  // Calories
  const today=getLocalDate();
  if(S.dailyLog.date!==today){ S.dailyLog={date:today,entries:[]}; persistDailyLog(); }
  const c=calcGoalCals();
  const goalCals=c?(c.goal==='cut'?c.cut:c.goal==='bulk'?c.bulk:c.maintain):null;
  const kcalTotal=S.dailyLog.entries.reduce((a,e)=>a+e.kcal,0);

  // Budget leftover — from the live plan config (single source of truth)
  let budLeft=null,budPillCls='good',budPillTxt='';
  const incTot=configIncomeTotal();
  if(incTot>0){
    budLeft=incTot-configFixedTotal()-configVariableTotal()-getWeeklySavings();
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

  // Weekly savings target + next workout
  const wSavTarget=getWeeklySavings();
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
      const col=e.balance<prev?'var(--danger)':'#3b82f6';
      const h=Math.max(8,Math.round(((e.balance-minV)/range)*36+8));
      return '<div style="flex:1;display:flex;align-items:flex-end;padding:0 1px"><div style="width:100%;height:'+h+'px;background:'+col+';border-radius:2px 2px 0 0;opacity:0.85"></div></div>';
    }).join('');
    savInner=
      '<div style="display:flex;justify-content:space-between;align-items:flex-end">'+
        '<div>'+
          '<div style="font-size:22px;font-weight:800">$'+latest.balance.toLocaleString()+'</div>'+
          '<div style="font-size:11px;color:var(--muted)">Updated '+ago+'</div>'+
        '</div>'+
        '<button onclick="event.stopPropagation();updateSavingsBalance()" style="font-size:12px;font-weight:600;padding:4px 11px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--muted);cursor:pointer">Update</button>'+
      '</div>'+
      '<div style="display:flex;align-items:flex-end;height:40px;gap:2px;margin-top:8px">'+bars+'</div>';
  } else {
    savInner=
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-size:22px;font-weight:800;color:var(--muted)">$—</div>'+
        '<button onclick="event.stopPropagation();updateSavingsBalance()" style="font-size:12px;font-weight:600;padding:4px 11px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--muted);cursor:pointer">Update</button>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:4px">No balance logged · $'+wSavTarget+'/wk target</div>';
  }

  const heroHdrCol=goalCals?'#52B788':budLeft!==null?'#FF6B35':'#64748b';
  const heroHdrTxt=goalCals?'🍎 Calorie progress':budLeft!==null?'💰 Budget summary':'📊 Overview';
  wrap.innerHTML=
    '<div class="home-top-row">'+
    // Hero card
    '<div class="card hero-card"'+(goalCals?' onclick="openCalorieOverlay()"':'')+' style="margin-bottom:12px;padding:0;overflow:hidden'+(goalCals?';cursor:pointer':'')+'">'+
      '<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">'+heroHdrTxt+'</div>'+
      '<div class="overview-content" style="padding:14px 16px">'+
        '<div class="overview-greeting" style="font-size:15px;font-weight:700;margin-bottom:12px">'+greetLine+'</div>'+
        heroContent+
      '</div>'+
    '</div>'+
    // 2×3 stat grid
    '<div class="home-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
      '<div class="card" onclick="setView(\'log\')" style="margin-bottom:0;padding:14px;text-align:center;cursor:pointer">'+
        '<div style="font-size:22px;margin-bottom:2px">💪</div>'+
        '<div style="font-size:28px;font-weight:800;line-height:1">'+wStreak+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Workout streak</div>'+
      '</div>'+
      '<div class="card" onclick="setView(\'log\')" style="margin-bottom:0;padding:14px;text-align:center;cursor:pointer">'+
        '<div style="font-size:22px;margin-bottom:2px">🔥</div>'+
        '<div style="font-size:28px;font-weight:800;line-height:1">'+ciStreak+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Check-in streak</div>'+
      '</div>'+
      '<div class="card" onclick="setView(\'budget\')" style="margin-bottom:0;padding:14px;text-align:center;cursor:pointer">'+
        '<div style="font-size:22px;margin-bottom:2px">💰</div>'+
        '<div style="font-size:22px;font-weight:800;line-height:1;color:var(--success)">$'+wSavTarget+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Weekly target</div>'+
      '</div>'+
      '<div class="card" onclick="setView(\'log\')" style="margin-bottom:0;padding:14px;text-align:center;cursor:pointer">'+
        '<div style="font-size:22px;margin-bottom:2px">🏋️</div>'+
        '<div style="font-size:14px;font-weight:700;line-height:1.2">'+nextType.name+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Day '+dayNum+' up next</div>'+
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
    '</div>'+
    '</div>'+
    // Savings balance
    '<div class="card" onclick="setView(\'budget\')" style="padding:0;overflow:hidden;cursor:pointer">'+
      '<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">🏦 Savings balance</div>'+
      '<div style="padding:14px 16px">'+
        savInner+
      '</div>'+
    '</div>'+
    // Weekly review + habits grid
    buildWeekSummaryCard()+
    // Today's habits checklist
    buildTodayHabitsCard()+
    // Next workout with action button
    '<div class="card" style="padding:0;overflow:hidden">'+
      '<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted)">🏋️ Next workout</div>'+
      '<div style="padding:14px 16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center">'+
          '<div>'+
            '<div style="font-size:18px;font-weight:700">'+nextType.name+'</div>'+
            '<div style="font-size:12px;color:var(--muted)">Day '+dayNum+' · '+nextType.exercises.length+' exercises</div>'+
          '</div>'+
          '<button onclick="initDay('+nextIdx+');setView(\'log\')" style="background:var(--accent);color:#fff;border:none;border-radius:10px;padding:10px 22px;font-size:15px;font-weight:700;cursor:pointer">Go →</button>'+
        '</div>'+
      '</div>'+
    '</div>';

  renderHomeStats();
}

// ── Home stats integration (Stats folded into Home) ───────────────
// Relocate the standalone #view-stats DOM into the collapsible Home card once,
// so all existing stats render functions keep targeting their original ids.
function mountStatsIntoHome(){
  const stats=document.getElementById('view-stats');
  const body=document.getElementById('home-stats-body');
  if(!stats||!body) return;
  if(stats.parentElement===body) return; // already mounted
  const topbar=stats.querySelector('.desktop-topbar');
  if(topbar) topbar.remove(); // the Home card header already says "Stats"
  stats.classList.remove('hidden');
  body.appendChild(stats);
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
  // Card 2 — Weekly consistency (reuse the 8-week grid)
  const consist=document.getElementById('home-consistency-card');
  if(consist){
    if(!S.sessions.length){
      consist.innerHTML='';
    } else {
      consist.innerHTML='<div id="home-week-grid"></div>';
      renderWeeklyGrid('home-week-grid');
    }
  }
  // Card 3 (collapsible Stats) re-renders its active sub-tab if currently open
  if(homeStatsOpen) setStatsTab(statsSubTab);
}

function updateSavingsBalance(){
  const input=prompt('Enter current savings balance ($):');
  if(input===null) return;
  const bal=parseFloat(String(input).replace(/[^0-9.]/g,''));
  if(isNaN(bal)||bal<0) return;
  const today=getLocalDate();
  savingsLog=savingsLog.filter(e=>e.date!==today);
  savingsLog.push({date:today,balance:bal});
  saveSavingsLog();
  renderHome();
}

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
function kitSaveRecipes(){ localStorage.setItem('kitchen_recipes',JSON.stringify(kitRecipes)); }
const kitState={tab:'recipes',cat:'all',search:'',selectedId:null,scaleServings:null};
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
function kitFilteredRecipes(){
  const q=kitState.search.trim().toLowerCase();
  return kitRecipes.filter(r=>{
    if(kitState.cat!=='all' && r.category!==kitState.cat) return false;
    if(!q) return true;
    if((r.name||'').toLowerCase().includes(q)) return true;
    return (r.ingredients||[]).some(i=>(i.name||'').toLowerCase().includes(q));
  });
}
function kitRenderList(){
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
      return '<div class="kit-card'+sel+'" onclick="kitOpenDetail(\''+r.id+'\')">'+
        '<div class="kit-card-top">'+
          '<div class="kit-card-name">'+kitEsc(r.name)+'</div>'+
          '<button class="kit-fav'+(r.favourite?' on':'')+'" onclick="event.stopPropagation();kitToggleFav(\''+r.id+'\')" aria-label="Favourite">'+(r.favourite?'⭐':'☆')+'</button>'+
        '</div>'+
        '<div class="kit-card-meta"><span class="kit-cat-tag kit-cat-'+r.category+'">'+r.category+'</span>'+cal+batch+'</div>'+
        (r.description?'<div class="kit-card-desc">'+kitEsc(r.description)+'</div>':'')+
        '<div class="kit-card-serv">🍽️ '+r.servings+' serving'+(r.servings!=1?'s':'')+'</div>'+
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
  const stepRows=(r.steps||[]).map((s,i)=>'<div class="kit-step-row"><span class="kit-step-n">'+(i+1)+'</span><span>'+kitEsc(s)+'</span></div>').join('');
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
  const backBtn=window.innerWidth>=1024?'':'<button class="kit-back" onclick="kitCloseDetail()" aria-label="Back">←</button>';
  target.innerHTML=
    '<div class="kit-detail-head">'+backBtn+
      '<button class="kit-fav'+(r.favourite?' on':'')+'" onclick="kitToggleFav(\''+r.id+'\')" style="margin-left:auto" aria-label="Favourite">'+(r.favourite?'⭐':'☆')+'</button>'+
    '</div>'+
    '<div class="kit-detail-name">'+kitEsc(r.name)+'</div>'+
    '<div class="kit-card-meta" style="margin-bottom:14px"><span class="kit-cat-tag kit-cat-'+r.category+'">'+r.category+'</span>'+(r.batchPrep?'<span class="kit-batch-badge">🍱 Batch</span>':'')+tags+'</div>'+
    (r.description?'<div class="kit-card-desc" style="margin-bottom:16px">'+kitEsc(r.description)+'</div>':'')+
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
function kitOpenForm(id){
  const editing=id?kitRecipes.find(x=>x.id===id):null;
  const r=editing||{name:'',category:'dinner',description:'',servings:2,ingredients:[{name:'',amount:'',unit:''}],steps:[''],tags:[],calories:'',protein:'',carbs:'',fat:''};
  const box=document.getElementById('kit-form-box'); if(!box) return;
  const catOpts=['breakfast','lunch','dinner','dessert'].map(c=>'<option value="'+c+'"'+(r.category===c?' selected':'')+'>'+c.charAt(0).toUpperCase()+c.slice(1)+'</option>').join('');
  box.innerHTML=
    '<div class="modal-title">'+(editing?'Edit recipe':'New recipe')+'</div>'+
    '<input type="hidden" id="kit-f-id" value="'+(editing?editing.id:'')+'">'+
    '<div class="settings-field"><label>Name</label><input id="kit-f-name" type="text" value="'+kitEsc(r.name)+'" placeholder="Recipe name"></div>'+
    '<div class="settings-2col">'+
      '<div class="settings-field"><label>Category</label><select id="kit-f-cat">'+catOpts+'</select></div>'+
      '<div class="settings-field"><label>Servings</label><input id="kit-f-serv" type="number" min="1" inputmode="numeric" value="'+(r.servings||2)+'"></div>'+
    '</div>'+
    '<div class="settings-field"><label>Description</label><input id="kit-f-desc" type="text" value="'+kitEsc(r.description)+'" placeholder="Short description"></div>'+
    '<div class="settings-field"><label>Macros (per recipe)</label><div class="kit-macro-grid">'+
      '<input id="kit-f-cal" type="number" inputmode="numeric" placeholder="cal" value="'+(r.calories??'')+'">'+
      '<input id="kit-f-pro" type="number" inputmode="numeric" placeholder="protein" value="'+(r.protein??'')+'">'+
      '<input id="kit-f-carb" type="number" inputmode="numeric" placeholder="carbs" value="'+(r.carbs??'')+'">'+
      '<input id="kit-f-fat" type="number" inputmode="numeric" placeholder="fat" value="'+(r.fat??'')+'">'+
    '</div></div>'+
    '<div class="settings-field"><label>Tags (comma separated)</label><input id="kit-f-tags" type="text" value="'+kitEsc((r.tags||[]).join(', '))+'" placeholder="quick, high-protein"></div>'+
    '<div class="settings-field"><label>Ingredients</label><div id="kit-f-ings"></div>'+
      '<button class="kit-add-row" onclick="kitFormAddIng()">+ Add ingredient</button></div>'+
    '<div class="settings-field"><label>Steps</label><div id="kit-f-steps"></div>'+
      '<button class="kit-add-row" onclick="kitFormAddStep()">+ Add step</button></div>'+
    '<div class="modal-btn-row">'+
      '<button class="modal-btn secondary" onclick="kitCloseForm()">Cancel</button>'+
      '<button class="modal-btn green" onclick="kitSaveForm()">Save</button>'+
    '</div>';
  const ings=document.getElementById('kit-f-ings');
  ings.innerHTML='';
  (r.ingredients&&r.ingredients.length?r.ingredients:[{name:'',amount:'',unit:''}]).forEach(i=>kitFormAddIng(i));
  const steps=document.getElementById('kit-f-steps');
  steps.innerHTML='';
  (r.steps&&r.steps.length?r.steps:['']).forEach(s=>kitFormAddStep(s));
  document.getElementById('kit-form-overlay').classList.remove('hidden');
}
function kitFormAddIng(data){
  const wrap=document.getElementById('kit-f-ings'); if(!wrap) return;
  const d=(data&&typeof data==='object')?data:{name:'',amount:'',unit:''};
  const row=document.createElement('div');
  row.className='kit-f-ing-row';
  row.innerHTML='<input class="kit-fi-name" type="text" placeholder="Ingredient" value="'+kitEsc(d.name)+'">'+
    '<input class="kit-fi-amt" type="text" inputmode="decimal" placeholder="Amt" value="'+kitEsc(d.amount)+'">'+
    '<input class="kit-fi-unit" type="text" placeholder="Unit" value="'+kitEsc(d.unit)+'">'+
    '<button class="kit-f-del" onclick="this.parentElement.remove()" aria-label="Remove">✕</button>';
  wrap.appendChild(row);
}
function kitFormAddStep(data){
  const wrap=document.getElementById('kit-f-steps'); if(!wrap) return;
  const val=(typeof data==='string')?data:'';
  const row=document.createElement('div');
  row.className='kit-f-step-row';
  row.innerHTML='<textarea class="kit-fs-text" rows="2" placeholder="Describe this step">'+kitEsc(val)+'</textarea>'+
    '<button class="kit-f-del" onclick="this.parentElement.remove()" aria-label="Remove">✕</button>';
  wrap.appendChild(row);
}
function kitCloseForm(){
  const ov=document.getElementById('kit-form-overlay');
  if(ov) ov.classList.add('hidden');
}
function kitSaveForm(){
  const num=v=>{ const n=parseFloat(v); return isNaN(n)?null:n; };
  const name=(document.getElementById('kit-f-name')?.value||'').trim();
  if(!name){ alert('Please enter a recipe name.'); return; }
  const ings=[...document.querySelectorAll('#kit-f-ings .kit-f-ing-row')].map(row=>({
    name:(row.querySelector('.kit-fi-name')?.value||'').trim(),
    amount:(()=>{ const v=(row.querySelector('.kit-fi-amt')?.value||'').trim(); const n=parseFloat(v); return (v!==''&&!isNaN(n)&&String(n)===v)?n:v; })(),
    unit:(row.querySelector('.kit-fi-unit')?.value||'').trim(),
  })).filter(i=>i.name);
  const steps=[...document.querySelectorAll('#kit-f-steps .kit-fs-text')].map(t=>t.value.trim()).filter(Boolean);
  const tags=(document.getElementById('kit-f-tags')?.value||'').split(',').map(t=>t.trim()).filter(Boolean);
  const id=document.getElementById('kit-f-id')?.value||'';
  const data={
    name,
    category:document.getElementById('kit-f-cat')?.value||'dinner',
    description:(document.getElementById('kit-f-desc')?.value||'').trim(),
    servings:Math.max(1,parseInt(document.getElementById('kit-f-serv')?.value)||1),
    ingredients:ings,
    steps,
    tags,
    calories:num(document.getElementById('kit-f-cal')?.value),
    protein:num(document.getElementById('kit-f-pro')?.value),
    carbs:num(document.getElementById('kit-f-carb')?.value),
    fat:num(document.getElementById('kit-f-fat')?.value),
    batchPrep:tags.includes('batch-prep'),
  };
  if(id){
    const r=kitRecipes.find(x=>x.id===id);
    if(r) Object.assign(r,data);
  } else {
    kitRecipes.push(Object.assign({id:kitUUID(),favourite:false,createdAt:Date.now()},data));
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
function kitShopSaveSelected(){ localStorage.setItem('kitchen_shopping_selected',JSON.stringify(kitShopSelected)); }
function kitShopLoadChecked(){ try{ return JSON.parse(localStorage.getItem('kitchen_shopping_checked')||'{}')||{}; }catch(e){ return {}; } }
function kitShopSaveChecked(){ localStorage.setItem('kitchen_shopping_checked',JSON.stringify(kitShopChecked)); }
function kitShopLoadManual(){ try{ const a=JSON.parse(localStorage.getItem('kitchen_shopping_manual')||'[]'); return Array.isArray(a)?a:[]; }catch(e){ return []; } }
function kitShopSaveManual(){ localStorage.setItem('kitchen_shopping_manual',JSON.stringify(kitShopManual)); }
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
function kitPantrySave(){ localStorage.setItem('kitchen_pantry',JSON.stringify(kitPantryData)); }
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
  applyTheme();
  applyAccent(getAccent());
  logCheckin();
  initDay(suggestDay());
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
    '<button onclick="location.reload(true)" style="padding:10px 20px;border:none;border-radius:10px;background:var(--accent);color:#fff;font-size:14px;font-weight:600;cursor:pointer">Reload</button>'+
    '</div>';
}

// Always register the (network-first) service worker so fresh code reaches the
// device even if boot above threw — this is what replaces stale cached code.
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/workout-tracker/service-worker.js');
}
