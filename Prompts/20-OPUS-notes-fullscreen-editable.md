# PROMPT 22 — Fullscreen Notes View Should Actually Be Editable

## CODEBASE CONTEXT

`#note-view-overlay` (index.html:606-613) is a "comfortable reading" fullscreen view for a
single note — but `#note-view-body` is a `<pre>` tag, not an input of any kind. It was built
read-only on purpose (comment: "Read the current note fullscreen for comfortable reading of
long notes", js/app.js:9716), with just a Copy button, not Save.

It's worse than just "can't type here" though. `notesViewFullscreen()` (js/app.js:9719-9724):
```js
function notesViewFullscreen(){
  const title=(document.getElementById('ne-title')?.value||'').trim();
  const body=document.getElementById('ne-body')?.value||'';
  document.getElementById('note-edit-overlay')?.remove(); // closes the edit modal — no id passed in, either
  showNoteView(title, body);
}
```
This reads whatever's currently typed in the edit modal (`#ne-title`/`#ne-body`, built fresh each
time by `notesOpenEdit(id)`, js/app.js:9675-9714), then **deletes that modal** to show the
read-only view. If you had unsaved typing and wanted to keep editing after glancing at
fullscreen, there's no path back — closing fullscreen returns to the notes list, and reopening
the note re-reads the last **saved** version from `loadNotes()`, silently dropping whatever
you'd typed. The "Read fullscreen" button doesn't even receive the note's `id` today, so there's
no way to write back to the right record from here even if the field were editable.

## TASK

