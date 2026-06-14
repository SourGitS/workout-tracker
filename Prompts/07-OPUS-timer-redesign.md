# PROMPT 6 — Timer Redesign: Rest Timer + Session Timer

## CODEBASE CONTEXT

Multi-file app: `index.html`, `css/style.css`, `js/app.js`
Stack: Vanilla JS + CSS. No frameworks. PWA (manifest.json + service-worker.js).
Dark mode via `[data-theme="dark"]`. Accent: `--accent: #FF6B35`.
The existing rest timer lives in `#rt-overlay` as a bottom sheet modal. Replace it entirely.

---

## CRITICAL BUG FIX — Timer pauses when app is backgrounded

**Current problem:** Uses `setInterval` to count seconds. When phone locks, tab becomes inactive, or user switches apps, the interval is throttled/paused by the browser.

**Fix — always use timestamps, never count ticks:**

```javascript
// Instead of counting seconds up:
let rtStartTime = null;      // Date.now() when timer started
let rtOffset = 0;            // accumulated ms from previous runs (for pause/resume)
let rtRunning = false;
let rtInterval = null;
let rtLaps = [];             // array of { label, ms } rest periods

function rtStart() {
  rtStartTime = Date.now();
  rtRunning = true;
  rtInterval = setInterval(rtTick, 47); // ~21fps, smooth enough
}

function rtPause() {
  if (!rtRunning) return;
  rtOffset += Date.now() - rtStartTime;
  rtRunning = false;
  clearInterval(rtInterval);
}

function rtGetElapsed() {
  if (!rtRunning) return rtOffset;
  return rtOffset + (Date.now() - rtStartTime);
}

function rtTick() {
  rtUpdateDisplay(rtGetElapsed());
}

// Page Visibility API — re-sync display when app comes back to foreground
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && rtRunning) {
    rtUpdateDisplay(rtGetElapsed()); // immediately correct on return
  }
});
```

Apply the same timestamp pattern to the session timer (total workout duration).

---

## FEATURE SPEC

### Two timers:

| Timer | Purpose | Resets |
|-------|---------|--------|
| **Rest timer** | Counts up since last lap (time resting between sets) | On Lap tap, on Stop tap |
| **Session timer** | Total workout duration since first set | On new day / save session |

---

## UI DESIGN — Sticky bar + fullscreen mode

### State 1: Sticky timer bar (always visible on Log tab)

Sits **below the day selector and progress bar**, **above the exercise list**. Stays in place while user scrolls through exercises. Never blocks content — it is part of the normal document flow, not a floating overlay.

Layout (single row, full width):

```
[▲]  [Lap]  00:00.0  [▶ Start]  |  Session: 00:00
```

- `[▲]` — expand to fullscreen (small icon button, left)
- `[Lap]` — records current elapsed as a rest lap, resets counter to 0:00.0
- `00:00.0` — current rest time, large bold monospace font, centred
- `[▶ Start]` / `[⏸ Pause]` / `[↺ Reset]` — right side, changes based on state
- `Session: 00:00` — small muted text showing total session time, far right

Sticky bar height: 52px. Background: `var(--card)`. Border-bottom: `1px solid var(--border)`. Sits between `#pbar-wrap` and `#exercise-list` in the HTML.

```css
#rt-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  margin-bottom: 14px;
}
#rt-bar-time {
  font-size: 24px;
  font-weight: 800;
  font-family: monospace;
  letter-spacing: -1px;
  flex: 1;
  text-align: center;
  color: var(--text);
}
#rt-bar-session {
  font-size: 11px;
  color: var(--muted);
  font-family: monospace;
  white-space: nowrap;
}
.rt-bar-btn {
  height: 36px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1.5px solid var(--border);
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  flex-shrink: 0;
}
.rt-bar-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.rt-expand-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
```

---

### State 2: Fullscreen timer overlay

Triggered by tapping `[▲]` in the sticky bar. Full-screen overlay (same `position:fixed;inset:0` as existing overlays). Dark background. Dismiss by tapping `[▼]` or swiping down.

Layout (top to bottom, centred):

```
                          [▼ minimise]

            Session  00:18:41

         ┌─────────────────────┐
         │                     │
         │      18:20.9        │  ← large, 72px bold monospace
         │                     │
         └─────────────────────┘

         [   Lap   ]  [   Stop   ]

   ─────────────────────────────────
   Rest 3          00:09.82
   Rest 2          00:01.31
   Rest 1          00:00.47
```

CSS for fullscreen:

