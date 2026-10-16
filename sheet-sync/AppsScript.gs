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
 *
 * VERSION 2 (RIR + cardio). Updating from version 1: paste this file over the
 * old code, then Deploy → Manage deployments → edit (pencil) → Version: "New
 * version" → Deploy. The URL stays the same. Existing rows are never changed:
 *  - "App Log" gets one extra column on the right, "RIR laatste set", filled
 *    for newly synced rows only (older rows simply leave it empty);
 *  - cardio goes to a separate "App Cardio" tab, created on first use.
 * The app also still works with version 1 — it then syncs the 12 classic
 * columns and tells you RIR/cardio were skipped.
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
// Columns after HEADERS. Only ever appended to the right of existing ones.
const EXTRA_HEADERS = ["RIR laatste set"];
const CARDIO_SHEET_NAME = "App Cardio";
const CARDIO_HEADERS = ["Datum", "Dag", "Minuten", "Helling %", "Snelheid km/u"];
const SCRIPT_VERSION = 2;

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const rows = body.rows || [];
    const extra = body.extra || [];
    const cardioRows = body.cardioRows || [];

    const sheet = getOrCreateLogSheet();
    if (rows.length) {
      ensureExtraHeaders(sheet);
      const width = HEADERS.length + EXTRA_HEADERS.length;
      // Every row padded/truncated to exactly `width` cells, so a missing or
      // short `extra` entry can never shift data into the wrong column.
      const values = rows.map((row, i) => {
        const cells = row.slice(0, HEADERS.length);
        while (cells.length < HEADERS.length) cells.push("");
        const more = (extra[i] || []).slice(0, EXTRA_HEADERS.length);
        while (more.length < EXTRA_HEADERS.length) more.push("");
        return cells.concat(more);
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, values.length, width).setValues(values);
    }

    if (cardioRows.length) {
      const cardioSheet = getOrCreateSheet(CARDIO_SHEET_NAME, CARDIO_HEADERS);
      const values = cardioRows.map((row) => {
        const cells = row.slice(0, CARDIO_HEADERS.length);
        while (cells.length < CARDIO_HEADERS.length) cells.push("");
        return cells;
      });
      cardioSheet.getRange(cardioSheet.getLastRow() + 1, 1, values.length, CARDIO_HEADERS.length).setValues(values);
    }

    return jsonResponse({ ok: true, appended: rows.length, cardio: cardioRows.length, version: SCRIPT_VERSION });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function getOrCreateLogSheet() {
  return getOrCreateSheet(LOG_SHEET_NAME, HEADERS);
}

function getOrCreateSheet(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

// Writes a header for each new column only if that header cell is empty —
// never overwrites anything already in the sheet.
function ensureExtraHeaders(sheet) {
  EXTRA_HEADERS.forEach((header, i) => {
    const cell = sheet.getRange(1, HEADERS.length + 1 + i);
    if (cell.getValue() === "") cell.setValue(header);
  });
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
