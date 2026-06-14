# PROMPT 2 — Kitchen Tab: Recipe Book (Phase 1)

## CODEBASE CONTEXT (pre-answered — do not re-read files for this)

**App:** Daily — multi-file lifestyle tracker.
**Files:** `index.html` (structure), `css/style.css` (styles), `js/app.js` (JS logic)
**Stack:** Vanilla JS + CSS. No frameworks. Chart.js from CDN (already loaded). No other dependencies.

**Colour scheme (exact CSS variables):**
```
--bg: #ffffff / dark: #080808
--card: #ffffff / dark: rgba(255,255,255,0.05)
--text: #111111 / dark: #ffffff
--muted: rgba(0,0,0,0.45) / dark: rgba(255,255,255,0.45)
--border: rgba(0,0,0,0.08) / dark: rgba(255,255,255,0.08)
--accent: #FF6B35 (orange)
--success: #52B788
--danger: #E74C3C
--blue: #3b82f6
--radius: 16px
```

**Dark mode:** `[data-theme="dark"]` attribute on html/body. All new CSS must include dark variants.

**Font:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

**Navigation:** Bottom nav on mobile (5 tabs after Prompt 1 restructure): Home | Log | Kitchen | Budget | Settings. Desktop: left sidebar (160px). Kitchen tab replaces the old Stats tab.

