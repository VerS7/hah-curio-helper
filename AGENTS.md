# AGENTS.md — Curiosity Planner (Haven & Hearth)

> Operational guide and domain manual for AI coding agents working on the Curiosity Planner codebase.

---

## 1. Project Overview & Architecture

Curiosity Planner is a zero-dependency, client-side web application designed for players of **Haven & Hearth** (H&H). It computes optimal curiosity study schedules to maximize Learning Points (LP) within a given planning horizon, subject to real-game mental weight (Attention) and grid capacity constraints.

### Core Stack & Architecture Principles
- **Pure Vanilla Web Technologies**: HTML5, Vanilla JavaScript (ES6+), modern CSS3.
- **Zero Runtime Dependencies**: No npm packages, no bundlers, no build steps. The app runs immediately when opening `index.html` in any browser or serving statically.
- **Offline-First**: All 840 curiosity definitions are embedded in `data.js`. Curio images load from `ringofbrodgar.com` with graceful offline fallback to SVG placeholders.
- **Clean Layered Separation**:
  - `planner.js`: Pure mathematical domain engine (discrete-event simulation, grid packing, min-heap, priority sorting). CommonJS-compatible (`module.exports`) for headless Node.js testing.
  - `app.js`: Application controller, reactive state management, debounced `localStorage` persistence, DOM rendering.
  - `index.html` & `style.css`: Semantic markup, flat dark UI theme, responsive CSS Grid/Flexbox layouts.
  - `data.js`: Static database of 840 curiosities generated via `tools/data_from_json.py`.

---

## 2. Haven & Hearth Curiosity Mechanics & Domain Rules

Understanding game mechanics is required to prevent invalid optimizations or broken simulation rules.

### 2.1. Fundamental Entities & Properties
- **Learning Points (LP)**: The primary progression currency in H&H. The planner's goal is **maximum LP gained** within the horizon.
- **Mental Weight (MW / Attention)**: Each curio has a weight cost. The character has an Attention pool (determined by Intelligence and bonuses), represented by the Attention cap (`bufferMaxWeight`).
- **Experience Points (XP)**: Consumed when a curio finishes studying. Tracked as an expenditure.
- **Study Time**: Real-time duration required to study a curio (`studySeconds`).
- **Grid Dimensions**: Curios occupy a 2D bounding box ($w \times h$ cells) in grid inventories.

### 2.2. The Study Report (Buffer) — Workstation
- **Fixed Size (4 × 4 cells)**: In Haven & Hearth, the player's study inventory (Study Report) is strictly $4 \times 4$ cells (16 cells total). This is immutable and not configurable.
- **Attention Cap (Mental Weight)**: Total active curiosity weight cannot exceed the Attention cap (`bufferMaxWeight`).
- **Strictly Unique Types (No Duplicates in Study Report)**:
  - A character can only study **one copy of any given curiosity type at a time**.
  - Two copies of `Gold Egg` or two copies of `Cone Cow` **cannot** reside in the Study Report simultaneously.
  - **Gemstones**: All sizes and cuts of the same gem family share the same study slot. Two curiosities of the same gem family (e.g. `Tiny Rough Jade` and `Grand Brilliant Jade`) **cannot** reside in the Study Report simultaneously.
- **Parallel Independent Study**:
  - All items in the Study Report progress their timers concurrently and independently.
  - An item with duration $t$ completes exactly $t$ seconds after entering the Study Report.
- **Completion & Resource Freeing**:
  - Upon completion, the curio grants LP, spends XP, and disappears from the Study Report.
  - Its cells and Attention are immediately freed.

### 2.3. Operational Modes: Study Desk vs. Upkeep

The planner operates in one of two distinct modes:

#### 1. Study Desk Mode (`mode: "desk"`)
- **Physical Desk Inventory**: Models loading curiosities into an in-game Study Desk container ($N \times N$ cells, configurable from $5 \times 5$ to $12 \times 12$).
- **Finite Queue**: The study desk is limited strictly by grid cells (no weight cap). It serves as a finite storage queue that drains into the Study Report over time.
- **Serialization & Queue Cap**: Multiple copies of the same curio type are studied serially. Each type is capped to:
  $$\text{maxCopies}(c) = \max\left(1, \left\lfloor \frac{\text{horizon}}{c.\text{studySeconds}} \right\rfloor\right)$$
- **Fit to Horizon**: When enabled, the engine performs a binary search over desk cell budgets to find the largest queue that drains completely before the deadline.
- **Primary Output**: A desk loadout layout / multiset and queue drain statistics.

