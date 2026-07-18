const SHEET_DATA_URL = "https://script.google.com/macros/s/AKfycbz78SJdxcvR4p7zjgKB8xyB4MF85pifCbUPB0Q_YpyCajKDDK4PVwehDkF64M4HesHbIg/exec";
const TOPO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json";
const MAP_WIDTH = 975;
const MAP_HEIGHT = 610;
const PANEL_WIDTH_RATIO = 1 / 3;
const MAP_PLACEHOLDER_FILL = "#e8e8e8";
const ZOOM_DURATION = 750;

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
  current: ["#c4c4c4", "#ffb239", "#46a0d6", "#2f3a72", "#209f57"],
  option1: ["#F5ECC2", "#B7C2A9", "#D6B43E", "#064F6E", "#C53C69"],
  option2: ["#E4E4E4", "#C19F2C", "#C3CD9D", "#437742", "#0D1C43"],
  option3: ["#A8A8A8", "#FDBF68", "#C16B27", "#A5C8D1", "#064F6E"],
  option4: ["#EEEEEE", "#004F46", "#FFDD00", "#78CDD0", "#004F46"],
  option5: ["#c4c4c4", "#E36A93", "#78CDD0", "#209f57", "rainbow"],

};

const RAINBOW_SENTINEL = "rainbow";
const RAINBOW_GRADIENT_ID = "rainbow-gradient";
const RAINBOW_STOPS = [
  { offset: "0%", color: "#e05c5c" },
  { offset: "20%", color: "#e89a4e" },
  { offset: "40%", color: "#e6d05a" },
  { offset: "60%", color: "#5fb877" },
  { offset: "80%", color: "#5a8fd6" },
  { offset: "100%", color: "#9a6bc9" }
];
const RAINBOW_CSS_GRADIENT = `linear-gradient(135deg, ${RAINBOW_STOPS.map(s => `${s.color} ${s.offset}`).join(", ")})`;

const PALETTE_LABELS = {
  current: "Current",
  option1: "Option 1",
  option2: "Option 2",
  option3: "Option 3",
  option4: "Option 4",
  option5: "Option 5"
};

let activePaletteKey = "current";

const FILTER_BUTTON_ORDER = [...ERA_TYPES].reverse();

const color = d3.scaleOrdinal()
  .domain(ERA_TYPES)
  .range(COLOR_PALETTES.current)
  .unknown("#f0f0f0");

const activeFilters = new Set();
const mapUI = { lookup: null, tooltip: null, statePaths: null, activeTab: "review", zoomOut: null, isZoomed: false };

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

function countByCategory(stateData) {
  const counts = Object.fromEntries(ERA_TYPES.map(t => [t, 0]));
  stateData.forEach(d => {
    const type = d["State ERA type"];
    if (type in counts) counts[type] += 1;
  });
  return counts;
}

function textColor(hex) {
  // The rainbow gradient is light overall, so use dark text for non-hex values.
  if (!hex || !hex.startsWith("#")) return "#222";
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#222" : "#fff";
}

function getEraType(row) {
  return row ? row["State ERA type"] : null;
}

function isRainbow(value) {
  return value === RAINBOW_SENTINEL;
}

function svgFill(era) {
  const value = color(era);
  return isRainbow(value) ? `url(#${RAINBOW_GRADIENT_ID})` : value;
}

function applySwatchBackground(selection, value) {
  if (isRainbow(value)) {
    selection
      .style("background-color", null)
      .style("background-image", RAINBOW_CSS_GRADIENT);
  } else {
    selection
      .style("background-image", null)
      .style("background-color", value);
  }
}

function swatchStyle(value) {
  return isRainbow(value)
    ? `background-image:${RAINBOW_CSS_GRADIENT}`
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
    .attr("id", RAINBOW_GRADIENT_ID)
    .attr("x1", "0%")
    .attr("y1", "0%")
    .attr("x2", "100%")
    .attr("y2", "100%");

  gradient.selectAll("stop")
    .data(RAINBOW_STOPS)
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
    .attr("fill", "none")
    .attr("stroke", "#fff")
    .attr("stroke-linejoin", "round")
    .attr("d", path);

  attachZoom(svg, mapLayer, statePaths, path);

  return { statePaths, svg };
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

function setPaneContent(selection, text, emptyMessage) {
  selection.selectAll("*").remove();
  if (text) {
    selection.text(text);
  } else {
    selection.append("em").text(emptyMessage);
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
  panel.select('[data-pane="review"]').selectAll("*").remove();
  panel.select('[data-pane="cases"]').selectAll("*").remove();
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
      applySwatchBackground(d3.select(this), color(d));
    })
    .style("color", d => textColor(color(d)));

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

function renderFilters(counts, statePaths, lookup) {
  const filters = d3.select("#filters")
    .selectAll("button")
    .data(FILTER_BUTTON_ORDER)
    .join("button")
    .attr("class", "filter-btn")
    .attr("type", "button")
    .attr("aria-hidden", null)
    .each(function (d) {
      applySwatchBackground(d3.select(this), color(d));
    })
    .style("color", d => textColor(color(d)))
    .classed("active", d => activeFilters.has(d))
    .classed("filter-btn--placeholder", false)
    .on("click", (_, category) => {
      if (activeFilters.has(category)) {
        activeFilters.delete(category);
      } else {
        activeFilters.add(category);
      }
      filters.classed("active", d => activeFilters.has(d));
      updateMapOpacity(statePaths, lookup);
    });

  filters.html(d => `
    <span class="label">${d}</span>
    <span class="count">${counts[d]} state${counts[d] === 1 ? "" : "s"}</span>
  `);
}

function createTooltip() {
  return d3.select("#map-frame")
    .append("div")
    .attr("class", "tooltip");
}

function showTooltip(tooltip, event, row) {
  if (!row || mapUI.isZoomed || d3.select("#state-panel").classed("visible")) {
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
    showStatePanel(row);
    zoomToState(mapLayer, path, d, true);
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
      showTooltip(tooltip, event, lookup.get(d.properties.name));
    })
    .on("mousemove", (event, d) => {
      showTooltip(tooltip, event, lookup.get(d.properties.name));
    })
    .on("mouseleave", () => {
      hideTooltip(tooltip);
    });

  d3.select("#map").on("mouseleave", () => hideTooltip(tooltip));
}

function hideMapLoading() {
  d3.select("#map-loading").classed("hidden", true);
}

function renderDatasetButtons(sheetData, activeName) {
  d3.select("#dataset-buttons")
    .selectAll("button")
    .data(Object.keys(sheetData))
    .join("button")
    .attr("class", "dataset-btn")
    .attr("type", "button")
    .classed("active", d => d === activeName)
    .text(d => d);
}

function applySheetData(sheetData, statePaths, tooltip) {
  console.log("Sheet data:", sheetData);

  const stateData = sheetData["State ERAs"];
  renderDatasetButtons(sheetData, "State ERAs");
  const lookup = new Map(stateData.map(d => [d.State, d]));
  const counts = countByCategory(stateData);

  mapUI.lookup = lookup;
  mapUI.tooltip = tooltip;

  applyMapColors(statePaths, lookup);
  renderFilters(counts, statePaths, lookup);
  attachTooltip(statePaths, lookup, tooltip);
  hideMapLoading();
}

initStatePanel();

// Start sheet fetch immediately so it overlaps topology download + map render.
const sheetPromise = fetchSheetJsonp(SHEET_DATA_URL);

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
