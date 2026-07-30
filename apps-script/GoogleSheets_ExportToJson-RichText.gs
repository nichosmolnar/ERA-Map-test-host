/**
 * Serves the State ERAs tab as JSON for the ERA map.
 *
 * Most cells are exported as plain strings via getValues().
 * Only these columns keep Google Sheets rich-text formatting as HTML
 * (<strong>, <em>, <u>, <s>, <a>):
 *   - Constitution Context
 *   - Sex Equality Cases
 *   - Federal Standard of Review
 *
 * Output shape:
 * {
 *   "State ERAs": [ { "State": "Alabama", "Sex Equality Cases": "<em>…</em>", … }, … ]
 * }
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
  "Constitution Context": true,
  "Sex Equality Cases": true,
  "Federal Standard of Review": true
};

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

  // TWO API calls total: one for plain values, one for all rich text.
  // Previously: one getValues() + one getRichTextValues() per rich-text column.
  const plainValues    = range.getValues();
  const richTextValues = range.getRichTextValues();

  const headers = plainValues[0];

  // Build a Set of column indices that need rich-text processing
  const richColIndices = new Set(
    headers
      .map((h, i) => RICH_TEXT_COLUMNS[h] ? i : null)
      .filter(i => i !== null)
  );

  const items = plainValues
    .slice(1) // skip header row
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => row.some(cell => cell !== "")) // skip blank rows
    .map(({ row, rowIndex }) => {
      const item = {};
      const richRow = richTextValues[rowIndex + 1]; // +1 to skip header
      headers.forEach((key, i) => {
        item[key] = richColIndices.has(i)
          ? richTextToHtml(richRow[i])
          : row[i];
      });
      return item;
    });

  return jsonpOrJson(e, { [STATE_ERAS_SHEET]: items });
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
