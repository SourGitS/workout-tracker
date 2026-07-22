# PROMPT 18 — Real Wordmark: Onboarding, Header, and Side Menu

## CODEBASE CONTEXT

Two new theme-paired logo assets are already sitting in the repo root, untracked, ready to
commit: **`daily-wordmark-light.png`** and **`daily-wordmark-dark.png`** (both 900×350,
transparent background — light variant is black-on-transparent for the light theme, dark
variant is white-on-transparent for the dark theme), cropped and sized from Francois's latest
logo import.

Confirmed with Francois via a quick lock-in question before writing this: full replacement —
onboarding welcome screen, in-app header, **and** the hamburger-menu title all switch to the
real logo image. This deliberately retires the header/menu's dynamic per-training-day text
colour — confirmed acceptable, not an oversight.

Three sites currently render "DAILY" as text, all sharing one gradient-text treatment:
- `obWelcomeHTML()` (js/app.js:8117-8129) — `<div class="ob-logo">Daily</div>`
- `#header-title` (index.html:65) — static div
- `#side-menu-title` (index.html:849) — static div

The shared gradient rule (`#header-title,#side-menu-title{...}`, css/layout.css:14-23) is keyed
off two CSS custom properties, both set by `applyLogoDayColour()` (js/app.js:1473-1496):
`--day-color` and `--day-color-rgb`. `--day-color` is **also** used independently by
`#header-stats-pill.active` (css/layout.css:26) — that usage has nothing to do with the wordmark
and must survive this change. `--day-color-rgb`, by contrast, is only ever read by the gradient
wordmark rule being removed here (confirmed via grep) — once that rule's gone, so is every
reader of `--day-color-rgb`.

## TASK

### 1. Shared image-swap CSS
Both new PNGs stay in the DOM at all times; `[data-theme]` just shows the matching one —
matching how every other light/dark difference in this codebase already works, no JS needed.

Replace css/layout.css lines 7-24 (the comment block + `#header-title,#side-menu-title{...}`
gradient rule + `#header-title{font-size:24px;letter-spacing:0.5px}`) with:
```css
/* Wordmark is a real logo image now, theme-paired (light=black-on-transparent,
   dark=white-on-transparent) rather than gradient text. Both variants are always in the
   DOM; [data-theme] just shows the matching one. */
.wordmark-img{display:none;height:auto}
[data-theme="light"] .wordmark-light{display:block}
[data-theme="dark"] .wordmark-dark{display:block}
#header-title .wordmark-img{height:22px}
```

Replace css/kitchen-extras.css:488-490 (the side-menu-specific size override + its now-stale
"shares the gradient treatment" comment) with:
```css
#side-menu-title .wordmark-img{height:18px}
```

Replace css/budget-home.css:339-345 (`.ob-logo` + its now-stale "accent-keyed since onboarding
runs before day colours exist" comment) with:
```css
.ob-center .wordmark-img{width:100%;max-width:260px;margin:0 auto 18px}
```

### 2. Swap the three markup sites
index.html:65 —
```html
<div id="header-title">
  <img class="wordmark-img wordmark-light" src="daily-wordmark-light.png" alt="Daily">
  <img class="wordmark-img wordmark-dark" src="daily-wordmark-dark.png" alt="Daily">
</div>
```
index.html:849 — identical pattern, just `id="side-menu-title"`.

js/app.js:8119, inside `obWelcomeHTML()` — replace:
```js
'<div class="ob-logo">Daily</div>'+
```
with:
```js
'<img class="wordmark-img wordmark-light" src="daily-wordmark-light.png" alt="Daily">'+
'<img class="wordmark-img wordmark-dark" src="daily-wordmark-dark.png" alt="Daily">'+
```

### 3. Trim `applyLogoDayColour()` to what's still load-bearing
```js
function applyLogoDayColour(){
  let c;
  if(localStorage.getItem('daily_dynamic_colours')==='true'){
    c=dayColorFor(currentDayName());
  } else {
    c=restColor();
  }
  document.documentElement.style.setProperty('--day-color', c);
}
```
Drops the `--day-color-rgb` computation and the inline `.style.color` sets on `#header-title`/
`#side-menu-title` (both dead once those elements hold only `<img>` tags). Leave the function
name and its three call sites (`applyDayColour()` js/app.js:917, the main init sequence
~line 9469, the `pageshow` listener ~line 10056) as they are — renaming the function since
"Logo" is no longer quite accurate is optional, not required.

### 4. Cache-bust
service-worker.js line 1: bump `CACHE_NAME` — currently `'daily-v162'`, move to `'daily-v163'`
(double-check it's still 162 first; other work may have moved it since).

### 5. Commit
`git add daily-wordmark-light.png daily-wordmark-dark.png index.html js/app.js css/layout.css
css/kitchen-extras.css css/budget-home.css service-worker.js` — the two PNGs are untracked, sitting in the repo root already.

## OUT OF SCOPE

- `icon-source.png` / the app-icon generator — a separate "DA" monogram asset from Prompt 14.
  Unrelated to this wordmark, not touched.
- The two raw originals Francois imported ("Daily App Logo Dark Mode.png" /
  "Daily App Logo Light Mode.png", 6250×6250 each) — don't commit these; only the cropped
  `daily-wordmark-light.png`/`daily-wordmark-dark.png` pair belongs in the repo.
- `#header-stats-pill`'s use of `--day-color` (layout.css:26) — untouched, still needed and still
  works after this change.
- Theme toggle behaviour itself — unaffected; this only changes what renders once a theme is
  already active.

## VERIFICATION — for Francois to check

1. Settings → Advanced → Reset onboarding → welcome screen shows the real logo, correct light/
   dark variant for whichever theme is currently active.
2. With the app open, toggle Settings → Dark mode → the header logo swaps between the two
   variants instantly, no reload needed.
3. Open the hamburger menu → same logo, smaller, correct theme variant.
4. Switch training days, and separately toggle "Day colours" in Settings → the Stats pill
   (visible on Home/Stats) still recolours per day exactly as before — confirms `--day-color`
   survived the cleanup and only the wordmark's own colour-tinting was removed.
5. Header and side-menu logos now stay a fixed colour regardless of training day — expected
   outcome of this prompt, not a regression.
