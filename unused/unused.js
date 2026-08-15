/**
 * Archived snippets. Not loaded by the live map — kept for reference / restore.
 *
 * Note: the Federal Ratification toggle previously archived here has been
 * restored into app.js / index.html.
 */

/* ==========================================================================
 * Hover-split ERA filter group
 * Unified "States with Equal Rights Amendments (ERA)" bar that split into
 * Limited / Full / Expanded filter buttons on hover.
 * ========================================================================== */

const ERA_PROTECTION_TYPES = [
  "Limited ERA",
  "Full State ERA",
  "Expanded ERA"
];
const PROTECTION_FILTER_ORDER = [...ERA_PROTECTION_TYPES].reverse();
const OUTER_FILTER_ORDER = ["Ongoing Campaign", "No State ERA"];
const FILTER_GROUP_LABEL = "States with Equal Rights Amendments (ERA)";

function renderFiltersWithSplitGroup(counts, statePaths, lookup) {
  const root = d3.select("#filters");

  let group = root.select(".filter-group");
  if (group.empty()) {
    group = root.insert("div", ":first-child")
      .attr("class", "filter-group")
      .attr("role", "group")
      .attr("aria-label", FILTER_GROUP_LABEL);
    group.append("div")
      .attr("class", "filter-group-toggle")
      .attr("aria-hidden", "true");
    group.append("div").attr("class", "filter-group-buttons");
  }

  const protectionTotal = ERA_PROTECTION_TYPES.reduce((sum, t) => sum + (counts[t] || 0), 0);
  group.select(".filter-group-toggle")
    .classed("filter-group-toggle--placeholder", false)
    .html(`
      <span class="label">${FILTER_GROUP_LABEL}</span>
      <span class="count">${protectionTotal}</span>
    `);

  const refresh = () => {
    root.selectAll("button.filter-btn")
      .classed("active", d => activeFilters.has(d));
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

  refresh();
}

/* --- HTML (place inside #filters) ---
<div class="filter-group" role="group" aria-label="States with Equal Rights Amendments (ERA)">
  <div class="filter-group-toggle filter-group-toggle--placeholder" aria-hidden="true"><span class="label">&nbsp;</span><span class="count">&nbsp;</span></div>
  <div class="filter-group-buttons">
    <button type="button" class="filter-btn filter-btn--placeholder" aria-hidden="true"><span class="label">&nbsp;</span><span class="count">&nbsp;</span></button>
    <button type="button" class="filter-btn filter-btn--placeholder" aria-hidden="true"><span class="label">&nbsp;</span><span class="count">&nbsp;</span></button>
    <button type="button" class="filter-btn filter-btn--placeholder" aria-hidden="true"><span class="label">&nbsp;</span><span class="count">&nbsp;</span></button>
  </div>
</div>
--- */

/* --- CSS ---
.filter-group {
  position: relative;
  min-width: 0;
  box-sizing: border-box;
}

.filter-group-toggle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  box-sizing: border-box;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid #000;
  background: #209f57;
  color: #fff;
  font-family: inherit;
  font-size: var(--font-size-lg);
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: 0.02em;
  text-align: left;
  pointer-events: none;
  opacity: 1;
  transform: scaleX(1);
  transition: opacity 0.2s ease, transform 0.2s ease;
  z-index: 1;
}

.filter-group-toggle .label {
  min-width: 0;
}

.filter-group-toggle .count {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75em;
  height: 1.75em;
  border-radius: 50%;
  background: #fff;
  color: #000;
  font-size: var(--font-size-sm);
  font-weight: 600;
  line-height: 1;
}

.filter-group-toggle--placeholder {
  background: #ebebeb;
  color: #222;
  border-color: transparent;
}

.filter-group-toggle--placeholder .count {
  background: #ccc;
  color: #ccc;
}

.filter-group-buttons {
  display: flex;
  flex-wrap: nowrap;
  gap: 8px;
  align-items: stretch;
  opacity: 0;
  transform: scaleX(0.96);
  pointer-events: none;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.filter-group:not(:has(.filter-group-toggle--placeholder)):hover .filter-group-toggle,
.filter-group:not(:has(.filter-group-toggle--placeholder)):focus-within .filter-group-toggle {
  opacity: 0;
  transform: scaleX(0.96);
}

.filter-group:not(:has(.filter-group-toggle--placeholder)):hover .filter-group-buttons,
.filter-group:not(:has(.filter-group-toggle--placeholder)):focus-within .filter-group-buttons {
  opacity: 1;
  transform: scaleX(1);
  pointer-events: auto;
}

@media (max-width: 700px) {
  .filter-group {
    width: 100%;
  }

  .filter-group-buttons {
    flex-direction: column;
  }
}
--- */

/* ==========================================================================
 * Color palette switcher + alternate palette options
 * ========================================================================== */

/* --- HTML (place inside #map-controls, right side) ---
<div id="palette-selector">
  <label for="palette-select">Color palette</label>
  <select id="palette-select" aria-label="Color palette"></select>
</div>
--- */

/* --- CSS ---
#palette-selector {
  text-align: right;
  font-size: var(--font-size-base);
}

#palette-selector label {
  margin-right: 8px;
}

#palette-select {
  font-family: inherit;
  font-size: var(--font-size-base);
  padding: 4px 8px;
}

#map-controls {
  justify-content: space-between;
}
--- */

const COLOR_PALETTES = {
  // Ltd/Full/Expanded are unified around #209f57: Ltd = striped, Full = solid, Expanded = navy→dark green gradient
  current: ["#c4c4c4", "#E36A93", "ltd-stripes", "#209f57", "expanded-gradient"],
  option1: ["#F5ECC2", "#B7C2A9", "#D6B43E", "#064F6E", "#C53C69"],
  option2: ["#E4E4E4", "#C19F2C", "#C3CD9D", "#437742", "#0D1C43"],
  option3: ["#A8A8A8", "#FDBF68", "#C16B27", "#A5C8D1", "#064F6E"],
  option4: ["#EEEEEE", "#004F46", "#FFDD00", "#78CDD0", "#004F46"],
  option5: ["#c4c4c4", "#E36A93", "ltd-stripes", "#209f57", "expanded-gradient"],
};

const PALETTE_LABELS = {
  current: "Current",
  option1: "Option 1",
  option2: "Option 2",
  option3: "Option 3",
  option4: "Option 4",
  option5: "Option 5"
};

let activePaletteKey = "current";

// Live map uses a single fixed range instead:
//   const ERA_COLORS = COLOR_PALETTES.current;
//   color.range(ERA_COLORS)

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

// Call after renderMap():
//   initPaletteSelector();
