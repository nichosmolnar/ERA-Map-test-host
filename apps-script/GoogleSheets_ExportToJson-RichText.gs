/**
 * Serves the State ERAs tab as JSON for the ERA map.
 *
 * Most cells are exported as plain strings via getValues().
 * Only these columns keep Google Sheets rich-text formatting as HTML
 * (<strong>, <em>, <u>, <s>, <a>):
 *   - ERA Background & Context
 *   - Case Law
 *   - Standard of Review
 *
 * Output shape:
 * {
 *   "State ERAs": [ { "State & Territory": "Alabama", "Case Law": "<em>…</em>", … }, … ]
 * }
 *
 * Perf notes:
 *   getRichTextValues() is much more expensive per-cell than getValues() (it has to
 *   walk every formatting run), so it's only ever called on the specific rich-text
 *   columns above, never the whole sheet. On top of that, the fully-built JSON is
 *   cached in CacheService for CACHE_TTL_SECONDS so repeat requests skip touching the
 *   spreadsheet entirely — this is what makes cold Apps Script executions fast. After
 *   editing the sheet, run clearEraCache() from the Apps Script editor (Run menu) to
 *   see changes immediately instead of waiting for the cache to expire.
 *
 * Deploy as a Web App:
 *   Deploy > New deployment > Web app
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * After changing the script or access settings, create a NEW deployment (or "Manage deployments"
 * > edit > New version) — updating the code alone does not update the live /exec URL.

 *
 * Test in browser (should show JSON, not "Access Denied"):
 *   https://YOUR_DEPLOYMENT_ID/exec?callback=test
 */

var STATE_ERAS_SHEET = "State ERAs";

/** Columns that should preserve sheet bold/italic/etc. as HTML. */
var RICH_TEXT_COLUMNS = {
  "ERA Background & Context": true,
  "Case Law": true,
  "Standard of Review": true
};

/**
 * How long the built JSON is cached server-side (CacheService), in seconds.
 * Max allowed by CacheService is 21600 (6 hours). Bump this up if the sheet
 * changes rarely, or call clearEraCache() manually after edits for an
 * immediate refresh instead of relying on this expiring.
 */
var CACHE_TTL_SECONDS = 5 * 60;

/** CacheService values are capped at 100KB each, so large JSON is split into chunks. */
var CACHE_KEY_PREFIX = "eraJson_";
var CACHE_CHUNK_SIZE = 90 * 1024;

function readEraCache() {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(CACHE_KEY_PREFIX + "meta");
  if (!meta) return null;

  const chunkCount = Number(meta);
  const keys = [];
  for (let i = 0; i < chunkCount; i++) keys.push(CACHE_KEY_PREFIX + i);

  const found = cache.getAll(keys);
  if (Object.keys(found).length !== chunkCount) return null; // partially expired

  try {
    return JSON.parse(keys.map(k => found[k]).join(""));
  } catch (err) {
    return null;
  }
}

function writeEraCache(result) {
  const json = JSON.stringify(result);
  const chunks = [];
  for (let i = 0; i < json.length; i += CACHE_CHUNK_SIZE) {
    chunks.push(json.slice(i, i + CACHE_CHUNK_SIZE));
  }

  const payload = { [CACHE_KEY_PREFIX + "meta"]: String(chunks.length) };
  chunks.forEach((chunk, i) => { payload[CACHE_KEY_PREFIX + i] = chunk; });

  CacheService.getScriptCache().putAll(payload, CACHE_TTL_SECONDS);
}

/** Run manually (Apps Script editor > Run) after editing the sheet to force fresh data immediately. */
function clearEraCache() {
  const cache = CacheService.getScriptCache();
  const meta = cache.get(CACHE_KEY_PREFIX + "meta");
  if (!meta) return;

  const chunkCount = Number(meta);
  const keys = [CACHE_KEY_PREFIX + "meta"];
  for (let i = 0; i < chunkCount; i++) keys.push(CACHE_KEY_PREFIX + i);
  cache.removeAll(keys);
}

/**
 * Converts a RichTextValue cell into an HTML string.
 * Handles bold, italic, underline, and strikethrough per text run.
 * If the cell has no formatting at all, returns the plain string directly.
 */
function richTextToHtml(richText) {
  if (!richText) return "";

  const runs = richText.getRuns();

  // Single unformatted run — skip HTML entirely
  if (runs.length === 1) {
    const style = runs[0].getTextStyle();
    if (!style.isBold() && !style.isItalic() && !style.isUnderline() && !style.isStrikethrough()) {
      return richText.getText();
    }
  }

  return runs.map(run => {
    const text = run.getText();
    if (!text) return "";

    const style = run.getTextStyle();
    const url   = run.getLinkUrl();

    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Apply inline formatting — order matters for valid nesting
    if (style.isStrikethrough()) html = `<s>${html}</s>`;
    if (style.isUnderline())     html = `<u>${html}</u>`;
    if (style.isItalic())        html = `<em>${html}</em>`;
    if (style.isBold())          html = `<strong>${html}</strong>`;
    if (url)                     html = `<a href="${url}">${html}</a>`;

    return html;
  }).join("");
}

function doGet(e) {
  const skipCache = e && e.parameter && String(e.parameter.nocache) === "1";
  if (!skipCache) {
    const cached = readEraCache();
    if (cached) {
      return jsonpOrJson(e, cached);
    }
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(STATE_ERAS_SHEET);
  if (!sheet) {
    throw new Error('"' + STATE_ERAS_SHEET + '" sheet not found');
  }

  const range = sheet.getDataRange();
  const numRows = range.getNumRows();
  const numCols = range.getNumColumns();

  if (numRows === 0 || numCols === 0) {
    return jsonpOrJson(e, { [STATE_ERAS_SHEET]: [] });
  }

  const plainValues = range.getValues();
  // Trim headers so trailing spaces in the sheet don't silently disable rich text.
  const headers = plainValues[0].map(h => String(h || "").trim());
  const numDataRows = numRows - 1;

  // Only fetch rich text for the specific columns that need it (see RICH_TEXT_COLUMNS).
  // getRichTextValues() is per-cell expensive, so pulling it for every column instead
  // of just these ~3 was a major source of slow load times.
  const richColIndices = headers
    .map((h, i) => RICH_TEXT_COLUMNS[h] ? i : null)
    .filter(i => i !== null);

  const richTextByCol = {}; // colIndex -> array of RichTextValue, one per data row
  if (numDataRows > 0) {
    richColIndices.forEach(colIndex => {
      richTextByCol[colIndex] = sheet
        .getRange(2, colIndex + 1, numDataRows, 1)
        .getRichTextValues()
        .map(r => r[0]);
    });
  }

  const items = plainValues
    .slice(1) // skip header row
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => row.some(cell => cell !== "")) // skip blank rows
    .map(({ row, rowIndex }) => {
      const item = {};
      headers.forEach((key, i) => {
        item[key] = richTextByCol[i]
          ? richTextToHtml(richTextByCol[i][rowIndex])
          : row[i];
      });
      return item;
    });

  const result = {
    [STATE_ERAS_SHEET]: items,
    // Lets you confirm the live deployment matched the expected rich-text columns.
    _meta: {
      richTextColumnsMatched: richColIndices.map(i => headers[i])
    }
  };
  if (!skipCache) writeEraCache(result);
  return jsonpOrJson(e, result);
}

function jsonpOrJson(e, result) {
  const output   = JSON.stringify(result);
  const callback = e && e.parameter && e.parameter.callback;

  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + output + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON);
}
