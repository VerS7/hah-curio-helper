// planner.js
// Model: the table is a queue of items, the buffer is the workstation.
// Studying happens ONLY in the buffer, all buffer items study in parallel and
// independently. When an item finishes it grants LP, costs XP and disappears,
// freeing its cells and its weight. Freed room is refilled from the table.
//
// The table is limited by cells only (no weight cap).
// The buffer is limited by cells AND by a total weight cap.
// The horizon is a hard deadline: an item is never placed if it cannot finish.

const EPS = 1e-9;

// Reference quality: everything is normalised against it.
// LP multiplier = sqrt(quality / BASE_QUALITY).
const BASE_QUALITY = 10;

// ---------------------------------------------------------------- //
// Priority metrics. All of them read EFFECTIVE values, i.e. values
// after the LP / study-speed multipliers have been applied, so that the
// multipliers influence selection and not just the final total.
// ---------------------------------------------------------------- //

function hoursOf(c) { return c.studySeconds / 3600; }

const METRICS = {
  xp_cost:            c => c.xpCost,
  points:             c => c.points,
  weight:             c => c.weight,
  study_seconds:      c => c.studySeconds,
  points_per_cost:    c => (c.xpCost > 0 ? c.points / c.xpCost : Infinity),
  points_per_cell:    c => c.points / c.cells,
  lp_per_hour:        c => (hoursOf(c) > 0 ? c.points / hoursOf(c) : Infinity),
  lp_per_cell_hour:   c => (hoursOf(c) > 0 ? c.points / (hoursOf(c) * c.cells) : Infinity),
  lp_per_weight_hour: c => {
    const h = hoursOf(c);
    if (h <= 0 || c.weight <= 0) return Infinity;
    return c.points / (h * c.weight);
  },
  xp_per_hour:        c => (hoursOf(c) > 0 ? c.xpCost / hoursOf(c) : Infinity),
};

function buildComparatorKey(priorities) {
  return function key(c) {
    return priorities.map(({ metric, direction }) => {
      const fn = METRICS[metric] || METRICS.lp_per_weight_hour;
      const v = fn(c);
      return direction === "max" ? -v : v;
    });
  };
}

// No subtraction: Infinity - Infinity === NaN would make the sort order
// undefined (this used to scramble the four xpCost === 0 curios).
function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function sortByComparator(list, keyFn) {
  return list
    .map(c => ({ c, k: keyFn(c) }))
    .sort((x, y) => {
      const r = compareKeys(x.k, y.k);
      if (r !== 0) return r;
      // Name as the last tiebreaker keeps the order fully deterministic.
      return x.c.name < y.c.name ? -1 : x.c.name > y.c.name ? 1 : 0;
    })
    .map(x => x.c);
}

// ---------------------------------------------------------------- //
// Grid packing
// ---------------------------------------------------------------- //

class GridPacker {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.grid = new Array(width * height).fill(null);
  }
  idx(x, y) { return y * this.width + x; }

  findSpot(w, h) {
    if (w > this.width || h > this.height) return null;
    for (let y = 0; y <= this.height - h; y++) {
      for (let x = 0; x <= this.width - w; x++) {
        if (this._fits(x, y, w, h)) return [x, y];
      }
    }
    return null;
  }

  _fits(x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (this.grid[this.idx(xx, yy)] !== null) return false;
      }
    }
    return true;
  }

  place(slotId, x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        this.grid[this.idx(xx, yy)] = slotId;
      }
    }
  }

  // Clears only the item's own rectangle; the coordinates are known by the
  // caller, so there is no reason to scan the whole grid.
  remove(x, y, w, h) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        this.grid[this.idx(xx, yy)] = null;
      }
    }
  }

  freeCells() {
    let n = 0;
    for (const v of this.grid) if (v === null) n++;
    return n;
  }
}

