/**
 * Trainingsapp — Sheet sync receiver.
 *
 * This is not run from this repo — it's the source Danny pastes into his
 * Google Sheet's own Apps Script editor and deploys as a Web App. Once
 * deployed, the resulting URL goes into the app's Sync-instellingen field
 * (Schema tab), and the app's "Sync nu" button POSTs to it.
 *
 * ONE-TIME SETUP:
 * 1. Open the "Trainingsschema" Google Sheet.
 * 2. Extensions → Apps Script.
 * 3. Delete any placeholder code, paste this whole file in.
 * 4. Deploy → New deployment → type: "Web app".
 *    - Execute as: Me
 *    - Who has access: Anyone with the link
 * 5. Copy the deployment URL (ends in /exec) into the app's Sync-instellingen
 *    field and press "Opslaan".
 *
 * What it does: appends rows to a tab called "App Log" in this same
 * spreadsheet, creating that tab (with a header row) if it doesn't exist yet.
 * Never touches the existing "Trainingslog" tab or its formulas — this is a
 * one-way, additive sync (app -> Sheet), never the other direction.
 */

const LOG_SHEET_NAME = "App Log";
const HEADERS = [
  "Datum", "Dag", "Oefening",
  "Set 1 kg", "Set 1 reps",
  "Set 2 kg", "Set 2 reps",
  "Set 3 kg", "Set 3 reps",
  "Set 4 kg", "Set 4 reps",
  "Totaal volume",
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const rows = body.rows || [];

    const sheet = getOrCreateLogSheet();
    if (rows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
    }

    return jsonResponse({ ok: true, appended: rows.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function getOrCreateLogSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(LOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