### 1. Thread the note's id through
js/app.js:9687 (inside `notesOpenEdit()`'s template) — change:
```html
<button onclick="notesViewFullscreen()" ...>
```
to:
```html
<button onclick="notesViewFullscreen('${n.id}')" ...>
```
(`n.id` is already always set at this point, even for a brand-new unsaved note — js/app.js:9678.)

### 2. Save-before-leaving, without the strict "title required" gate
`notesSave()` (js/app.js:9746) alerts and bails if the title's empty — fine for its own explicit
Save button, wrong for a background save when just switching views. Add a lighter variant:
```js
function notesSaveDraft(id){
  const notes=loadNotes();
  const idx=notes.findIndex(n=>n.id===id);
  const updated={
    id,
    title: document.getElementById('ne-title')?.value?.trim()||'',
    body: document.getElementById('ne-body')?.value||'',
    type: document.getElementById('ne-type')?.value||'personal',
    dateType: document.getElementById('ne-datetype')?.value||'none',
    date: document.getElementById('ne-date')?.value||'',
    priority: document.getElementById('ne-priority')?.checked||false,
    createdAt: idx>=0?notes[idx].createdAt:getLocalDate()
  };
  if(idx>=0) notes[idx]=updated; else notes.push(updated);
  saveNotes(notes);
  return updated;
}
```
Rewrite `notesViewFullscreen`:
```js
function notesViewFullscreen(id){
  const saved = id ? notesSaveDraft(id) : null; // nothing typed so far is ever lost now
  document.getElementById('note-edit-overlay')?.remove();
  showNoteView(saved?saved.title:'', saved?saved.body:'', id);
}
```

### 3. Make the fullscreen view a real (small) editor
index.html:606-613 — swap the read-only title span and `<pre>` body for editable fields, keeping
the same visual sizing:
```html
<div id="note-view-overlay" style="display:none;position:fixed;top:0;right:0;bottom:0;left:0;z-index:120;background:var(--bg);overflow-y:auto;-webkit-overflow-scrolling:touch">
  <div style="position:sticky;top:0;background:var(--bg);z-index:10;padding:12px 16px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border)">
    <button onclick="closeNoteView()" aria-label="Back to notes" style="background:none;border:none;font-size:28px;line-height:1;color:var(--text);cursor:pointer;padding:0 4px;-webkit-tap-highlight-color:transparent">&#8249;</button>
    <input id="note-view-title" oninput="noteViewSave()" placeholder="Title" style="font-size:18px;font-weight:700;color:var(--text);flex:1;min-width:0;background:none;border:none;padding:0;font-family:inherit">
    <button id="note-view-copy" onclick="copyNoteView()" style="background:var(--accent);border:none;border-radius:12px;color:#fff;font-size:14px;font-weight:700;padding:8px 14px;cursor:pointer;-webkit-tap-highlight-color:transparent">Copy</button>
  </div>
  <textarea id="note-view-body" oninput="noteViewSave()" placeholder="Write here…" style="width:100%;display:block;box-sizing:border-box;border:none;background:none;outline:none;resize:none;padding:18px 16px calc(env(safe-area-inset-bottom,0px) + 40px);max-width:760px;margin:0 auto;min-height:calc(100vh - 80px);white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere;font-family:var(--font-ui),system-ui,sans-serif;font-size:15px;line-height:1.6;color:var(--text)"></textarea>
</div>
```

### 4. Wire up live saving + fix Copy
Replace `showNoteView`/`copyNoteView`'s use of the old `_noteViewText` cache with reads straight
from the (now-editable) fields, and add the debounced save:
```js
let _noteViewId=null;
let _noteViewSaveTimer=null;
function showNoteView(title, body, id){
  _noteViewId=id;
  const t=document.getElementById('note-view-title'); if(t) t.value=title||'';
  const b=document.getElementById('note-view-body'); if(b) b.value=body||'';
  const v=document.getElementById('note-view-overlay');
  if(v){ v.style.display='block'; v.scrollTop=0; }
}
function noteViewSave(){
  clearTimeout(_noteViewSaveTimer);
  _noteViewSaveTimer=setTimeout(()=>{
    if(!_noteViewId) return;
    const notes=loadNotes();
    const idx=notes.findIndex(n=>n.id===_noteViewId);
    if(idx<0) return;
    notes[idx].title=(document.getElementById('note-view-title')?.value||'').trim();
    notes[idx].body=document.getElementById('note-view-body')?.value||'';
    saveNotes(notes);
  }, 500);
}
function copyNoteView(){
  const title=document.getElementById('note-view-title')?.value||'';
  const body=document.getElementById('note-view-body')?.value||'';
  const text=(title?title+'\n\n':'')+body;
  const btn=document.getElementById('note-view-copy');
  const done=()=>{ if(btn){ const o=btn.textContent; btn.textContent='Copied ✓'; setTimeout(()=>{ btn.textContent=o; },1500); } };
  try{
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(text).then(done,()=>{}); return; }
  }catch(e){}
  // keep the existing insecure-context fallback below this, just swap its source string to `text` too
}
```
`closeNoteView()` stays as-is — the debounced save already covers anything typed before closing;
no need to force a synchronous save on exit.

## OUT OF SCOPE

- The compact edit modal (`#note-edit-overlay`, `notesOpenEdit`/`notesSave`) — unchanged, still
  the primary way to set type/date/priority (fullscreen only ever handled title+body).
- Notes list rendering, Home notes card/bubble — unaffected.
- Any Firebase-sync-frequency tuning beyond the 500ms debounce above — that's an existing pattern
  (`saveNotes()` already pushes to Firebase), just now reachable from one more place.

## VERIFICATION — for Francois to check

1. Open a note, tap the fullscreen icon → title and body are both now typeable directly in
   fullscreen.
2. Type something in fullscreen, tap back (‹), reopen the same note → your fullscreen edits are
   there, not lost.
3. Start a brand-new note, type only a body (no title), tap fullscreen icon → no "Add a title"
   alert interrupts you; jump to fullscreen, type more, come back → still there.
4. Copy button in fullscreen still copies the current (possibly just-edited) title+body.
5. Existing notes with type/date/priority set → still show correctly, unaffected by fullscreen
   edits to title/body only.
