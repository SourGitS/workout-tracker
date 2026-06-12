'use strict';

// â”€â”€ Firebase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    btn.innerHTML='<span style="font-size:14px;font-weight:700;color:#FF6B35;line-height:1">'+initial+'</span>';
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

// â”€â”€ Program â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TYPES = [
  {
    id:'cb', name:'Chest & Back', pillClass:'cb', barColor:'#ef4444',
    exercises:[
      {name:'Incline smith press', sets:3},
      {name:'Chest fly', sets:2},
      {name:'Chest press machine', sets:2},
      {name:'Pullups', sets:3, allowNegative:true, note:'âˆ’ kg = assisted Â· + kg = added weight'},
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

// â”€â”€ Storage helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    if(saved.date !== today) return {date:today, entries:[]};
    return saved;
  } catch{ return {date:getLocalDate(), entries:[]}; }
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

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  sessionStart: Date.now(),
};

// â”€â”€ Persist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
function persistDailyLog(){ localStorage.setItem('wt_calories', JSON.stringify(S.dailyLog)); }

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Theme â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function applyTheme(){
  document.documentElement.setAttribute('data-theme', S.theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = S.theme==='dark' ? '#1a1a1a' : '#0f172a';
}
function setTheme(t){
  S.theme = t;
  localStorage.setItem('wt_theme', t);
  applyTheme();
  if(S.view==='progress') renderProgress();
}

// â”€â”€ Timer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function fmtTimer(ms){
  const s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60);
  const mm=String(m%60).padStart(2,'0'), ss=String(s%60).padStart(2,'0');
  return h>0?`${h}:${mm}:${ss}`:`${m}:${ss}`;
}
function getDurationMins(){ return Math.round((Date.now()-S.sessionStart)/60000); }

// â”€â”€ Rest Timer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const RT_PRESETS=[60,90,120,180];
const RT={preset:90,remaining:90,running:false,interval:null,laps:[],started:false};

function openRestTimer(){
  document.getElementById('rt-overlay').classList.remove('hidden');
  rtRenderPresets();
  rtRenderDisplay();
  rtRenderLaps();
}
function closeRestTimer(){
  document.getElementById('rt-overlay').classList.add('hidden');
}
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
    return '<button onclick="rtSetPreset('+s+')" style="padding:9px 18px;border-radius:20px;border:2px solid '+(a?'#FF6B35':'var(--border)')+';background:'+(a?'#FF6B35':'transparent')+';color:'+(a?'#fff':'var(--text)')+';font-size:14px;font-weight:600;cursor:pointer">'+lbl[s]+'</button>';
  }).join('')+'<button onclick="rtCustom()" style="padding:9px 18px;border-radius:20px;border:2px solid '+(isCustom?'#FF6B35':'var(--border)')+';background:'+(isCustom?'#FF6B35':'transparent')+';color:'+(isCustom?'#fff':'var(--text)')+';font-size:14px;font-weight:600;cursor:pointer">'+(isCustom?rtFmt(RT.preset):'Custom')+'</button>';
}
function rtRenderDisplay(){
  const d=document.getElementById('rt-display');
  if(d) d.textContent=rtFmt(RT.remaining);
  const b=document.getElementById('rt-start-btn');
  if(b) b.textContent=RT.running?'Pause':'Start';
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

// â”€â”€ Init day â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function initDay(idx){
  S.dayIdx = idx;
  S.checked = new Set();
  S.sessionNote = '';
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

// â”€â”€ View â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let statsSubTab = 'history';
function setView(v){
  S.view = v;
  document.querySelectorAll('#app-main > section').forEach(el=>el.classList.add('hidden'));
  document.getElementById('view-'+v).classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  if(v==='home') renderHome();
  if(v==='log') renderLog();
  if(v==='stats'){ if(statsSubTab==='history') renderHistory(); else if(statsSubTab==='progress') renderProgress(); else renderBudgetStats(); }
  if(v==='budget') renderBudgetTab();
  if(v==='settings') renderSettings();
  updateNavPill(v);
  updateNavBadges();
}
const NAV_ORDER=['home','log','stats','budget','settings'];
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

// â”€â”€ LOG view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderLog(){
  if(!Object.keys(S.setData).length) initDay(S.dayIdx);
  const t = type(S.dayIdx);

  document.getElementById('day-selector').innerHTML = DAYS.map((d,i)=>{
    const tc = TYPES[d.typeIdx];
    return `<button class="day-pill ${i===S.dayIdx?tc.pillClass:''}" onclick="selectDay(${i})">Day ${d.dayNum}</button>`;
  }).join('');

  document.getElementById('day-name').textContent = t.name;
  const tag = document.getElementById('header-tag');
  if(tag){ tag.textContent=`Day ${S.dayIdx+1} Â· ${t.name}`; tag.style.color=t.barColor; }
  const done=S.checked.size, total=t.exercises.length;
  document.getElementById('comp-text').textContent = `${done}/${total}`;
  document.getElementById('pbar').style.width = Math.round(done/total*100)+'%';
  document.getElementById('pbar').style.background = t.barColor;

  document.getElementById('exercise-list').innerHTML = t.exercises.map(renderExCard).join('');

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
  return `<div class="ex-card${done?' done':''}" id="ec${ei}">
    <div class="ex-top ex-top-bar" style="background:${barColor}">
      <div class="ex-left">
        <div class="ex-name">${displayName}</div>
        ${isSwapped?`<div class="swap-badge">swapped</div>`:''}
        ${ex.note?`<div style="font-size:11px;color:rgba(255,255,255,0.7);margin-top:2px">${ex.note}</div>`:''}
        ${badge?`<div class="ex-badges">${badge}</div>`:''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="swap-btn" onclick="openSwapModal(${ei})" title="Swap exercise" aria-label="Swap exercise">
          <svg viewBox="0 0 24 24"><path d="M7 16V4m0 0L3 8m4-4 4 4"/><path d="M17 8v12m0 0 4-4m-4 4-4-4"/></svg>
        </button>
        <button class="check-btn${done?' done':''}" onclick="toggleDone(${ei})" aria-label="Mark complete">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
        </button>
      </div>
    </div>
    <div class="set-col-labels">
      <div class="set-col-label">#</div>
      <div class="set-col-label">Weight (kg)</div>
      <div class="set-col-label">${unit}</div>
    </div>
    ${setRows}
    <button class="add-set-btn" onclick="addSet(${ei})">+ Add set</button>
  </div>`;
}

function selectDay(idx){ initDay(idx); renderLog(); }

function updSet(ei, si, field, val){
  const ex = type(S.dayIdx).exercises[ei];
  S.setData[ex.name][si][field] = val;
}
function toggleDone(ei){
  S.checked.has(ei) ? S.checked.delete(ei) : S.checked.add(ei);
  renderLog();
}
function addSet(ei){
  const ex = type(S.dayIdx).exercises[ei];
  S.setData[ex.name].push({weight:'',reps:'',hint:''});
  renderLog();
}

// â”€â”€ Save session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // Reset note
  S.sessionNote = '';
  const noteEl = document.getElementById('session-note');
  if(noteEl) noteEl.value = '';

  // Success feedback
  const btn = document.getElementById('save-btn');
  const msg = document.getElementById('save-msg');
  btn.textContent = 'âœ“ Saved!';
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

