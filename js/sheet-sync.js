import * as storage from "./storage.js";

// One-way sync: app -> Google Sheet, via an Apps Script Web App bridge Danny
// deploys himself (see sheet-sync/AppsScript.gs). Never reads from the Sheet,
// never touches the existing "Trainingslog" tab — only appends new rows to a
// dedicated "App Log" tab. Manual trigger only (no background sync).

const URL_KEY = "trainingsapp.syncUrl";
const LAST_SYNCED_KEY = "trainingsapp.lastSyncedAt";

export function getSyncUrl() {
  return localStorage.getItem(URL_KEY) || "";
}

export function setSyncUrl(url) {
  localStorage.setItem(URL_KEY, url.trim());
}

function getLastSyncedAt() {
  return localStorage.getItem(LAST_SYNCED_KEY) || new Date(0).toISOString();
}

function setLastSyncedAt(iso) {
  localStorage.setItem(LAST_SYNCED_KEY, iso);
}

// Fixed at 4 to match the Apps Script's fixed column layout (Set 1-4 kg/reps),
// same as every exercise's default set count in this app. Padded/truncated so
// a session with a different set count still produces a well-formed row.
const ROW_SET_COLUMNS = 4;

function entryToRow(session, entry) {
  const dateLabel = new Date(session.date).toLocaleDateString("nl-NL");
  const setCells = [];
  for (let i = 0; i < ROW_SET_COLUMNS; i++) {
    const set = entry.sets[i];
    setCells.push(set ? set.weight : "", set ? set.reps : "");
  }
  // Rounded to avoid floating-point noise (e.g. 6.8 * 10 = 67.99999999999999).
  const volume = Math.round(entry.sets.reduce((sum, s) => sum + s.weight * s.reps, 0) * 10) / 10;
  return [dateLabel, session.dayName, entry.exerciseName, ...setCells, volume];
}

// Returns { ok: true, count } on success, { ok: false, message } on failure.
// Never advances lastSyncedAt on failure, so a failed sync retries the same
// sessions next time rather than silently losing them.
export async function syncNow() {
  const url = getSyncUrl();
  if (!url) {
    return { ok: false, message: "Vul eerst je Apps Script webapp-URL in." };
  }

  const lastSyncedAt = getLastSyncedAt();
  const sessions = (await storage.getSessions())
    .filter((s) => new Date(s.date) > new Date(lastSyncedAt))
    .reverse(); // oldest-first, so rows land in the Sheet in chronological order

  const rows = [];
  for (const session of sessions) {
    for (const entry of session.entries) {
      rows.push(entryToRow(session, entry));
    }
  }

  if (!rows.length) {
    return { ok: true, count: 0, message: "Niets nieuws om te syncen." };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ rows }),
    });
    if (!response.ok) {
      return { ok: false, message: `Sync mislukt (server antwoordde ${response.status}).` };
    }

    // A 200 status alone doesn't prove the Apps Script actually ran: a wrong
    // or undeployed URL can still return 200 with an HTML error page instead
    // of the JSON our own AppsScript.gs sends back. Only trust a response
    // that actually parses as JSON and says { ok: true }.
    let payload;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, message: "Sync mislukt: geen geldig antwoord van de webapp. Klopt de URL, en staat de webapp op 'Anyone with the link'?" };
    }
    if (!payload.ok) {
      return { ok: false, message: `Sync mislukt: ${payload.error || "onbekende fout in de Apps Script."}` };
    }

    setLastSyncedAt(new Date().toISOString());
    return { ok: true, count: rows.length, message: `${rows.length} regels gesynchroniseerd.` };
  } catch (err) {
    return { ok: false, message: `Sync mislukt: ${err.message}. Klopt de URL en is de webapp gedeployed?` };
  }
}
