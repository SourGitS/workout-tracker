# PROMPT 14 — Real Logo Assets: App Icon + Onboarding Splash Badge

## CODEBASE CONTEXT

Two new image assets are already sitting in the repo root, untracked, ready to commit:
- **`icon-source.png`** — 512×512, opaque, the "DA" monogram app-icon artwork (black rounded
  icon, white pill outline, halftone-dot sparkle).
- **`daily-badge-bottom.png`** — 720×368, transparent background, the "DAILY" neon-glow
  wordmark badge (triple-ring outline, bold black sparkle over the D) — cropped and
  alpha-extracted from Francois's reference art so the dark backdrop is real transparency,
  not a black rectangle.

`generate-icons.html` (repo root) is Francois's existing manual tool: he opens it in a
browser, clicks a button, it downloads `icon-192.png`/`icon-512.png` via canvas
`toDataURL`. Right now `drawIcon(size)` (lines 41-83) draws a flat dark rounded-square
background then hand-paints two-tone "Daily" text — it never loads an image. `download(size)`
(85-93) and the 192px preview render (96-101) both just call `drawIcon()` and don't otherwise
care how it's implemented internally.

Onboarding is a multi-step wizard (`OB_STEPS`, js/app.js:7621) rendered into `#onboarding-box`
(index.html:687) by `renderObStep()`. The first step, `obWelcomeHTML()` (js/app.js:8117-8129),
is the splash moment — it currently renders `<div class="ob-logo">Daily</div>`, styled by
`.ob-logo` (css/budget-home.css:339-345) as flat accent-orange gradient text at 56px.

`#onboarding-overlay{background:var(--bg)}` (css/workout.css:209) — the overlay follows
whatever theme is currently active, so the welcome step can render on a light/white background.
`daily-badge-bottom.png` is a white glow + white text badge built to sit on near-black — placed
directly onto a light-mode background it would wash out almost to invisible.

## A DELIBERATE CHANGE FROM "USE IT IN BOTH THE HEADER AND THE SPLASH"

`#header-title` and `#side-menu-title` currently render "DAILY" as gradient text coloured by
`var(--day-color, var(--accent))` — CLAUDE.md documents this as a real, deliberate feature (the
header recolours per training day). The badge PNG is one fixed white rendering with no
per-day-colour variants. Swapping the header to that image would quietly remove day-colour
theming from every single screen, permanently, in exchange for a cosmetic header upgrade —
worse trade than it looked like when this was first asked for. This prompt uses the real badge
for the splash moment only (the highest-impact placement anyway, and a one-time static screen
where a fixed colour costs nothing) and leaves the header exactly as it is. If you'd still
rather have a version in the header after seeing this, that's a separate, smaller follow-up —
just ask.

## TASK

### 1. `generate-icons.html` — load the real icon instead of drawing text

Replace the `<div class="buttons">` block with button `id`s and a disabled default state:
```html
<div class="buttons">
  <button id="btn-192" onclick="download(192)" disabled>Download 192×192</button>
  <button id="btn-512" onclick="download(512)" disabled>Download 512×512</button>
</div>
```

Replace the entire `<script>` block (everything from `function roundedRect` through the closing
`renderPreview()` IIFE) with:
```html
<script>
let iconImg = new Image();
let iconReady = false;

iconImg.onload = function() {
  iconReady = true;
  document.getElementById('btn-192').disabled = false;
  document.getElementById('btn-512').disabled = false;
  renderPreview();
};
iconImg.onerror = function() {
  document.querySelector('.note').textContent =
    'Could not load icon-source.png — make sure it is saved in the same folder as this file, then reload the page.';
};
iconImg.src = 'icon-source.png';

function drawIcon(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(iconImg, 0, 0, size, size);
  return canvas;
}

function download(size) {
  if (!iconReady) return;
  const canvas = drawIcon(size);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'icon-' + size + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function renderPreview() {
  const src = drawIcon(192);
  const preview = document.getElementById('preview');
  const ctx = preview.getContext('2d');
  ctx.clearRect(0, 0, 192, 192);
  ctx.drawImage(src, 0, 0);
}
</script>
```
This drops `roundedRect()` and all the font-measuring/two-tone-text code — nothing else in the
file calls them. Buttons stay disabled (and greyed via the existing `button` CSS, no new style
needed) until `icon-source.png` actually loads, so there's no way to download a blank canvas.

### 2. Onboarding welcome step — real badge, theme-proof backdrop

In `obWelcomeHTML()` (js/app.js:8117), replace:
```js
'<div class="ob-logo">Daily</div>'+
```
with:
```js
'<div class="ob-badge-stage"><img class="ob-badge-img" src="daily-badge-bottom.png" alt="Daily"></div>'+
```

Add this to css/budget-home.css, replacing the now-unused `.ob-logo` rule (lines 339-345 —
confirmed via grep it's the only place that class is referenced, safe to remove entirely):
```css
.ob-badge-stage{
  background:radial-gradient(ellipse at 50% 40%,#1c1c1c,#060606);
  border-radius:var(--radius-hero);
  padding:28px 20px;
  margin-bottom:18px;
  display:flex;align-items:center;justify-content:center;
}
.ob-badge-img{width:100%;max-width:260px;height:auto;display:block}
```
The dark radial-gradient stage is what keeps the glow readable in light mode — don't skip it or
make it theme-dependent; it should look identical regardless of `data-theme`.

### 3. Cache-busting

- `index.html` lines 14-15: bump the shared version query on both icon links —
  `icon-192.png?v=87` → `icon-192.png?v=88` (the `<link rel="icon">` and
  `<link rel="apple-touch-icon">` tags both use it).
- `service-worker.js` line 1: bump `CACHE_NAME = 'daily-v158'` → `'daily-v159'`.

### 4. Commit

Stage the two new assets explicitly alongside the code changes —
`git add icon-source.png daily-badge-bottom.png index.html js/app.js css/budget-home.css
service-worker.js generate-icons.html` — rather than a blanket `git add -A`, so nothing else
in the working tree gets swept in by accident.

## OUT OF SCOPE

- `#header-title` / `#side-menu-title` — untouched, keep the dynamic day-colour gradient text
  exactly as it is (see above).
- Every onboarding step other than `welcome` — untouched.
- `daily-badge-top.png`, `Dailly App Logo.png`, `DailyApp App Icon Badge.png` — the unused
  variant and the raw originals Francois dropped in. Don't commit these three; leave them
  sitting locally uncommitted (harmless) rather than deleting anything he might still want.
- `logo.png.png` — a separate, older asset already in the repo. Not part of this change.

## VERIFICATION — for Francois to check

1. Open `generate-icons.html` in a browser → both buttons are greyed out for a moment, then
   enable once the real "DA" icon artwork appears in the preview (not text). Download both
   sizes and confirm they look right.
2. Replace `icon-192.png`/`icon-512.png` in the repo with the two you just downloaded (same
   filenames, just overwrite).
3. Settings → Advanced → Reset onboarding → the welcome screen shows the real glow badge inside
   its own dark rounded panel. Check this in **both** light and dark theme — the panel should
   look identical either way, and the badge should be clearly visible in both, not washed out.
4. Header and hamburger-menu wordmark still say "DAILY" in the same gradient text as before,
   and still change colour across different training days — completely unaffected.
5. After deploying, hard-refresh or reopen the PWA — new home-screen icon shows up. If your
   phone still shows the old icon after that, you may need to remove and re-add the app to your
   home screen once — iOS caches app icons separately from the site's own cache-busting.
