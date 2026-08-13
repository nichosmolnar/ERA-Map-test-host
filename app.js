const SHEET_DATA_URL = "https://script.google.com/macros/s/AKfycbxDwWXY58ZV4Je44i7jH_T0utO2ZUR9tbBTm-xV0UHuGvMIvXSyM5z7ZmSQn_C6u01EMQ/exec";
const SHEET_CACHE_KEY = "era-map-sheet-cache";
const SHEET_CACHE_TTL_MS = 60 * 1000;
const TOPO_URL = "https://static.observableusercontent.com/files/8326f37ebb0e430088bde96410bb0426ff6a71b3a592bb20987200ca00f8be73a0083b26ab17cb714ce111f936f695b96e77faffc560a0071d839e0742bb54f5";
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
  "Limited ERA",
  "Full State ERA",
  "Expanded ERA"
];

// Ltd/Full/Expanded are unified around #209f57: Ltd = striped, Full = solid, Expanded = navy→dark green gradient
const ERA_COLORS = ["#c4c4c4", "#E36A93", "ltd-stripes", "#018a31", "expanded-gradient"];

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

const LTD_STRIPES_SENTINEL = "ltd-stripes";
const LTD_STRIPES_ID = "ltd-stripes";
const LTD_STRIPES_COLOR = "#018a31";
const LTD_STRIPES_BG_COLOR = "#c4c4c4"; // Matches the "No State ERA" grey.
const LTD_STRIPES_WIDTH = 3;
const LTD_STRIPES_GAP = 6;
const LTD_STRIPES_PERIOD = LTD_STRIPES_WIDTH + LTD_STRIPES_GAP;
const LTD_STRIPES_ANGLE = 45;
const LTD_STRIPES_CSS_PATTERN = `repeating-linear-gradient(${LTD_STRIPES_ANGLE}deg, ${LTD_STRIPES_COLOR} 0, ${LTD_STRIPES_COLOR} ${LTD_STRIPES_WIDTH}px, ${LTD_STRIPES_BG_COLOR} ${LTD_STRIPES_WIDTH}px, ${LTD_STRIPES_BG_COLOR} ${LTD_STRIPES_PERIOD}px)`;

const FILTER_ORDER = [...ERA_TYPES].reverse();

// Sheet column for place name (states + territories). Older exports used "State".
const PLACE_NAME_KEY = "State & Territory";
// Topology / geo-albers-usa-territories names that differ from the sheet labels.
const PLACE_NAME_ALIASES = {
  "U.S. Virgin Islands": "United States Virgin Islands",
  "Northern Mariana Islands": "Commonwealth of the Northern Mariana Islands"
};
// The five inhabited territories; excluded from filter category counts
// (those counts are states-only). Names match the sheet "State & Territory" column.
const TERRITORY_NAMES = new Set([
  "American Samoa",
  "Guam",
  "Northern Mariana Islands",
  "Puerto Rico",
  "U.S. Virgin Islands"
]);

const color = d3.scaleOrdinal()
  .domain(ERA_TYPES)
  .range(ERA_COLORS)
  .unknown("#f0f0f0");

const RATIFIED_STATUS = "Ratified";
let showFederalRatification = false;

