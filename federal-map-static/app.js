const SHEET_DATA_URL = "https://script.google.com/macros/s/AKfycbxDwWXY58ZV4Je44i7jH_T0utO2ZUR9tbBTm-xV0UHuGvMIvXSyM5z7ZmSQn_C6u01EMQ/exec";
const SHEET_CACHE_KEY = "era-federal-map-sheet-cache";
const SHEET_CACHE_TTL_MS = 60 * 1000;
const TOPO_URL = "https://static.observableusercontent.com/files/8326f37ebb0e430088bde96410bb0426ff6a71b3a592bb20987200ca00f8be73a0083b26ab17cb714ce111f936f695b96e77faffc560a0071d839e0742bb54f5";
const MAP_WIDTH = 975;
const MAP_HEIGHT = 610;
const MAP_PLACEHOLDER_FILL = "#e8e8e8";
const RATIFIED_FILL = "#2f3a72";
const RATIFIED_STATUS = "Ratified";

// Sheet column for place name (states + territories). Older exports used "State".
const PLACE_NAME_KEY = "State & Territory";
// Topology / geo-albers-usa-territories names that differ from the sheet labels.
const PLACE_NAME_ALIASES = {
  "U.S. Virgin Islands": "United States Virgin Islands",
  "Northern Mariana Islands": "Commonwealth of the Northern Mariana Islands"
};

const buildTerritoriesProjection = geoAlbersUsaTerritories.geoAlbersUsaTerritories;
const PROJECTION_SCALE = 1200;
const PROJECTION_TRANSLATE = [520, 305];
const MAP_BORDER_WIDTH = 1;

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

function isFederallyRatified(row) {
  return row && row["Federal Ratification Status"] === RATIFIED_STATUS;
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

function territoryBoxBorderSegments(rect, outerEdges) {
  const { x0, y0, x1, y1 } = rect;
  const segments = [];
  if (!outerEdges.includes("top")) segments.push([x0, y0, x1, y0]);
  if (!outerEdges.includes("bottom")) segments.push([x0, y1, x1, y1]);
  if (!outerEdges.includes("left")) segments.push([x0, y0, x0, y1]);
  if (!outerEdges.includes("right")) segments.push([x1, y0, x1, y1]);
  return segments;
}

function renderTerritoryBoxes(mapLayer, states) {
  const groups = buildTerritoryBoxGroups(states.features);
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

  renderTerritoryBoxes(mapLayer, states);

  return { statePaths };
}

function applyMapColors(statePaths, lookup) {
  statePaths.attr("fill", d => {
    const row = lookup.get(d.properties.name);
    return isFederallyRatified(row) ? RATIFIED_FILL : MAP_PLACEHOLDER_FILL;
  });
}

function hideMapLoading() {
  d3.select("#map-loading").classed("hidden", true);
}

function applySheetData(sheetData, statePaths) {
  const stateData = sheetData["State ERAs"];
  const lookup = buildPlaceLookup(stateData);
  applyMapColors(statePaths, lookup);
  hideMapLoading();
}

const sheetPromise = loadSheetData();

fetch(TOPO_URL)
  .then(res => {
    if (!res.ok) throw new Error(`Map topology HTTP ${res.status}`);
    return res.json();
  })
  .then(us => {
    const { statePaths } = renderMap(us);

    return sheetPromise
      .then(stateData => applySheetData(stateData, statePaths))
      .catch(err => {
        console.error("Failed to load sheet data:", err);
        hideMapLoading();
      });
  })
  .catch(err => console.error("Failed to load map:", err));
