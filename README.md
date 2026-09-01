# Curiosity Planner for Haven & Hearth

Curiosity Planner is a zero-dependency, client-side web application designed to compute optimal curiosity study schedules and desk loadouts for the MMORPG **Haven & Hearth**. It maximizes Learning Points (LP) gain within a configurable planning horizon, fully respecting in-game Attention (Mental Weight), grid capacity, and study exclusivity rules.

---

## Table of Contents

- [Overview](#overview)
- [Quick Start](#quick-start)
- [Core Mechanics and Domain Rules](#core-mechanics-and-domain-rules)
  - [Workstation vs. Storage Queue](#workstation-vs-storage-queue)
  - [Exclusivity and Gemstone Families](#exclusivity-and-gemstone-families)
  - [Refill Event Loop](#refill-event-loop)
- [Operational Modes](#operational-modes)
  - [Study Desk Mode](#1-study-desk-mode)
  - [Upkeep Mode](#2-upkeep-mode)
- [Features and Configuration](#features-and-configuration)
  - [Simulation Controls](#simulation-controls)
  - [Optimization Priorities](#optimization-priorities)
  - [Curiosity Catalog, Search, and Tabs](#curiosity-catalog-search-and-tabs)
  - [Fine-Grained Constraints: Min, Max, and Quality](#fine-grained-constraints-min-max-and-quality)
  - [Gemstone Bulk Management](#gemstone-bulk-management)
  - [Configuration Import and Export](#configuration-import-and-export)
- [Statistics and Bottleneck Diagnostics](#statistics-and-bottleneck-diagnostics)
- [Mathematical Formulas](#mathematical-formulas)
- [Project Architecture and Files](#project-architecture-and-files)
- [Development and Testing](#development-and-testing)
  - [Headless Simulation Verification](#headless-simulation-verification)
  - [Benchmark Baselines](#benchmark-baselines)
  - [Catalog Data Regeneration](#catalog-data-regeneration)
- [Disclaimer](#disclaimer)

---

## Overview

In Haven & Hearth, character progression relies heavily on studying curiosities. Choosing the optimal set of curiosities is complex due to competing constraints:
- **Attention (Mental Weight)**: Characters have a finite Attention pool.
- **Study Report Dimensions**: The study inventory is strictly $4 \times 4$ cells (16 cells total).
- **Study Duration and Deadlines**: Long-duration curiosities yield higher LP per item, but short-duration curiosities offer higher LP per weight-hour.
- **Unique Study Slot Rules**: A character cannot study duplicate items of the same type simultaneously, nor multiple cuts/sizes from the same gemstone family.

Curiosity Planner models these mechanics with a high-performance discrete-event simulation engine that evaluates effective rates, prioritizes items, simulates queue refills, and diagnoses bottlenecks in real time.

---

## Quick Start

### Running in Browser
No build steps, package managers, or server installations are required.

1. Clone or download the repository.
2. Open `index.html` directly in any modern web browser (double-click the file).

### Running via Local HTTP Server (Optional)
```powershell
python -m http.server 8000
```
Then open `http://localhost:8000` in your browser.

> Note on Images: Curio icons are fetched from `ringofbrodgar.com` when online. If offline or if an image fails to load, the application seamlessly falls back to inline SVG placeholders without interrupting functionality.

---

## Core Mechanics and Domain Rules

### Workstation vs. Storage Queue

| Container | Role | Size | Capacity Limits |
|---|---|---|---|
| **Study Report** | Active workstation where study progression occurs | Fixed $4 \times 4$ cells (16 cells) | Limited by **both** grid cells and **Attention (Mental Weight)** cap |
| **Study Desk** | External container queue holding curiosities waiting to be studied | Configurable $N \times N$ ($5 \times 5$ to $12 \times 12$) | Limited **only** by grid cells (**no weight limit**) |

1. **Studying occurs exclusively in the Study Report**: Items sitting on the Study Desk do not accumulate study time.
2. **Independent Parallel Progress**: All items placed in the Study Report progress concurrently. An item with duration $t$ finishes exactly $t$ seconds after being placed, independent of other active curios.
3. **Resource Freeing**: Upon completion, a curio awards its LP, expends character Experience Points (XP), and vacates its grid cells and Attention allocation immediately.

### Exclusivity and Gemstone Families

- **No Duplicates in Study Report**: Only one copy of any given curiosity type (e.g. `Gold Egg` or `Cone Cow`) may reside in the Study Report at any instant. Duplicates are permitted on the Study Desk queue.
- **Gemstone Family Exclusivity**: 540 cut gemstones exist in the catalog across 15 families (such as Jade, Ruby, Sapphire, Sugar Diamond, Diamond). All 36 variants (6 sizes $\times$ 6 cuts) of a family share a single study slot. Two gems from the same family (e.g. `Tiny Rough Jade` and `Grand Brilliant Jade`) cannot be studied at the same time. Gems from different families (e.g. Jade and Ruby) can be studied concurrently.

### Refill Event Loop

Whenever an item completes in the Study Report, the simulation refills the vacated room using the following order:
1. **Unmet Minimum Quotas**: Evaluates candidate curiosities that have not yet fulfilled their mandatory `Min` quota.
2. **Same-Type Immediate Refill**: Attempts to take another copy of the completed curiosity type from the queue or supply, as its geometry and weight are guaranteed to fit.
3. **Greedy Priority Fallback**: Scans remaining candidates in priority order for the highest-ranked curio that:
   - Fits within available Study Report grid dimensions.
   - Fits within remaining Attention budget.
   - Is not already active in the Study Report (uniqueness constraint).
   - Can finish before the horizon deadline ($t_{\text{current}} + c.\text{studySeconds} \le \text{horizon}$).
4. **Greedy Filling Loop**: Repeats until no further curiosities can fit.

---

## Operational Modes

Curiosity Planner supports two dedicated workflows:

```text
+--------------------------------------------------------------------------------+
|                                OPERATIONAL MODES                               |
+---------------------------------------+----------------------------------------+
|           STUDY DESK MODE             |              UPKEEP MODE               |
|  - Physical desk container (N x N)    |  - Continuous study from storage chests|
|  - Finite queue drains over time      |  - Unconstrained external supply       |
|  - "Fit to horizon" binary search     |  - Total consumption requirements      |
|  - Output: Multiset desk layout &     |  - Output: Total curiosities needed,   |
|    drain statistics                   |    total LP & XP across horizon        |
+---------------------------------------+----------------------------------------+
```

### 1. Study Desk Mode
Designed for players loading a physical Study Desk container in-game before logging off or going AFK.
- **Queue Packing**: Curiosities are allocated into the desk grid according to user priorities and quantity constraints.
- **Fit to Horizon (Binary Search)**: When enabled, the engine performs a binary search over desk cell budgets to find the largest queue that drains completely within the planning horizon, avoiding leftover unstudied items.
- **Primary View**: Displays the desk multiset loadout grouped by curiosity with quantity badges (`xN`), along with desk drain status.

### 2. Upkeep Mode
Designed for active players who continuously replenish their Study Report from large storage chests.
- **Continuous Rotation**: Bypasses desk container limits and assumes an unconstrained curiosity supply.
- **Primary View**: Displays total curiosity production and consumption quotas required across the entire horizon (e.g. `x12 Cone Cow`, `x4 Dandelion`, total LP and XP per item).

---

## Features and Configuration

### Simulation Controls

- **Operational Mode**: Toggle between `Study Desk` and `Upkeep`.
- **Study Desk Size**: Configurable from $5 \times 5$ (25 cells) up to $12 \times 12$ (144 cells).
- **Attention (Mental Weight)**: Slider ranging from 10 to 1,500 Attention.
- **Planning Horizon**: Duration from 0.5 days (12 hours) to 30 days.
- **Fit to Horizon**: Automatically sizes the Study Desk queue to drain completely before the deadline.
- **LP Multiplier & Study Speed Multiplier**: Global scaling factors (0.1x to 10.0x) applied in the derived layer *before sorting*, ensuring optimal item selection under custom realm bonuses, credos, or gear.
- **Cell Size**: Adjusts visual tile rendering size (20px to 48px).

### Optimization Priorities

Two-tier customizable priority comparator (Priority 1 + tie-breaking Priority 2) with `min` or `max` directions. Available metrics:

- `LP per weight-hour` (Default — mathematically optimal for Attention-bound setups)
- `Learning points (LP)`
- `LP per hour`
- `LP per cell`
- `LP per cell-hour`
- `LP per XP`
- `XP cost`
- `XP per hour`
- `Study time`
- `Weight`

> Deterministic Sorting: Zero-XP curiosities (`A Talking Whale`, `Driftwood Crown`, `Bloated Bolete`, `Ant Soldiers`) evaluate $\frac{\text{LP}}{\text{XP}} = \infty$. The comparator avoids arithmetic subtraction (`Infinity - Infinity === NaN`) and uses direct relational comparisons with curio name tiebreakers to ensure deterministic ordering.

### Curiosity Catalog, Search, and Tabs

- **Dual Tabs**:
  - **All**: Browse all 840 curiosities embedded in the database.
  - **Selected**: Filter down exclusively to active, chosen curiosities.
- **Real-Time Search**: Instant filtering by item name or gemstone family.
- **Bulk Action Buttons**: Select/Deselect Visible, Select All, Clear All.
- **Horizon Indicator**: Items whose base or speed-adjusted study duration exceeds the horizon are visually flagged and excluded from placement.

### Fine-Grained Constraints: Min, Max, and Quality

Each curiosity row provides dedicated numerical inputs:

- **Min (Minimum copies)**: Enforces a mandatory quota. Candidates with unmet quotas receive strict priority during queue allocation and Study Report refills.
- **Max (Maximum copies)**: Sets a strict ceiling on studied copies (set to `0` to exclude; leave blank or `inf` for natural horizon limits).
- **Q (Quality)**: Custom quality value (default `10`). Scales LP proportionally according to the square-root formula.

### Gemstone Bulk Management

All 540 gemstones are categorized into 15 collapsible family sections:
- **Tri-State Master Checkbox**: Select or deselect all 36 variants in one click.
- **Quick Filter Chips**: Toggle variants by Size (`Tiny`, `Small`, `Fair`, `Large`, `Grand`, `Jotun`) or Cut (`Rough`, `Smooth`, `Cabochon`, `Pear`, `Heart`, `Brilliant`).
- **Bulk Min, Max, and Quality Inputs**: Header controls apply values to all 36 family variants simultaneously (displays `mixed` when variants have differing values).

### Configuration Import and Export

Save and share complete setups (selected curios, custom qualities, min/max limits, priorities, and environment settings):
- **Export File**: Downloads configuration as a formatted `.json` file.
- **Copy JSON**: Copies JSON configuration payload directly to clipboard.
- **Import File**: Uploads and restores configuration from a `.json` file.
- **Paste & Apply**: Reads JSON configuration from clipboard and updates UI and simulation state.
- **Automatic Persistence**: All state changes are automatically debounced (400ms) and saved to browser `localStorage` (`hah-curio-planner:v1`).

---

## Statistics and Bottleneck Diagnostics

The statistics panel provides an instant, comprehensive summary of the simulation results:

- **LP gained**: Total Learning Points accumulated within the horizon.
- **LP per day / LP per hour**: Average progression rates over the horizon duration.
- **XP spent**: Total Experience Points consumed upon curiosity completion.
- **Studies completed**: Total curiosity items finished.
- **Study Desk queue & drained status**: Progress of queue processing and whether items remained unstudied at the deadline.
- **Attention peak**: Maximum concurrent mental weight utilized in the Study Report.
- **Study Report cells peak**: Maximum grid cells occupied (out of 16).
- **Makespan**: Time required to finish the final active study item.

### Diagnostic Engine
The planner analyzes peak usage to diagnose system bottlenecks:
- **Attention-Bound**: Peak weight reaches Attention cap while grid cells remain under 16. (Solution: Increase Intelligence/Attention or select lighter curiosities).
- **Cell-Bound**: Study Report reaches 16/16 cells while Attention is not exhausted. (Solution: Select heavier, higher-yield curiosities).
- **Type-Bound**: Attention and cells have spare capacity, but parallel throughput is throttled because the candidate pool lacks distinct curio types. (Solution: Select more curio varieties).

---

## Mathematical Formulas

### 1. Quality Scaling
In Haven & Hearth, curiosity quality scales Learning Points using a square-root relationship against base quality ($Q_0 = 10$):

$$\text{LP}_{\text{effective}} = \text{LP}_{\text{base}} \times \sqrt{\frac{Q}{10}}$$

*Note: Mental weight and study duration are intrinsic properties and remain unchanged by quality.*

### 2. Multiplier Pipeline
Global multipliers and quality scaling are applied in the derived layer prior to sorting:

$$\text{points} = \text{basePoints} \times \text{lpMultiplier} \times \sqrt{\frac{Q}{10}}$$

$$\text{studySeconds} = \frac{\text{baseStudySeconds}}{\text{speedMultiplier}}$$

### 3. Natural Horizon Capacity
Because identical curio types cannot study in parallel, the maximum useful copies of curio $c$ within horizon $H$ is capped by serial execution:

$$\text{horizonCap}(c) = \max\left(1, \left\lfloor \frac{H}{c.\text{studySeconds}} \right\rfloor\right)$$

$$\text{effectiveMax}(c) = \min\left(c.\text{userMax} \mathbin{??} \text{horizonCap}(c),\, \text{horizonCap}(c)\right)$$

$$\text{effectiveMin}(c) = \min\left(c.\text{userMin} \mathbin{??} 0,\, \text{effectiveMax}(c)\right)$$

---

## Project Architecture and Files

```text
hah-curio-helper/
├── index.html            # Semantic HTML5 layout (3-column responsive desktop/mobile UI)
├── style.css             # Dark theme styling, CSS Grid/Flexbox layouts, CSS variables
├── planner.js            # Core simulation engine (GridPacker, Container, MinHeap, Planner)
├── app.js                # State management, localStorage persistence, DOM renderer
├── data.js               # Embedded catalog containing all 840 curiosities
├── AGENTS.md             # Operational architecture and domain manual for AI agents
├── README.md             # End-user and technical documentation
└── tools/
    ├── data_from_json.py # Python utility to compile raw JSON into data.js
    └── data/
        └── curiosities.json # Raw scraped curiosity dataset
```

---

## Development and Testing

### Headless Simulation Verification
Because `planner.js` conditionally exports modules via CommonJS when running in Node.js, the simulation engine can be verified headlessly:

#### Study Desk Mode (3 Days Horizon Baseline)
```powershell
node -e "const vm = require('vm'); const fs = require('fs'); vm.runInThisContext(fs.readFileSync('./data.js', 'utf8')); const { Planner } = require('./planner.js'); const p = new Planner(CURIOSITIES_DATA, { mode: 'desk', tableW: 12, tableH: 12, bufferW: 4, bufferH: 4, bufferMaxWeight: 150, horizonSeconds: 3 * 86400, priorities: [{ metric: 'lp_per_weight_hour', direction: 'max' }], lpMultiplier: 1, speedMultiplier: 1, fitToHorizon: false }); console.log(p.run().stats);"
```

#### Upkeep Mode (3 Days Horizon Baseline)
```powershell
node -e "const vm = require('vm'); const fs = require('fs'); vm.runInThisContext(fs.readFileSync('./data.js', 'utf8')); const { Planner } = require('./planner.js'); const p = new Planner(CURIOSITIES_DATA, { mode: 'upkeep', tableW: 12, tableH: 12, bufferW: 4, bufferH: 4, bufferMaxWeight: 150, horizonSeconds: 3 * 86400, priorities: [{ metric: 'lp_per_weight_hour', direction: 'max' }], lpMultiplier: 1, speedMultiplier: 1, fitToHorizon: false }); console.log(p.run().stats);"
```

#### Min and Max Constraints Verification
```powershell
node -e "const vm = require('vm'); const fs = require('fs'); vm.runInThisContext(fs.readFileSync('./data.js', 'utf8')); const { Planner } = require('./planner.js'); const data = CURIOSITIES_DATA.map(c => c.name === 'Cone Cow' ? { ...c, minCopies: 5, maxCopies: 5 } : c); const p = new Planner(data, { mode: 'desk', tableW: 12, tableH: 12, bufferW: 4, bufferH: 4, bufferMaxWeight: 150, horizonSeconds: 3 * 86400, priorities: [{ metric: 'lp_per_weight_hour', direction: 'max' }], lpMultiplier: 1, speedMultiplier: 1, fitToHorizon: false }); console.log('Cone Cow desk allocation:', p.run().table.groups.find(g => g.name === 'Cone Cow'));"
```

### Benchmark Baselines

Standard benchmark results for regression testing:

| Mode & Settings | Horizon | Expected Studied | Expected Remaining | Expected LP |
|---|---|---|---|---|
| **Desk**: Table 12x12, Buffer 4x4, Attention 150, Default Priorities | **3 days** | **144** | **0** | **4,549,500** |
| **Desk**: Table 12x12, Buffer 4x4, Attention 150, Default Priorities | **30 days** | **144** | **0** | **39,361,000** |
| **Upkeep**: Buffer 4x4, Attention 150, Default Priorities | **3 days** | **524** | **N/A (unconstrained)** | **5,797,750** |

### Catalog Data Regeneration
If `tools/data/curiosities.json` is updated with newly discovered curiosities or rebalanced game stats:

```powershell
python tools/data_from_json.py -i tools/data/curiosities.json -o data.js
```

---

## Disclaimer

Curiosity Planner is a community-developed tool and is not affiliated with, endorsed by, or connected to **Seatribe**, **Haven & Hearth**, **Jorb & Loftar**, or **Ring of Brodgar**. All curiosity data and artwork belong to their respective creators.