#### 2. Upkeep Mode (`mode: "upkeep"`)
- **Continuous Study Rotation**: Models active players who continuously replenish their Study Report ($4 \times 4$) from an unconstrained external inventory (e.g. storage chests).
- **No Desk Limit**: Study Desk size is bypassed and hidden in the UI.
- **Fit to Horizon (20% Study Time Overrun)**:
  - When enabled (`fitToHorizon: true`), curios that start before the horizon and finish within 20% of their study time past the deadline ($t_{\text{finish}} - \text{horizon} \le 0.2 \times c.\text{studySeconds} \iff t_{\text{now}} + 0.8 \times c.\text{studySeconds} \le \text{horizon}$) are placed, completed, and counted toward LP and XP.
  - When disabled (`fitToHorizon: false`), a strict horizon cutoff is enforced ($c.\text{studySeconds} \le \text{horizon} - \text{currentTime}$).
- **Unconstrained Supply Simulation**: Each candidate curio is given an initial supply equal to $\text{maxUsefulCopies}(c)$. The simulation runs continuous refills whenever slots open.
- **Primary Output**: The total curiosity consumption / production requirements across the entire horizon ($\times N$ total copies studied, total LP, total XP per type).

### 2.4. Refill Logic (Event Loop)
When a curio finishes in the Study Report:
1. **Same-type refill first**: Try to take another copy of the completed curio (from the desk queue or upkeep supply). Its type just vacated the Study Report, and its dimensions and weight are guaranteed to fit.
2. **Priority fallback**: If no copies of that type remain or it cannot finish before the horizon deadline, scan candidate pool by user priority for the highest-ranked curio that:
   - Fits within available Study Report grid cells.
   - Fits within remaining Attention (weight).
   - Is not already active in the Study Report (uniqueness constraint).
   - Can finish within allowed time limits:
     $$c.\text{studySeconds} \le \text{horizon} - \text{currentTime} \quad (\text{or } c.\text{studySeconds} \times 0.8 \le \text{horizon} - \text{currentTime} \text{ if Upkeep + Fit to Horizon})$$
3. **Repeat greedy placement**: Continue refilling until no more curios fit. (Freeing a single heavy curio can open room for multiple lighter curios).

### 2.5. Min and Max Quantity Constraints
- **Per-Curiosity Limits**:
  - `minCopies` ($c.\text{minCopies} \ge 0$, default `0`): Minimum number of copies of this curio that must be studied.
  - `maxCopies` ($c.\text{maxCopies} \ge 0$, default `null` / unbounded): Maximum number of copies of this curio that may be studied.
- **Feasibility & Effective Limits**:
  - Natural horizon cap:
    $$\text{horizonCap}(c) = \max\left(1, \left\lfloor \frac{\text{horizon}}{c.\text{studySeconds}} \right\rfloor\right)$$
  - Effective upper bound: $\text{effectiveMax}(c) = \min(c.\text{userMax} \mathbin{??} \text{horizonCap}(c), \text{horizonCap}(c))$. If `effectiveMax === 0`, curio is excluded.
  - Effective lower bound: $\text{effectiveMin}(c) = \min(c.\text{userMin} \mathbin{??} 0, \text{effectiveMax}(c))$.
- **Allocation Rules**:
  - **Desk Mode**: Queue allocation (`buildTable`) executes in two distinct phases:
    1. *Mandatory Phase*: Allocate `effectiveMin` copies for all candidates in priority order up to the cell budget.
    2. *Greedy Phase*: Fill remaining cell budget with additional copies up to `effectiveMax` in priority order.
  - **Upkeep Mode & Event Refill**:
    - When refilling open Study Report slots, candidates with unmet minimum quotas ($(\text{studied} + \text{inBuffer}) < \text{effectiveMin}$) are given strict placement priority over normal candidates.
    - No curio can ever exceed its `effectiveMax` bound.

### 2.6. Quality (Q) Scaling Formula
In Haven & Hearth, curio quality scales Learning Points using a square-root relationship against base quality ($Q_0 = 10$):
$$\text{LP}_{\text{effective}} = \text{LP}_{\text{base}} \times \sqrt{\frac{Q}{10}}$$
- $Q10 \to 1.0\times$
- $Q40 \to 2.0\times$
- $Q90 \to 3.0\times$
- $Q160 \to 4.0\times$
- Mental weight and study time are **intrinsic and unaffected by quality**.

### 2.7. Gemstones Taxonomy (540 Variants)
- 540 of the 840 curiosities in `data.js` are cut gemstones matching the pattern:
  `"<Size> <Cut> <GemFamily>"`
- **Sizes (6)**: `Tiny`, `Small`, `Fair`, `Large`, `Grand`, `Jotun`
- **Cuts (6)**: `Rough`, `Smooth`, `Cabochon`, `Pear`, `Heart`, `Brilliant`
- **Gem Families (15)**: `Amber`, `Amethyst`, `Diamond`, `Dust Jewel`, `Emerald`, `Jade`, `Moonstone`, `Onyx`, `Opal`, `Red Coral`, `Ruby`, `Sapphire`, `Sugar Diamond`, `Topaz`, `Turquoise`
- **Critical Parsing Rule**: `Diamond` and `Sugar Diamond` are two separate families. When parsing, family name is the **entire remainder** of the string after Size and Cut:
  ```javascript
  const p = name.split(" ");
  const family = p.slice(2).join(" ");
  ```