// â”€â”€ Progressive overload check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Week review â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const inc=(parseFloat(weekBudget.inc_fuji)||0)+(parseFloat(weekBudget.inc_mcd)||0)+(parseFloat(weekBudget.inc_other)||0);
    const transport=parseFloat(weekBudget.fix_transport)||dTransport();
    const spending=dFine()+dSubs()+transport+dGym()+(parseFloat(weekBudget.var_food)||0)+(parseFloat(weekBudget.var_pub)||0)+(parseFloat(weekBudget.var_personal)||0);
    const saved=getWeeklySavings()+(parseFloat(weekBudget.sav_extra)||0);
    const leftover=inc>0?inc-spending-saved:null;
    if(leftover!==null){
      const statusTxt=leftover>=50?'ðŸŸ¢ On track':leftover>=0?'ðŸŸ¡ Tight':'ðŸ”´ Over';
      const col=leftover>=0?'var(--success)':'var(--danger)';
      leftoverLine='<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid var(--border)"><span style="font-size:13px;color:var(--muted)">Budget</span><span style="font-size:13px;font-weight:600;color:'+col+'">'+(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0)+' Â· '+statusTxt+'</span></div>';
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
    +'<div class="sec-label" style="margin-bottom:10px">ðŸ—“ï¸ Week in review</div>'
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
    ?weekSessions.map(s=>'<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)"><span style="font-size:13px;font-weight:600">'+fmtDate(s.date)+'</span><span style="font-size:13px;color:var(--muted)">'+s.sessionType+(s.duration?' Â· '+s.duration+' min':'')+'</span></div>').join('')
    :'<div style="font-size:13px;color:var(--muted);padding:8px 0">No workouts logged this week</div>';

  const bd=budgetData[mondayStr];
  let budHTML='<div style="font-size:13px;color:var(--muted);padding:8px 0">No budget data this week</div>';
  if(bd){
    const inc=(parseFloat(bd.inc_fuji)||0)+(parseFloat(bd.inc_mcd)||0)+(parseFloat(bd.inc_other)||0);
    const transport=parseFloat(bd.fix_transport)||dTransport();
    const food=parseFloat(bd.var_food)||0,pub=parseFloat(bd.var_pub)||0,personal=parseFloat(bd.var_personal)||0;
    const saved=getWeeklySavings()+(parseFloat(bd.sav_extra)||0);
    const fixed=dFine()+dSubs()+transport+dGym();
    const leftover=inc>0?inc-saved-fixed-food-pub-personal:null;
    const col=leftover!==null&&leftover>=0?'var(--success)':'var(--danger)';
    budHTML='<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:var(--muted)">Income</span><span style="font-weight:600;color:var(--success)">'+(inc>0?'$'+inc.toFixed(0):'â€”')+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:var(--muted)">Saved</span><span style="font-weight:600">$'+saved.toFixed(0)+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:var(--muted)">Fixed expenses</span><span style="font-weight:600">$'+fixed.toFixed(0)+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px"><span style="color:var(--muted)">Variable expenses</span><span style="font-weight:600">$'+(food+pub+personal).toFixed(0)+'</span></div>'
      +'<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;font-weight:700;border-top:1px solid var(--border);margin-top:4px"><span>Left over</span><span style="color:'+col+'">'+(leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'â€”')+'</span></div>';
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

// â”€â”€ Exercise swap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ HISTORY view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderHistory(){
  const list = document.getElementById('history-list');
  if(!S.sessions.length){
    list.innerHTML=`<div class="empty"><div class="empty-icon">ðŸ“‹</div><div class="empty-title">No sessions yet</div><div class="empty-sub">Log your first session and it'll appear here</div></div>`;
    return;
  }
  list.innerHTML = [...S.sessions].reverse().map((s,ri)=>{
    const i = S.sessions.length-1-ri;
    const tc = TYPES.find(t=>t.name===s.sessionType)||TYPES[0];
    const summary = s.exercises.map(e=>`${dn(e.name)} (${e.sets.length} sets)`).join(' Â· ');
    const detail = s.exercises.map(ex=>`
      <div class="session-ex-row">
        <div class="session-ex-name">${dn(ex.name)}</div>
        ${ex.sets.map((set,si)=>`<div class="session-set-line">Set ${si+1}: ${set.weight?set.weight+'kg':'â€”'} Ã— ${set.reps||'â€”'}</div>`).join('')}
      </div>`).join('');

    const durStr = s.duration ? ` Â· ${s.duration} min` : '';
    return `<div class="session-card">
      <div class="session-card-top">
        <div class="session-date-str">${fmtDate(s.date)} Â· Day ${s.dayNum}${durStr}</div>
        <div class="session-type-pill ${tc.id}">${s.sessionType}</div>
      </div>
      <div class="session-summary">${summary}</div>
      <div class="session-expand" id="se${i}">${detail}
        <button class="delete-btn" onclick="deleteSession('${s.id}')">Delete session</button>
      </div>
      ${s.note?`<div class="session-note-block" id="sn${i}">${s.note.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`:''}
      <div class="hist-toggle-row">
        <button class="hist-toggle-btn" onclick="toggleExpand('se${i}',this)">Show sets â–¾</button>
        ${s.note?`<button class="hist-toggle-btn" onclick="toggleExpand('sn${i}',this)">Notes â–¾</button>`:''}
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
    const label = btn.textContent.includes('sets') ? (open?'Show sets â–¾':'Hide sets â–´')
                                                     : (open?'Notes â–¾':'Notes â–´');
    btn.textContent = label;
  }
}

function deleteSession(id){
  if(!confirm('Delete this session?')) return;
  S.sessions = S.sessions.filter(s=>s.id!==id);
  persist(); renderHistory();
}

// â”€â”€ WEIGHT tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
              <button onclick="deleteWeight('${w.date}')" style="font-size:12px;color:var(--danger);background:none;border:none;cursor:pointer;padding:0 4px">âœ•</button>
            </div>`).join('')}
        </div>` :
        '<div style="text-align:center;color:var(--muted);font-size:13px;padding:12px 0">No entries yet â€” log your weight above</div>'}
    </div>`;

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

// â”€â”€ PROGRESS view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderProgress(){
  const sel = document.getElementById('pr-select');
  const prev = sel.value;
  sel.innerHTML = ALL_EX.map(n=>`<option value="${n}"${n===prev?' selected':''}>${dn(n)}</option>`).join('');
  if(!sel.value && ALL_EX.length) sel.value = ALL_EX[0];
  renderWeightSection();
  renderWeeklyGrid();
  renderConsistStats();
  renderChart();
  renderPRBoard();
}

function renderWeeklyGrid(){
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
    <div class="week-section-sub">Each square = one day Â· coloured = session logged</div>
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
  document.getElementById('week-grid-wrap').innerHTML=html;
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
    {l:'Avg session',v:avgDur?`${avgDur} min`:'â€”'},
  ].map(s=>`<div class="stat-card"><div class="stat-val">${s.v}</div><div class="stat-lbl">${s.l}</div></div>`).join('');
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
    {l:'Sessions',v:sessions||'â€”'},
    {l:'Total sets',v:totalSets||'â€”'},
    {l:'Best weight',v:pr?pr+'kg':'â€”'},
  ].map(s=>`<div class="stat-card"><div class="stat-val">${s.v}</div><div class="stat-lbl">${s.l}</div></div>`).join('');

  if(S.chart){ S.chart.destroy(); S.chart=null; }
  const ctx = document.getElementById('prog-chart');

  if(!pts.length){
    ctx.style.display='none';
    const msg=ctx.parentElement.querySelector('.no-data-msg');
    if(!msg){
      const p=document.createElement('p');
      p.className='no-data-msg';
      p.style.cssText='text-align:center;color:var(--muted);padding:20px 0;font-size:14px';
      p.textContent='No data yet â€” log some sessions first';
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
          <div class="pr-val${pr?'':' none'}">${pr?pr+'kg':'â€”'}</div>
        </div>`;
      }).join('')}
    </div>`).join('');
}

// â”€â”€ SETTINGS view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  ['account','profile','appearance','personal','calories','saved-foods','income','savings-target','fixed','variable'].forEach(key=>{
    if(!settingsCollapsed[key]) return;
    const body=document.getElementById('ssc-'+key);
    const chev=document.getElementById('sc-'+key);
    const hdr=document.getElementById('sh-'+key);
    if(body) body.style.display='none';
    if(chev) chev.style.transform='rotate(-90deg)';
    if(hdr) hdr.style.marginBottom='0';
  });
}
function renderSettings(){
  const toggle = document.getElementById('theme-toggle');
  if(toggle) toggle.checked = S.theme==='dark';

  const pi = S.personalInfo;
  const fields = ['name','age','sex','height','weight','activity'];
  fields.forEach(f=>{
    const el = document.getElementById('pi-'+f);
    if(el && pi[f]!=null) el.value = pi[f];
  });

  renderTDEESection();
  renderCalorieLog();
  renderSavedFoods();
  renderAccountSection();
  renderSettingsProfile();
  renderSettingsBudgetCustom();
  applySettingsCollapsed();
}

