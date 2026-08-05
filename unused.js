/**
 * Archived: color palette switcher + alternate palette options.
 * Not loaded by the live map — kept here for reference / possible restore.
 *
 * Note: the Federal Ratification toggle previously archived here has been
 * restored into app.js / index.html.
 */

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