- **Study Exclusivity Rule**: Only one gemstone of a given family can be studied concurrently in the Study Report (Buffer). Different gem families (e.g. Jade and Ruby) can be studied concurrently.

### 2.8. Zero XP Cost Curios & Deterministic Sorting
Four curios have `xpCost = 0`:
1. `A Talking Whale`
2. `Driftwood Crown`
3. `Bloated Bolete`
4. `Ant Soldiers`

> [!WARNING]
> Computing $\frac{\text{LP}}{\text{XP}}$ yields `Infinity`. In JavaScript, `Infinity - Infinity === NaN`. If an array comparator uses subtraction (`a - b`), `NaN` produces non-deterministic sort order and scrambles top-tier curios.
> **Rule**: Always use direct comparison (`<`, `>`, `===`) and tiebreak with `curio.name`.

### 2.9. Bottleneck Diagnosis
The statistics panel must evaluate and report which constraint binds the current setup:
- **Attention-Bound**: `bufferPeakWeight >= maxWeight` while `bufferPeakCells < totalCells`. (Raise Attention or use lighter curios).
- **Cell-Bound**: `bufferPeakCells >= totalCells` while `bufferPeakWeight < maxWeight`. (Study Report grid is full).
- **Type-Bound**: Both Attention and cells have spare capacity, but Study Report idles because the study desk lacks distinct curio types to study in parallel.

---

## 3. Project Structure & Key Files

```text
hah-curio-helper/
├── index.html            # Main UI markup (3 panels: Settings, Grids/Stats, Curio Selection)
├── style.css             # Dark theme stylesheet, CSS variables, responsive rules
├── planner.js            # Core simulation engine (exportable CommonJS / browser script)
├── app.js                # App state, event listeners, localStorage, DOM renderer
├── data.js               # Embedded catalog: const CURIOSITIES_DATA = [...] (840 items)
├── PLAN.md               # Historical roadmap and multi-stage execution plan
├── README.md             # End-user documentation
└── tools/
    ├── data_from_json.py # Python script regenerating data.js from raw JSON
    └── data/
        └── curiosities.json # Raw scraped curiosity dataset
```

---

## 4. Architectural Invariants & Agent Guidelines

When modifying this repository, adhere to these strict invariants:

1. **Zero External Dependencies**:
   - Do not introduce npm dependencies, build scripts, or CSS preprocessors.
   - All code must execute directly in standard modern evergreen browsers.

2. **Pre-Sorting Multiplier Application**:
   - Multipliers (`lpMultiplier`, `speedMultiplier`, `quality`) must be applied in `Planner` **before sorting**.
   - Derived metrics like `lp_per_weight_hour` must evaluate effective values. Applying multipliers after sorting breaks optimal greedy item selection.
   - Do not mutate the global `CATALOG` or `CURIOSITIES_DATA`.

3. **Buffer Geometry is Fixed**:
   - The buffer is $4 \times 4$ cells. Do not add UI sliders to resize the buffer.

4. **Performance on Hot Paths**:
   - In `planner.js`, the candidate pool is sorted **once** in the `Planner` constructor, not on every simulation event.
   - `GridPacker.remove(x, y, w, h)` clears only the item's rectangular footprint; never perform a full-grid scan on removal.
   - `Fit to horizon` performs binary search over table cell budgets (~8 simulation runs); keep each simulation run under 2ms.

5. **Safe State Persistence (`localStorage`)**:
   - Storage key: `hah-curio-planner:v1`.
   - All writes must be debounced (300–500ms).
   - Wrap `localStorage.getItem` and `localStorage.setItem` in `try/catch` to avoid crashes in private browsing mode or when storage quotas are exceeded.
   - When saving selected curios, optimize payload (e.g. serialize `"ALL"` if all are selected).

6. **Clean UTF-8 Encodings & UI Language**:
   - Interface text, tooltips, and documentation must be in **English**.
   - Use valid UTF-8 without BOM. Use HTML entities (`&times;`, `&mdash;`, `&middot;`) for special typographic symbols in HTML to avoid encoding corruption across environments.

7. **Operating Mode Compatibility**:
   - `Planner` must support both `mode: "desk"` (default) and `mode: "upkeep"`.
   - In Upkeep mode, the UI hides desk size controls while "Fit to horizon" controls remain visible and active to toggle the 20% study time overrun tolerance.
   - `report()` returns mode-specific structures: `report.table` in Desk mode, and `report.upkeep` in Upkeep mode, with shared `buffer` and `stats` fields (including `LP per day` and `LP per hour`).

