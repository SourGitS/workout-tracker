# PROMPT 23 — Weekly Review: Track Workout Days Instead of "Perfect" Habit Days

## CODEBASE CONTEXT

The Weekly Review card's bottom section (`buildWeekSummaryCard()`, js/app.js:6822-6876) currently
shows a "perfect days" stat + a 7-dot grid — but both are driven by **habit completion**, not
workouts:
```js
function buildHabitsWeekGrid(){       // js/app.js:6710-6728
  ...
  const done=(habitsLog[date]||[]).length;
  if(!isFuture&&done>=n){bg='var(--success)';tc='#fff';}       // all habits done that day
  else if(!isFuture&&done>0){bg='#f59e0b';tc='#fff';}           // some habits done
  ...
}
function buildHabitsWeekStats(){      // js/app.js:6775-6790
  ...
  if(done>=n) perfect++;              // "perfect" = every habit checked that day
  ...
  return '<span ... color:var(--success)">'+perfect+' perfect day...'
}
```
Both are called from exactly two places (confirmed via grep) — inside `buildWeekSummaryCard()`
(js/app.js:6871-6872) and inside `refreshHabitsUI()` (js/app.js:6805-6809, which live-refreshes
this same grid/stats whenever a habit gets toggled elsewhere on Home). Nothing else references
them — this is safe to repurpose in place rather than needing a separate parallel system.

Francois wants this section to track **workout days** (was a session logged that date, from
`S.sessions`) instead of habit completion, coloured with the app's actual live accent
(`var(--accent)`) rather than the hardcoded `var(--success)`/`#f59e0b` habit colours.

## TASK

### 1. Rename + rewrite the grid
Replace `buildHabitsWeekGrid()` (js/app.js:6710-6728) with:
```js
function buildWorkoutWeekGrid(){
  const today=getLocalDate();
  const dates=getWeekDates();
  const labels=['M','T','W','T','F','S','S'];
  const sessionDates=new Set(S.sessions.map(s=>s.date));
  return dates.map((date,i)=>{
    const isFuture=date>today;
    const worked=!isFuture&&sessionDates.has(date);
    const bg=worked?'var(--accent)':'var(--border)';
    const tc=worked?'#fff':'var(--muted)';
    const border=date===today?'border:2px solid var(--text);':'border:2px solid transparent;';
    return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">'
      +'<div style="width:30px;height:30px;border-radius:8px;background:'+bg+';'+border+'display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:'+tc+'">'
      +(worked?'✓':'')
      +'</div>'
      +'<div style="font-size:9px;color:var(--muted)">'+labels[i]+'</div>'
      +'</div>';
  }).join('');
}
```
One colour, one state (worked out / didn't) — no partial-completion tier, since a workout either
happened that day or it didn't (unlike multi-habit completion, which had a genuine "some done"
middle state).

### 2. Rename + rewrite the stats line
Replace `buildHabitsWeekStats()` (js/app.js:6775-6790) with:
```js
function buildWorkoutWeekStats(){
  const today=getLocalDate();
  const dates=getWeekDates();
  const sessionDates=new Set(S.sessions.map(s=>s.date));
  const workoutDays=dates.filter(d=>d<=today&&sessionDates.has(d)).length;
  return '<span style="font-size:12px;font-weight:600;color:var(--accent)">'+workoutDays+' workout day'+(workoutDays!==1?'s':'')+'</span>'
    +'<span style="font-size:12px;color:var(--muted);margin-left:8px">this week</span>';
}
```
Dropped the old "avg X/Y per day" clause — that was a completion-rate concept specific to
multi-habit tracking and doesn't translate to a yes/no workout day.

### 3. Update the two call sites
`buildWeekSummaryCard()` (js/app.js:6871-6872) — rename the element ids for clarity (they no
longer hold habit data) and call the new functions:
```js
+'<div id="workout-week-stats" style="margin-bottom:8px">'+buildWorkoutWeekStats()+'</div>'
+'<div id="workout-week-grid" style="display:flex;gap:4px">'+buildWorkoutWeekGrid()+'</div>'
```
`refreshHabitsUI()` (js/app.js:6805-6809) — remove the two lines that refresh
`habits-week-grid`/`habits-week-stats`. Workout data doesn't change when a habit is toggled, so
there's nothing to refresh here anymore; leave the today's-habits-list/count refresh in the same
function untouched. (Home's normal re-render when you navigate back from Log already keeps the
new workout grid/stats correct — no new refresh hook needed elsewhere.)

## OUT OF SCOPE

- The 2×2 stats grid above this section (Workouts X/6 days, Budget, Cals today, Weight Δ) —
  untouched; "Workouts X/6" there is a different metric (days worked out vs. a 6-day training
  program) from this section's day-by-day calendar-week grid.
- `buildTodayHabitsCard()`/`buildTodayHabitsList()` (the separate "Today's Habits" widget) and
  `renderStatsHabits()` (Stats → Training habit-completion history) — both untouched; habits
  tracking itself isn't being removed from the app, just this one card's grid/stat.
- Habits data/storage (`habitsLog`, `habitsData`) — untouched, still used everywhere else.

## VERIFICATION — for Francois to check (Home tab, Weekly Review card)

1. The dot grid now lights up (in your current accent colour) on days you actually logged a
   workout, not on days you completed all your habits.
2. The small text above the grid reads "N workout days · this week," coloured with your live
   accent colour, not green.
3. Today's Habits card (the separate widget, if you have it enabled) still works exactly as
   before — checking habits there no longer touches this grid, and shouldn't need to; it wasn't
   tracking the same thing anyway.
4. Log a new workout, navigate back to Home → today's dot lights up correctly.