function renderAccountSection(){
  const wrap=document.getElementById('settings-account-section'); if(!wrap) return;
  const c=settingsCollapsed['account']?1:0;
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
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">'+
        avatar+
        '<div style="min-width:0">'+
          '<div style="font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+uname+'</div>'+
          '<div style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+email+'</div>'+
          '<div style="font-size:12px;color:var(--success);margin-top:2px">â— Synced to cloud</div>'+
        '</div>'+
      '</div>'+
      '<button onclick="handleAuth()" style="width:100%;padding:10px;border-radius:10px;border:1.5px solid var(--border);background:transparent;color:var(--muted);font-size:13px;font-weight:600;cursor:pointer">Sign out</button>';
  } else {
    inner=
      '<div style="font-size:13px;color:var(--muted);margin-bottom:14px">Not signed in â€” sign in to sync your data across devices.</div>'+
      '<button onclick="handleAuth()" style="width:100%;padding:10px;border-radius:10px;border:none;background:#4285f4;color:#fff;font-size:13px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">'+
        '<svg viewBox="0 0 24 24" style="width:16px;height:16px;flex-shrink:0"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>'+
        'Sign in with Google'+
      '</button>';
  }
  wrap.innerHTML=
    '<div class="settings-card">'+
      '<div id="sh-account" class="settings-card-title" onclick="toggleSettingsSection(\'account\')" style="cursor:pointer;margin-bottom:'+(c?'0':'14px')+'">'+
        'Account<span id="sc-account" class="settings-chevron" style="'+(c?'transform:rotate(-90deg)':'')+'">â–¼</span>'+
      '</div>'+
      '<div id="ssc-account" style="'+(c?'display:none':'')+'">'+
        inner+
      '</div>'+
    '</div>';
}

function renderSettingsProfile(){
  const wrap=document.getElementById('settings-profile-section'); if(!wrap) return;
  const c=settingsCollapsed['profile']?1:0;
  wrap.innerHTML=`
    <div class="settings-card">
      <div id="sh-profile" class="settings-card-title" onclick="toggleSettingsSection('profile')" style="cursor:pointer;margin-bottom:${c?0:14}px">
        Profile<span id="sc-profile" class="settings-chevron" style="${c?'transform:rotate(-90deg)':''}">â–¼</span>
      </div>
      <div id="ssc-profile" style="${c?'display:none':''}">
        <div class="settings-field">
          <label>Your name</label>
          <input type="text" id="profile-name" placeholder="e.g. Francois" value="${(profileData.name||'').replace(/"/g,'&quot;')}" autocomplete="name">
        </div>
      </div>
    </div>`;
}

function renderSettingsBudgetCustom(){
  const wrap=document.getElementById('settings-budget-section'); if(!wrap) return;
  const bd=budDefaults;
  const cv=key=>settingsCollapsed[key]?1:0;
  wrap.innerHTML=`
    <div class="settings-card">
      <div id="sh-income" class="settings-card-title" onclick="toggleSettingsSection('income')" style="cursor:pointer;margin-bottom:${cv('income')?0:14}px">
        Income sources<span id="sc-income" class="settings-chevron" style="${cv('income')?'transform:rotate(-90deg)':''}">â–¼</span>
      </div>
      <div id="ssc-income" style="${cv('income')?'display:none':''}">
        <div class="settings-2col">
          <div class="settings-field"><label>Job 1 label</label><input type="text" id="s-inc1-label" placeholder="e.g. Fujifilm" value="${(bd.inc1_label||'').replace(/"/g,'&quot;')}"></div>
          <div class="settings-field"><label>Weekly amount ($)</label><input type="number" id="s-inc1-amount" inputmode="decimal" placeholder="507" value="${bd.inc1_amount??''}"></div>
        </div>
        <div class="settings-2col">
          <div class="settings-field"><label>Job 2 label</label><input type="text" id="s-inc2-label" placeholder="e.g. McDonald's" value="${(bd.inc2_label||'').replace(/"/g,'&quot;')}"></div>
          <div class="settings-field"><label>Weekly amount ($)</label><input type="number" id="s-inc2-amount" inputmode="decimal" placeholder="278" value="${bd.inc2_amount??''}"></div>
        </div>
        <div class="settings-field"><label>Other income label (optional)</label><input type="text" id="s-inc3-label" placeholder="e.g. Freelance" value="${(bd.inc3_label||'').replace(/"/g,'&quot;')}"></div>
      </div>
    </div>
    <div class="settings-card">
      <div id="sh-savings-target" class="settings-card-title" onclick="toggleSettingsSection('savings-target')" style="cursor:pointer;margin-bottom:${cv('savings-target')?0:14}px">
        Weekly savings target<span id="sc-savings-target" class="settings-chevron" style="${cv('savings-target')?'transform:rotate(-90deg)':''}">â–¼</span>
      </div>
      <div id="ssc-savings-target" style="${cv('savings-target')?'display:none':''}">
        <div class="settings-field"><label>Target ($)</label><input type="number" id="s-weekly-savings" inputmode="decimal" placeholder="350" value="${bd.weeklySavings??''}"></div>
      </div>
    </div>
    <div class="settings-card">
      <div id="sh-fixed" class="settings-card-title" onclick="toggleSettingsSection('fixed')" style="cursor:pointer;margin-bottom:${cv('fixed')?0:14}px">
        Fixed expenses<span id="sc-fixed" class="settings-chevron" style="${cv('fixed')?'transform:rotate(-90deg)':''}">â–¼</span>
      </div>
      <div id="ssc-fixed" style="${cv('fixed')?'display:none':''}">
        <div class="settings-2col">
          <div class="settings-field"><label>Fine label</label><input type="text" id="s-fine-label" placeholder="Fine repayment" value="${(bd.fine_label||'').replace(/"/g,'&quot;')}"></div>
          <div class="settings-field"><label>Amount ($)</label><input type="number" id="s-fine-amt" inputmode="decimal" placeholder="25" value="${bd.fine??''}"></div>
        </div>
        <div class="settings-2col">
          <div class="settings-field"><label>Subscriptions label</label><input type="text" id="s-subs-label" placeholder="Subscriptions" value="${(bd.subs_label||'').replace(/"/g,'&quot;')}"></div>
          <div class="settings-field"><label>Amount ($)</label><input type="number" id="s-subs-amt" inputmode="decimal" placeholder="17" value="${bd.subs??''}"></div>
        </div>
        <div class="settings-2col">
          <div class="settings-field"><label>Transport label</label><input type="text" id="s-transport-label" placeholder="Transport" value="${(bd.transport_label||'').replace(/"/g,'&quot;')}"></div>
          <div class="settings-field"><label>Budget ($)</label><input type="number" id="s-transport-amt" inputmode="decimal" placeholder="50" value="${bd.transport??''}"></div>
        </div>
        <div class="settings-2col">
          <div class="settings-field"><label>Gym label</label><input type="text" id="s-gym-label" placeholder="Anytime Fitness" value="${(bd.gym_label||'').replace(/"/g,'&quot;')}"></div>
          <div class="settings-field"><label>Amount ($)</label><input type="number" id="s-gym-amt" inputmode="decimal" placeholder="27" value="${bd.gym??''}"></div>
        </div>
      </div>
    </div>
    <div class="settings-card">
      <div id="sh-variable" class="settings-card-title" onclick="toggleSettingsSection('variable')" style="cursor:pointer;margin-bottom:${cv('variable')?0:14}px">
        Variable spending budgets<span id="sc-variable" class="settings-chevron" style="${cv('variable')?'transform:rotate(-90deg)':''}">â–¼</span>
      </div>
      <div id="ssc-variable" style="${cv('variable')?'display:none':''}">
        <div class="settings-2col">
          <div class="settings-field"><label>Food / week ($)</label><input type="number" id="s-food-bud" inputmode="decimal" placeholder="70" value="${bd.food_bud??''}"></div>
          <div class="settings-field"><label>Pub &amp; social / week ($)</label><input type="number" id="s-pub-bud" inputmode="decimal" placeholder="100" value="${bd.pub_bud??''}"></div>
        </div>
        <div class="settings-field"><label>Personal &amp; misc / week ($)</label><input type="number" id="s-personal-bud" inputmode="decimal" placeholder="60" value="${bd.personal_bud??''}"></div>
      </div>
    </div>
    <div class="settings-card">
      <button class="settings-save-btn" id="settings-all-save-btn" onclick="saveAllSettings()">Save settings</button>
      <div id="settings-all-save-msg" style="display:none;text-align:center;color:var(--accent);font-size:14px;font-weight:500;padding:8px 0">Saved âœ“</div>
    </div>`;
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
  budDefaults.inc1_label      = gn('s-inc1-label');
  budDefaults.inc1_amount     = gf('s-inc1-amount');
  budDefaults.inc2_label      = gn('s-inc2-label');
  budDefaults.inc2_amount     = gf('s-inc2-amount');
  budDefaults.inc3_label      = gn('s-inc3-label');
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
  localStorage.setItem('daily_budget_defaults', JSON.stringify(budDefaults));
  syncBudDefaultsToFirebase();

  // Button feedback
  const btn=document.getElementById('settings-all-save-btn');
  if(btn){
    btn.textContent='Saved âœ“';
    btn.style.background='var(--accent)';
    setTimeout(()=>{ btn.textContent='Save settings'; btn.style.background=''; }, 2000);
  }
  // Card flash â€” profile section + all budget cards except the button card
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

  const btn = document.querySelector('.settings-save-btn');
  if(btn){
    btn.textContent='âœ“ Saved!'; btn.style.background='var(--accent)';
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
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">TDEE: ${c.tdee} kcal Â· tap a goal to track it</div>
      <div class="tdee-grid">
        <div class="tdee-card" style="color:var(--danger);border-color:${g==='cut'?'var(--danger)':'var(--border)'}" onclick="selectGoal('cut')">
          <div class="tdee-card-val">${c.cut}</div>
          <div class="tdee-card-lbl">Cut</div>
          ${g==='cut'?'<div class="tdee-card-active" style="color:var(--danger)">âœ“ Active</div>':''}
        </div>
        <div class="tdee-card" style="color:var(--success);border-color:${g==='maintain'?'var(--success)':'var(--border)'}" onclick="selectGoal('maintain')">
          <div class="tdee-card-val">${c.maintain}</div>
          <div class="tdee-card-lbl">Maintain</div>
          ${g==='maintain'?'<div class="tdee-card-active" style="color:var(--success)">âœ“ Active</div>':''}
        </div>
        <div class="tdee-card" style="color:var(--blue);border-color:${g==='bulk'?'var(--blue)':'var(--border)'}" onclick="selectGoal('bulk')">
          <div class="tdee-card-val">${c.bulk}</div>
          <div class="tdee-card-lbl">Bulk</div>
          ${g==='bulk'?'<div class="tdee-card-active" style="color:var(--blue)">âœ“ Active</div>':''}
        </div>
      </div>
    </div>`;
}

// â”€â”€ Calorie log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        <div class="cal-entry-name">${e.name.replace(/</g,'&lt;')||'â€”'}</div>
        <div class="cal-entry-kcal">${e.kcal} kcal</div>
        <button class="cal-del-btn" onclick="deleteCalEntry(${i})">âœ•</button>
      </div>`;
    });
    html += `</div>
      <div style="padding-top:10px;font-size:14px;font-weight:700;text-align:right">Total: ${total} kcal</div>`;
  } else {
    html += `<div style="text-align:center;color:var(--muted);font-size:13px;padding:14px 0">No food logged today</div>`;
  }

  wrap.innerHTML = html;
}

