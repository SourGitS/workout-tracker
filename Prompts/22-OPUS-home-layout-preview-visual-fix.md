# PROMPT 22 — Home Layout Previews: Look Like the Real Cards, Not Grey Skeletons

## FEEDBACK ON PROMPT 19's PART 3

Francois compared the actual Home tab against the new Settings → Home Layout previews: the
generic grey-bar skeletons (`hlPreviewStat`/`hlPreviewList`/`hlPreviewBars`) don't read as "this
card" at a glance — he wants small versions that actually look like the real card (real
background treatment, real colours), not an abstract placeholder shape. This prompt replaces
the preview system from Prompt 19 Part 3 — same idea (illustrative, not live data), executed
with the real visual identity of each card type instead of uniform grey.

## CODEBASE CONTEXT

Home cards fall into three real background treatments:
- **Hero gradient** (Today's Session, Weekly Budget): `rgba(var(--accent-rgb), .9→.4)` diagonal
  gradient, white text — `.budget-hero-card`/`#budget-hero-card` (css/budget-home.css:29,
  index.html:230) and `.log-day-hero-card` (css/workout.css:31-33, colour set inline per training
  day in js/app.js). A preview doesn't need to track the live day-colour, just needs the same
  gradient formula off `--accent-rgb` to look right.
- **Frosted "review" card** (Weekly Review): `.card.weekly-review-card`
  (css/budget-home.css:188-191) — translucent white gradient + radial highlight, not flat.
- **Plain dark card** (Total Assets, Calorie Progress, Notes, Recent Workout, Habits, Money Quick
  Tiles): ordinary `.card` (`var(--card)` background).

## TASK

Replace the three `hlPreview*` functions and `.hl-p-*`/`.hl-preview` CSS added in Prompt 19 Part
3 with the set below (delete the old ones, these aren't additive on top).

### 1. Container + content-piece CSS
```css
.hl-prev{border-radius:10px;padding:9px 10px;margin:6px 0 2px;overflow:hidden;pointer-events:none}
.hl-prev-hero{background:linear-gradient(150deg, rgba(var(--accent-rgb),.9), rgba(var(--accent-rgb),.6) 55%, rgba(var(--accent-rgb),.4));color:#fff}
.hl-prev-review{background:linear-gradient(180deg, rgba(255,255,255,.20), rgba(255,255,255,.06));border:1px solid var(--card-border);color:var(--text)}
[data-theme="light"] .hl-prev-review{background:var(--card)}
.hl-prev-plain{background:var(--card);border:1px solid var(--card-border);color:var(--text)}
.hl-lbl{font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;opacity:.65;margin-bottom:5px}
.hl-num{font-family:var(--font-num);font-weight:800;font-size:15px;margin-bottom:3px;line-height:1}
.hl-sub{font-size:8px;opacity:.6}
.hl-bar-track{height:4px;border-radius:3px;background:rgba(255,255,255,.25);overflow:hidden;margin-top:7px}
.hl-prev-plain .hl-bar-track,.hl-prev-review .hl-bar-track{background:var(--border)}
.hl-bar-fill{height:100%;width:35%;background:currentColor;border-radius:3px}
.hl-dots{display:flex;gap:3px;margin-top:7px}
.hl-dot{width:8px;height:8px;border-radius:3px;background:rgba(255,255,255,.2)}
.hl-prev-plain .hl-dot,.hl-prev-review .hl-dot{background:var(--border)}
.hl-dot.on{background:var(--accent)}
.hl-row{height:7px;border-radius:3px;background:var(--border);margin-bottom:5px;width:100%}
.hl-row:last-child{margin-bottom:0;width:65%}
.hl-ring{width:28px;height:28px;border-radius:50%;border:4px solid var(--border);border-top-color:var(--success);flex-shrink:0}
```

### 2. Per-widget preview builders (reuse across `HOME_WIDGETS`)
```js
function hlPrevHero(title){ return '<div class="hl-prev hl-prev-hero"><div class="hl-lbl">'+title+'</div><div class="hl-num" style="font-size:13px">'+ '████'.replace(/./g,'')+'&nbsp;'+'</div><div class="hl-bar-track"><div class="hl-bar-fill"></div></div></div>'; }
function hlPrevReview(){ return '<div class="hl-prev hl-prev-review"><div style="display:flex;gap:16px"><div><div class="hl-lbl">Workouts</div><div class="hl-num">2</div></div><div><div class="hl-lbl">Budget</div><div class="hl-num" style="color:var(--success)">+$</div></div></div><div class="hl-dots">'+[1,1,0,1,0,0,0].map(on=>'<div class="hl-dot'+(on?' on':'')+'"></div>').join('')+'</div></div>'; }
function hlPrevBalance(){ return '<div class="hl-prev hl-prev-plain"><div class="hl-lbl">Total assets</div><div class="hl-num">$0,000</div><div class="hl-sub">Net worth · debts</div></div>'; }
function hlPrevCalories(){ return '<div class="hl-prev hl-prev-plain" style="display:flex;align-items:center;gap:10px"><div class="hl-ring"></div><div><div class="hl-lbl">Good morning</div><div class="hl-num" style="font-size:13px;color:var(--success)">0000 kcal</div></div></div>'; }
function hlPrevList(rows){ return '<div class="hl-prev hl-prev-plain">'+Array(rows||3).fill('<div class="hl-row"></div>').join('')+'</div>'; }
function hlPrevTiles(){ return '<div class="hl-prev hl-prev-plain" style="display:grid;grid-template-columns:1fr 1fr;gap:6px"><div class="hl-row" style="margin:0;height:22px"></div><div class="hl-row" style="margin:0;height:22px"></div></div>'; }
```
Fix the odd `'████'.replace(/./g,'')+'&nbsp;'` placeholder above before using it — that's a
stand-in for "a short bold title-like bar"; render it properly as a small solid rounded block
(reuse the `.hl-bar-fill`-style block at a bigger size, or similar) rather than literal block
characters — use your judgement on the cleanest way to render "looks like a short bold title,"
just don't ship literal box-drawing characters.

### 3. Reassign `HOME_WIDGETS.preview` to match each real card
```js
{id:'session', ..., preview:()=>hlPrevHero('Today\'s session')},
{id:'budget',  ..., preview:()=>hlPrevHero('Weekly budget')},
{id:'streak',  ..., preview:hlPrevReview},   // check what this one actually renders first — if it's not stat+dots like Review, adjust
{id:'review',  ..., preview:hlPrevReview},
{id:'recent',  ..., preview:()=>hlPrevList(3)},
{id:'calories',..., preview:hlPrevCalories},
{id:'habits',  ..., preview:()=>hlPrevList(3)},
{id:'balance', ..., preview:hlPrevBalance},
{id:'tiles',   ..., preview:hlPrevTiles},
{id:'notes',   ..., preview:()=>hlPrevList(2)},
```
Keep whatever field ordering/other properties (`tab`, `fixed`, `label`) Prompt 19 already set —
only the `preview` value is changing here.

## OUT OF SCOPE

- Actual live data in previews — still deliberately placeholder content, just now with the right
  background/colour identity per card type.
- Any real Home card's actual design or the drag-reorder system — untouched.

## VERIFICATION — for Francois to check (Settings → Home Layout)

1. Today's Session and Weekly Budget previews now show the same maroon/accent gradient as the
   real hero cards on Home, not a flat grey box.
2. Weekly Review's preview has the frosted/translucent look the real card has, with two stats
   and a dot row.
3. Total Assets, Calorie Progress, Notes, Recent Workout, Habits, Money Quick Tiles all sit on
   plain dark cards matching the real ones, with a rough content shape that hints at what's
   actually there (a big number, a ring, list rows, a small tile grid).
4. Still placeholder content, not your real numbers — that's expected, only the visual identity
   changed.
