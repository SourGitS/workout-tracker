# PROMPT 15 — Home Accounts Card: Lead With Total Assets, De-emphasize Net Worth

## CODEBASE CONTEXT

The Home page's accounts widget (`renderHome()`, js/app.js:7185) builds a `balanceRow` block
at lines 7331-7350 using three helpers (js/app.js:4846-4848):
```js
function accountsAssetsTotal(){ return accounts.filter(a=>a&&a.type==='asset').reduce((s,a)=>s+(parseFloat(a.current)||0),0); }
function accountsDebtsTotal(){  return accounts.filter(a=>a&&a.type==='debt' ).reduce((s,a)=>s+(parseFloat(a.current)||0),0); }
function accountsNetWorth(){ return accountsAssetsTotal()-accountsDebtsTotal(); }
```
Right now the card leads with **net worth** as the big 30px number (coloured green/red by sign
via `_nwCol`), with assets total demoted to a small muted subtext line (currently mislabelled
"total balance"). Francois wants this flipped: total assets should be the headline figure, net
worth still shown but visually secondary.

## TASK

Replace the `balanceRow` block (js/app.js:7331-7350) with:
```js
const balanceRow=
    '<div class="card home-networth-card" style="padding:0;overflow:hidden;margin-bottom:12px">'+
      '<div style="background:transparent;padding:12px 16px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--muted);display:flex;justify-content:space-between;align-items:center">'+
        '<span>💰 Total Assets</span>'+
        '<span onclick="openAccounts()" style="cursor:pointer;text-transform:none;letter-spacing:0;font-weight:700;color:var(--accent)">Manage Accounts →</span>'+
      '</div>'+
      '<div style="padding:12px 16px 16px">'+
        (accounts.length
          ? '<div style="font-family:var(--font-num);font-size:30px;font-weight:800;line-height:1;color:var(--text)">'+fmtMoney(_assets)+'</div>'+
            '<div style="font-size:12px;color:var(--muted);margin-top:6px">Net worth '+fmtMoney(_nw)+' · '+fmtMoney(_debts)+' debts</div>'+
            // Expand/collapse the per-account list — same inline toggle idiom as the
            // Recent-workout card; no re-render, so it can't lose scroll position.
            '<div onclick="var d=this.nextElementSibling;var open=d.style.display===\'block\';d.style.display=open?\'none\':\'block\';this.querySelector(\'span\').textContent=open?\'▾\':\'▴\'" '+
              'style="cursor:pointer;font-size:12px;font-weight:700;color:var(--muted);margin-top:10px;display:flex;justify-content:space-between;align-items:center">'+
              accounts.length+' account'+(accounts.length===1?'':'s')+' <span>▾</span></div>'+
            '<div class="home-accts-list" style="display:none;margin-top:4px">'+_acctRows+'</div>'+
            _stmtRows
          : '<div onclick="openAccounts()" style="cursor:pointer;font-size:14px;color:var(--muted)">Tap to add your savings, credit card, or any balance to track net worth.</div>')+
      '</div>'+
    '</div>';
```

What changed and why:
- Header label: "💰 Net worth" → "💰 Total Assets" — the label above the big number should
  describe what it now is.
- Big number: `_nw` → `_assets`, colour `_nwCol` (green/red by sign) → flat `var(--text)`. Assets
  aren't a signed/directional figure the way net worth is, so the semantic red/green doesn't
  apply — same neutral treatment other hero numbers in the app use.
- Subtext: net worth moves down here, small and `var(--muted)` — no more green/red on it either.
  That colour removal is the actual "less important" lever; size and position already do most of
  the work, and a loud green/red on the secondary line would still fight with the headline
  number for attention.
- Debts total stays in the subtext, just re-worded to sit alongside net worth instead of assets.

Also remove the now-unused `_nwCol` const (js/app.js:7316) — double-check it isn't referenced
anywhere else inside `renderHome()` before deleting it, same as any other dead-variable cleanup.

## OUT OF SCOPE

Two other places show net-worth-first and are deliberately left untouched by this prompt:
- `renderAccountsPage()` (js/app.js:7871-7884, the `#accounts-networth` header inside the
  full-screen **Accounts page itself**, not Home) — still leads with net worth. This means
  Home and the Accounts page will briefly disagree on what's "first" until/unless Francois asks
  for the same swap there.
- The Budget tab's own hero card (`#bud-hero-net`, index.html:257-260) — a separate "Net worth"
  figure inside the Budget hero, unrelated to this card.
- The Stats "Net worth over time" chart (js/app.js:~6504-6514) — a trend line, not a snapshot
  card, different context entirely.

## VERIFICATION — for Francois to check

1. Home page → Accounts card now shows your **total assets** as the big number, not net worth.
2. Underneath it, in smaller muted text: "Net worth $X · $Y debts" — still visible, just
   de-emphasized, and no longer green/red.
3. Tap the account-count row to expand → per-account list still works exactly as before.
4. If you carry any tracked credit-card statement balance, the amber due-date warning still
   shows underneath, unchanged.
5. Empty state (no accounts yet) → unchanged "Tap to add…" prompt.
6. Accounts page itself (tap "Manage Accounts →") — intentionally NOT changed by this prompt;
   still leads with net worth same as before.