```css
#rt-fullscreen {
  position: fixed;
  inset: 0;
  background: var(--bg);
  z-index: 200;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 24px;
  padding-top: env(safe-area-inset-top, 20px);
  padding-bottom: env(safe-area-inset-bottom, 20px);
}
#rt-fs-time {
  font-size: 72px;
  font-weight: 800;
  font-family: monospace;
  letter-spacing: -3px;
  line-height: 1;
  margin: auto 0; /* vertically centred */
  color: var(--text);
}
#rt-fs-session {
  font-size: 15px;
  color: var(--muted);
  font-family: monospace;
  margin-bottom: 16px;
}
.rt-fs-btn-row {
  display: flex;
  gap: 16px;
  width: 100%;
  margin-bottom: 32px;
}
.rt-fs-btn {
  flex: 1;
  height: 64px;
  border-radius: 50px;
  font-size: 17px;
  font-weight: 700;
  border: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.rt-fs-btn.lap {
  background: rgba(255,255,255,0.12);
  color: var(--text);
}
.rt-fs-btn.stop {
  background: var(--danger);
  color: #fff;
}
.rt-fs-btn.start {
  background: var(--accent);
  color: #fff;
  flex: 2;
}
[data-theme="dark"] .rt-fs-btn.lap {
  background: rgba(255,255,255,0.1);
}
/* Lap list */
#rt-fs-laps {
  width: 100%;
  overflow-y: auto;
  flex: 1;
}
.rt-lap-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
  font-family: monospace;
}
.rt-lap-label { font-size: 14px; color: var(--muted); }
.rt-lap-time { font-size: 16px; font-weight: 700; color: var(--text); }
.rt-lap-row:first-child .rt-lap-time { color: var(--accent); } /* current running lap */
```

---

## DISPLAY FORMAT

```javascript
function rtFormat(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const tenth = Math.floor((ms % 1000) / 100);
  return `${min > 0 ? min + ':' : ''}${String(sec).padStart(min > 0 ? 2 : 1, '0')}.${tenth}`;
}

function sessionFormat(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${m}:${String(s).padStart(2,'0')}`;
}
```

---

## LAP BEHAVIOUR

Tapping Lap:
1. Records `{ label: 'Rest ' + (rtLaps.length + 1), ms: rtGetElapsed() }` into `rtLaps` array
2. Resets `rtOffset = 0`, `rtStartTime = Date.now()` (rest timer restarts from 0)
3. Re-renders lap list in fullscreen view (most recent at top)
4. Session timer is NOT affected — keeps counting

Lap list format (top = most recent):
```
Rest 3    00:09.8    ← accent colour (current running lap)
Rest 2    00:01.3
Rest 1    00:00.4
```

---

## SESSION TIMER

Starts automatically when the user taps **Save session** — no, actually starts on first set input or first timer Start tap (whichever comes first). Separate timestamps from rest timer:

```javascript
let sessionStart = null;

function sessionGetElapsed() {
  if (!sessionStart) return 0;
  return Date.now() - sessionStart;
}
```

Reset `sessionStart = null` when navigating away from Log tab or after saving session.

---

## WHAT TO REMOVE

- Delete the existing `#rt-overlay` HTML in index.html (the bottom sheet modal)
- Delete the existing `openRestTimer()`, `closeRestTimer()`, `rtToggle()`, `rtReset()`, `rtLap()` functions in app.js (replace with new implementations above)
- Remove the ⏱️ emoji button from `#day-info-row` in index.html (it opened the old modal)
- Remove `#rt-presets` (the preset time buttons 1:00, 1:30, 2:00, etc.) — new timer is count-up only

---

## DESKTOP BEHAVIOUR (≥1024px)

On desktop, the sticky bar stays visible in the left column of the Log tab (already a two-column layout). The fullscreen overlay still works on desktop but appears as a centred modal (max-width: 400px, auto margin) rather than true full-screen.

---

## VERIFICATION

1. Open Log tab → sticky timer bar visible between day selector and exercise list
2. Tap Start → timer counts up: 0:00.0, 0:00.1, 0:00.2...
3. Lock phone screen for 30 seconds → unlock → timer shows correct elapsed time (not paused at the locked value)
4. Switch to another app for 2 minutes → return → timer is correct
5. Tap Lap → rest time recorded in list, counter resets to 0:00.0
6. Tap ▲ → fullscreen opens with large display, lap list, Lap/Stop buttons
7. Tap ▼ → returns to sticky bar, timer still running
8. Tap Stop → timer pauses, Start button appears to resume
9. Session timer shown in sticky bar increases throughout workout
10. Save session → session timer resets
11. Dark mode → all timer elements look correct
12. 375px mobile → sticky bar fits, all buttons tappable
