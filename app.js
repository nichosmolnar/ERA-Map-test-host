const SHEET_DATA_URL = "https://script.google.com/macros/s/AKfycbyeo7T6ZtDqJZcpjeink-etSuEXbv4V_IkebWNOPJKxPmHoqTEDvgWJoGxXPYokSSWyqg/exec";
const SHEET_CACHE_KEY = "era-map-sheet-cache";
const SHEET_CACHE_TTL_MS = 60 * 1000;
const TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json";
const MAP_WIDTH = 975;
const MAP_HEIGHT = 610;
const PANEL_WIDTH_RATIO = 2 / 3;
const MAP_PLACEHOLDER_FILL = "#e8e8e8";
const ZOOM_DURATION = 750;
const MOBILE_LAYOUT_MQ = "(max-width: 700px)";

function isMobileLayout() {
  return window.matchMedia(MOBILE_LAYOUT_MQ).matches;
}

function mapTransition(mapLayer) {
  return mapLayer.transition().duration(ZOOM_DURATION).ease(d3.easeCubicInOut);
}

const ERA_TYPES = [
  "No State ERA",
  "Ongoing Campaign",
  "Ltd. Gender Equality Provisions",
  "Full State ERA",
  "Expanded ERA"
];

const COLOR_PALETTES = {
  // Ltd = mid green; Full = dark green; Expanded = navy→dark green gradient
  current: ["#c4c4c4", "#E36A93", "#209f57", "#0B5C3A", "expanded-gradient"],
  option1: ["#F5ECC2", "#B7C2A9", "#D6B43E", "#064F6E", "#C53C69"],
  option2: ["#E4E4E4", "#C19F2C", "#C3CD9D", "#437742", "#0D1C43"],
  option3: ["#A8A8A8", "#FDBF68", "#C16B27", "#A5C8D1", "#064F6E"],
  option4: ["#EEEEEE", "#004F46", "#FFDD00", "#78CDD0", "#004F46"],
  option5: ["#c4c4c4", "#E36A93", "#209f57", "#0B5C3A", "expanded-gradient"],
};

const EXPANDED_GRADIENT_SENTINEL = "expanded-gradient";
const EXPANDED_GRADIENT_ID = "expanded-gradient";
const EXPANDED_GRADIENT_STOPS = [
  { offset: "0%", color: "#2f3a72" },
  { offset: "14.286%", color: "#004982" },
  { offset: "28.571%", color: "#00578a" },
  { offset: "42.857%", color: "#006488" },
  { offset: "57.143%", color: "#00707d" },
  { offset: "71.429%", color: "#007a69" },
  { offset: "85.714%", color: "#00834f" },
  { offset: "100%", color: "#018a31" }
];
const EXPANDED_CSS_GRADIENT = `linear-gradient(90deg, ${EXPANDED_GRADIENT_STOPS.map(s => s.color).join(", ")})`;

const PALETTE_LABELS = {
  current: "Current",
  option1: "Option 1",
  option2: "Option 2",
  option3: "Option 3",
  option4: "Option 4",
  option5: "Option 5"
};

let activePaletteKey = "current";

const ERA_PROTECTION_TYPES = [
  "Ltd. Gender Equality Provisions",
  "Full State ERA",
  "Expanded ERA"
];
const PROTECTION_FILTER_ORDER = [...ERA_PROTECTION_TYPES].reverse();
const OUTER_FILTER_ORDER = ["Ongoing Campaign", "No State ERA"];
const FILTER_GROUP_LABEL = "Has constitutional gender-equality protections";

const color = d3.scaleOrdinal()
  .domain(ERA_TYPES)
  .range(COLOR_PALETTES.current)
  .unknown("#f0f0f0");

const activeFilters = new Set();
const mapUI = {
  lookup: null,
  tooltip: null,
  statePaths: null,
  outlineLayer: null,
  path: null,
  activeTab: "review",
  zoomOut: null,
  isZoomed: false
};

