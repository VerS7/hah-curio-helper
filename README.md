# Curiosity Planner — Haven & Hearth

## Running

Open `index.html` in a browser (double click). No server is needed: all
840 curios are embedded in `data.js` and load locally.

## Curio images

Images are pulled directly from ringofbrodgar.com via `Special:FilePath`,
so they need an internet connection. Missing images fall back to a `?`
placeholder and the app keeps working offline.

## Model

| Entity | Role | Limits |
|---|---|---|
| **Study Desk** | queue of items waiting to be studied | cells only (`N×N`, 5–12), **no weight cap** |
| **Study Report** | workstation where studying happens | fixed **4 × 4** cells **and Attention cap** |
| **Horizon** | deadline | the queue must be processed within N days |

Rules:

1. Studying happens **only in the Study Report**. The Study Desk studies nothing.
2. All Study Report items study **in parallel and independently**. An item with
   `studySeconds = t` finishes `t` after it enters the Study Report, regardless
   of its neighbours.
3. On completion it grants LP, costs XP and **disappears**, freeing its
   cells and its Attention.
4. **Refill:** the freed room is filled with the **same type** from the
   Study Desk first; otherwise the best remaining item by priority.
5. Duplicates are allowed on the Study Desk, but the Study Report permits only **unique types** simultaneously (all sizes and cuts of the same gem family count as the same type).
6. The goal is **maximum LP**. Attention is a ceiling, not a target.
7. An item whose study time exceeds the remaining horizon is never placed.

### Attention is the main control

With an Attention cap of 150 and `Gold Egg` weighing 50, only **3 items** fit at a
time and 13 of 16 Study Report cells sit idle. The statistics panel says
explicitly which constraint binds.

| Weight cap | Studied in 3d | LP |
|---|---|---|
| 50 | 9 | 3,600,000 |
| 150 | 27 | 10,800,000 |
| 300 | 54 | 21,600,000 |
| 600 | 108 | 43,200,000 |
| 1500 | 144 | 57,600,000 |

### Horizon (desk 12×12, Study Report 4×4, Attention 150)

| Horizon | Studied | Left on desk | LP |
|---|---|---|---|
| 1d | 9 | 135 | 3,600,000 |
| 3d | 27 | 117 | 10,800,000 |
| 7d | 69 | 75 | 27,600,000 |
| 14d | 138 | 6 | 55,200,000 |
| 30d | 144 | 0 | 57,600,000 |

## Settings

- Study Desk size, one slider, `N × N` from 5 to 12. The Study Report is fixed at
  4 × 4 as in the game and is not configurable.
- **Attention** — the dominant study parameter (mental weight capacity).
- Planning horizon, in days.
- **Fit to horizon** — sizes the queue by binary search so it drains
  completely inside the horizon instead of blindly filling every cell.
- **LP multiplier** and **study speed multiplier** (0.1–10). Both affect
  *selection*, not just the final total, so the planner picks the items
  that are actually best under your multipliers. Speed also widens what
  fits inside the horizon.
- Cell size, in pixels.
- Two priority levels. Metrics: XP cost, LP, weight, study time, LP per
  XP, LP per cell, LP per hour, LP per cell-hour, **LP per weight-hour**
  (default), XP per hour. Since the buffer is weight-bound, LP per
  weight-hour is the right greedy objective.
- **Curiosity Panel & Tabs**:
  - **All tab**: Browse all 840 curiosities or filter with search.
  - **Selected tab**: Focus only on the curiosities currently selected for study.
  - Gem families grouped into collapsible categories with tri-state checkboxes and size/cut quick chips.
- **Min and Max Quantity Limits**:
  - **Min (Minimum copies)**: Sets a mandatory quota of copies to study. The planner guarantees and prioritizes studying these items in both Study Desk queue packing and Upkeep rotation.
  - **Max (Maximum copies)**: Sets a strict ceiling on how many copies of that curio can be studied / queued. Leave blank (or `∞`) to allow natural horizon limits. Set to `0` to exclude the curio.
  - Gem family headers feature bulk Min, Max, and Quality inputs to configure all 36 variants at once (displays `mixed` when variant values differ).
- **Per-curio quality** (default 10). LP scales as `sqrt(Q / 10)`, so
  q10 = 1x, q40 = 2x, q90 = 3x, q160 = 4x. Each gem family header also has
  one input that sets the quality of all 36 variants at once (it shows
  `mixed` when the variants differ). Like the other multipliers, quality
  is applied *before* sorting, so it changes which curios the planner
  picks, not just the reported total.

Everything recalculates in real time; there is no Apply button.
State is saved to `localStorage` and restored on reload; **Reset to
defaults** clears it.

## Statistics

`LP gained`, `LP per day`, `XP spent`, `Studies completed`, `Study Desk queue`,
`Study Desk drained`, `Attention peak`, `Study Report cells peak`, `Makespan`,
`Unfinished at deadline`, plus warnings telling you whether the setup is
Attention-bound or cell-bound.

## Files

`index.html`, `style.css`, `planner.js` (algorithm), `app.js`
(interface), `data.js` (curio data).
