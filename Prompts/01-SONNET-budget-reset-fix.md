# PROMPT 7 — Bug Fix: Budget inputs resetting on app update

## PROBLEM

Two bugs causing budget inputs to appear blank after the app updates or reloads:

1. **Timezone bug** — `getMondayOf()` calculates the week key using UTC time. In AEST (UTC+10/+11), this means the week rolls over at 10am–11am Monday morning instead of midnight, causing the app to show a new blank week for several hours.

2. **Save timing bug** — some budget inputs only save when `budRecalc()` is triggered. If the service worker updates and reloads the page before an oninput event fires, unsaved values are lost.

---

## FIX 1 — Timezone-aware week key

Find the `getMondayOf()` function in js/app.js. It currently uses `new Date()` with no timezone offset.

Replace it with an AEST-aware version:

```javascript
function getMondayOf(weekOffset = 0) {
  // Use AEST offset: UTC+10 standard, UTC+11 daylight saving
  // Safest approach: use a fixed +10 offset (conservative, avoids DST edge cases)
  const AEST_OFFSET_MS = 10 * 60 * 60 * 1000;
  const nowUTC = Date.now();
  const nowAEST = new Date(nowUTC + AEST_OFFSET_MS);

  // Day of week in AEST (0=Sun, 1=Mon ... 6=Sat)
  const day = nowAEST.getUTCDay();
  // Days since last Monday (Monday = 0 offset)
  const diffToMonday = (day === 0) ? 6 : day - 1;

  const monday = new Date(nowAEST);
  monday.setUTCDate(nowAEST.getUTCDate() - diffToMonday + (weekOffset * 7));
  monday.setUTCHours(0, 0, 0, 0);

  // Return as YYYY-MM-DD string
  return monday.toISOString().slice(0, 10);
}
```

This ensures the week boundary always flips at midnight Monday AEST regardless of what UTC time it is.

---

## FIX 2 — Save inputs immediately on every change

Find the budget input elements in index.html. They currently use `oninput="budRecalc()"`. 

Ensure `budSaveCurrentWeek()` is called inside `budRecalc()` at the end, every time, not just on explicit save button tap. Check js/app.js:

```javascript
function budRecalc() {
  // ... existing calculation logic ...

  // MAKE SURE this line exists at the END of budRecalc():
  budSaveCurrentWeek();
}
```

If `budSaveCurrentWeek()` is not already called inside `budRecalc()`, add it. This ensures every keystroke immediately persists to localStorage.

---

## FIX 3 — Save before service worker reloads

In js/app.js, find where the service worker update is handled. It likely looks something like:

```javascript
// Existing SW update listener (find and update it):
registration.addEventListener('updatefound', () => {
  // ...
  newWorker.addEventListener('statechange', () => {
    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
      // App is about to reload — save budget state first
      budSaveCurrentWeek();
      // Then reload
      window.location.reload();
    }
  });
});
```

Add `budSaveCurrentWeek()` before any `window.location.reload()` call in the service worker update handler.

Also add a `beforeunload` safety net in js/app.js:

```javascript
window.addEventListener('beforeunload', () => {
  budSaveCurrentWeek();
});
```

This catches any page unload (reload, tab close, navigation) and ensures the current budget week is saved.

---

## FIX 4 — Repopulate inputs correctly on render

In `renderBudgetTab()` or `renderBudgetWeek()` in js/app.js, verify that after setting input values from localStorage, the function reads the correct week key.

Add a console.log temporarily to verify:
```javascript
console.log('Budget week key:', weekKey());
console.log('Budget data for this week:', budLoadData()[weekKey()]);
```

If the week key doesn't match stored data (e.g. data stored as `2026-06-09` but key returns `2026-06-16`), the timezone fix above will resolve it.

Remove the console.log after verifying.

---

## VERIFICATION

1. Fill in all budget inputs for the current week
2. Force a page reload (pull to refresh or browser refresh)
3. Confirm all values are still populated after reload
4. Push an app update via Claude Code → GitHub → confirm values survive the service worker update reload
5. At 11:59pm Sunday AEST, check week key → at 12:00am Monday AEST, confirm week rolls over correctly (not at 10am Monday)
6. Fill in some inputs, wait 30 seconds without tapping Save — reload — confirm values persisted