class Container {
  // allowDuplicates: true for the table (a queue may hold many copies of a
  // type), false for the buffer (it may study each type only once at a time).
  constructor(width, height, maxWeight, allowDuplicates) {
    this.width = width;
    this.height = height;
    this.packer = new GridPacker(width, height);
    this.maxWeight = maxWeight;
    this.allowDuplicates = allowDuplicates;
    this.totalWeight = 0;
    this.usedCells = 0;
    this.items = new Map(); // slotId -> {curio, x, y}
    this.namesInUse = new Set();
    this._nextId = 1;
  }

  get totalCells() { return this.width * this.height; }

  fitsWeight(curio) {
    return this.totalWeight + curio.weight <= this.maxWeight + EPS;
  }

  has(name) { return this.namesInUse.has(name); }

  add(curio) {
    if (!this.allowDuplicates && this.namesInUse.has(curio.name)) return null;
    if (!this.fitsWeight(curio)) return null;
    const spot = this.packer.findSpot(curio.w, curio.h);
    if (!spot) return null;
    const [x, y] = spot;
    const slotId = this._nextId++;
    this.packer.place(slotId, x, y, curio.w, curio.h);
    this.items.set(slotId, { curio, x, y });
    this.totalWeight += curio.weight;
    this.usedCells += curio.cells;
    if (!this.allowDuplicates) this.namesInUse.add(curio.name);
    return slotId;
  }

  remove(slotId) {
    const item = this.items.get(slotId);
    if (!item) return null;
    this.items.delete(slotId);
    this.packer.remove(item.x, item.y, item.curio.w, item.curio.h);
    this.totalWeight -= item.curio.weight;
    this.usedCells -= item.curio.cells;
    if (!this.allowDuplicates) this.namesInUse.delete(item.curio.name);
    return item.curio;
  }

  snapshot() {
    return [...this.items.values()].map(it => ({
      name: it.curio.name, x: it.x, y: it.y,
      w: it.curio.w, h: it.curio.h, curio: it.curio,
    }));
  }
}

// ---------------------------------------------------------------- //
// Min-heap of finish times
// ---------------------------------------------------------------- //

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(time, slotId) {
    this.a.push([time, slotId]);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p][0] <= this.a[i][0]) break;
      [this.a[p], this.a[i]] = [this.a[i], this.a[p]];
      i = p;
    }
  }
  pop() {
    const top = this.a[0];
    const last = this.a.pop();
    if (this.a.length > 0) {
      this.a[0] = last;
      let i = 0;
      const n = this.a.length;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.a[l][0] < this.a[smallest][0]) smallest = l;
        if (r < n && this.a[r][0] < this.a[smallest][0]) smallest = r;
        if (smallest === i) break;
        [this.a[smallest], this.a[i]] = [this.a[i], this.a[smallest]];
        i = smallest;
      }
    }
    return top;
  }
  peekTime() { return this.a.length ? this.a[0][0] : Infinity; }
}

// ---------------------------------------------------------------- //
// Planner
// ---------------------------------------------------------------- //

