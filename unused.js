/**
 * Archived: "States with Federal Ratification" toggle + outer outline mesh.
 * Uses sheet column "Federal Ratification Status" ("Ratified" | "Not Ratified").
 * Not loaded by the live map — kept here for reference / possible restore.
 */

/* --- HTML (place inside #map-controls, left side) ---
<div id="ratification-toggle">
  <label for="federal-ratification-toggle">
    <input type="checkbox" id="federal-ratification-toggle" />
    <span class="toggle-track" aria-hidden="true"></span>
    States with Federal Ratification
  </label>
</div>
--- */

/* --- CSS ---
.toggle-track {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
  border: 2px solid #000;
  background: #ebebeb;
  box-sizing: border-box;
  transition: background 0.2s ease;
}

.toggle-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: #000;
  transition: transform 0.2s ease;
}

#ratification-toggle input:checked + .toggle-track {
  background: #2f3a72;
}

#ratification-toggle input:checked + .toggle-track::after {
  background: #fff;
  transform: translateX(18px);
}

#ratification-toggle input:focus-visible + .toggle-track {
  outline: 2px solid #000;
  outline-offset: 2px;
}

#ratification-toggle {
  display: flex;
  align-items: center;
}

#ratification-toggle label {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: var(--font-size-lg);
  font-weight: 600;
  user-select: none;
}

#ratification-toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}
--- */

const RATIFIED_STATUS = "Ratified";
let showFederalRatification = false;

// mapUI fields used by this feature:
//   ratificationOutline, topology

function isFederallyRatified(row) {
  return row && row["Federal Ratification Status"] === RATIFIED_STATUS;
}

function isStateFullyOpaque(row) {
  if (showFederalRatification && !isFederallyRatified(row)) return false;
  if (activeFilters.size === 0) return true;
  const era = getEraType(row);
  return !!(era && activeFilters.has(era));
}

// In renderMap, after state borders, before hover outlineLayer:
function createRatificationOutlineLayer(mapLayer, us, path) {
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

function updateMapOpacityWithRatification(statePaths, lookup) {
  statePaths.attr("opacity", d => {
    return isStateFullyOpaque(lookup.get(d.properties.name)) ? 1 : 0.15;
  });
  updateRatificationOutline();
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

function initRatificationToggle(statePaths, lookup) {
  d3.select("#federal-ratification-toggle").on("change", function () {
    showFederalRatification = this.checked;
    updateMapOpacityWithRatification(statePaths, lookup);
  });
}