function readSheetCache() {
  try {
    const raw = localStorage.getItem(SHEET_CACHE_KEY);
    if (!raw) return null;
    const { fetchedAt, data } = JSON.parse(raw);
    if (!fetchedAt || !data) return null;
    if (Date.now() - fetchedAt > SHEET_CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeSheetCache(data) {
  try {
    localStorage.setItem(SHEET_CACHE_KEY, JSON.stringify({
      fetchedAt: Date.now(),
      data
    }));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function fetchSheetJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `sheetCallback_${Date.now()}`;
    const script = document.createElement("script");

    window[callbackName] = (data) => {
      delete window[callbackName];
      script.remove();
      resolve(data);
    };

    script.src = `${url}${url.includes("?") ? "&" : "?"}callback=${callbackName}`;
    script.onerror = () => {
      delete window[callbackName];
      script.remove();
      reject(new Error("Sheet JSONP fetch failed"));
    };
    document.head.appendChild(script);
  });
}

function loadSheetData() {
  const cached = readSheetCache();
  if (cached) return Promise.resolve(cached);

  return fetchSheetJsonp(SHEET_DATA_URL).then(data => {
    writeSheetCache(data);
    return data;
  });
}

function countByCategory(stateData) {
  const counts = Object.fromEntries(ERA_TYPES.map(t => [t, 0]));
  stateData.forEach(d => {
    const type = d["State ERA type"];
    if (type in counts) counts[type] += 1;
  });
  return counts;
}

function textColor(hex) {
  // Expanded gradient is dark throughout, so use light text on it.
  if (!hex || !hex.startsWith("#")) return "#fff";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#222" : "#fff";
}

function getEraType(row) {
  return row ? row["State ERA type"] : null;
}

function isExpandedGradient(value) {
  return value === EXPANDED_GRADIENT_SENTINEL;
}

function svgFill(era) {
  const value = color(era);
  return isExpandedGradient(value) ? `url(#${EXPANDED_GRADIENT_ID})` : value;
}

function applySwatchBackground(selection, value) {
  if (isExpandedGradient(value)) {
    selection
      .style("background-color", null)
      .style("background-image", EXPANDED_CSS_GRADIENT);
  } else {
    selection
      .style("background-image", null)
      .style("background-color", value);
  }
}

function applyFilterButtonColor(selection, value) {
  const fill = isExpandedGradient(value) ? EXPANDED_CSS_GRADIENT : value;
  selection
    .style("--btn-fill", fill)
    .style("--btn-on-fill-text", textColor(value))
    .style("background-color", null)
    .style("background-image", null)
    .style("color", null);
}

function swatchStyle(value) {
  return isExpandedGradient(value)
    ? `background-image:${EXPANDED_CSS_GRADIENT}`
    : `background-color:${value}`;
}

function renderMap(us) {
  const states = topojson.feature(us, us.objects.states);
  const borders = topojson.mesh(us, us.objects.states, (a, b) => a !== b);
  const path = d3.geoPath();

  const svg = d3.select("#map")
    .append("svg")
    .attr("viewBox", [0, 0, MAP_WIDTH, MAP_HEIGHT]);

  const gradient = svg.append("defs")
    .append("linearGradient")
    .attr("id", EXPANDED_GRADIENT_ID)
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "100%")
    .attr("y2", "0%");

  gradient.selectAll("stop")
    .data(EXPANDED_GRADIENT_STOPS)
    .join("stop")
    .attr("offset", d => d.offset)
    .attr("stop-color", d => d.color);

  const mapLayer = svg.append("g").attr("class", "map-layer");

  const statePaths = mapLayer.append("g")
    .selectAll("path")
    .data(states.features)
    .join("path")
    .attr("class", "state")
    .attr("fill", MAP_PLACEHOLDER_FILL)
    .attr("d", path);

  mapLayer.append("path")
    .datum(borders)
    .attr("class", "state-borders")
    .attr("fill", "none")
    .attr("stroke", "#fff")
    .attr("stroke-linejoin", "round")
    .attr("d", path);

  const outlineLayer = mapLayer.append("g").attr("class", "state-outline");
  mapUI.outlineLayer = outlineLayer;
  mapUI.path = path;

  attachZoom(svg, mapLayer, statePaths, path);

  return { statePaths, svg };
}

function setStateOutline(feature) {
  if (!mapUI.outlineLayer || !mapUI.path) return;

  mapUI.outlineLayer.selectAll("path")
    .data(feature ? [feature] : [])
    .join("path")
    .attr("fill", "none")
    .attr("stroke", "#000")
    .attr("stroke-width", 1)
    .attr("stroke-linejoin", "round")
    .attr("pointer-events", "none")
    .attr("d", mapUI.path);
}

function initStatePanel() {
  const panel = d3.select("#state-panel");

  panel.selectAll(".state-panel-tab")
    .on("click", function () {
      const tab = this.dataset.tab;
      mapUI.activeTab = tab;
      panel.selectAll(".state-panel-tab")
        .classed("active", function () { return this.dataset.tab === tab; });
      panel.selectAll(".state-panel-pane")
        .classed("active", function () { return this.dataset.pane === tab; });
    });

  panel.select(".state-panel-close")
    .on("click", (event) => {
      event.stopPropagation();
      if (mapUI.zoomOut) mapUI.zoomOut();
    });

  panel.on("click", (event) => event.stopPropagation());

  return panel;
}

function setPaneContent(selection, html, emptyMessage) {
  // Sheet export may include rich-text HTML (<strong>, <em>, <u>, <s>, <a>).
  // Newlines are preserved via .state-panel-pane { white-space: pre-line }.
  if (html) {
    selection.html(html);
  } else {
    selection.html("").append("em").attr("class", "empty").text(emptyMessage);
  }
}

let panelClearTimer = null;

function showStatePanel(row) {
  if (!row) return;

  if (panelClearTimer) {
    clearTimeout(panelClearTimer);
    panelClearTimer = null;
  }

  const panel = d3.select("#state-panel");
  const era = row["State ERA type"];
  const review = (row["Federal Standard of Review"] || "").trim();
  const cases = (row["Sex Equality Cases"] || "").trim();
  const provisionContext = (row["Constitution Context"] || "").trim();

  panel.select(".state-panel-name").text(row.State);
  panel.select(".state-panel-status").text(era || "Unknown");
  applySwatchBackground(panel.select(".state-panel-swatch"), color(era));

  setPaneContent(
    panel.select('[data-pane="review"]'),
    review,
    "No federal standard of review information available."
  );
  setPaneContent(
    panel.select('[data-pane="cases"]'),
    cases,
    "No sex equality cases available."
  );
  setPaneContent(
    panel.select('[data-pane="provision"]'),
    provisionContext,
    "No constitution context available."
  );

  panel.selectAll(".state-panel-tab")
    .classed("active", function () { return this.dataset.tab === mapUI.activeTab; });
  panel.selectAll(".state-panel-pane")
    .classed("active", function () { return this.dataset.pane === mapUI.activeTab; });

  panel.classed("visible", false).attr("aria-hidden", "true");
  requestAnimationFrame(() => {
    panel.classed("visible", true).attr("aria-hidden", null);
  });
}

function clearStatePanel() {
  const panel = d3.select("#state-panel");
  panel.select(".state-panel-name").text("");
  panel.select(".state-panel-status").text("");
  panel.select(".state-panel-swatch")
    .style("background-color", null)
    .style("background-image", null);
  panel.select('[data-pane="review"]').html("");
  panel.select('[data-pane="cases"]').html("");
  panel.select('[data-pane="provision"]').html("");
}

function hideStatePanel() {
  const panelNode = document.getElementById("state-panel");

  // Move focus out before aria-hidden, otherwise browsers block hiding a focused subtree.
  if (panelNode.contains(document.activeElement)) {
    document.activeElement.blur();
  }

  d3.select("#state-panel").classed("visible", false).attr("aria-hidden", "true");

  // Keep the content in place until the slide-out transition finishes.
  if (panelClearTimer) clearTimeout(panelClearTimer);
  panelClearTimer = setTimeout(() => {
    panelClearTimer = null;
    clearStatePanel();
  }, ZOOM_DURATION);
}

function applyMapColors(statePaths, lookup) {
  statePaths.attr("fill", d => svgFill(getEraType(lookup.get(d.properties.name))));
}

function applyPalette(key) {
  const palette = COLOR_PALETTES[key];
  if (!palette) return;

  activePaletteKey = key;
  color.range(palette);

  if (mapUI.statePaths && mapUI.lookup) {
    applyMapColors(mapUI.statePaths, mapUI.lookup);
  }

  d3.select("#filters")
    .selectAll("button.filter-btn:not(.filter-btn--placeholder)")
    .each(function (d) {
      applyFilterButtonColor(d3.select(this), color(d));
    });

  const panel = d3.select("#state-panel");
  if (panel.classed("visible")) {
    const status = panel.select(".state-panel-status").text();
    if (status) {
      applySwatchBackground(panel.select(".state-panel-swatch"), color(status));
    }
  }
}

function initPaletteSelector() {
  const select = d3.select("#palette-select");

  select.selectAll("option")
    .data(Object.keys(COLOR_PALETTES))
    .join("option")
    .attr("value", d => d)
    .text(d => PALETTE_LABELS[d]);

  select.property("value", activePaletteKey);

  select.on("change", function () {
    applyPalette(this.value);
  });
}

function updateMapOpacity(statePaths, lookup) {
  const filtering = activeFilters.size > 0;
  statePaths.attr("opacity", d => {
    const era = getEraType(lookup.get(d.properties.name));
    if (!filtering) return 1;
    return era && activeFilters.has(era) ? 1 : 0.15;
  });
}

function showMapControls() {
  d3.select("#map-controls")
    .classed("ready", true)
    .attr("aria-hidden", null);
}

function allProtectionFiltersActive() {
  return ERA_PROTECTION_TYPES.every(t => activeFilters.has(t));
}

function revealFilterGroupToggle(root) {
  root.select(".filter-group-toggle")
    .property("disabled", false)
    .attr("aria-hidden", null);
}

function bindFilterButtons(selection, counts, refresh) {
  selection
    .attr("class", "filter-btn")
    .attr("type", "button")
    .attr("aria-hidden", null)
    .each(function (d) {
      applyFilterButtonColor(d3.select(this), color(d));
    })
    .classed("active", d => activeFilters.has(d))
    .classed("filter-btn--placeholder", false)
    .on("click", (event, category) => {
      event.stopPropagation();
      if (activeFilters.has(category)) {
        activeFilters.delete(category);
      } else {
        activeFilters.add(category);
      }
      refresh();
    })
    .html(d => `
      <span class="label">${d}</span>
      <span class="count">${counts[d]}</span>
    `);
}

function renderFilters(counts, statePaths, lookup) {
  const root = d3.select("#filters");

  let group = root.select(".filter-group");
  if (group.empty()) {
    group = root.insert("div", ":first-child")
      .attr("class", "filter-group")
      .attr("role", "group")
      .attr("aria-label", FILTER_GROUP_LABEL);
    group.append("button")
      .attr("type", "button")
      .attr("class", "filter-group-toggle")
      .attr("aria-hidden", "true")
      .attr("aria-pressed", "false")
      .property("disabled", true)
      .html(`
        <span class="filter-group-toggle-label">${FILTER_GROUP_LABEL}</span>
        <span class="filter-group-toggle-bar" aria-hidden="true"></span>
      `);
    group.append("div").attr("class", "filter-group-buttons");
  }

  const refresh = () => {
    const groupActive = allProtectionFiltersActive();
    root.selectAll("button.filter-btn")
      .classed("active", d => activeFilters.has(d));
    group.select(".filter-group-toggle")
      .classed("active", groupActive)
      .attr("aria-pressed", groupActive);
    updateMapOpacity(statePaths, lookup);
  };

  const protectionButtons = group.select(".filter-group-buttons")
    .selectAll("button.filter-btn")
    .data(PROTECTION_FILTER_ORDER)
    .join("button");
  bindFilterButtons(protectionButtons, counts, refresh);

  const outerButtons = root.selectAll(":scope > button.filter-btn")
    .data(OUTER_FILTER_ORDER)
    .join("button");
  bindFilterButtons(outerButtons, counts, refresh);

  group.select(".filter-group-toggle").on("click", () => {
    if (allProtectionFiltersActive()) {
      ERA_PROTECTION_TYPES.forEach(t => activeFilters.delete(t));
    } else {
      ERA_PROTECTION_TYPES.forEach(t => activeFilters.add(t));
    }
    refresh();
  });

  revealFilterGroupToggle(root);
  refresh();
}

function createTooltip() {
  return d3.select("#map-frame")
    .append("div")
    .attr("class", "tooltip");
}

function showTooltip(tooltip, event, row) {
  if (
    !row ||
    isMobileLayout() ||
    mapUI.isZoomed ||
    d3.select("#state-panel").classed("visible")
  ) {
    hideTooltip(tooltip);
    return;
  }

  const era = row["State ERA type"];
  const hover = (row.HOVER || "").trim();

  tooltip.html(`
    <div class="tooltip-name">${row.State}</div>
    <div class="tooltip-category">
      <span class="tooltip-swatch" style="${swatchStyle(color(era))}"></span>
      <span>${era || "Unknown"}</span>
    </div>
    ${hover
      ? `<div class="tooltip-background">${hover}</div>`
      : `<div class="tooltip-background"><em>No information available.</em></div>`}
    <div class="tooltip-cta">Click to learn more</div>
  `);

  tooltip.classed("visible", true).style("visibility", "hidden");

  const mapFrame = document.getElementById("map-frame");
  const [x, y] = d3.pointer(event, mapFrame);
  const offset = 12;
  const tipNode = tooltip.node();
  const tipWidth = tipNode.offsetWidth;
  const tipHeight = tipNode.offsetHeight;
  const maxX = mapFrame.clientWidth - tipWidth - 4;
  const maxY = mapFrame.clientHeight - tipHeight - 4;

  tooltip
    .style("left", `${Math.min(x + offset, maxX)}px`)
    .style("top", `${Math.min(y + offset, maxY)}px`)
    .style("visibility", "visible");
}

function hideTooltip(tooltip) {
  tooltip
    .classed("visible", false)
    .style("visibility", null)
    .style("left", null)
    .style("top", null)
    .html("");
}

function zoomToState(mapLayer, path, feature, panelOpen) {
  const [[x0, y0], [x1, y1]] = path.bounds(feature);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const x = (x0 + x1) / 2;
  const y = (y0 + y1) / 2;
  const viewWidth = panelOpen ? MAP_WIDTH * (1 - PANEL_WIDTH_RATIO) : MAP_WIDTH;
  const scale = Math.min(8, 0.9 / Math.max(dx / viewWidth, dy / MAP_HEIGHT));
  const translate = [viewWidth / 2 - scale * x, MAP_HEIGHT / 2 - scale * y];

  mapTransition(mapLayer)
    .attr("transform", `translate(${translate}) scale(${scale})`);
}

function resetZoom(mapLayer, onEnd) {
  const transition = mapTransition(mapLayer)
    .attr("transform", "translate(0, 0) scale(1)");
  if (onEnd) transition.on("end", onEnd);
}

function attachZoom(svg, mapLayer, statePaths, path) {
  let zoomedState = null;

  function zoomOut() {
    zoomedState = null;
    setStateOutline(null);
    hideStatePanel();
    if (mapUI.tooltip) hideTooltip(mapUI.tooltip);
    resetZoom(mapLayer, () => {
      mapUI.isZoomed = false;
    });
  }

  function zoomIn(d) {
    zoomedState = d;
    mapUI.isZoomed = true;
    const row = mapUI.lookup ? mapUI.lookup.get(d.properties.name) : null;
    if (mapUI.tooltip) hideTooltip(mapUI.tooltip);
    setStateOutline(d);
    showStatePanel(row);
    if (!isMobileLayout()) {
      zoomToState(mapLayer, path, d, true);
    }
  }

  statePaths.on("click", (event, d) => {
    event.stopPropagation();
    if (zoomedState) {
      zoomOut();
      return;
    }
    zoomIn(d);
  });

  svg.on("click", () => {
    if (zoomedState) zoomOut();
  });

  mapUI.zoomOut = zoomOut;
}

function attachTooltip(statePaths, lookup, tooltip) {
  statePaths
    .on("click.zoom", () => hideTooltip(tooltip))
    .on("mouseenter", (event, d) => {
      if (isMobileLayout()) return;
      if (!mapUI.isZoomed) setStateOutline(d);
      showTooltip(tooltip, event, lookup.get(d.properties.name));
    })
    .on("mousemove", (event, d) => {
      if (isMobileLayout()) return;
      showTooltip(tooltip, event, lookup.get(d.properties.name));
    })
    .on("mouseleave", () => {
      if (isMobileLayout()) return;
      if (!mapUI.isZoomed) setStateOutline(null);
      hideTooltip(tooltip);
    });

  d3.select("#map").on("mouseleave", () => {
    if (isMobileLayout()) return;
    if (!mapUI.isZoomed) setStateOutline(null);
    hideTooltip(tooltip);
  });
}

function hideMapLoading() {
  d3.select("#map-loading").classed("hidden", true);
}

function applySheetData(sheetData, statePaths, tooltip) {
  console.log("Sheet data:", sheetData);

  const stateData = sheetData["State ERAs"];
  const lookup = new Map(stateData.map(d => [d.State, d]));
  const counts = countByCategory(stateData);

  mapUI.lookup = lookup;
  mapUI.tooltip = tooltip;

  applyMapColors(statePaths, lookup);
  renderFilters(counts, statePaths, lookup);
  attachTooltip(statePaths, lookup, tooltip);
  showMapControls();
  hideMapLoading();
}

initStatePanel();

// Start sheet load immediately so it overlaps topology download + map render.
// Uses localStorage cache so refreshes within 1 minute skip the Apps Script call.
const sheetPromise = loadSheetData();

fetch(TOPO_URL)
  .then(res => {
    if (!res.ok) throw new Error(`Map topology HTTP ${res.status}`);
    return res.json();
  })
  .then(us => {
    const { statePaths } = renderMap(us);
    mapUI.statePaths = statePaths;
    initPaletteSelector();
    const tooltip = createTooltip();
    mapUI.tooltip = tooltip;

    return sheetPromise
      .then(stateData => applySheetData(stateData, statePaths, tooltip))
      .catch(err => {
        console.error("Failed to load sheet data:", err);
        hideMapLoading();
      });
  })
  .catch(err => console.error("Failed to load map:", err));