class Planner {
  /**
   * @param {Array}  candidates - base curios the user selected
   * @param {Object} config - {tableW,tableH,bufferW,bufferH,bufferMaxWeight,
   *                           horizonSeconds,priorities,lpMultiplier,
   *                           speedMultiplier,fitToHorizon}
   */
  constructor(candidates, config) {
    this.config = config;
    this.horizon = config.horizonSeconds;

    const lpMult = config.lpMultiplier > 0 ? config.lpMultiplier : 1;
    const spMult = config.speedMultiplier > 0 ? config.speedMultiplier : 1;

    // Derived layer. CATALOG itself is never mutated; base values are kept
    // so tooltips can show "750 -> 1500 LP".
    // Quality scales LP by sqrt(Q / 10): q10 = 1x, q40 = 2x, q90 = 3x.
    // It is applied here, before sorting, so quality influences which curios
    // the planner picks and not merely the final total.
    const effective = candidates.map(c => {
      const q = Number.isFinite(c.quality) && c.quality > 0 ? c.quality : BASE_QUALITY;
      const qMult = Math.sqrt(q / BASE_QUALITY);
      const studySeconds = Math.max(c.studySeconds / spMult, EPS);
      const horizonCap = Math.max(1, Math.floor((this.horizon + EPS) / studySeconds));

      let effectiveMax = horizonCap;
      if (c.maxCopies !== undefined && c.maxCopies !== null && Number.isFinite(Number(c.maxCopies))) {
        effectiveMax = Math.max(0, Math.min(Math.floor(Number(c.maxCopies)), horizonCap));
      }
      let effectiveMin = 0;
      if (c.minCopies !== undefined && c.minCopies !== null && Number.isFinite(Number(c.minCopies))) {
        effectiveMin = Math.max(0, Math.min(Math.floor(Number(c.minCopies)), effectiveMax));
      }

      return {
        name: c.name,
        image: c.image,
        producer: c.producer,
        w: c.w,
        h: c.h,
        cells: c.w * c.h,
        weight: c.weight,
        xpCost: c.xpCost,
        quality: q,
        qualityMult: qMult,
        basePoints: c.points,
        baseStudySeconds: c.studySeconds,
        points: c.points * lpMult * qMult,
        studySeconds,
        minCopies: effectiveMin,
        maxCopies: effectiveMax,
        effectiveMin,
        effectiveMax,
      };
    });

    // Speed multiplier also widens what fits inside the horizon. Curios with effectiveMax === 0 are excluded.
    this.pool = effective.filter(c => c.studySeconds <= this.horizon + EPS && c.effectiveMax > 0);
    this.excludedByHorizon = effective.length - this.pool.length;

    this.keyFn = buildComparatorKey(config.priorities);
    // Sorted exactly once, not per event.
    this.sortedPool = sortByComparator(this.pool, this.keyFn);
    this.byName = new Map(this.sortedPool.map(c => [c.name, c]));
    this.rankByName = new Map(this.sortedPool.map((c, i) => [c.name, i]));

    this.result = null;
  }

  // -------------------------------------------------------------- //
  // Table: greedy fill by priority, duplicates allowed, no weight cap.
  // -------------------------------------------------------------- //

  // A type can only be studied one copy at a time, so copies of the same type
  // are processed strictly serially. Queueing more copies than fit end-to-end
  // inside the horizon just wastes table cells, so cap each type accordingly.
  maxUsefulCopies(c) {
    return c.effectiveMax;
  }

  buildTable(cellBudget) {
    const { tableW, tableH } = this.config;
    const table = new Container(tableW, tableH, Infinity, true);
    const limit = Math.min(cellBudget, tableW * tableH);
    const counts = new Map();

    // Phase 1: Mandatory minimum counts
    for (const c of this.sortedPool) {
      if (table.usedCells >= limit) break;
      const targetMin = c.effectiveMin;
      let placed = counts.get(c.name) || 0;
      while (placed < targetMin) {
        if (table.usedCells + c.cells > limit) break;
        if (table.add(c) === null) break;
        placed++;
        counts.set(c.name, placed);
      }
    }

    // Phase 2: Greedy fill up to effectiveMax in priority order
    for (const c of this.sortedPool) {
      if (table.usedCells >= limit) break;
      const cap = c.effectiveMax;
      let placed = counts.get(c.name) || 0;
      while (placed < cap) {
        if (table.usedCells + c.cells > limit) break;
        if (table.add(c) === null) break;
        placed++;
        counts.set(c.name, placed);
      }
    }
    return { table, counts, cellsUsed: table.usedCells };
  }

  // -------------------------------------------------------------- //
  // Event-driven simulation over one table content
  // -------------------------------------------------------------- //