function logCalorie(){
  const food = document.getElementById('cal-food');
  const kcalEl = document.getElementById('cal-kcal');
  const kcal = parseInt(kcalEl.value);
  if(!kcal||kcal<=0) return;
  S.dailyLog.entries.push({name: food.value.trim()||'Unknown', kcal});
  persistDailyLog();
  food.value=''; kcalEl.value='';
  renderCalorieLog();
}
function deleteCalEntry(i){
  S.dailyLog.entries.splice(i, 1);
  persistDailyLog();
  renderCalorieLog();
}

// â”€â”€ Saved foods (favourites) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  S.dailyLog.entries.push({name, kcal});
  persistDailyLog();
  renderCalorieLog();
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
        <span onclick="logFromFavourite('${safeName}',${f.kcal})" style="font-size:13px;font-weight:600;color:var(--blue-dark);cursor:pointer">${safeName} Â· ${f.kcal} kcal</span>
        <button onclick="deleteSavedFood(${i})" style="font-size:12px;color:var(--muted);background:none;border:none;cursor:pointer;padding:0 2px;line-height:1;flex-shrink:0">âœ•</button>
      </div>`;
    });
    html+=`</div>`;
  } else {
    html+=`<div style="text-align:center;color:var(--muted);font-size:13px;padding:10px 0">No saved foods yet â€” save frequent meals above</div>`;
  }
  wrap.innerHTML=html;
}

// â”€â”€ Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function exportBudgetCSV(){
  const keys=Object.keys(budgetData).sort();
  if(!keys.length){ alert('No budget weeks saved yet.'); return; }
  const rows=['Week,Income,Saved,Fine,Subs,Transport,Gym,Food,Pub,Personal,Total Out,Leftover'];
  let tIncome=0,tSaved=0,tFine=0,tSubs=0,tTransport=0,tGym=0,tFood=0,tPub=0,tPersonal=0,tOut=0,tLeft=0;
  keys.forEach(k=>{
    const d=budgetData[k];
    const mon=new Date(k+'T12:00:00'),fri=new Date(mon); fri.setDate(mon.getDate()+4);
    const lbl=mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' â€“ '+fri.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
    const income=(parseFloat(d.inc_fuji)||0)+(parseFloat(d.inc_mcd)||0)+(parseFloat(d.inc_other)||0);
    const saved=getWeeklySavings()+(parseFloat(d.sav_extra)||0);
    const fine=dFine(),subs=dSubs(),transport=parseFloat(d.fix_transport)||dTransport(),gym=dGym();
    const food=parseFloat(d.var_food)||0,pub=parseFloat(d.var_pub)||0,personal=parseFloat(d.var_personal)||0;
    const out=saved+fine+subs+transport+gym+food+pub+personal;
    const left=income>0?income-out:0;
    tIncome+=income;tSaved+=saved;tFine+=fine;tSubs+=subs;tTransport+=transport;tGym+=gym;
    tFood+=food;tPub+=pub;tPersonal+=personal;tOut+=out;tLeft+=income>0?left:0;
    rows.push([`"${lbl}"`,income,saved,fine,subs,transport,gym,food,pub,personal,out,income>0?left:''].join(','));
  });
  rows.push(['"Totals"',tIncome,tSaved,tFine,tSubs,tTransport,tGym,tFood,tPub,tPersonal,tOut,tLeft].join(','));
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


// â”€â”€ Budget constants (fallback defaults) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DEFAULT_SAVINGS   = 350;
const DEFAULT_FINE      = 25;
const DEFAULT_SUBS      = 17;
const DEFAULT_GYM       = 27;
const DEFAULT_TRANSPORT = 50;
const DEFAULT_FOOD      = 70;
const DEFAULT_PUB       = 100;
const DEFAULT_PERSONAL  = 60;

// â”€â”€ Budget state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let currentWeekIdx     = 0;
let currentMonthOffset = 0;
let budgetView         = 'week';
let budgetData         = budLoadData();
let budDefaults        = budLoadDefaults();
let savingsLog         = loadSavingsLog();
let profileData        = loadProfileData();
let settingsCollapsed  = (()=>{try{return JSON.parse(localStorage.getItem('daily_settings_collapsed')||'{}');}catch{return {};}})();
let habitsData         = loadHabits();
let habitsLog          = loadHabitsLog();
let budChart           = null;
let budTrendRange      = 'monthly';
let bsChart            = null;
let bsBalChart         = null;
let bsTrendRange       = 'monthly';

// â”€â”€ Budget storage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function budLoadData(){
  try{ return JSON.parse(localStorage.getItem('daily_budget')||'{}'); }
  catch{ return {}; }
}
function budSaveData(){
  localStorage.setItem('daily_budget', JSON.stringify(budgetData));
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
function dFineLabel()      { return budDefaults.fine_label      || 'âš™ï¸ Fine repayment'; }
function dSubsLabel()      { return budDefaults.subs_label      || 'ðŸ“± Subscriptions'; }
function dGymLabel()       { return budDefaults.gym_label       || 'ðŸ‹ï¸ Gym'; }
function dTransportLabel() { return budDefaults.transport_label || 'ðŸšŒ Transport'; }
function dTransportBud()   { return budDefaults.transport       ?? DEFAULT_TRANSPORT; }
function dFoodBud()    { return budDefaults.food_bud    ?? DEFAULT_FOOD; }
function dPubBud()     { return budDefaults.pub_bud     ?? DEFAULT_PUB; }
function dPersonalBud(){ return budDefaults.personal_bud ?? DEFAULT_PERSONAL; }

// â”€â”€ Timezone-aware date helpers (Australia/Sydney) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Week / month key helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  return monday.toLocaleDateString('en-AU',opts)+' â€“ '+fri.toLocaleDateString('en-AU',opts);
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

// â”€â”€ Budget view toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Week navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function changeWeek(dir){
  if(dir>0&&currentWeekIdx>=0) return;
  currentWeekIdx+=dir; renderBudgetTab();
}
function changeMonth(dir){
  if(dir>0&&currentMonthOffset>=0) return;
  currentMonthOffset+=dir; renderMonth();
}

// â”€â”€ Render budget tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderBudgetTab(){
  const monday=getMondayOf(currentWeekIdx);
  const key=weekKey(monday);
  const data=getBudWeekData(key);
  const isCur=currentWeekIdx===0;

  document.getElementById('week-label-main').textContent=
    isCur?'This week':currentWeekIdx===-1?'Last week':Math.abs(currentWeekIdx)+' weeks ago';
  document.getElementById('week-label-sub').textContent=fmtWeekLabel(monday);
  document.getElementById('week-next-btn').style.opacity=currentWeekIdx>=0?'0.3':'1';

  const perWeek={
    'inc-fuji':'inc_fuji','inc-mcd':'inc_mcd','inc-other':'inc_other',
    'inc-other-label':'inc_other_label','sav-extra':'sav_extra',
    'fix-transport':'fix_transport','var-food':'var_food',
    'var-pub':'var_pub','var-personal':'var_personal'
  };
  Object.entries(perWeek).forEach(([id,dk])=>{
    const el=document.getElementById(id); if(!el) return;
    el.value=data[dk]||''; el.disabled=!isCur; el.style.opacity=isCur?'1':'0.7';
  });

  const fe=document.getElementById('fix-fine');
  const se=document.getElementById('fix-subs');
  const ge=document.getElementById('fix-gym');
  if(fe) fe.value=budDefaults.fine!=null?budDefaults.fine:'';
  if(se) se.value=budDefaults.subs!=null?budDefaults.subs:'';
  if(ge) ge.value=budDefaults.gym!=null?budDefaults.gym:'';

  // Update dynamic labels
  const setText=(id,t)=>{ const el=document.getElementById(id); if(el) el.textContent=t; };
  setText('inc1-name-lbl', inc1Label());
  setText('inc1-bud-lbl',  'Budget $'+inc1Amount()+'/wk');
  setText('inc2-name-lbl', inc2Label());
  setText('inc2-bud-lbl',  'Budget $'+inc2Amount()+'/wk');
  setText('savings-target-lbl', '$'+getWeeklySavings());
  setText('fix-fine-lbl',      dFineLabel());
  setText('fix-subs-lbl',      dSubsLabel());
  setText('fix-transport-lbl', dTransportLabel());
  setText('fix-transport-bud-lbl', 'Budget $'+dTransportBud()+'/wk');
  setText('fix-gym-lbl',       dGymLabel());
  setText('var-food-bud-lbl',     'Budget $'+dFoodBud()+'/wk');
  setText('var-pub-bud-lbl',      'Budget $'+dPubBud()+'/wk');
  setText('var-personal-bud-lbl', 'Budget $'+dPersonalBud()+'/wk');

  const notesEl=document.getElementById('week-notes');
  if(notesEl){ notesEl.value=data.notes||''; notesEl.disabled=!isCur; }

  const saveBtn=document.getElementById('save-week-btn');
  const saveMsg=document.getElementById('save-week-msg');
  if(saveBtn) saveBtn.style.display=isCur?'block':'none';
  if(saveMsg) saveMsg.style.display='none';

  budRecalc();
  renderPrevWeeks();
}

function budRecalc(){
  const v=id=>parseFloat(document.getElementById(id)?.value)||0;
  const totalIncome = v('inc-fuji')+v('inc-mcd')+v('inc-other');
  const savExtra    = v('sav-extra');
  const fine        = parseFloat(document.getElementById('fix-fine')?.value)||dFine();
  const subs        = parseFloat(document.getElementById('fix-subs')?.value)||dSubs();
  const transport   = parseFloat(document.getElementById('fix-transport')?.value)||dTransport();
  const gym         = parseFloat(document.getElementById('fix-gym')?.value)||dGym();
  const food        = v('var-food'), pub=v('var-pub'), personal=v('var-personal');

  const totalSaved  = getWeeklySavings()+savExtra;
  const totalFixed  = fine+subs+transport+gym;
  const totalVar    = food+pub+personal;
  const totalOut    = totalSaved+totalFixed+totalVar;
  const leftover    = totalIncome>0?totalIncome-totalOut:null;

  const $ = (id,t) => { const el=document.getElementById(id); if(el) el.textContent=t; };
  $('calc-income',  totalIncome>0?'$'+totalIncome.toFixed(0):'â€”');
  $('calc-saved',   '$'+totalSaved.toFixed(0));
  $('calc-fixed',   '$'+totalFixed.toFixed(0));
  $('calc-variable',totalVar>0?'$'+totalVar.toFixed(0):'â€”');
  $('calc-leftover',leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'â€”');

  const pill=document.getElementById('week-status-pill');
  if(pill){
    if(leftover===null){pill.className='status-pill good';pill.textContent='â³ Enter income';}
    else if(leftover>=50){pill.className='status-pill good';pill.textContent='ðŸŸ¢ On track';}
    else if(leftover>=0){pill.className='status-pill warn';pill.textContent='ðŸŸ¡ Tight week';}
    else{pill.className='status-pill over';pill.textContent='ðŸ”´ Over budget';}
  }

  const sumEl=document.getElementById('budget-summary');
  if(sumEl) sumEl.innerHTML=[
    {val:totalIncome>0?'$'+totalIncome.toFixed(0):'â€”',lbl:'Income',color:'var(--success)'},
    {val:'$'+totalSaved.toFixed(0),lbl:'Saved',color:'var(--blue)'},
    {val:leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'â€”',lbl:'Left over',
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
  budSaveDraft();
}

function budSaveDraft(){
  if(currentWeekIdx !== 0) return;
  const key=weekKey(getMondayOf(0));
  if(!budgetData[key]) budgetData[key]={};
  const d=budgetData[key];
  const gv=id=>document.getElementById(id)?.value||'';
  d.inc_fuji=gv('inc-fuji'); d.inc_mcd=gv('inc-mcd');
  d.inc_other=gv('inc-other'); d.inc_other_label=gv('inc-other-label');
  d.sav_extra=gv('sav-extra'); d.fix_transport=gv('fix-transport');
  d.var_food=gv('var-food'); d.var_pub=gv('var-pub'); d.var_personal=gv('var-personal');
  d.notes=gv('week-notes');
  if(!d.saved) d.draft=true;
  budSaveData();
}

function budSaveCurrentWeek(){
  const monday=getMondayOf(currentWeekIdx);
  const key=weekKey(monday);
  if(!budgetData[key]) budgetData[key]={};
  const d=budgetData[key];
  const gv=id=>document.getElementById(id)?.value||'';
  d.inc_fuji=gv('inc-fuji'); d.inc_mcd=gv('inc-mcd');
  d.inc_other=gv('inc-other'); d.inc_other_label=gv('inc-other-label');
  d.sav_extra=gv('sav-extra'); d.fix_transport=gv('fix-transport');
  d.var_food=gv('var-food'); d.var_pub=gv('var-pub'); d.var_personal=gv('var-personal');
  d.notes=gv('week-notes');
  d.saved=true; delete d.draft;
  budSaveData(); renderPrevWeeks(); updateNavBadges();
  const btn=document.getElementById('save-week-btn');
  const msg=document.getElementById('save-week-msg');
  if(btn){btn.textContent='âœ“ Saved!';btn.style.background='var(--accent)';}
  if(msg) msg.style.display='block';
  setTimeout(()=>{
    if(btn){btn.textContent='Save week';btn.style.background='';}
    if(msg) msg.style.display='none';
  },1800);
}

function renderPrevWeeks(){
  const wrap=document.getElementById('prev-weeks-section'); if(!wrap) return;
  const curKey=weekKey(getMondayOf(currentWeekIdx));
  const keys=Object.keys(budgetData).filter(k=>k<curKey).sort((a,b)=>b.localeCompare(a)).slice(0,8);
  if(!keys.length){wrap.innerHTML='';return;}
  let html='<div class="card"><div class="sec-label" style="margin-bottom:10px">Previous weeks</div>';
  keys.forEach(k=>{
    const d=budgetData[k];
    const inc=(parseFloat(d.inc_fuji)||0)+(parseFloat(d.inc_mcd)||0)+(parseFloat(d.inc_other)||0);
    const saved=getWeeklySavings()+(parseFloat(d.sav_extra)||0);
    const transport=parseFloat(d.fix_transport)||dTransport();
    const varT=(parseFloat(d.var_food)||0)+(parseFloat(d.var_pub)||0)+(parseFloat(d.var_personal)||0);
    const out=saved+dFine()+dSubs()+transport+dGym()+varT;
    const left=inc>0?inc-out:null;
    const mon=new Date(k+'T12:00:00');
    const fri=new Date(mon); fri.setDate(mon.getDate()+4);
    const lbl=mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' â€“ '+fri.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
    html+='<div class="prev-week-row"><div class="prev-week-date">'+lbl+'</div><div class="prev-week-pills">';
    if(inc>0) html+='<span class="prev-pill in">$'+inc.toFixed(0)+' in</span>';
    html+='<span class="prev-pill saved">$'+saved.toFixed(0)+' saved</span>';
    if(left!==null) html+='<span class="prev-pill '+(left>=0?'left':'over')+'">'+(left>=0?'+':'-')+'$'+Math.abs(left).toFixed(0)+'</span>';
    html+='</div></div>';
  });
  html+='</div>';
  wrap.innerHTML=html;
}

function renderMonth(){
  const monthDate=getMonthDate(currentMonthOffset);
  const isCur=currentMonthOffset>=0;
  document.getElementById('month-label-main').textContent=fmtMonthLabel(monthDate);
  document.getElementById('month-next-btn').style.opacity=isCur?'0.3':'1';
  const keys=getMondaysInMonth(monthDate);
  let totalIncome=0,totalSaved=0,totalFood=0,totalPub=0,totalPersonal=0,weekCount=0;
  keys.forEach(k=>{
    const d=budgetData[k]; if(!d) return; weekCount++;
    totalIncome+=(parseFloat(d.inc_fuji)||0)+(parseFloat(d.inc_mcd)||0)+(parseFloat(d.inc_other)||0);
    totalSaved+=getWeeklySavings()+(parseFloat(d.sav_extra)||0);
    totalFood+=parseFloat(d.var_food)||0;
    totalPub+=parseFloat(d.var_pub)||0;
    totalPersonal+=parseFloat(d.var_personal)||0;
  });
  const totalFixed=keys.reduce((acc,k)=>{
    const d=budgetData[k]; if(!d) return acc;
    return acc+dFine()+dSubs()+(parseFloat(d.fix_transport)||dTransport())+dGym();
  },0);
  const totalVar=totalFood+totalPub+totalPersonal;
  const totalOut=totalSaved+totalFixed+totalVar;
  const leftover=totalIncome>0?totalIncome-totalOut:null;

  document.getElementById('month-label-sub').textContent=weekCount>0?weekCount+' week'+(weekCount>1?'s':'')+' recorded':'No data saved yet';

  const sg=document.getElementById('month-summary-grid');
  if(sg) sg.innerHTML=[
    {val:totalIncome>0?'$'+totalIncome.toFixed(0):'â€”',lbl:'Income',color:'var(--success)'},
    {val:weekCount>0?'$'+totalSaved.toFixed(0):'â€”',lbl:'Saved',color:'var(--blue)'},
    {val:leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'â€”',lbl:'Left over',
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
  if(catEl) catEl.innerHTML=[
    {label:'ðŸ” Food',val:totalFood,bud:dFoodBud()*weekCount,color:'#52B788'},
    {label:'ðŸº Pub & social',val:totalPub,bud:dPubBud()*weekCount,color:'#f59e0b'},
    {label:'ðŸ‘œ Personal',val:totalPersonal,bud:dPersonalBud()*weekCount,color:'#6366f1'},
  ].map(c=>{
    const pct=weekCount>0?Math.min(100,Math.round(c.val/Math.max(c.bud,1)*100)):0;
    const over=c.val>c.bud&&c.bud>0;
    return '<div class="month-cat-row"><div class="month-cat-label">'+c.label+'</div>'
      +'<div class="month-cat-bar-wrap"><div class="month-cat-bar-fill" style="width:'+pct+'%;background:'+(over?'var(--danger)':c.color)+'"></div></div>'
      +'<div class="month-cat-amount" style="color:'+(over?'var(--danger)':'var(--text)')+'">'+( c.val>0?'$'+c.val.toFixed(0):'â€”')+'</div></div>';
  }).join('');

  const wl=document.getElementById('month-weeks-list');
  if(wl){
    if(!keys.length){wl.innerHTML='<div style="font-size:13px;color:var(--muted);padding:8px 0">Save some weeks first.</div>';}
    else wl.innerHTML=keys.map(k=>{
      const d=budgetData[k]; if(!d) return '';
      const inc=(parseFloat(d.inc_fuji)||0)+(parseFloat(d.inc_mcd)||0)+(parseFloat(d.inc_other)||0);
      const transport=parseFloat(d.fix_transport)||dTransport();
      const out=getWeeklySavings()+(parseFloat(d.sav_extra)||0)+dFine()+dSubs()+transport+dGym()
               +(parseFloat(d.var_food)||0)+(parseFloat(d.var_pub)||0)+(parseFloat(d.var_personal)||0);
      const left=inc>0?inc-out:null;
      const mon=new Date(k+'T12:00:00'),fri=new Date(mon); fri.setDate(mon.getDate()+4);
      const lbl=mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'})+' â€“ '+fri.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
      return '<div class="month-week-row"><div class="month-week-lbl">'+lbl+'</div>'
        +'<div class="month-week-val" style="color:'+(left===null?'var(--muted)':left>=0?'var(--green-dark)':'var(--amber-dark)')+'">'+
        (left!==null?(left>=0?'+$':'-$')+Math.abs(left).toFixed(0):'â€”')+'</div></div>';
    }).join('');
  }
  renderSavingsCard();
}

// â”€â”€ Budget trends â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getBudWeekTotals(d){
  const income   = (parseFloat(d.inc_fuji)||0)+(parseFloat(d.inc_mcd)||0)+(parseFloat(d.inc_other)||0);
  const spending = dFine()+dSubs()+(parseFloat(d.fix_transport)||dTransport())+dGym()
                 +(parseFloat(d.var_food)||0)+(parseFloat(d.var_pub)||0)+(parseFloat(d.var_personal)||0);
  const saved    = getWeeklySavings()+(parseFloat(d.sav_extra)||0);
  return {income,spending,saved};
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

// â”€â”€ Savings account card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderSavingsCard(){
  const wrap=document.getElementById('bud-savings-card-wrap'); if(!wrap) return;
  const today=getLocalDate();
  const sorted=[...savingsLog].sort((a,b)=>a.date<b.date?-1:1);
  const cur=sorted.length?sorted[sorted.length-1]:null;
  wrap.innerHTML=`<div class="card">
    <div class="sec-label" style="margin-bottom:12px">ðŸ¦ Savings account</div>
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
          <button onclick="deleteSavingsEntry('${e.date}')" style="font-size:12px;color:var(--danger);background:none;border:none;cursor:pointer;padding:0 4px">âœ•</button>
        </div>`).join('')}
    </div>`:'<div style="text-align:center;color:var(--muted);font-size:13px;padding:8px 0">No entries yet â€” log your balance above</div>'}
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

