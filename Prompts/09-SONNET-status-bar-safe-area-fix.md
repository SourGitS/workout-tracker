# PROMPT 9 — Fix Oversized Status-Bar / Safe-Area Gap

## CODEBASE CONTEXT

iOS PWA (Add to Home Screen) via `manifest.json` (`display: standalone`) +
`<meta name="apple-mobile-web-app-status-bar-style" content="black">` in `index.html`. This
makes the status bar opaque — iOS reserves the full status-bar height as a solid block filled
with `theme-color`, instead of letting the app draw underneath it.

That "black" (opaque) choice was made deliberately in commit `316893c`
("fix(ios): sync status-bar/chrome tint to the app's dark background") specifically INSTEAD of
`black-translucent`, because translucent forces white status-bar icons in every theme
(unreadable in light mode) and previously caused a cold-launch bug where the safe-area value
raced and content jumped after load. **Do not switch this back to `black-translucent` as part
of this fix** — solve the size problem in CSS, not by reverting that decision.

`css/layout.css` already has the correct fix applied to the main tab header, with this comment
in place:
```css
/* Status bar is now opaque ('black'), so content starts below it — no top safe-area
   padding needed here (that env value raced/double-counted on cold launch). */
#app-header{background:var(--bg);color:var(--text);padding:0 16px;min-height:56px; ...}
```

## THE BUG

That fix was applied to `#app-header` only. Every other sticky header in the app still adds
`env(safe-area-inset-top)` padding on top of space the opaque status bar already reserves —
double-counting it, which is almost certainly what reads as "the status bar is too large."
Known instances found by grep on 2026-07-21 (re-grep the whole project for
`safe-area-inset-top` to confirm this list is complete — there may be more):

- `index.html` line ~588 — sticky header above `#note-view-body` (Notes detail view)
- `index.html` line ~679 — sticky header above `#settings-detail-content` (Settings detail view)
- `index.html` line ~845 — sticky header near the HTML-plan-viewer overlay
- `css/budget-home.css` line ~143 — `.detail-topbar` (used by Accounts / budget detail
  sub-pages)
- `css/layout.css` line ~83 — `#rt-fullscreen` (`padding-top: env(safe-area-inset-top, 20px)`)
- `css/kitchen-extras.css` line ~483 — `#side-menu`
  (`padding-top: env(safe-area-inset-top, 0px)`)

(Line numbers are approximate as of 2026-07-21 — the file has likely moved since.)

## TASK

1. Grep the entire project (`index.html`, all of `css/*.css`, `js/app.js`) for
   `safe-area-inset-top` and list every match.
2. For each match, decide: is this a header/bar that sits flush at the very top of the screen,
   the same way `#app-header` does? If yes, it's double-counting — bring it in line with the
   `#app-header` precedent (fixed padding only, no `env(safe-area-inset-top)` addition).
3. For `#rt-fullscreen` and `#side-menu` specifically — check whether they behave differently
   (e.g. an overlay appearing on top of already-rendered content vs. a top-level screen). Don't
   assume they need the identical fix; verify each one on device before changing it.
4. Leave every `safe-area-inset-BOTTOM` reference untouched — this issue is about the TOP only.
5. Bump the service worker cache version in `service-worker.js` (currently `daily-v152` →
   `daily-v153`) so the fix isn't served stale from cache, matching the pattern used in the
   previous status-bar commit.

## VERIFICATION — for Francois to check on his phone

Cold-launch the app each time (force-quit first, not just background it — a backgrounded app
can mask this bug).

1. Open the app fresh — the top area looks like a normal slim status bar, not an oversized
   colored block.
2. Notes tab → open any note → detail header sits directly under the status bar, no extra gap
   above it.
3. Settings → open any detail section (e.g. Personal Info) → same check.
4. Budget → Accounts → same check.
5. Log tab → open the rest timer fullscreen view → top spacing looks correct — not touching the
   status bar, not oversized.
6. Open the hamburger/side menu → top spacing looks correct.
7. Repeat steps 1–6 in both dark mode and light mode.
8. Force-quit and cold-launch the app 3–4 times in a row → confirm there's no flash or jump of
   content at the top (this was the original bug the "black" opaque switch fixed — make sure
   this change doesn't bring it back).
