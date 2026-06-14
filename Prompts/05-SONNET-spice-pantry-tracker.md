# PROMPT 4 — Kitchen Tab: Spice & Pantry Tracker (Phase 3)

## PREREQUISITE

Complete Prompts 1, 2, and 3 before this. The Kitchen tab must have working Recipes and Shopping sub-tabs.

---

## CODEBASE CONTEXT

Same app — Daily, multi-file: `index.html`, `css/style.css`, `js/app.js`.
localStorage prefix: `kitchen_`
Styling conventions identical to Prompts 2 & 3.

---

## FEATURE SPEC

### New localStorage key
- `kitchen_pantry` — object: `{ [itemId]: { inStock: boolean, runningLow: boolean } }`

---

## PRE-POPULATED PANTRY LIST

Seed this list on first load if `kitchen_pantry` doesn't exist. All items default to `inStock: true, runningLow: false`.

```javascript
const PANTRY_DEFAULTS = {
  spices: [
    'Smoked paprika', 'Paprika (ground)', 'Coriander (ground)', 'Cumin (ground)',
    'Chilli flakes', 'Garam masala', 'Garlic powder', 'Garlic salt',
    'Onion powder', 'Allspice (ground)', 'Roast chicken seasoning', 'Cayenne pepper',
    'Ginger powder'
  ],
  herbs: [
    'Parsley (dried)', 'Rosemary leaves', 'Oregano leaves',
    'Italian herbs', 'Bay leaves', 'Cloves (whole)'
  ],
  dry: [
    'Salt', 'Black pepper', 'Curry powder', 'Cinnamon',
    'Sugar', 'Brown sugar', 'Plain flour', 'Vanilla extract'
  ],
  oils: [
    'Extra virgin olive oil', 'Canola oil', 'Salted butter', 'Sesame oil'
  ],
  sauces: [
    'Soy sauce', 'Worcestershire sauce', 'Balsamic vinegar', 'White vinegar',
    'BBQ sauce', 'Teriyaki sauce', 'Mayonnaise', 'Chipotle in adobo',
    'Tomato ketchup', 'Dijon mustard'
  ]
};
```

---

## UI / UX SPEC

### Pantry sub-tab (inside Kitchen tab)

**Layout:**
- Summary row at top: "X items in stock · Y running low · Z out of stock" — coloured badges
- Category sections: Spices | Dried Herbs | Dry Goods | Oils & Fats | Sauces & Condiments
- Each section has a sticky header (category name + item count)
- Each item row contains:
  - **In-stock toggle** (large checkbox, 44×44px minimum) — green when ticked
  - **Item name**
  - **"Low" flag button** — small amber pill/button "⚠ Low" — tap to toggle running-low state. If running low, pill turns amber and item shows on shopping list even if still ticked
  - If out of stock (unticked), row background subtly tinted red/amber

**"Add custom item" flow:**
- Small "+ Add item" button below each category section
- Inline text input appears, user types name and presses Enter or taps Add
- New item appears in that category, saved to `kitchen_pantry` with a generated id

**Shopping list integration:**
- Items that are either `inStock: false` OR `runningLow: true` are automatically appended to the shopping list under their category
- These appear as a "Pantry needs" section in the shopping list, separate from recipe ingredients
- Ticking them in the shopping list sets `inStock: true, runningLow: false` in `kitchen_pantry`

---

## TECHNICAL REQUIREMENTS

- All new JS functions prefixed `kitPantry` (e.g. `kitPantryRender()`, `kitPantryToggle()`, `kitPantryToggleLow()`)
- All new CSS under `/* ── Kitchen Pantry ── */` block in style.css
- Item IDs: normalised lowercase item name (e.g. `"smoked_paprika"`) — consistent so pantry staples exclusion list in Shopping matches
- Custom items get id = `custom_${Date.now()}`
- The PANTRY_STAPLES set in prompt-3-shopping-list should be derived from these item names — update it if needed

---

## VERIFICATION

1. Tap Kitchen → Pantry sub-tab
2. See all categories with pre-populated items, all in-stock
3. Untick "Soy sauce" → row turns red-tinted, summary updates
4. Tap "⚠ Low" on "Smoked paprika" → pill turns amber
5. Go to Shopping tab, build a list → "Pantry needs" section shows soy sauce + smoked paprika
6. Tick soy sauce in shopping list → return to Pantry, confirm soy sauce is back in stock
7. Add a custom item to Spices → persists after page refresh
8. Toggle dark mode → all pantry UI looks correct
