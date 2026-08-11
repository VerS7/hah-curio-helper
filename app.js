// app.js
// Wires the data (data.js), the algorithm (planner.js) and the interface.

// ---------------------------------------------------------------- //
// Catalog
// ---------------------------------------------------------------- //

const CATALOG = CURIOSITIES_DATA.map(d => ({
  name: d.name,
  points: d.points || 0,
  weight: d.weight || 0,
  xpCost: d.xpCost || 0,
  studySeconds: d.studySeconds || 0,
  w: Math.max(1, d.w || 1),
  h: Math.max(1, d.h || 1),
  image: d.image || "",
  producer: d.producer || "",
  skills: d.skills || [],
}));

const CATALOG_BY_NAME = new Map(CATALOG.map(c => [c.name, c]));

const PLACEHOLDER_IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
       <rect width="32" height="32" fill="#1e1a16"/>
       <text x="16" y="21" font-size="16" fill="#5a5142" text-anchor="middle" font-family="sans-serif">?</text>
     </svg>`
  );

function getImageUrl(rawUrl) {
  if (!rawUrl) return PLACEHOLDER_IMG;
  const marker = "File:";
  const idx = rawUrl.indexOf(marker);
  let filename = idx >= 0 ? rawUrl.slice(idx + marker.length) : rawUrl.split("/").pop();
  try { filename = decodeURIComponent(filename); } catch (e) { /* ignore */ }
  return "https://ringofbrodgar.com/wiki/Special:FilePath/" + encodeURIComponent(filename);
}

function attachImg(parent, src, alt) {
  const img = document.createElement("img");
  img.loading = "lazy";
  img.src = src;
  img.alt = alt;
  img.onerror = function () { this.onerror = null; this.src = PLACEHOLDER_IMG; };
  parent.appendChild(img);
  return img;
}

function fmtNum(n) {
  return Math.round(n * 10) / 10;
}
function fmtInt(n) {
  return Math.round(n).toLocaleString("en-US");
}
function fmtDuration(seconds) {
  const h = seconds / 3600;
  if (h < 1) return `${Math.round(seconds / 60)} min`;
  if (h < 48) return `${fmtNum(h)} h`;
  return `${fmtNum(h / 24)} d`;
}

// ---------------------------------------------------------------- //
// Gem grouping: 540 of 840 curios are "<Size> <Cut> <Family>".
// The family is the WHOLE remainder, so "Sugar Diamond" and "Diamond"
// stay separate families.
// ---------------------------------------------------------------- //

const GEM_SIZES = ["Tiny", "Small", "Fair", "Large", "Grand", "Jotun"];
const GEM_CUTS = ["Rough", "Smooth", "Cabochon", "Pear", "Heart", "Brilliant"];

function parseGem(name) {
  const p = name.split(" ");
  if (p.length < 3) return null;
  if (!GEM_SIZES.includes(p[0]) || !GEM_CUTS.includes(p[1])) return null;
  return { size: p[0], cut: p[1], family: p.slice(2).join(" ") };
}

const GEM_FAMILIES = new Map(); // family -> [{curio,size,cut}]
const PLAIN_CURIOS = [];
for (const c of CATALOG) {
  const g = parseGem(c.name);
  if (g) {
    if (!GEM_FAMILIES.has(g.family)) GEM_FAMILIES.set(g.family, []);
    GEM_FAMILIES.get(g.family).push({ curio: c, size: g.size, cut: g.cut });
  } else {
    PLAIN_CURIOS.push(c);
  }
}
const GEM_FAMILY_NAMES = [...GEM_FAMILIES.keys()].sort();

// ---------------------------------------------------------------- //
// Defaults & persisted state
// ---------------------------------------------------------------- //

const STORAGE_KEY = "hah-curio-planner:v1";
const STORAGE_VERSION = 1;

// The buffer is 4 × 4 in the game and cannot be changed.
const BUFFER_W = 4;
const BUFFER_H = 4;

const DEFAULT_CONFIG = {
  mode: "desk",
  tableSize: 12,
  bufferWeight: 150,
  horizonDays: 3,
  cellSize: 30,
  lpMult: 1,
  speedMult: 1,
  fitToHorizon: true,
  p1metric: "lp_per_weight_hour", p1dir: "max",
  p2metric: "points", p2dir: "max",
};

let currentMode = "desk";

const selected = new Set(CATALOG.map(c => c.name));
const collapsedGroups = new Set(GEM_FAMILY_NAMES); // gem groups start collapsed
let searchTerm = "";

const DEFAULT_QUALITY = 10;
const quality = new Map(); // name -> quality
const minQuantities = new Map(); // name -> min
const maxQuantities = new Map(); // name -> max
let currentCurioTab = "all"; // "all" | "selected"

function getQuality(name) {
  const q = quality.get(name);
  return q === undefined ? DEFAULT_QUALITY : q;
}
function setQuality(name, q) {
  if (!Number.isFinite(q) || q <= 0) q = DEFAULT_QUALITY;
  if (q === DEFAULT_QUALITY) quality.delete(name); else quality.set(name, q);
}
function qualityMult(q) {
  return Math.sqrt(q / DEFAULT_QUALITY);
}

function getMinQty(name) {
  const v = minQuantities.get(name);
  return v === undefined ? 0 : v;
}
function setMinQty(name, val) {
  const v = parseInt(val, 10);
  if (Number.isFinite(v) && v > 0) {
    minQuantities.set(name, v);
  } else {
    minQuantities.delete(name);
  }
}

function getMaxQty(name) {
  const v = maxQuantities.get(name);
  return v === undefined ? null : v;
}
function setMaxQty(name, val) {
  if (val === "" || val === null || val === undefined) {
    maxQuantities.delete(name);
    return;
  }
  const v = parseInt(val, 10);
  if (Number.isFinite(v) && v >= 0) {
    maxQuantities.set(name, v);
  } else {
    maxQuantities.delete(name);
  }
}

// ---------------------------------------------------------------- //
// Controls & Mode Switcher
// ---------------------------------------------------------------- //

const modeDeskBtn = document.getElementById("modeDesk");
const modeUpkeepBtn = document.getElementById("modeUpkeep");
const controlTableSize = document.getElementById("controlTableSize");
const controlFitToHorizon = document.getElementById("controlFitToHorizon");
const headerStatusDesc = document.getElementById("headerStatusDesc");
const centerPanelTitle = document.getElementById("centerPanelTitle");
const queueSectionTitle = document.getElementById("queueSectionTitle");

function syncModeUI() {
  const isUpkeep = currentMode === "upkeep";
  if (modeDeskBtn) modeDeskBtn.classList.toggle("active", !isUpkeep);
  if (modeUpkeepBtn) modeUpkeepBtn.classList.toggle("active", isUpkeep);
  if (controlTableSize) controlTableSize.classList.toggle("is-hidden", isUpkeep);
  if (controlFitToHorizon) controlFitToHorizon.classList.toggle("is-hidden", isUpkeep);
  if (headerStatusDesc) {
    headerStatusDesc.textContent = isUpkeep
      ? "Continuous Upkeep & Study Report"
      : "Study Desk Queue & Study Report";
  }
  if (centerPanelTitle) {
    centerPanelTitle.textContent = isUpkeep
      ? "Upkeep & Study Report"
      : "Study Desk & Study Report";
  }
  if (queueSectionTitle) {
    queueSectionTitle.textContent = isUpkeep
      ? "Curiosities to study (total upkeep)"
      : "Study Desk (queue)";
  }
}

function setMode(m) {
  const next = m === "upkeep" ? "upkeep" : "desk";
  if (currentMode === next) return;
  currentMode = next;
  syncModeUI();
  scheduleSave();
  scheduleRecompute();
}

if (modeDeskBtn) modeDeskBtn.addEventListener("click", () => setMode("desk"));
if (modeUpkeepBtn) modeUpkeepBtn.addEventListener("click", () => setMode("upkeep"));

const controls = {
  tableSize: document.getElementById("tableSize"),
  bufferWeight: document.getElementById("bufferWeight"),
  horizonDays: document.getElementById("horizonDays"),
  cellSize: document.getElementById("cellSize"),
  lpMult: document.getElementById("lpMult"),
  speedMult: document.getElementById("speedMult"),
  fitToHorizon: document.getElementById("fitToHorizon"),
  p1metric: document.getElementById("p1metric"),
  p1dir: document.getElementById("p1dir"),
  p2metric: document.getElementById("p2metric"),
  p2dir: document.getElementById("p2dir"),
};

const valueLabels = {
  tableSize: document.getElementById("tableSizeVal"),
  bufferWeight: document.getElementById("bufferWeightVal"),
  horizonDays: document.getElementById("horizonDaysVal"),
  cellSize: document.getElementById("cellSizeVal"),
  lpMult: document.getElementById("lpMultVal"),
  speedMult: document.getElementById("speedMultVal"),
};

function syncSliderLabels() {
  const n = controls.tableSize.value;
  valueLabels.tableSize.textContent = `${n} × ${n}`;
  valueLabels.bufferWeight.textContent = controls.bufferWeight.value;
  valueLabels.horizonDays.textContent = controls.horizonDays.value;
  valueLabels.cellSize.textContent = controls.cellSize.value;
  valueLabels.lpMult.textContent = parseFloat(controls.lpMult.value).toFixed(1);
  valueLabels.speedMult.textContent = parseFloat(controls.speedMult.value).toFixed(1);
  document.documentElement.style.setProperty("--cell-size", controls.cellSize.value + "px");
}

function readConfigFromControls() {
  return {
    mode: currentMode,
    tableSize: parseInt(controls.tableSize.value, 10),
    bufferWeight: parseFloat(controls.bufferWeight.value),
    horizonDays: parseFloat(controls.horizonDays.value),
    cellSize: parseInt(controls.cellSize.value, 10),
    lpMult: parseFloat(controls.lpMult.value),
    speedMult: parseFloat(controls.speedMult.value),
    fitToHorizon: controls.fitToHorizon.checked,
    p1metric: controls.p1metric.value,
    p1dir: controls.p1dir.value,
    p2metric: controls.p2metric.value,
    p2dir: controls.p2dir.value,
  };
}

function applyConfigToControls(cfg) {
  currentMode = cfg.mode === "upkeep" ? "upkeep" : "desk";
  syncModeUI();
  controls.tableSize.value = cfg.tableSize;
  controls.bufferWeight.value = cfg.bufferWeight;
  controls.horizonDays.value = cfg.horizonDays;
  controls.cellSize.value = cfg.cellSize;
  controls.lpMult.value = cfg.lpMult;
  controls.speedMult.value = cfg.speedMult;
  controls.fitToHorizon.checked = !!cfg.fitToHorizon;
  controls.p1metric.value = cfg.p1metric;
  controls.p1dir.value = cfg.p1dir;
  controls.p2metric.value = cfg.p2metric;
  controls.p2dir.value = cfg.p2dir;
}

// ---------------------------------------------------------------- //
// localStorage
// ---------------------------------------------------------------- //

let saveTimer = null;
function scheduleSave() {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 400);
}

function saveState() {
  saveTimer = null;
  try {
    // Space saving: "ALL", or store the smaller of the two sides.
    let sel;
    if (selected.size === CATALOG.length) {
      sel = "ALL";
    } else if (selected.size > CATALOG.length / 2) {
      sel = { invert: CATALOG.filter(c => !selected.has(c.name)).map(c => c.name) };
    } else {
      sel = [...selected];
    }
    const payload = {
      version: STORAGE_VERSION,
      selected: sel,
      // Only non-default qualities are stored.
      quality: Object.fromEntries(quality),
      minQty: Object.fromEntries(minQuantities),
      maxQty: Object.fromEntries(maxQuantities),
      config: readConfigFromControls(),
      ui: { collapsedGroups: [...collapsedGroups], searchTerm, curioTab: currentCurioTab },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    // Private mode or quota exceeded must never break the app.
  }
}

function migrate(data) {
  if (!data || typeof data !== "object") return null;
  if (data.version !== STORAGE_VERSION) return null; // future migrations go here
  return data;
}

function loadState() {
  let data = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) data = migrate(JSON.parse(raw));
  } catch (e) {
    data = null;
  }
  if (!data) return;

  // Config: fill missing fields from the defaults, ignore unknown ones.
  const cfg = Object.assign({}, DEFAULT_CONFIG);
  if (data.config && typeof data.config === "object") {
    for (const k of Object.keys(DEFAULT_CONFIG)) {
      const v = data.config[k];
      if (v === undefined || v === null) continue;
      if (typeof DEFAULT_CONFIG[k] === "boolean") cfg[k] = !!v;
      else if (typeof DEFAULT_CONFIG[k] === "number" && Number.isFinite(Number(v))) cfg[k] = Number(v);
      else if (typeof DEFAULT_CONFIG[k] === "string" && typeof v === "string") cfg[k] = v;
    }
  }
  if (typeof cfg.tableSize === "number") {
    cfg.tableSize = Math.min(12, Math.max(5, Math.round(cfg.tableSize)));
  }
  if (cfg.mode !== "upkeep") cfg.mode = "desk";
  applyConfigToControls(cfg);

  // Selection: drop names that no longer exist in the catalog.
  const s = data.selected;
  if (s === "ALL") {
    selected.clear();
    CATALOG.forEach(c => selected.add(c.name));
  } else if (Array.isArray(s)) {
    selected.clear();
    s.forEach(n => { if (CATALOG_BY_NAME.has(n)) selected.add(n); });
  } else if (s && Array.isArray(s.invert)) {
    selected.clear();
    CATALOG.forEach(c => selected.add(c.name));
    s.invert.forEach(n => selected.delete(n));
  }

  // Quality: drop unknown names and unusable values.
  quality.clear();
  if (data.quality && typeof data.quality === "object") {
    for (const [name, v] of Object.entries(data.quality)) {
      if (!CATALOG_BY_NAME.has(name)) continue;
      const q = Number(v);
      if (Number.isFinite(q) && q > 0 && q !== DEFAULT_QUALITY) quality.set(name, q);
    }
  }

  // Min quantities
  minQuantities.clear();
  if (data.minQty && typeof data.minQty === "object") {
    for (const [name, v] of Object.entries(data.minQty)) {
      if (!CATALOG_BY_NAME.has(name)) continue;
      const val = parseInt(v, 10);
      if (Number.isFinite(val) && val > 0) minQuantities.set(name, val);
    }
  }

  // Max quantities
  maxQuantities.clear();
  if (data.maxQty && typeof data.maxQty === "object") {
    for (const [name, v] of Object.entries(data.maxQty)) {
      if (!CATALOG_BY_NAME.has(name)) continue;
      const val = parseInt(v, 10);
      if (Number.isFinite(val) && val >= 0) maxQuantities.set(name, val);
    }
  }

  if (data.ui && typeof data.ui === "object") {
    if (Array.isArray(data.ui.collapsedGroups)) {
      collapsedGroups.clear();
      data.ui.collapsedGroups.forEach(g => { if (GEM_FAMILIES.has(g)) collapsedGroups.add(g); });
    }
    if (typeof data.ui.searchTerm === "string") {
      searchTerm = data.ui.searchTerm;
      searchInput.value = searchTerm;
    }
    if (data.ui.curioTab === "selected" || data.ui.curioTab === "all") {
      currentCurioTab = data.ui.curioTab;
    }
  }
  syncCurioTabsUI();
}

// ---------------------------------------------------------------- //
// Curio list: gem families collapse into groups, tabs (All / Selected)
// ---------------------------------------------------------------- //

const listEl = document.getElementById("curioList");
const listMetaEl = document.getElementById("listMeta");
const searchInput = document.getElementById("searchInput");
const tabAllBtn = document.getElementById("tabAll");
const tabSelectedBtn = document.getElementById("tabSelected");
const tabAllCount = document.getElementById("tabAllCount");
const tabSelectedCount = document.getElementById("tabSelectedCount");

function syncCurioTabsUI() {
  const isSelectedTab = currentCurioTab === "selected";
  if (tabAllBtn) tabAllBtn.classList.toggle("active", !isSelectedTab);
  if (tabSelectedBtn) tabSelectedBtn.classList.toggle("active", isSelectedTab);
}

function setCurioTab(tab) {
  const next = tab === "selected" ? "selected" : "all";
  if (currentCurioTab === next) return;
  currentCurioTab = next;
  syncCurioTabsUI();
  renderCurioList();
  scheduleSave();
}

if (tabAllBtn) tabAllBtn.addEventListener("click", () => setCurioTab("all"));
if (tabSelectedBtn) tabSelectedBtn.addEventListener("click", () => setCurioTab("selected"));

let horizonSecondsForList = DEFAULT_CONFIG.horizonDays * 86400;
let speedForList = 1;

function matchesTerm(name, term) {
  return !term || name.toLowerCase().includes(term);
}

// Returns the curios currently shown, honouring active tab and search term.
function currentFilteredCurios() {
  const term = searchTerm.trim().toLowerCase();
  const isSelectedTab = currentCurioTab === "selected";
  const out = [];

  for (const c of PLAIN_CURIOS) {
    if (isSelectedTab && !selected.has(c.name)) continue;
    if (matchesTerm(c.name, term)) out.push(c);
  }

  for (const fam of GEM_FAMILY_NAMES) {
    const famMatches = matchesTerm(fam, term);
    for (const v of GEM_FAMILIES.get(fam)) {
      if (isSelectedTab && !selected.has(v.curio.name)) continue;
      if (famMatches || matchesTerm(v.curio.name, term)) out.push(v.curio);
    }
  }
  return out;
}

function isOverHorizon(c) {
  return c.studySeconds / speedForList > horizonSecondsForList;
}

function curioSubline(c) {
  const over = isOverHorizon(c) ? ` · exceeds horizon` : "";
  const q = getQuality(c.name);
  const m = qualityMult(q);
  const lp = m === 1
    ? `LP ${fmtNum(c.points)}`
    : `LP ${fmtNum(c.points)} → ${fmtInt(c.points * m)} (×${fmtNum(m)})`;
  return `${c.w}×${c.h} · weight ${fmtNum(c.weight)} · XP ${fmtNum(c.xpCost)} · ${lp} · ${fmtDuration(c.studySeconds)}${over}`;
}

function makeCurioRow(c) {
  const row = document.createElement("label");
  row.className = "curio-row" + (isOverHorizon(c) ? " over-horizon" : "");

  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = selected.has(c.name);
  cb.addEventListener("change", () => {
    if (cb.checked) selected.add(c.name); else selected.delete(c.name);
    const g = parseGem(c.name);
    if (g) refreshGroupHeader(g.family);
    updateListMeta();
    if (currentCurioTab === "selected") {
      renderCurioList();
    }
    scheduleSave();
    scheduleRecompute();
  });

  const thumb = document.createElement("div");
  thumb.className = "curio-thumb";
  attachImg(thumb, getImageUrl(c.image), c.name);

  const info = document.createElement("div");
  const nameEl = document.createElement("div");
  nameEl.className = "curio-name";
  nameEl.textContent = c.name;
  const subEl = document.createElement("div");
  subEl.className = "curio-sub";
  subEl.textContent = curioSubline(c);
  info.appendChild(nameEl);
  info.appendChild(subEl);

  // Controls container: Min, Max, Quality
  const controlsWrap = document.createElement("div");
  controlsWrap.className = "curio-controls";

  // Min input
  const minField = document.createElement("div");
  minField.className = "ctrl-field";
  minField.title = `Min copies of ${c.name} to study (0 = no min)`;
  const minLabel = document.createElement("span");
  minLabel.className = "ctrl-label";
  minLabel.textContent = "Min";
  const minInput = document.createElement("input");
  minInput.type = "number";
  minInput.min = "0";
  minInput.step = "1";
  minInput.placeholder = "0";
  const curMin = getMinQty(c.name);
  minInput.value = curMin > 0 ? String(curMin) : "";
  minInput.addEventListener("click", e => e.preventDefault());
  minInput.addEventListener("input", () => {
    setMinQty(c.name, minInput.value);
    scheduleSave();
    scheduleRecompute();
  });
  minField.appendChild(minLabel);
  minField.appendChild(minInput);

  // Max input
  const maxField = document.createElement("div");
  maxField.className = "ctrl-field";
  maxField.title = `Max copies of ${c.name} to study (blank = horizon limit)`;
  const maxLabel = document.createElement("span");
  maxLabel.className = "ctrl-label";
  maxLabel.textContent = "Max";
  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.min = "0";
  maxInput.step = "1";
  maxInput.placeholder = "∞";
  const curMax = getMaxQty(c.name);
  maxInput.value = curMax !== null ? String(curMax) : "";
  maxInput.addEventListener("click", e => e.preventDefault());
  maxInput.addEventListener("input", () => {
    setMaxQty(c.name, maxInput.value);
    scheduleSave();
    scheduleRecompute();
  });
  maxField.appendChild(maxLabel);
  maxField.appendChild(maxInput);

  // Quality input
  const qField = document.createElement("div");
  qField.className = "ctrl-field";
  qField.title = `Quality of ${c.name}\nLP multiplier = sqrt(Q / 10)`;
  const qLabel = document.createElement("span");
  qLabel.className = "ctrl-label";
  qLabel.textContent = "Q";
  const qInput = document.createElement("input");
  qInput.type = "number";
  qInput.min = "1";
  qInput.step = "1";
  qInput.value = String(getQuality(c.name));
  qInput.addEventListener("click", e => e.preventDefault());
  qInput.addEventListener("input", () => {
    const v = parseFloat(qInput.value);
    if (!Number.isFinite(v) || v <= 0) return;
    setQuality(c.name, v);
    subEl.textContent = curioSubline(c);
    scheduleSave();
    scheduleRecompute();
  });
  qInput.addEventListener("blur", () => {
    const v = parseFloat(qInput.value);
    if (!Number.isFinite(v) || v <= 0) {
      setQuality(c.name, DEFAULT_QUALITY);
      qInput.value = String(DEFAULT_QUALITY);
      subEl.textContent = curioSubline(c);
      scheduleSave();
      scheduleRecompute();
    }
  });
  qField.appendChild(qLabel);
  qField.appendChild(qInput);

  controlsWrap.appendChild(minField);
  controlsWrap.appendChild(maxField);
  controlsWrap.appendChild(qField);

  row.appendChild(cb);
  row.appendChild(thumb);
  row.appendChild(info);
  row.appendChild(controlsWrap);
  return row;
}

const groupHeaderRefs = new Map(); // family -> {master, counter}

function refreshGroupHeader(family) {
  const ref = groupHeaderRefs.get(family);
  if (!ref) return;
  const variants = GEM_FAMILIES.get(family);
  const total = variants.length;
  const sel = variants.reduce((n, v) => n + (selected.has(v.curio.name) ? 1 : 0), 0);
  ref.master.checked = sel === total;
  ref.master.indeterminate = sel > 0 && sel < total;
  ref.counter.textContent = `${sel} / ${total} selected`;
}

function setFamilySelection(family, want, filterFn) {
  for (const v of GEM_FAMILIES.get(family)) {
    if (filterFn && !filterFn(v)) continue;
    if (want) selected.add(v.curio.name); else selected.delete(v.curio.name);
  }
}

function buildGemGroup(family, visibleVariants, forceOpen) {
  const details = document.createElement("details");
  details.className = "gem-group";
  details.open = forceOpen || !collapsedGroups.has(family);
  details.addEventListener("toggle", () => {
    if (details.open) collapsedGroups.delete(family); else collapsedGroups.add(family);
    scheduleSave();
  });

  const summary = document.createElement("summary");

  const master = document.createElement("input");
  master.type = "checkbox";
  master.addEventListener("click", e => e.stopPropagation());
  master.addEventListener("change", () => {
    setFamilySelection(family, master.checked, null);
    rerenderGroupBody(family, body, visibleVariants);
    refreshGroupHeader(family);
    updateListMeta();
    if (currentCurioTab === "selected") renderCurioList();
    scheduleSave();
    scheduleRecompute();
  });

  const thumb = document.createElement("div");
  thumb.className = "curio-thumb";
  attachImg(thumb, getImageUrl(visibleVariants[0].curio.image), family);

  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "curio-name";
  title.textContent = family;
  const counter = document.createElement("div");
  counter.className = "curio-sub";
  titleWrap.appendChild(title);
  titleWrap.appendChild(counter);

  // Bulk controls for the whole family: Min, Max, Q
  const controlsWrap = document.createElement("div");
  controlsWrap.className = "curio-controls";

  const allVariants = GEM_FAMILIES.get(family);

  // Bulk Min
  const minField = document.createElement("div");
  minField.className = "ctrl-field";
  minField.title = `Min copies for all ${family} (0 = no min)`;
  const minLabel = document.createElement("span");
  minLabel.className = "ctrl-label";
  minLabel.textContent = "Min";
  const minInput = document.createElement("input");
  minInput.type = "number";
  minInput.min = "0";
  minInput.step = "1";
  minInput.placeholder = "0";
  const famMins = new Set(allVariants.map(v => getMinQty(v.curio.name)));
  if (famMins.size === 1) {
    const v = [...famMins][0];
    minInput.value = v > 0 ? String(v) : "";
  } else {
    minInput.placeholder = "mixed";
  }
  minInput.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });
  minInput.addEventListener("input", () => {
    const val = minInput.value;
    for (const variant of allVariants) setMinQty(variant.curio.name, val);
    rerenderGroupBody(family, body, visibleVariants);
    scheduleSave();
    scheduleRecompute();
  });
  minField.appendChild(minLabel);
  minField.appendChild(minInput);

  // Bulk Max
  const maxField = document.createElement("div");
  maxField.className = "ctrl-field";
  maxField.title = `Max copies for all ${family} (blank = horizon limit)`;
  const maxLabel = document.createElement("span");
  maxLabel.className = "ctrl-label";
  maxLabel.textContent = "Max";
  const maxInput = document.createElement("input");
  maxInput.type = "number";
  maxInput.min = "0";
  maxInput.step = "1";
  maxInput.placeholder = "∞";
  const famMaxes = new Set(allVariants.map(v => getMaxQty(v.curio.name)));
  if (famMaxes.size === 1) {
    const v = [...famMaxes][0];
    maxInput.value = v !== null ? String(v) : "";
  } else {
    maxInput.placeholder = "mixed";
  }
  maxInput.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });
  maxInput.addEventListener("input", () => {
    const val = maxInput.value;
    for (const variant of allVariants) setMaxQty(variant.curio.name, val);
    rerenderGroupBody(family, body, visibleVariants);
    scheduleSave();
    scheduleRecompute();
  });
  maxField.appendChild(maxLabel);
  maxField.appendChild(maxInput);

  // Bulk Q
  const qField = document.createElement("div");
  qField.className = "ctrl-field";
  qField.title = `Quality for all of ${family}\nLP multiplier = sqrt(Q / 10)`;
  const qLabel = document.createElement("span");
  qLabel.className = "ctrl-label";
  qLabel.textContent = "Q";
  const qInput = document.createElement("input");
  qInput.type = "number";
  qInput.min = "1";
  qInput.step = "1";
  const famQualities = new Set(allVariants.map(v => getQuality(v.curio.name)));
  qInput.value = famQualities.size === 1 ? String([...famQualities][0]) : "";
  if (famQualities.size > 1) qInput.placeholder = "mixed";
  qInput.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });
  qInput.addEventListener("input", () => {
    const v = parseFloat(qInput.value);
    if (!Number.isFinite(v) || v <= 0) return;
    for (const variant of allVariants) setQuality(variant.curio.name, v);
    rerenderGroupBody(family, body, visibleVariants);
    scheduleSave();
    scheduleRecompute();
  });
  qField.appendChild(qLabel);
  qField.appendChild(qInput);

  controlsWrap.appendChild(minField);
  controlsWrap.appendChild(maxField);
  controlsWrap.appendChild(qField);

  summary.appendChild(master);
  summary.appendChild(thumb);
  summary.appendChild(titleWrap);
  summary.appendChild(controlsWrap);
  details.appendChild(summary);

  // Quick size/cut chips.
  const chips = document.createElement("div");
  chips.className = "chip-row";
  const addChip = (label, filterFn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.textContent = label;
    b.addEventListener("click", () => {
      const all = allVariants.filter(filterFn)
        .every(v => selected.has(v.curio.name));
      setFamilySelection(family, !all, filterFn);
      rerenderGroupBody(family, body, visibleVariants);
      refreshGroupHeader(family);
      updateListMeta();
      if (currentCurioTab === "selected") renderCurioList();
      scheduleSave();
      scheduleRecompute();
    });
    chips.appendChild(b);
  };
  GEM_SIZES.forEach(s => addChip(s, v => v.size === s));
  GEM_CUTS.forEach(cut => addChip(cut, v => v.cut === cut));
  details.appendChild(chips);

  const body = document.createElement("div");
  body.className = "gem-body";
  details.appendChild(body);

  groupHeaderRefs.set(family, { master, counter });
  rerenderGroupBody(family, body, visibleVariants);
  refreshGroupHeader(family);
  return details;
}

function rerenderGroupBody(family, body, visibleVariants) {
  body.innerHTML = "";
  const isSelectedTab = currentCurioTab === "selected";
  const frag = document.createDocumentFragment();
  for (const v of visibleVariants) {
    if (isSelectedTab && !selected.has(v.curio.name)) continue;
    frag.appendChild(makeCurioRow(v.curio));
  }
  body.appendChild(frag);
}

function updateListMeta() {
  const shown = currentFilteredCurios().length;
  const selCount = selected.size;
  const totalCount = CATALOG.length;
  if (tabAllCount) tabAllCount.textContent = `(${totalCount})`;
  if (tabSelectedCount) tabSelectedCount.textContent = `(${selCount})`;
  listMetaEl.textContent = `Showing ${shown} of ${totalCount}. Selected: ${selCount}.`;
}

function renderCurioList() {
  const term = searchTerm.trim().toLowerCase();
  const isSelectedTab = currentCurioTab === "selected";
  groupHeaderRefs.clear();
  const frag = document.createDocumentFragment();
  let totalRendered = 0;

  for (const c of PLAIN_CURIOS) {
    if (isSelectedTab && !selected.has(c.name)) continue;
    if (!matchesTerm(c.name, term)) continue;
    frag.appendChild(makeCurioRow(c));
    totalRendered++;
  }

  for (const family of GEM_FAMILY_NAMES) {
    const variants = GEM_FAMILIES.get(family);
    const famMatches = matchesTerm(family, term);
    const visible = variants.filter(v => {
      if (isSelectedTab && !selected.has(v.curio.name)) return false;
      return famMatches || matchesTerm(v.curio.name, term);
    });
    if (visible.length === 0) continue;
    frag.appendChild(buildGemGroup(family, visible, !!term));
    totalRendered += visible.length;
  }

  listEl.innerHTML = "";
  if (totalRendered === 0) {
    const emptyNote = document.createElement("div");
    emptyNote.className = "empty-note static";
    emptyNote.textContent = isSelectedTab
      ? (term ? "No selected curiosities match search." : "No curiosities selected. Switch to All tab to select curiosities.")
      : "No curiosities match search.";
    listEl.appendChild(emptyNote);
  } else {
    listEl.appendChild(frag);
  }
  updateListMeta();
}

searchInput.addEventListener("input", () => {
  searchTerm = searchInput.value;
  renderCurioList();
  scheduleSave();
});

// Bulk buttons operate on the filtered set, not on visible DOM nodes.
document.getElementById("btnSelectVisible").addEventListener("click", () => {
  for (const c of currentFilteredCurios()) selected.add(c.name);
  renderCurioList(); scheduleSave(); scheduleRecompute();
});
document.getElementById("btnDeselectVisible").addEventListener("click", () => {
  for (const c of currentFilteredCurios()) selected.delete(c.name);
  renderCurioList(); scheduleSave(); scheduleRecompute();
});
document.getElementById("btnSelectAll").addEventListener("click", () => {
  for (const c of CATALOG) selected.add(c.name);
  renderCurioList(); scheduleSave(); scheduleRecompute();
});
document.getElementById("btnDeselectAll").addEventListener("click", () => {
  selected.clear();
  renderCurioList(); scheduleSave(); scheduleRecompute();
});

document.getElementById("btnReset").addEventListener("click", () => {
  applyConfigToControls(DEFAULT_CONFIG);
  selected.clear();
  CATALOG.forEach(c => selected.add(c.name));
  quality.clear();
  minQuantities.clear();
  maxQuantities.clear();
  collapsedGroups.clear();
  GEM_FAMILY_NAMES.forEach(g => collapsedGroups.add(g));
  searchTerm = "";
  searchInput.value = "";
  currentCurioTab = "all";
  syncCurioTabsUI();
  syncSliderLabels();
  renderCurioList();
  scheduleSave();
  scheduleRecompute();
});

Object.values(controls).forEach(el => {
  const evt = (el.tagName === "SELECT" || el.type === "checkbox") ? "change" : "input";
  el.addEventListener(evt, () => {
    syncSliderLabels();
    scheduleSave();
    scheduleRecompute();
  });
});

// ---------------------------------------------------------------- //
// Recompute
// ---------------------------------------------------------------- //

let rafId = null;
function scheduleRecompute() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    rafId = null;
    recompute();
  });
}

function recompute() {
  const ui = readConfigFromControls();
  const config = {
    mode: ui.mode,
    tableW: ui.tableSize,
    tableH: ui.tableSize,
    bufferW: BUFFER_W,
    bufferH: BUFFER_H,
    bufferMaxWeight: ui.bufferWeight,
    horizonSeconds: ui.horizonDays * 24 * 3600,
    lpMultiplier: ui.lpMult,
    speedMultiplier: ui.speedMult,
    fitToHorizon: ui.fitToHorizon,
    priorities: [
      { metric: ui.p1metric, direction: ui.p1dir },
      { metric: ui.p2metric, direction: ui.p2dir },
    ],
  };

  // The list marks items that cannot fit the horizon; keep it in sync.
  const horizonChanged = horizonSecondsForList !== config.horizonSeconds || speedForList !== ui.speedMult;
  horizonSecondsForList = config.horizonSeconds;
  speedForList = ui.speedMult;

  const candidates = CATALOG
    .filter(c => selected.has(c.name))
    .map(c => Object.assign({}, c, {
      quality: getQuality(c.name),
      minCopies: getMinQty(c.name),
      maxCopies: getMaxQty(c.name),
    }));

  if (candidates.length === 0) {
    renderQueue([], config, null);
    renderGrid("bufferGrid", [], config.bufferW, config.bufferH, "No curiosities selected");
    renderStats(null, config);
    if (horizonChanged) renderCurioList();
    return;
  }

  const planner = new Planner(candidates, config);
  const report = planner.run();

  const groups = report.mode === "upkeep" ? report.upkeep.groups : report.table.groups;
  renderQueue(groups, config, report);
  renderGrid("bufferGrid", report.buffer.placed, config.bufferW, config.bufferH,
    report.buffer.placed.length ? null : "Study Report empty: nothing fits Attention");
  renderStats(report, config);

  if (horizonChanged) renderCurioList();
}

// ---------------------------------------------------------------- //
// Rendering: the study desk is a multiset, so it is drawn grouped by type
// with a quantity badge instead of 144 identical pictures.
// ---------------------------------------------------------------- //

function tooltipFor(curio, extra) {
  const lpChanged = Math.abs(curio.points - curio.basePoints) > 1e-9;
  const spChanged = Math.abs(curio.studySeconds - curio.baseStudySeconds) > 1e-9;
  const lp = lpChanged
    ? `${fmtInt(curio.basePoints)} -> ${fmtInt(curio.points)}`
    : fmtInt(curio.points);
  const time = spChanged
    ? `${fmtDuration(curio.baseStudySeconds)} -> ${fmtDuration(curio.studySeconds)}`
    : fmtDuration(curio.studySeconds);
  const lines = [
    curio.name,
    `Size: ${curio.w}×${curio.h}`,
    `Weight: ${fmtNum(curio.weight)}`,
    `XP cost: ${fmtNum(curio.xpCost)}`,
    `LP: ${lp}`,
    `Study time: ${time}`,
  ];
  if (curio.minCopies > 0) lines.push(`Min copies: ${curio.minCopies}`);
  if (curio.maxCopies !== undefined && curio.maxCopies !== null && curio.maxCopies < 999999) {
    lines.push(`Max copies: ${curio.maxCopies}`);
  }
  if (curio.quality !== undefined) {
    lines.push(`Quality: ${fmtNum(curio.quality)} (×${fmtNum(curio.qualityMult)} LP)`);
  }
  return lines.concat(extra || []).join("\n");
}

function renderQueue(groups, config, report) {
  const el = document.getElementById("tableQueue");
  const meta = document.getElementById("tableMeta");
  el.innerHTML = "";

  if (!groups || groups.length === 0 || !report) {
    const note = document.createElement("div");
    note.className = "empty-note static";
    note.textContent = "No curiosities selected";
    el.appendChild(note);
    meta.textContent = "";
    return;
  }

  const isUpkeep = report.mode === "upkeep";
  if (isUpkeep) {
    meta.textContent = `${report.upkeep.totalItems} items · ${report.upkeep.distinctTypes} distinct types`;
  } else {
    const totalCells = config.tableW * config.tableH;
    meta.textContent = `${report.table.itemCount} items · ${report.table.cellsUsed} / ${totalCells} cells`;
  }

  const frag = document.createDocumentFragment();
  for (const g of groups) {
    const tile = document.createElement("div");
    tile.className = "queue-tile";
    tile.style.width = `calc(var(--cell-size) * ${g.curio.w})`;
    tile.style.height = `calc(var(--cell-size) * ${g.curio.h})`;
    const extraLines = isUpkeep
      ? [
          `Total studied: ${g.count}`,
          `Total LP: ${fmtInt(g.totalPoints)}`,
          `Total XP: ${fmtInt(g.totalXp)}`,
        ]
      : [`Queued: ${g.count}`];
    tile.title = tooltipFor(g.curio, extraLines);
    attachImg(tile, getImageUrl(g.curio.image), g.name);
    const badge = document.createElement("span");
    badge.className = "qty-badge";
    badge.textContent = "×" + g.count;
    tile.appendChild(badge);
    frag.appendChild(tile);
  }
  el.appendChild(frag);
}

function renderGrid(containerId, placedItems, W, H, emptyMessage) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  el.style.setProperty("--cols", W);
  el.style.setProperty("--rows", H);
  el.style.backgroundImage =
    "linear-gradient(to right, var(--cell-line) 1px, transparent 1px)," +
    "linear-gradient(to bottom, var(--cell-line) 1px, transparent 1px)";
  el.style.backgroundSize = `${100 / W}% 100%, 100% ${100 / H}%`;

  if (emptyMessage) {
    const note = document.createElement("div");
    note.className = "empty-note";
    note.textContent = emptyMessage;
    el.appendChild(note);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const it of placedItems) {
    const div = document.createElement("div");
    div.className = "cell-item";
    div.style.left = `${(it.x / W) * 100}%`;
    div.style.top = `${(it.y / H) * 100}%`;
    div.style.width = `${(it.w / W) * 100}%`;
    div.style.height = `${(it.h / H) * 100}%`;
    div.title = tooltipFor(it.curio);
    attachImg(div, getImageUrl(it.curio.image), it.name);
    frag.appendChild(div);
  }
  el.appendChild(frag);
}

// ---------------------------------------------------------------- //
// Statistics
// ---------------------------------------------------------------- //

function line(label, value, cls) {
  return `<div class="stat-line ${cls || ""}"><span>${label}</span><b>${value}</b></div>`;
}
function note(text, cls) {
  return `<div class="stat-note ${cls || ""}">${text}</div>`;
}

function renderStats(report, config) {
  const el = document.getElementById("statsBox");
  const bufMeta = document.getElementById("bufferMeta");

  if (!report) {
    el.innerHTML = note("Select at least one curiosity.", "warn");
    bufMeta.textContent = "";
    return;
  }

  const isUpkeep = report.mode === "upkeep";
  const s = report.stats;
  const days = config.horizonSeconds / 86400;
  const hours = config.horizonSeconds / 3600;
  const lpPerDay = days > 0 ? s.lpGained / days : 0;
  const lpPerHour = hours > 0 ? s.lpGained / hours : 0;
  const bufCells = report.buffer.totalCells;

  bufMeta.textContent =
    `${s.bufferPeakCells} / ${bufCells} cells · Attention ${fmtNum(s.bufferPeakWeight)} / ${fmtNum(config.bufferMaxWeight)}`;

  let html = "";
  html += line("LP gained", fmtInt(s.lpGained));
  html += line("LP per day", fmtInt(lpPerDay));
  html += line("LP per hour", fmtInt(lpPerHour));
  html += line("XP spent", fmtInt(s.xpSpent));
  html += line("Studies completed", fmtInt(s.studiedCount));

  if (!isUpkeep) {
    html += line("Study Desk queue", `${s.studiedCount} / ${report.table.itemCount}`);
    html += line("Distinct types", fmtInt(report.table.groups.length));
    html += line("Study Desk drained", s.tableDrained ? "Yes" : "No", s.tableDrained ? "" : "warn");
  } else {
    html += line("Distinct types", fmtInt(report.upkeep.distinctTypes));
  }

  html += line("Attention peak",
    `${fmtNum(s.bufferPeakWeight)} / ${fmtNum(config.bufferMaxWeight)}`);
  html += line("Study Report cells peak", `${s.bufferPeakCells} / ${bufCells}`);
  html += line("Makespan", fmtDuration(s.makespan));

  if (!isUpkeep) {
    html += line("Unfinished at deadline", fmtInt(s.bufferUnfinished),
      s.bufferUnfinished > 0 ? "warn" : "");

    if (report.fit && report.fit.enabled) {
      html += line("Queue size",
        `${report.fit.cellBudget} / ${report.table.totalCells} cells`);
      html += note(
        `Queue sized to ${report.fit.cellBudget}/${report.table.totalCells} cells — ` +
        `drains in ${fmtNum(s.makespan / 86400)}d of ${fmtNum(days)}d.`);
    }
  }

  // Which constraint actually binds? Determined from the run, not assumed.
  const weightBound = s.bufferPeakWeight >= config.bufferMaxWeight - 1e-6;
  const cellBound = s.bufferPeakCells >= bufCells;
  const distinctCount = isUpkeep ? report.upkeep.distinctTypes : report.table.groups.length;

  if (weightBound && !cellBound) {
    html += note("Attention-bound: raise Attention or use lighter curios.", "warn");
  } else if (cellBound && !weightBound) {
    html += note("Cell-bound: Study Report is full (16/16 cells); Attention is not the limit.");
  } else if (!weightBound && !cellBound) {
    // Each type studies one copy at a time, so parallelism is capped by the
    // number of distinct types available.
    html += note(
      `Type-bound: only ${distinctCount} distinct types ${isUpkeep ? "studied" : "queued"}, so the ` +
      `Study Report idles at ${s.bufferPeakCells}/${bufCells} cells. Select more curio types.`);
  }

  if (!isUpkeep && !s.tableDrained) {
    html += note(`Queue not drained: ${s.tableRemaining + s.bufferUnfinished} items left.`, "warn");
  }
  if (s.excludedByHorizon > 0) {
    html += note(`${s.excludedByHorizon} curios excluded: study time exceeds horizon.`);
  }
  if (s.poolSize === 0) {
    html += note("Nothing fits the horizon. Increase it or raise study speed.", "warn");
  }
  if (s.eventsCapped) {
    html += note("Event limit reached, results are truncated.", "warn");
  }

  el.innerHTML = html;
}

// ---------------------------------------------------------------- //
// Init
// ---------------------------------------------------------------- //

applyConfigToControls(DEFAULT_CONFIG);
loadState();
syncSliderLabels();
horizonSecondsForList = parseFloat(controls.horizonDays.value) * 86400;
speedForList = parseFloat(controls.speedMult.value);
renderCurioList();
recompute();
