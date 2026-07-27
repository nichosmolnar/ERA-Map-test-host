/**
 * Serves ALL tabs in the spreadsheet as JSON.
 * Each tab becomes a key in the top-level object.
 * Each row in a tab becomes an object with column headers as keys.
 *
 * Output shape:
 * {
 *   "Sheet1": [ { "State": "Alabama", ... }, ... ],
 *   "Sources": [ { "Citation": "...", ... }, ... ]
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
function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets(); // all tabs, in left-to-right order

  const result = {};

  sheets.forEach(sheet => {
    const values = sheet.getDataRange().getValues();
    if (values.length === 0) return; // skip empty tabs

    const headers = values[0];
    const rows = values.slice(1);

    result[sheet.getName()] = rows
      .filter(row => row.some(cell => cell !== "")) // skip blank rows
      .map(row => {
        const item = {};
        headers.forEach((key, i) => {
          item[key] = row[i];
        });
        return item;
      });
  });

  const output = JSON.stringify(result);
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