// â”€â”€ Savings goals card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          <button onclick="deleteGoal(${i})" style="font-size:12px;color:var(--danger);background:none;border:none;cursor:pointer;padding:0">âœ•</button>
        </div>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:6px">
        <div style="width:${pct}%;height:100%;background:${bc};border-radius:3px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">
        <span>${pct}%${curBal>0?' ($'+curBal.toLocaleString()+')':''}</span>
        <span>${pct>=100?'ðŸŽ‰ Reached!':(remaining>0?'$'+remaining.toLocaleString()+' to go':'')+(weeklyNeeded?' Â· '+weeklyNeeded:'')}</span>
      </div>
    </div>`;
  }).join('');
  wrap.innerHTML=`<div class="card">
    <div class="sec-label" style="margin-bottom:12px">ðŸŽ¯ Savings goals</div>
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

// â”€â”€ Budget Stats (Stats tab) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    wrap.innerHTML='<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px 0">Save at least 2 weeks of data to see trends.</div>';
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
    wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden"><div style="background:#52B788;padding:8px 14px;font-size:13px;font-weight:500;color:#fff">ðŸ’° Account balance</div><div style="padding:14px 16px;text-align:center;color:var(--muted);font-size:13px">Log at least 2 balance entries in Budget â†’ Month to see the chart.</div></div>';
    return;
  }
  wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden"><div style="background:#52B788;padding:8px 14px;font-size:13px;font-weight:500;color:#fff">ðŸ’° Account balance</div><div style="padding:14px 16px"><canvas id="bs-bal-chart"></canvas></div></div>';
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
    wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden"><div style="background:#6366f1;padding:8px 14px;font-size:13px;font-weight:500;color:#fff">ðŸ“… Budget consistency</div><div style="padding:14px 16px;text-align:center;color:var(--muted);font-size:13px">No weeks saved yet.</div></div>';
    return;
  }
  const cells=allKeys.map(k=>{
    const d=budgetData[k]; if(!d) return '';
    const inc=(parseFloat(d.inc_fuji)||0)+(parseFloat(d.inc_mcd)||0)+(parseFloat(d.inc_other)||0);
    const spending=dFine()+dSubs()+(parseFloat(d.fix_transport)||dTransport())+dGym()+(parseFloat(d.var_food)||0)+(parseFloat(d.var_pub)||0)+(parseFloat(d.var_personal)||0);
    const saved=getWeeklySavings()+(parseFloat(d.sav_extra)||0);
    const leftover=inc>0?inc-spending-saved:null;
    const mon=new Date(k+'T12:00:00');
    const dayLbl=mon.toLocaleDateString('en-AU',{day:'numeric',month:'short'});
    const status=leftover===null?'grey':leftover>=50?'green':leftover>=0?'amber':'red';
    const bg={green:'#52B788',amber:'#f59e0b',red:'#E74C3C',grey:'var(--border)'};
    const fg={green:'#fff',amber:'#fff',red:'#fff',grey:'var(--muted)'};
    const valLbl=leftover!==null?(leftover>=0?'+$':'-$')+Math.abs(leftover).toFixed(0):'â€”';
    return '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:3px">'
      +'<div style="width:100%;height:48px;background:'+bg[status]+';border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:'+fg[status]+'">'+valLbl+'</div>'
      +'<div style="font-size:9px;color:var(--muted);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;padding:0 1px">'+dayLbl+'</div>'
      +'</div>';
  }).join('');
  wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden">'
    +'<div style="background:#6366f1;padding:8px 14px;font-size:13px;font-weight:500;color:#fff">ðŸ“… Budget consistency</div>'
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
    wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden"><div style="background:#f59e0b;padding:8px 14px;font-size:13px;font-weight:500;color:#fff">ðŸ† Personal records</div><div style="padding:14px 16px;text-align:center;color:var(--muted);font-size:13px">Save at least 2 weeks to see records.</div></div>';
    return;
  }
  let bestInc={val:0,key:null},bestSav={val:0,key:null},loSpend={val:Infinity,key:null};
  keys.forEach(k=>{
    const d=budgetData[k]; if(!d) return;
    const inc=(parseFloat(d.inc_fuji)||0)+(parseFloat(d.inc_mcd)||0)+(parseFloat(d.inc_other)||0);
    const spend=dFine()+dSubs()+(parseFloat(d.fix_transport)||dTransport())+dGym()+(parseFloat(d.var_food)||0)+(parseFloat(d.var_pub)||0)+(parseFloat(d.var_personal)||0);
    const sav=getWeeklySavings()+(parseFloat(d.sav_extra)||0);
    if(inc>0&&inc>bestInc.val){bestInc={val:inc,key:k};}
    if(sav>bestSav.val){bestSav={val:sav,key:k};}
    if(inc>0&&spend<loSpend.val){loSpend={val:spend,key:k};}
  });
  const fmtWk=k=>{if(!k) return 'â€”'; return new Date(k+'T12:00:00').toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'2-digit'});};
  const rows=[
    {icon:'ðŸ’µ',label:'Highest income',val:bestInc.key?'$'+bestInc.val.toFixed(0):'â€”',wk:fmtWk(bestInc.key)},
    {icon:'ðŸ“‰',label:'Lowest spending',val:loSpend.key&&isFinite(loSpend.val)?'$'+loSpend.val.toFixed(0):'â€”',wk:fmtWk(loSpend.key)},
    {icon:'ðŸ…',label:'Most saved',val:bestSav.key?'$'+bestSav.val.toFixed(0):'â€”',wk:fmtWk(bestSav.key)},
  ];
  wrap.innerHTML='<div class="card" style="padding:0;overflow:hidden">'
    +'<div style="background:#f59e0b;padding:8px 14px;font-size:13px;font-weight:500;color:#fff">ðŸ† Personal records</div>'
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
          <button onclick="deleteGoal(${i})" style="font-size:12px;color:var(--danger);background:none;border:none;cursor:pointer;padding:0">âœ•</button>
        </div>
      </div>
      <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden;margin-bottom:6px">
        <div style="width:${pct}%;height:100%;background:${bc};border-radius:3px"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--muted)">
        <span>${pct}%${curBal>0?' ($'+curBal.toLocaleString()+')':''}</span>
        <span>${pct>=100?'ðŸŽ‰ Reached!':(remaining>0?'$'+remaining.toLocaleString()+' to go':'')+(weeklyNeeded?' Â· '+weeklyNeeded:'')}</span>
      </div>
    </div>`;
  }).join('');
  wrap.innerHTML=`<div class="card" style="padding:0;overflow:hidden">
    <div style="background:#3b82f6;padding:8px 14px;font-size:13px;font-weight:500;color:#fff">ðŸŽ¯ Savings goals</div>
    <div style="padding:14px 16px">
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${goals.length?'12px':'0'}">
        <input type="text" id="bs-goal-name" placeholder="Goal name" style="flex:1 1 100px;min-width:0;box-sizing:border-box;height:38px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;padding:0 8px;background:var(--card);color:var(--text)">
        <input type="number" id="bs-goal-target" inputmode="decimal" placeholder="$ Target" style="flex:1 1 70px;min-width:0;box-sizing:border-box;height:38px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;text-align:center;background:var(--card);color:var(--text)">
        <input type="date" id="bs-goal-date" style="flex:1 1 110px;min-width:0;box-sizing:border-box;height:38px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;padding:0 6px;background:var(--card);color:var(--text)">
        <button onclick="addBSGoal()" style="flex-shrink:0;padding:0 14px;height:38px;background:var(--header);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Add</button>
      </div>
      ${goals.length?goalsHTML:'<div style="text-align:center;color:var(--muted);font-size:13px;padding:12px 0">No goals yet â€” add one above</div>'}
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