---

## 5. Development, Testing & Verification

### 5.1. Running the Application
- **Direct browser**: Double-click `index.html`.
- **Local HTTP server**:
  ```powershell
  python -m http.server 8000
  ```
  Navigate to `http://localhost:8000`.

### 5.2. Headless Simulation Testing (Node.js)
Because `planner.js` uses `module.exports` conditionally, the core engine can be validated without a browser:

```powershell
# Desk Mode (3 days baseline)
node -e "const vm = require('vm'); const fs = require('fs'); vm.runInThisContext(fs.readFileSync('./data.js', 'utf8')); const { Planner } = require('./planner.js'); const p = new Planner(CURIOSITIES_DATA, { mode: 'desk', tableW: 12, tableH: 12, bufferW: 4, bufferH: 4, bufferMaxWeight: 150, horizonSeconds: 3 * 86400, priorities: [{ metric: 'lp_per_weight_hour', direction: 'max' }], lpMultiplier: 1, speedMultiplier: 1, fitToHorizon: false }); console.log(p.run().stats);"

# Upkeep Mode (3 days baseline, strict horizon cutoff)
node -e "const vm = require('vm'); const fs = require('fs'); vm.runInThisContext(fs.readFileSync('./data.js', 'utf8')); const { Planner } = require('./planner.js'); const p = new Planner(CURIOSITIES_DATA, { mode: 'upkeep', tableW: 12, tableH: 12, bufferW: 4, bufferH: 4, bufferMaxWeight: 150, horizonSeconds: 3 * 86400, priorities: [{ metric: 'lp_per_weight_hour', direction: 'max' }], lpMultiplier: 1, speedMultiplier: 1, fitToHorizon: false }); console.log(p.run().stats);"

# Upkeep Mode (3 days baseline, with Fit to Horizon 20% study time tolerance)
node -e "const vm = require('vm'); const fs = require('fs'); vm.runInThisContext(fs.readFileSync('./data.js', 'utf8')); const { Planner } = require('./planner.js'); const p = new Planner(CURIOSITIES_DATA, { mode: 'upkeep', tableW: 12, tableH: 12, bufferW: 4, bufferH: 4, bufferMaxWeight: 150, horizonSeconds: 3 * 86400, priorities: [{ metric: 'lp_per_weight_hour', direction: 'max' }], lpMultiplier: 1, speedMultiplier: 1, fitToHorizon: true }); console.log(p.run().stats);"

# Desk Mode with minCopies and maxCopies constraint
node -e "const vm = require('vm'); const fs = require('fs'); vm.runInThisContext(fs.readFileSync('./data.js', 'utf8')); const { Planner } = require('./planner.js'); const data = CURIOSITIES_DATA.map(c => c.name === 'Cone Cow' ? { ...c, minCopies: 5, maxCopies: 5 } : c); const p = new Planner(data, { mode: 'desk', tableW: 12, tableH: 12, bufferW: 4, bufferH: 4, bufferMaxWeight: 150, horizonSeconds: 3 * 86400, priorities: [{ metric: 'lp_per_weight_hour', direction: 'max' }], lpMultiplier: 1, speedMultiplier: 1, fitToHorizon: false }); console.log('Cone Cow desk allocation:', p.run().table.groups.find(g => g.name === 'Cone Cow'));"
```

### 5.3. Baseline Verification Benchmarks
Validate simulation integrity against known mathematical baselines:

| Mode & Settings | Horizon | Expected Studied | Expected Remaining | Expected LP |
|---|---|---|---|---|
| **Desk**: Table 12×12, Buffer 4×4, Max Weight 150, Default Priorities | **3 days** | **144** | **0** | **4,549,500** |
| **Desk**: Table 12×12, Buffer 4×4, Max Weight 150, Default Priorities | **30 days** | **144** | **0** | **39,361,000** |
| **Upkeep**: Buffer 4×4, Max Weight 150, Fit to Horizon: false, Default Priorities | **3 days** | **524** | **N/A (unconstrained)** | **5,797,750** |
| **Upkeep**: Buffer 4×4, Max Weight 150, Fit to Horizon: true (20% overrun), Default Priorities | **3 days** | **487** | **N/A (unconstrained)** | **6,197,675** |

- **Horizon Scaling**: Increasing horizon from 3d to 30d should increase LP gained by ~8.7× due to higher-tier curio chains fitting within the window.
- **Uniqueness Check**: In any simulation snapshot or buffer layout, no curiosity name may appear more than once in the buffer.

### 5.4. Data Regeneration
If `tools/data/curiosities.json` is updated with new game items:
```powershell
python tools/data_from_json.py -i tools/data/curiosities.json -o data.js
```
Confirm `data.js` preserves the `const CURIOSITIES_DATA = [...]` declaration.