  simulateWith(counts, maxEvents = 200000) {
    const cfg = this.config;
    const horizon = this.horizon;
    const buffer = new Container(cfg.bufferW, cfg.bufferH, cfg.bufferMaxWeight, false);
    const heap = new MinHeap();
    const remaining = new Map(counts);
    const sorted = this.sortedPool;

    let cursor = 0;           // everything before it is exhausted
    let lpGained = 0, xpSpent = 0, studiedCount = 0;
    const studiedCounts = new Map();
    let makespan = 0, peakWeight = 0, peakCells = 0;
    let eventsCapped = false;
    let initialSnapshot = null;

    const tryPlace = (c, now) => {
      if (!c) return false;
      if ((remaining.get(c.name) || 0) <= 0) return false;
      // The buffer studies each type only once at a time.
      if (buffer.has(c.name)) return false;
      // Rule 7: never occupy a slot with something that cannot finish in time.
      if (c.studySeconds > horizon - now + EPS) return false;
      if (!buffer.fitsWeight(c)) return false;
      const slot = buffer.add(c);
      if (slot === null) return false;
      remaining.set(c.name, remaining.get(c.name) - 1);
      heap.push(now + c.studySeconds, slot);
      return true;
    };

    const isUnderMinQuota = (c) => {
      if (!c || c.effectiveMin <= 0) return false;
      const studied = studiedCounts.get(c.name) || 0;
      const inBuffer = buffer.has(c.name) ? 1 : 0;
      return (studied + inBuffer) < c.effectiveMin;
    };

    // Refill rule:
    // 1. Mandatory minimums: any item that hasn't met effectiveMin yet
    // 2. Same type first (it just left the buffer, so its slot is free again)
    // 3. Best available type by priority that is not already being studied
    const refill = (now, preferName) => {
      for (;;) {
        let placed = false;

        for (let i = 0; i < sorted.length; i++) {
          const c = sorted[i];
          if ((remaining.get(c.name) || 0) <= 0) continue;
          if (buffer.has(c.name)) continue;
          if (isUnderMinQuota(c)) {
            if (tryPlace(c, now)) {
              placed = true;
              break;
            }
          }
        }
        if (placed) continue;

        if (preferName && tryPlace(this.byName.get(preferName), now)) continue;
        while (cursor < sorted.length && (remaining.get(sorted[cursor].name) || 0) <= 0) cursor++;
        for (let i = cursor; i < sorted.length; i++) {
          const c = sorted[i];
          if ((remaining.get(c.name) || 0) <= 0) continue;
          if (buffer.has(c.name)) continue;
          if (tryPlace(c, now)) { placed = true; break; }
        }
        if (!placed) break;
      }
      if (buffer.totalWeight > peakWeight) peakWeight = buffer.totalWeight;
      if (buffer.usedCells > peakCells) peakCells = buffer.usedCells;
    };

    refill(0, null);
    initialSnapshot = buffer.snapshot();

    let events = 0;
    while (heap.size > 0) {
      if (events >= maxEvents) { eventsCapped = true; break; }
      const [finish, slotId] = heap.pop();
      if (finish > horizon + EPS) break; // cannot happen given rule 7, kept as a guard
      events++;

      const done = buffer.remove(slotId);
      if (!done) continue;
      lpGained += done.points;
      xpSpent += done.xpCost;
      studiedCount++;
      studiedCounts.set(done.name, (studiedCounts.get(done.name) || 0) + 1);
      if (finish > makespan) makespan = finish;

      refill(finish, done.name);
    }

    let tableRemaining = 0;
    for (const n of remaining.values()) tableRemaining += n;
    const bufferUnfinished = buffer.items.size;

    return {
      lpGained, xpSpent, studiedCount,
      studiedCounts,
      tableRemaining,
      bufferUnfinished,
      tableDrained: tableRemaining === 0 && bufferUnfinished === 0,
      makespan,
      bufferPeakWeight: peakWeight,
      bufferPeakCells: peakCells,
      bufferTotalCells: buffer.totalCells,
      eventsCapped,
      initialSnapshot,
    };
  }

  // -------------------------------------------------------------- //
  // Run simulation: Desk mode or Upkeep mode
  // -------------------------------------------------------------- //