// â”€â”€ Home tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€ Habits â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    +'<span style="font-size:12px;color:var(--muted);margin-left:8px">Â· avg '+avg+'/'+n+' per day</span>';
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
  let budHTML='<span style="font-size:18px;font-weight:800;color:var(--muted)">â€”</span>';
  if(bd){
    const inc=(parseFloat(bd.inc_fuji)||0)+(parseFloat(bd.inc_mcd)||0)+(parseFloat(bd.inc_other)||0);
    if(inc>0){
      const transport=parseFloat(bd.fix_transport)||dTransport();
      const spending=dFine()+dSubs()+transport+dGym()+(parseFloat(bd.var_food)||0)+(parseFloat(bd.var_pub)||0)+(parseFloat(bd.var_personal)||0);
      const saved=getWeeklySavings()+(parseFloat(bd.sav_extra)||0);
      const left=inc-spending-saved;
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
    :'<span style="font-size:18px;font-weight:800;color:var(--muted)">â€”</span>';
  // Weight
  const weekWeights=S.weights.filter(w=>w.date>=mondayStr&&w.date<=sundayStr).sort((a,b)=>a.date<b.date?-1:1);
  let weightHTML='<span style="font-size:18px;font-weight:800;color:var(--muted)">â€”</span>';
  if(weekWeights.length>=2){
    const chg=+(weekWeights[weekWeights.length-1].weight-weekWeights[0].weight).toFixed(1);
    const col=chg<0?'var(--success)':chg>0?'var(--danger)':'var(--muted)';
    weightHTML='<span style="font-size:18px;font-weight:800;color:'+col+'">'+(chg>0?'+':'')+chg+'<span style="font-size:12px;margin-left:1px">kg</span></span>';
  }
  return '<div class="card" style="padding:0;overflow:hidden">'
    +'<div style="background:#8B5CF6;padding:8px 14px;font-size:13px;font-weight:500;color:#fff;display:flex;justify-content:space-between;align-items:center">'
    +'<span>ðŸ“‹ Weekly review</span>'
    +'<button onclick="openWeekReviewModal()" style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:20px;border:1.5px solid rgba(255,255,255,0.5);background:transparent;color:#fff;cursor:pointer">Full review</button>'
    +'</div>'
    +'<div style="padding:14px 16px">'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">'
    +'<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Workouts</div>'
    +'<span style="font-size:18px;font-weight:800">'+workoutDays+'</span><span style="font-size:11px;color:var(--muted);margin-left:3px">/ 6 days</span></div>'
    +'<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Budget</div>'+budHTML+'</div>'
    +'<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Cals today</div>'+calHTML+'</div>'
    +'<div><div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Weight Î”</div>'+weightHTML+'</div>'
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
    +'<div style="background:#3B82F6;padding:8px 14px;font-size:13px;font-weight:500;color:#fff;display:flex;justify-content:space-between;align-items:center">'
    +'<span>âœ… Daily habits</span>'
    +'<span id="habits-today-count" style="font-size:13px;font-weight:700;color:#fff;opacity:'+(allDone?'1':'0.75')+'">'+doneCount+'/'+n+'</span>'
    +'</div>'
    +'<div style="padding:14px 16px">'
    +'<div id="habits-today-list">'+buildTodayHabitsList()+'</div>'
    +'</div>'
    +'</div>';
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

  // Budget leftover
  const key=weekKey(getMondayOf(0));
  const bd=budgetData[key];
  let budLeft=null,budPillCls='good',budPillTxt='';
  if(bd){
    const inc=(parseFloat(bd.inc_fuji)||0)+(parseFloat(bd.inc_mcd)||0)+(parseFloat(bd.inc_other)||0);
    const transport=parseFloat(bd.fix_transport)||dTransport();
    const spending=dFine()+dSubs()+transport+dGym()+(parseFloat(bd.var_food)||0)+(parseFloat(bd.var_pub)||0)+(parseFloat(bd.var_personal)||0);
    const saved=getWeeklySavings()+(parseFloat(bd.sav_extra)||0);
    budLeft=inc>0?inc-spending-saved:null;
    budPillCls=budLeft===null?'good':budLeft>=50?'good':budLeft>=0?'warn':'over';
    budPillTxt=budLeft===null?'â³ No income':budLeft>=50?'ðŸŸ¢ On track':budLeft>=0?'ðŸŸ¡ Tight':'ðŸ”´ Over';
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
        '<div style="font-size:30px;font-weight:800;color:'+ringCol+';line-height:1">'+(rem>=0?rem:Math.abs(rem))+'</div>'+
        '<div style="font-size:12px;color:var(--muted);margin-bottom:6px">'+(rem>=0?'kcal remaining':'kcal over target')+'</div>'+
        '<div style="font-size:11px;font-weight:600;color:var(--muted)">Goal: '+goalCals+' kcal</div>'+
      '</div>'+
      '</div>';
  } else if(budLeft!==null){
    const col=budLeft>=0?'var(--success)':'var(--danger)';
    heroContent=
      '<div style="text-align:center;padding:14px 0">'+
        '<div style="font-size:46px;font-weight:800;color:'+col+';line-height:1;margin-bottom:6px">'+(budLeft>=0?'+$':'-$')+Math.abs(budLeft).toFixed(0)+'</div>'+
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
        '<button onclick="updateSavingsBalance()" style="font-size:12px;font-weight:600;padding:4px 11px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--muted);cursor:pointer">Update</button>'+
      '</div>'+
      '<div style="display:flex;align-items:flex-end;height:40px;gap:2px;margin-top:8px">'+bars+'</div>';
  } else {
    savInner=
      '<div style="display:flex;justify-content:space-between;align-items:center">'+
        '<div style="font-size:22px;font-weight:800;color:var(--muted)">$â€”</div>'+
        '<button onclick="updateSavingsBalance()" style="font-size:12px;font-weight:600;padding:4px 11px;border-radius:20px;border:1.5px solid var(--border);background:transparent;color:var(--muted);cursor:pointer">Update</button>'+
      '</div>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:4px">No balance logged Â· $'+wSavTarget+'/wk target</div>';
  }

  const heroHdrCol=goalCals?'#52B788':budLeft!==null?'#FF6B35':'#64748b';
  const heroHdrTxt=goalCals?'ðŸŽ Calorie progress':budLeft!==null?'ðŸ’° Budget summary':'ðŸ“Š Overview';
  wrap.innerHTML=
    // Hero card
    '<div class="card" style="margin-bottom:12px;padding:0;overflow:hidden">'+
      '<div style="background:'+heroHdrCol+';padding:8px 14px;font-size:13px;font-weight:500;color:#fff">'+heroHdrTxt+'</div>'+
      '<div style="padding:14px 16px">'+
        '<div style="font-size:15px;font-weight:700;margin-bottom:12px">'+greetLine+'</div>'+
        heroContent+
      '</div>'+
    '</div>'+
    // 2Ã—2 stat grid
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
      '<div class="card" style="margin-bottom:0;padding:14px;text-align:center">'+
        '<div style="font-size:22px;margin-bottom:2px">ðŸ’ª</div>'+
        '<div style="font-size:28px;font-weight:800;line-height:1">'+wStreak+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Workout streak</div>'+
      '</div>'+
      '<div class="card" style="margin-bottom:0;padding:14px;text-align:center">'+
        '<div style="font-size:22px;margin-bottom:2px">ðŸ”¥</div>'+
        '<div style="font-size:28px;font-weight:800;line-height:1">'+ciStreak+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Check-in streak</div>'+
      '</div>'+
      '<div class="card" style="margin-bottom:0;padding:14px;text-align:center">'+
        '<div style="font-size:22px;margin-bottom:2px">ðŸ’°</div>'+
        '<div style="font-size:22px;font-weight:800;line-height:1;color:var(--success)">$'+wSavTarget+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Weekly target</div>'+
      '</div>'+
      '<div class="card" style="margin-bottom:0;padding:14px;text-align:center">'+
        '<div style="font-size:22px;margin-bottom:2px">ðŸ‹ï¸</div>'+
        '<div style="font-size:14px;font-weight:700;line-height:1.2">'+nextType.name+'</div>'+
        '<div style="font-size:10px;color:var(--muted);margin-top:3px;text-transform:uppercase;letter-spacing:0.5px">Day '+dayNum+' up next</div>'+
      '</div>'+
    '</div>'+
    // Savings balance
    '<div class="card" style="padding:0;overflow:hidden">'+
      '<div style="background:#52B788;padding:8px 14px;font-size:13px;font-weight:500;color:#fff">ðŸ¦ Savings balance</div>'+
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
      '<div style="background:#52B788;padding:8px 14px;font-size:13px;font-weight:500;color:#fff">ðŸ‹ï¸ Next workout</div>'+
      '<div style="padding:14px 16px">'+
        '<div style="display:flex;justify-content:space-between;align-items:center">'+
          '<div>'+
            '<div style="font-size:18px;font-weight:700">'+nextType.name+'</div>'+
            '<div style="font-size:12px;color:var(--muted)">Day '+dayNum+' Â· '+nextType.exercises.length+' exercises</div>'+
          '</div>'+
          '<button onclick="initDay('+nextIdx+');setView(\'log\')" style="background:var(--accent);color:#fff;border:none;border-radius:10px;padding:10px 22px;font-size:15px;font-weight:700;cursor:pointer">Go â†’</button>'+
        '</div>'+
      '</div>'+
    '</div>';
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

// â”€â”€ Onboarding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        '<button onclick="nextObStep()" style="width:100%;padding:16px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:16px;font-weight:700;cursor:pointer">Get started â†’</button>'+
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
      '<button onclick="nextObStep()" style="width:100%;padding:16px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:16px;font-weight:700;cursor:pointer;margin-top:10px">Continue â†’</button>';
  } else {
    box.innerHTML=dots+
      '<div style="text-align:center;padding-top:8px">'+
        '<div style="font-size:52px;margin-bottom:18px">ðŸŽ‰</div>'+
        '<div style="font-size:26px;font-weight:800;margin-bottom:10px">You\'re all set, '+obData.name+'!</div>'+
        '<div style="font-size:15px;color:var(--muted);line-height:1.6;margin-bottom:52px">Your tracker is ready.<br>Update your details anytime in Settings.</div>'+
        '<button onclick="finishOnboarding()" style="width:100%;padding:16px;border-radius:12px;border:none;background:var(--accent);color:#fff;font-size:16px;font-weight:700;cursor:pointer">Go to app â†’</button>'+
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
  document.getElementById('onboarding-overlay').classList.add('hidden');
  renderHome();
}
function resetOnboarding(){
  profileData.name='';
  localStorage.setItem('daily_profile',JSON.stringify(profileData));
  showOnboarding();
}

// â”€â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
applyTheme();
logCheckin();
initDay(suggestDay());
renderHome();
updateHeaderAvatar();
updateNavPill('home');
updateNavBadges();
checkOnboarding();