const activeFilters = new Set();
const mapUI = {
  lookup: null,
  tooltip: null,
  statePaths: null,
  outlineLayer: null,
  ratificationOutline: null,
  topology: null,
  path: null,
  activeTab: "provision",
  zoomOut: null,
  isZoomed: false,
  handleFeatureClick: null,
  handleFeatureEnter: null,
  handleFeatureMove: null,
  handleFeatureLeave: null
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

function isTerritory(row) {
  const name = getPlaceName(row);
  return !!(name && TERRITORY_NAMES.has(name));
}

function countByCategory(stateData) {
  const counts = Object.fromEntries(ERA_TYPES.map(t => [t, 0]));
  stateData.forEach(d => {
    if (isTerritory(d)) return;
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

function getPlaceName(row) {
  if (!row) return null;
  return row[PLACE_NAME_KEY] || row.State || null;
}

function buildPlaceLookup(stateData) {
  const lookup = new Map();
  stateData.forEach(d => {
    const name = getPlaceName(d);
    if (!name) return;
    lookup.set(name, d);
    const alias = PLACE_NAME_ALIASES[name];
    if (alias) lookup.set(alias, d);
  });
  return lookup;
}

function getEraType(row) {
  return row ? row["State ERA type"] : null;
}

function isFederallyRatified(row) {
  return row && row["Federal Ratification Status"] === RATIFIED_STATUS;
}

function isExpandedGradient(value) {
  return value === EXPANDED_GRADIENT_SENTINEL;
}

function isLtdStripes(value) {
  return value === LTD_STRIPES_SENTINEL;
}

function svgFill(era) {
  const value = color(era);
  if (isExpandedGradient(value)) return `url(#${EXPANDED_GRADIENT_ID})`;
  if (isLtdStripes(value)) return `url(#${LTD_STRIPES_ID})`;
  return value;
}

function applySwatchBackground(selection, value) {
  if (isExpandedGradient(value)) {
    selection
      .style("background-color", null)
      .style("background-image", EXPANDED_CSS_GRADIENT);
  } else if (isLtdStripes(value)) {
    selection
      .style("background-color", null)
      .style("background-image", LTD_STRIPES_CSS_PATTERN);
  } else {
    selection
      .style("background-image", null)
      .style("background-color", value);
  }
}

function applyFilterButtonColor(selection, value) {
  let fill = value;
  if (isExpandedGradient(value)) fill = EXPANDED_CSS_GRADIENT;
  else if (isLtdStripes(value)) fill = LTD_STRIPES_CSS_PATTERN;
  selection
    .style("--btn-fill", fill)
    .style("--btn-on-fill-text", textColor(value))
    .style("background-color", null)
    .style("background-image", null)
    .style("color", null);
}

// Provided by the geo-albers-usa-territories <script> tag in index.html,
// which extends d3's Albers USA projection with insets for Puerto Rico, the
// US Virgin Islands, Guam, the Northern Mariana Islands, and American Samoa.
const buildTerritoriesProjection = geoAlbersUsaTerritories.geoAlbersUsaTerritories;
const PROJECTION_SCALE = 1200;
const PROJECTION_TRANSLATE = [520, 305];

// Matches the 1px CSS border on #map-frame (index.html) so the boxes below
// read as part of the same frame rather than a separate, thinner outline.
const MAP_BORDER_WIDTH = 1;

// Reserved inset cells for each territory grouping, expressed as fractions of
// the projection scale/translate (mirrors the offsets geo-albers-usa-territories
// uses internally to lay out its insets). `outerEdges` lists which sides face
// the edge of the map; those get pushed out flush with MAP_WIDTH/MAP_HEIGHT so
// the box border merges seamlessly with the outer frame around the whole map.
const TERRITORY_INSET_GROUPS = [
  {
    names: ["Puerto Rico", "United States Virgin Islands"],
    region: { x0: 0.3, x1: 0.38, y0: 0.204, y1: 0.234 },
    outerEdges: ["right", "bottom"]
  },
  {
    names: ["Guam", "Commonwealth of the Northern Mariana Islands"],
    region: { x0: -0.45, x1: -0.39, y0: 0.05, y1: 0.21 },
    outerEdges: ["left"]
  },
  {
    names: ["American Samoa"],
    region: { x0: -0.45, x1: -0.39, y0: 0.21, y1: 0.234 },
    outerEdges: ["left", "bottom"]
  }
];

function territoryBoxRect(region) {
  const [tx, ty] = PROJECTION_TRANSLATE;
  const k = PROJECTION_SCALE;
  return {
    x0: tx + region.x0 * k,
    x1: tx + region.x1 * k,
    y0: ty + region.y0 * k,
    y1: ty + region.y1 * k
  };
}

function extendToMapEdges(rect, outerEdges) {
  const extended = { ...rect };
  if (outerEdges.includes("left")) extended.x0 = 0;
  if (outerEdges.includes("right")) extended.x1 = MAP_WIDTH;
  if (outerEdges.includes("top")) extended.y0 = 0;
  if (outerEdges.includes("bottom")) extended.y1 = MAP_HEIGHT;
  return extended;
}

function buildTerritoryBoxGroups(features) {
  const byName = new Map(features.map(f => [f.properties.name, f]));
  return TERRITORY_INSET_GROUPS
    .map(group => ({
      outerEdges: group.outerEdges,
      features: group.names.map(name => byName.get(name)).filter(Boolean),
      rect: extendToMapEdges(territoryBoxRect(group.region), group.outerEdges)
    }))
    .filter(group => group.features.length > 0);
}

// Only the sides that don't already sit on the map's own outer edge get a
// visible line — the outer sides rely entirely on the #map-frame border
// (index.html) so there's never a second, separately-aligned line drawn
// directly on top of (or just inside) it.
function territoryBoxBorderSegments(rect, outerEdges) {
  const { x0, y0, x1, y1 } = rect;
  const segments = [];
  if (!outerEdges.includes("top")) segments.push([x0, y0, x1, y0]);
  if (!outerEdges.includes("bottom")) segments.push([x0, y1, x1, y1]);
  if (!outerEdges.includes("left")) segments.push([x0, y0, x0, y1]);
  if (!outerEdges.includes("right")) segments.push([x1, y0, x1, y1]);
  return segments;
}

// For a box covering two territories (e.g. Puerto Rico/USVI or Guam/N.
// Mariana Islands), splits the box in half along whichever axis separates
// the two territories, so hovering switches cleanly at the midpoint instead
// of following an uneven nearest-shape boundary.
function featureSplitter(features, path, rect) {
  if (features.length <= 1) {
    const only = features[0] || null;
    return () => only;
  }

  const [a, b] = features;
  const [ax, ay] = path.centroid(a);
  const [bx, by] = path.centroid(b);
  const horizontal = Math.abs(ax - bx) >= Math.abs(ay - by);

  if (horizontal) {
    const midX = (rect.x0 + rect.x1) / 2;
    const [west, east] = ax <= bx ? [a, b] : [b, a];
    return point => (point[0] <= midX ? west : east);
  }

  const midY = (rect.y0 + rect.y1) / 2;
  const [north, south] = ay <= by ? [a, b] : [b, a];
  return point => (point[1] <= midY ? north : south);
}

// Draws a border box over each territory inset (Puerto Rico/USVI,
// Guam/N. Mariana Islands, American Samoa). The tiny territory shapes are
// hard to hover precisely at this scale, so each box also acts as an
// enlarged hover/click target, split in half between the territories it
// covers so hovering one side vs. the other switches which one is active.
function renderTerritoryBoxes(mapLayer, states, path) {
  const groups = buildTerritoryBoxGroups(states.features).map(group => ({
    ...group,
    pickFeature: featureSplitter(group.features, path, group.rect)
  }));
  const boxLayer = mapLayer.append("g").attr("class", "territory-boxes");

  boxLayer.selectAll("g.territory-box-border")
    .data(groups)
    .join("g")
    .attr("class", "territory-box-border")
    .attr("pointer-events", "none")
    .each(function (d) {
      d3.select(this).selectAll("line")
        .data(territoryBoxBorderSegments(d.rect, d.outerEdges))
        .join("line")
        .attr("x1", seg => seg[0])
        .attr("y1", seg => seg[1])
        .attr("x2", seg => seg[2])
        .attr("y2", seg => seg[3])
        .attr("stroke", "#000")
        .attr("stroke-width", MAP_BORDER_WIDTH)
        .attr("vector-effect", "non-scaling-stroke");
    });

  const hitAreas = boxLayer.selectAll("rect.territory-box-hit")
    .data(groups)
    .join("rect")
    .attr("class", "territory-box-hit")
    .attr("x", d => d.rect.x0)
    .attr("y", d => d.rect.y0)
    .attr("width", d => d.rect.x1 - d.rect.x0)
    .attr("height", d => d.rect.y1 - d.rect.y0)
    .attr("fill", "transparent")
    .attr("pointer-events", "all");

  function localPoint(event) {
    return d3.pointer(event, mapLayer.node());
  }

  hitAreas
    .on("mouseenter", (event, d) => {
      const feature = d.pickFeature(localPoint(event));
      if (feature) mapUI.handleFeatureEnter?.(event, feature);
    })
    .on("mousemove", (event, d) => {
      const feature = d.pickFeature(localPoint(event));
      if (feature) mapUI.handleFeatureMove?.(event, feature);
    })
    .on("mouseleave", () => {
      mapUI.handleFeatureLeave?.();
    })
    .on("click", (event, d) => {
      event.stopPropagation();
      const feature = d.pickFeature(localPoint(event));
      if (feature) mapUI.handleFeatureClick?.(feature);
    });

  return hitAreas;
}

// Outlines the exterior perimeter of federally-ratified states (toggled via
// #federal-ratification-toggle). Kept empty/hidden until the toggle is on.
function createRatificationOutlineLayer(mapLayer, us) {
  const ratificationOutline = mapLayer.append("path")
    .attr("class", "ratification-outline")
    .attr("fill", "none")
    .attr("stroke", "#000")
    .attr("stroke-width", 2)
    .attr("stroke-linejoin", "round")
    .attr("pointer-events", "none")
    .attr("visibility", "hidden");

  mapUI.ratificationOutline = ratificationOutline;
  mapUI.topology = us;
  return ratificationOutline;
}

function updateRatificationOutline() {
  const outline = mapUI.ratificationOutline;
  const us = mapUI.topology;
  const lookup = mapUI.lookup;
  if (!outline || !us || !mapUI.path) return;

  if (!showFederalRatification || !lookup) {
    outline.attr("d", null).attr("visibility", "hidden");
    return;
  }

  // Outer perimeter only: exterior edges of opaque states, plus borders
  // between opaque and non-opaque — no shared interior borders.
  const mesh = topojson.mesh(us, us.objects.states, (a, b) => {
    const aOn = isStateFullyOpaque(lookup.get(a.properties.name));
    if (a === b) return aOn;
    const bOn = isStateFullyOpaque(lookup.get(b.properties.name));
    return aOn !== bOn;
  });

  outline
    .datum(mesh)
    .attr("d", mapUI.path)
    .attr("visibility", "visible");
}

function renderMap(us) {
  const projection = buildTerritoriesProjection()
    .scale(PROJECTION_SCALE)
    .translate(PROJECTION_TRANSLATE);
  const states = topojson.feature(us, us.objects.states);
  const borders = topojson.mesh(us, us.objects.states, (a, b) => a !== b);
  const path = d3.geoPath(projection);

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

  // The pattern's un-rotated stripes run vertically, matching CSS's
  // repeating-linear-gradient(90deg, ...) used for the buttons/swatch.
  // Subtracting 90 from LTD_STRIPES_ANGLE keeps this pattern's tilt in sync
  // with that CSS angle (they use opposite rotation conventions).
  const stripes = svg.select("defs")
    .append("pattern")
    .attr("id", LTD_STRIPES_ID)
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", LTD_STRIPES_PERIOD)
    .attr("height", LTD_STRIPES_PERIOD)
    .attr("patternTransform", `rotate(${LTD_STRIPES_ANGLE - 90})`);

  stripes.append("rect")
    .attr("width", LTD_STRIPES_PERIOD)
    .attr("height", LTD_STRIPES_PERIOD)
    .attr("fill", LTD_STRIPES_BG_COLOR);

  stripes.append("rect")
    .attr("width", LTD_STRIPES_WIDTH)
    .attr("height", LTD_STRIPES_PERIOD)
    .attr("fill", LTD_STRIPES_COLOR);

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

  createRatificationOutlineLayer(mapLayer, us);

  const outlineLayer = mapLayer.append("g").attr("class", "state-outline");
  mapUI.outlineLayer = outlineLayer;
  mapUI.path = path;

  attachZoom(svg, mapLayer, statePaths, path);
  renderTerritoryBoxes(mapLayer, states, path);

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
    selection.selectAll("a")
      .attr("target", "_blank")
      .attr("rel", "noopener noreferrer");
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
  const review = (row["Standard of Review"] || row["Federal Standard of Review"] || "").trim();
  const cases = (row["Case Law"] || row["Sex Equality Cases"] || "").trim();
  const provisionContext = (
    row["ERA Background & Context"] || row["Constitution Context"] || ""
  ).trim();

  panel.select(".state-panel-name").text(getPlaceName(row) || "");
  panel.select(".state-panel-status").text(era || "Unknown");
  applySwatchBackground(panel.select(".state-panel-swatch"), color(era));

  setPaneContent(
    panel.select('[data-pane="review"]'),
    review,
    "No standard of review information available."
  );
  setPaneContent(
    panel.select('[data-pane="cases"]'),
    cases,
    "No case law available."
  );
  setPaneContent(
    panel.select('[data-pane="provision"]'),
    provisionContext,
    "No ERA background available."
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

function isStateFullyOpaque(row) {
  if (showFederalRatification && !isFederallyRatified(row)) return false;
  if (activeFilters.size === 0) return true;
  const era = getEraType(row);
  return !!(era && activeFilters.has(era));
}

function updateMapOpacity(statePaths, lookup) {
  statePaths.attr("opacity", d => isStateFullyOpaque(lookup.get(d.properties.name)) ? 1 : 0.15);
  updateRatificationOutline();
}

function showMapControls() {
  d3.select("#map-controls")
    .classed("ready", true)
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

  const refresh = () => {
    root.selectAll("button.filter-btn")
      .classed("active", d => activeFilters.has(d));
    updateMapOpacity(statePaths, lookup);
  };

  const buttons = root.selectAll("button.filter-btn")
    .data(FILTER_ORDER)
    .join("button");
  bindFilterButtons(buttons, counts, refresh);

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

  const hover = (row.HOVER || "").trim();

  tooltip.html(`
    <div class="tooltip-name">${getPlaceName(row) || ""}</div>
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

  function handleFeatureClick(d) {
    if (zoomedState) {
      zoomOut();
      return;
    }
    zoomIn(d);
  }

  statePaths.on("click", (event, d) => {
    event.stopPropagation();
    handleFeatureClick(d);
  });

  svg.on("click", () => {
    if (zoomedState) zoomOut();
  });

  mapUI.zoomOut = zoomOut;
  mapUI.handleFeatureClick = handleFeatureClick;
}

function attachTooltip(statePaths, lookup, tooltip) {
  // Tracks whichever feature is currently outlined/tooltipped. A territory
  // box is a single DOM element covering multiple territories, so moving
  // from one half to the other only fires "mousemove" (no fresh
  // "mouseenter") — the outline needs to react there too whenever the
  // hovered feature actually changes.
  let hoveredFeature = null;

  function setHoveredFeature(d) {
    hoveredFeature = d;
    if (!mapUI.isZoomed) setStateOutline(d);
  }

  function handleFeatureEnter(event, d) {
    if (isMobileLayout()) return;
    setHoveredFeature(d);
    showTooltip(tooltip, event, lookup.get(d.properties.name));
  }

  function handleFeatureMove(event, d) {
    if (isMobileLayout()) return;
    if (d !== hoveredFeature) setHoveredFeature(d);
    showTooltip(tooltip, event, lookup.get(d.properties.name));
  }

  function handleFeatureLeave() {
    if (isMobileLayout()) return;
    hoveredFeature = null;
    if (!mapUI.isZoomed) setStateOutline(null);
    hideTooltip(tooltip);
  }

  statePaths
    .on("click.zoom", () => hideTooltip(tooltip))
    .on("mouseenter", handleFeatureEnter)
    .on("mousemove", handleFeatureMove)
    .on("mouseleave", handleFeatureLeave);

  d3.select("#map").on("mouseleave", () => {
    if (isMobileLayout()) return;
    if (!mapUI.isZoomed) setStateOutline(null);
    hideTooltip(tooltip);
  });

  mapUI.handleFeatureEnter = handleFeatureEnter;
  mapUI.handleFeatureMove = handleFeatureMove;
  mapUI.handleFeatureLeave = handleFeatureLeave;
}

function initRatificationToggle(statePaths, lookup) {
  d3.select("#federal-ratification-toggle").on("change", function () {
    showFederalRatification = this.checked;
    updateMapOpacity(statePaths, lookup);
  });
}

function hideMapLoading() {
  d3.select("#map-loading").classed("hidden", true);
}

function applySheetData(sheetData, statePaths, tooltip) {
  console.log("Sheet data:", sheetData);

  const stateData = sheetData["State ERAs"];
  const lookup = buildPlaceLookup(stateData);
  const counts = countByCategory(stateData);

  mapUI.lookup = lookup;
  mapUI.tooltip = tooltip;

  applyMapColors(statePaths, lookup);
  renderFilters(counts, statePaths, lookup);
  attachTooltip(statePaths, lookup, tooltip);
  initRatificationToggle(statePaths, lookup);
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