  run() {
    const mode = this.config.mode || "desk";

    if (mode === "upkeep") {
      const upkeepCounts = new Map();
      for (const c of this.sortedPool) {
        upkeepCounts.set(c.name, c.effectiveMax);
      }
      const stats = this.simulateWith(upkeepCounts);
      this.result = { mode: "upkeep", stats };
      return this.report();
    }

    const totalCells = this.config.tableW * this.config.tableH;
    let budget = totalCells;
    let fit = { enabled: false, cellBudget: totalCells, probes: 0 };

    if (this.config.fitToHorizon && this.sortedPool.length > 0) {
      let lo = 0, hi = totalCells, probes = 0;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const built = this.buildTable(mid);
        const st = this.simulateWith(built.counts);
        probes++;
        if (st.tableDrained && st.makespan <= this.horizon + EPS) lo = mid;
        else hi = mid - 1;
      }
      budget = lo;
      fit = { enabled: true, cellBudget: budget, probes };
    }

    const built = this.buildTable(budget);
    const stats = this.simulateWith(built.counts);

    this.result = { mode: "desk", built, stats, fit, totalCells };
    return this.report();
  }

  report() {
    const cfg = this.config;
    const mode = this.result.mode || "desk";

    if (mode === "upkeep") {
      const { stats } = this.result;
      const groups = [...(stats.studiedCounts?.entries() || [])]
        .map(([name, count]) => {
          const curio = this.byName.get(name);
          return {
            name,
            count,
            curio,
            totalPoints: count * (curio?.points || 0),
            totalXp: count * (curio?.xpCost || 0),
          };
        })
        .sort((a, b) => (this.rankByName.get(a.name) - this.rankByName.get(b.name)));

      return {
        mode: "upkeep",
        upkeep: {
          groups,
          totalItems: stats.studiedCount,
          distinctTypes: groups.length,
        },
        buffer: {
          placed: stats.initialSnapshot || [],
          maxWeight: cfg.bufferMaxWeight,
          totalCells: cfg.bufferW * cfg.bufferH,
        },
        stats: {
          lpGained: stats.lpGained,
          xpSpent: stats.xpSpent,
          studiedCount: stats.studiedCount,
          makespan: stats.makespan,
          bufferPeakWeight: stats.bufferPeakWeight,
          bufferPeakCells: stats.bufferPeakCells,
          eventsCapped: stats.eventsCapped,
          excludedByHorizon: this.excludedByHorizon,
          poolSize: this.pool.length,
          distinctTypes: groups.length,
        },
      };
    }

    const { built, stats, fit, totalCells } = this.result;

    // Table is a multiset: group by type for rendering, keep priority order.
    const groups = [...built.counts.entries()]
      .map(([name, count]) => ({ name, count, curio: this.byName.get(name) }))
      .sort((a, b) => (this.rankByName.get(a.name) - this.rankByName.get(b.name)));

    return {
      mode: "desk",
      table: {
        groups,
        cellsUsed: built.cellsUsed,
        totalCells,
        itemCount: [...built.counts.values()].reduce((a, b) => a + b, 0),
      },
      buffer: {
        placed: stats.initialSnapshot || [],
        maxWeight: cfg.bufferMaxWeight,
        totalCells: cfg.bufferW * cfg.bufferH,
      },
      fit,
      stats: {
        lpGained: stats.lpGained,
        xpSpent: stats.xpSpent,
        studiedCount: stats.studiedCount,
        tableRemaining: stats.tableRemaining,
        bufferUnfinished: stats.bufferUnfinished,
        tableDrained: stats.tableDrained,
        makespan: stats.makespan,
        bufferPeakWeight: stats.bufferPeakWeight,
        bufferPeakCells: stats.bufferPeakCells,
        eventsCapped: stats.eventsCapped,
        excludedByHorizon: this.excludedByHorizon,
        poolSize: this.pool.length,
        distinctTypes: groups.length,
      },
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { Planner, METRICS, GridPacker, Container, MinHeap, sortByComparator, buildComparatorKey, BASE_QUALITY };
}