**Existing UI components to reuse:**
- `.card` — white card, border 1px solid var(--border), border-radius 16px, padding 16px
- `.modal-overlay` + `.modal-box` — bottom sheet modal (border-radius 20px 20px 0 0)
- `.sec-label` — uppercase label, 11px, font-weight 600, letter-spacing 0.5px
- `.empty` — empty state: centred icon + title + subtitle
- `.toggle-switch` — iOS-style toggle
- `.modal-btn.primary` — solid accent button
- `.modal-btn.secondary` — outlined button
- `input` / `textarea` / `select` — grey fill (#f5f5f5 light, rgba(255,255,255,0.06) dark), 1px border, border-radius 8px, height 44–46px
- `.summary-grid` — 3-column stat grid with `.sum-card`
- `.status-pill` — small coloured badge (good/warn/over)
- Scale/press effect: `.card:active { transform: scale(0.97) }` — apply to all interactive cards

**localStorage key conventions:** prefix `wt_` for workout, `daily_` for budget. Use `kitchen_` prefix for all new keys.

**Existing localStorage keys (do not conflict):**
`wt_sessions`, `wt_weight`, `wt_swaps`, `wt_theme`, `wt_personalinfo`, `wt_calories`, `daily_budget`, `daily_budget_defaults`

**Desktop breakpoint:** `@media (min-width: 1024px)`

**setView(v) pattern:** Each tab has a `<section id="view-{name}">` in index.html. `setView()` in js/app.js shows/hides sections and calls the relevant render function.

**Calorie integration:** `wt_calories` stores today's calorie log as an array of `{ name, kcal }` objects keyed by date string. A "Log this meal" button on a recipe should push `{ name: recipeName, kcal: recipe.calories }` into today's log.

**Shared app:** Two users (Maya and François) share the same app via the same device/account. Recipes and shopping list are shared — no per-user filtering needed.

---

## TASK: Build the Recipe Book inside the Kitchen tab

**Do Prompt 1 (nav restructure) before this.** The Kitchen tab (`view-kitchen`) must already exist.

---

## FEATURE SPEC

### Data structure — store in `kitchen_recipes` localStorage key

```javascript
// Array of recipe objects
[
  {
    id: "uuid-string",           // crypto.randomUUID() or Date.now().toString()
    name: "Honey soy chicken thighs",
    category: "lunch",           // breakfast | lunch | dinner | dessert
    description: "One-line description",
    servings: 4,                 // base serving count
    ingredients: [
      { name: "Chicken thighs", amount: 600, unit: "g" },
      { name: "Basmati rice", amount: 2, unit: "cups" }
    ],
    steps: [
      "Marinate chicken in soy sauce and honey for 30 min.",
      "Heat pan over medium-high heat.",
      "Cook chicken 5–6 min each side until caramelised."
    ],
    tags: ["batch-prep", "high-protein"],   // array of strings
    calories: 520,               // per serving, optional (null if not set)
    protein: 42,                 // grams per serving, optional
    carbs: 48,
    fat: 12,
    favourite: false,
    batchPrep: false,
    createdAt: 1234567890000     // Date.now()
  }
]
```

---

## PRE-POPULATED RECIPES

Pre-populate `kitchen_recipes` on first load (if key doesn't exist) with these recipes. Fill in realistic ingredients, steps, macros, and tags.

### BREAKFAST

**French Toast with Berries**
- Servings: 2
- Ingredients: bread (4 slices), eggs (3), milk (¼ cup), vanilla extract (1 tsp), cinnamon (½ tsp), butter (1 tbsp), mixed berries (1 cup), maple syrup (2 tbsp)
- Steps: Whisk eggs, milk, vanilla, cinnamon. Dip bread. Cook in buttered pan 2–3 min each side until golden. Serve with berries and maple syrup.
- Tags: quick
- Calories: 420 per serving, protein 16g, carbs 58g, fat 14g

**Hash Browns**
- Servings: 2
- Ingredients: potatoes (4 medium), salt, black pepper, canola oil (2 tbsp)
- Steps: Grate potatoes, squeeze out moisture with a cloth. Season. Form into patties. Fry in oil over medium heat 4–5 min each side until golden and crispy.
- Tags: quick, batch-prep
- Calories: 280 per serving, protein 4g, carbs 48g, fat 9g

### LUNCH

**Honey Soy Chicken Thighs + Basmati Rice**
- Servings: 4
- Ingredients: chicken thighs (800g), soy sauce (3 tbsp), honey (2 tbsp), garlic (3 cloves), ginger (1 tsp), sesame oil (1 tsp), basmati rice (2 cups), spring onion (2, to garnish)
- Steps: Mix soy, honey, garlic, ginger, sesame oil. Marinate chicken 30+ min. Cook rice. Pan-fry chicken 5–6 min each side until caramelised. Slice and serve over rice. Top with spring onion.
- Tags: batch-prep, high-protein
- Calories: 520, protein 42g, carbs 48g, fat 14g
- batchPrep: true

**Spiced Lamb Pan Fry + Basmati Rice**
- Servings: 4
- Ingredients: lamb mince (600g), brown onion (1), garlic (3 cloves), garam masala (2 tsp), cumin (1 tsp), smoked paprika (1 tsp), basmati rice (2 cups), lemon (1), fresh parsley to garnish
- Steps: Cook rice. Fry onion until soft. Add garlic, then lamb mince. Break up and brown. Add spices, cook 2 min. Squeeze lemon. Serve over rice, garnish with parsley.
- Tags: batch-prep, high-protein
- Calories: 490, protein 38g, carbs 44g, fat 18g
- batchPrep: true

**Korean-Style Crispy Beef Mince + Rice**
- Servings: 4
- Ingredients: beef mince (600g), soy sauce (3 tbsp), brown sugar (1 tbsp), sesame oil (1 tsp), garlic (3 cloves), ginger (1 tsp), spring onion (3), basmati rice (2 cups), chilli flakes (½ tsp)
- Steps: Cook rice. Mix soy, brown sugar, sesame oil. Fry garlic and ginger 1 min. Add mince, cook until browned and crispy at edges. Add sauce, toss. Serve over rice. Top with spring onion and chilli.
- Tags: batch-prep, high-protein
- Calories: 510, protein 40g, carbs 46g, fat 16g
- batchPrep: true

### DINNER

**Butter Garlic Prawns**
- Servings: 2
- Ingredients: prawns (400g, peeled), butter (60g), garlic (4 cloves), lemon (1), parsley (small handful), salt, black pepper
- Steps: Heat butter in pan over medium-high heat. Add garlic, cook 30 sec. Add prawns, cook 1–2 min each side until pink. Squeeze lemon, season. Finish with parsley. Serve immediately.
- Tags: quick, high-protein
- Calories: 380, protein 36g, carbs 4g, fat 24g

**Pan Burgers**
- Servings: 2
- Ingredients: burger patties (2, 150g each), cheese slices (2), brown onion (1, thinly sliced), butter (1 tbsp), brioche buns (2), mayonnaise (2 tbsp), tomato ketchup (1 tbsp), Dijon mustard (1 tsp), rocket (handful)
- Steps: Caramelise onion in butter over low heat 20 min. Season patties. Cook in hot dry pan 3–4 min each side. Add cheese slice, cover 30 sec to melt. Mix mayo, ketchup, mustard for burger sauce. Toast buns. Build: sauce, rocket, patty with cheese, caramelised onion, top bun.
- Tags: quick
- Calories: 720, protein 38g, carbs 52g, fat 38g

**Turkish Bread Steak Sandwich**
- Servings: 2
- Ingredients: rump steak (400g), Turkish bread (1 loaf), brown onion (1, sliced), butter (1 tbsp), rocket (handful), mayonnaise (2 tbsp), Worcestershire sauce (1 tbsp), Dijon mustard (1 tsp), salt, black pepper
- Steps: Caramelise onion in butter 20 min. Season steak well. Sear in very hot pan 2–3 min each side for medium-rare. Rest 5 min, then slice thin against the grain. Mix mayo, Worcestershire, mustard for steakhouse sauce. Toast Turkish bread. Build: sauce, rocket, steak slices, caramelised onion.
- Calories: 680, protein 44g, carbs 54g, fat 26g

**Reverse Sear Rump Steak with Pan Sauce and Noodles**
- Servings: 2
- Ingredients: rump steak (500g), Mi Goreng noodles (2 packs), butter (30g), garlic (2 cloves), soy sauce (2 tbsp), Worcestershire sauce (1 tbsp), balsamic vinegar (1 tsp), salt, black pepper
- Steps: Season steak generously. Bake at 120°C until internal temp 50°C (approx 30–40 min). Rest while making sauce. Sear steak in hot pan 1 min each side. Remove. Add butter, garlic to pan. Deglaze with soy, Worcestershire, balsamic. Cook noodles to packet. Slice steak, serve over noodles with pan sauce.
- Tags: high-protein
- Calories: 620, protein 52g, carbs 44g, fat 22g

---

## UI / UX SPEC

### Kitchen tab layout (mobile)

**Sub-nav (3 tabs, same style as existing sub-toggle):**
```
Recipes | Shopping | Pantry
```
Only build Recipes in this prompt. Shopping and Pantry are placeholders ("Coming soon").

**Recipes view — two states:**

**State 1: Recipe list**
- Search bar at top (filters by name or ingredient in real time)
- Category filter pills: All | Breakfast | Lunch | Dinner | Dessert
- Recipe cards in a vertical scrollable list
- Each card shows: name, category pill, description, servings, calorie badge, favourite star, batch-prep badge if applicable
- Tap a card → opens recipe detail view (State 2)
- FAB (floating action button) in bottom-right to add new recipe — accent colour, "+" icon, 56px circle

**State 2: Recipe detail (full-screen overlay, bottom sheet style)**
- Back arrow at top-left
- Recipe name (large, bold)
- Category pill + tags row
- Servings scaler: prominent `−` button | number | `+` button (large tap targets, minimum 48px)
- All ingredient amounts scale proportionally with serving count
- Ingredients list (ingredient name + amount + unit per row)
- Divider
- Steps list (numbered, one per row, generous line height)
- Macros row (calories / protein / carbs / fat) — only if set
- Action buttons at bottom:
  - "Log this meal" → adds `{ name: recipeName, kcal: scaledCalories }` to `wt_calories` for today
  - "Edit" → opens edit form (same as add form, pre-filled)
  - "Delete" → confirm then delete

**Add/Edit form (bottom sheet modal, same `.modal-overlay` pattern):**
- Name (text input)
- Category (select: Breakfast / Lunch / Dinner / Dessert)
- Description (text input, single line)
- Servings (number input)
- Calories per serving (number, optional)
- Protein / Carbs / Fat per serving (number inputs, optional — show in a 3-col grid)
- Tags (text input, comma-separated)
- Ingredients section: list of rows, each with Name + Amount + Unit. "Add ingredient" button appends a new row.
- Steps section: list of textarea rows. "Add step" button appends a new row.
- Save / Cancel buttons

### Desktop layout (≥1024px)
- Two-column: recipe list on left (40%), recipe detail on right (60%) — persistent, no overlay
- When no recipe selected, right panel shows empty state
- Search + filters above the left column

---

## TECHNICAL REQUIREMENTS

- localStorage key: `kitchen_recipes` (array of recipe objects)
- Helper functions prefix: `kit` (e.g. `kitLoadRecipes()`, `kitSaveRecipes()`, `kitRenderList()`, `kitRenderDetail()`)
- On first load, if `kitchen_recipes` doesn't exist, call `kitSeedRecipes()` to populate defaults
- Serving scaler: store current scale factor in JS variable (not localStorage), resets when closing detail view
- Scaled ingredient amount = `(baseAmount / baseServings) * currentServings`, displayed to 1 decimal place (trim trailing .0)
- "Log this meal" must scale calories by current servings before logging
- Search filters both name and ingredient names (case-insensitive)
- Favourite toggle: tap star on list card, immediately saves to localStorage
- All CSS additions go in `css/style.css` under a `/* ── Kitchen ── */` comment block
- All JS additions go in `js/app.js`, grouped together
- HTML for `view-kitchen` goes in `index.html` replacing the placeholder from Prompt 1

---

## VERIFICATION

1. Open index.html in browser
2. Tap Kitchen → see Recipes sub-tab with all pre-populated recipes
3. Search "garlic" → filters to matching recipes
4. Filter by "Lunch" → shows only lunch recipes
5. Tap a recipe → detail view opens with ingredients and steps
6. Change servings from 4 to 2 → all ingredient amounts halve
7. Tap "Log this meal" → go to Settings > Health, confirm calories added
8. Tap "+" FAB → add form opens, fill in a new recipe, save, confirm it appears in list
9. Edit an existing recipe, save, confirm changes persist after page refresh
10. Delete a recipe, confirm it's removed
11. Toggle dark mode → all Kitchen UI respects dark theme
12. Test on 375px viewport — recipe cards readable, servings scaler buttons large enough to tap
