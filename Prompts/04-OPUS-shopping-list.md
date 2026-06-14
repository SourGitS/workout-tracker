# PROMPT 3 — Kitchen Tab: Shopping List (Phase 2)

## PREREQUISITE

Complete Prompt 1 (nav restructure) and Prompt 2 (Recipe Book) before this.
The Kitchen tab must exist with a working Recipes sub-tab and `kitchen_recipes` data in localStorage.

---

## CODEBASE CONTEXT

Same app as Prompts 1 & 2 — Daily, multi-file: `index.html`, `css/style.css`, `js/app.js`.
All styling conventions, CSS variables, and component patterns are the same as Prompt 2.
localStorage prefix for all new keys: `kitchen_`

---

## FEATURE SPEC

### New localStorage keys
- `kitchen_shopping_selected` — array of recipe IDs selected for this week's shop
- `kitchen_shopping_checked` — object mapping `itemKey → true` for ticked items
- `kitchen_shopping_manual` — array of manually added items `{ id, name, category }`

---

## PANTRY STAPLES (always excluded from shopping list)

These items are never added to the shopping list. Normalise ingredient names to lowercase and check inclusion before adding:

```javascript
const PANTRY_STAPLES = new Set([
  // Oils & Fats
  'extra virgin olive oil', 'olive oil', 'salted butter', 'butter', 'canola oil',
  // Sauces & Condiments
  'soy sauce', 'worcestershire sauce', 'balsamic vinegar', 'white vinegar',
  'bbq sauce', 'teriyaki sauce', 'mayonnaise', 'chipotle in adobo',
  // Dry goods
  'eggs', 'salt', 'black pepper', 'curry powder', 'sugar', 'brown sugar',
  'plain flour', 'cinnamon', 'vanilla extract',
  // Fresh constants
  'garlic', 'onion', 'brown onion',
  // Spices
  'smoked paprika', 'paprika', 'coriander', 'cumin', 'chilli', 'chilli flakes',
  'garam masala', 'garlic powder', 'garlic salt', 'onion powder', 'parsley',
  'rosemary', 'oregano', 'italian herbs', 'allspice', 'roast chicken seasoning',
  'bay leaves', 'cloves', 'cayenne pepper', 'ginger', 'ginger powder',
  'sesame oil'
]);
```

---

## INGREDIENT CATEGORY MAPPING

Auto-assign shopping list categories based on ingredient name (case-insensitive substring match):

```javascript
function kitGetIngredientCategory(name) {
  const n = name.toLowerCase();
  if (/prawn|beef|chicken|lamb|steak|mince|patty|patties|pork|fish|tuna|salmon|egg/.test(n)) return 'Protein';
  if (/milk|cheese|butter|yoghurt|cream|feta/.test(n)) return 'Dairy';
  if (/lettuce|rocket|spinach|tomato|carrot|potato|onion|lemon|lime|berry|berries|apple|banana|capsicum|zucchini|mushroom|spring onion|basil|coriander leaf/.test(n)) return 'Produce';
  if (/bread|bun|noodle|rice|flour|pasta|oat|cereal|cracker|wrap|tortilla/.test(n)) return 'Bakery & Grains';
  return 'Other';
}
```

Category order in the shopping list: Produce → Protein → Dairy → Bakery & Grains → Other

---

## UI / UX SPEC

### Shopping sub-tab (inside Kitchen tab)

**Two states:**

**State 1: Recipe selector**
- Heading: "What are you cooking this week?"
- List of all saved recipes as large selectable cards (name, category pill, servings)
- Tap to select/deselect — selected cards show an accent-coloured checkmark
- Servings adjuster on each card: `−` | number | `+` (adjusts for this shop only, doesn't edit the recipe)
- "Build shopping list →" button at bottom — accent colour, full width

**State 2: Shopping list**
- Back arrow to return to recipe selector
- Header: "Shopping list" + item count badge
- **Sticky category headers** as user scrolls (use `position: sticky; top: 0`)
- Each item row: large checkbox (minimum 44×44px tap target) + ingredient name + quantity
- Checked items: strikethrough text, reduced opacity, move to bottom of category (or stay in place — your choice, but must be visually distinct)
- Combined quantities across recipes (e.g. if two recipes need garlic, show combined total)
- Manual add: fixed input bar at bottom above bottom nav — text field + "Add" button. Tapping "Add" appends to Other category with no quantity
- "Clear checked" button in header — removes all ticked items from list
- "Clear all & start over" button — resets to recipe selector

---

## QUANTITY COMBINING LOGIC

When building the list from selected recipes:

1. Scale each recipe's ingredients by `(selectedServings / baseServings)`
2. Exclude PANTRY_STAPLES
3. Group remaining ingredients by normalised name (lowercase, trimmed)
4. If same ingredient appears across multiple recipes with the same unit → add amounts
5. If units differ (e.g. "2 cups" vs "100g") → list as separate rows, don't convert
6. Round combined amounts to 1 decimal, trim trailing .0
7. Assign category using `kitGetIngredientCategory()`
8. Sort within each category alphabetically

---

## PERSISTENCE

- Selected recipes + their serving counts: `kitchen_shopping_selected` = `[{ recipeId, servings }]`
- Checked state: `kitchen_shopping_checked` = `{ "itemKey": true }` where itemKey = `${normalisedName}-${unit}`
- Manual items: `kitchen_shopping_manual` = `[{ id, name, category }]`
- All three persist between sessions. Manual clear resets all three.

---

## TECHNICAL REQUIREMENTS

- All new JS functions prefixed `kitShop` (e.g. `kitShopRender()`, `kitShopBuildList()`, `kitShopToggleCheck()`)
- All new CSS under `/* ── Kitchen Shopping ── */` block in style.css
- Sticky headers require the shopping list container to have `overflow-y: auto` and each header `position: sticky; top: 0; z-index: 5; background: var(--bg)`
- Checkbox must be a real `<input type="checkbox">` styled with CSS (not a div pretending to be one) for accessibility and large tap target
- Large checkbox CSS:
  ```css
  .shop-item-check { width: 44px; height: 44px; accent-color: var(--accent); cursor: pointer; flex-shrink: 0; }
  ```

---

## VERIFICATION

1. Tap Kitchen → Shopping sub-tab
2. See recipe selector with all saved recipes
3. Select 2 recipes, adjust servings on one → tap "Build shopping list"
4. See categorised list with sticky headers — shared ingredients combined
5. Garlic, onion, butter, soy sauce NOT in list (pantry staples excluded)
6. Tap a checkbox — item ticks, text strikes through
7. Add a manual item — appears in Other category
8. Close app, reopen — checked state and manual items persist
9. Tap "Clear checked" — ticked items removed, unticked remain
10. Tap "Clear all & start over" — returns to recipe selector, all state reset
11. Test on 375px mobile viewport — checkboxes large enough to tap while shopping
