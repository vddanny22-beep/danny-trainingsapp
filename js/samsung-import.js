import * as storage from "./storage.js";

// Import steps and body weight from a Samsung Health export (Galaxy Watch /
// phone). A web app can't talk to Samsung Health directly — that needs a
// native Android app — but Samsung Health can export everything as CSV:
// Samsung Health → ⋮ → Instellingen → "Persoonlijke gegevens downloaden".
// That writes a folder (Download/Samsung Health/...) with one CSV per data
// type; the user picks the relevant files here.
//
// Samsung doesn't document the format, so this parser is deliberately
// tolerant:
//  - the first line is metadata ("com.samsung.shealth.step_daily_trend,...")
//    and is skipped; the header is the first line that names a known column;
//  - columns are matched on the part after the last dot, so both "count" and
//    "com.samsung.shealth.step_daily_trend.count" work;
//  - the file type is recognised from its file name OR that metadata line.
// Nothing is written until the user has seen what was found and confirms.
// The import only adds/updates: steps per day (protein stays), and weight
// entries with a stable id, so importing the same export twice is harmless.

// --- CSV --------------------------------------------------------------------

// Quote-aware split of one CSV line ("a","b,c" → [a, "b,c"]).
export function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { cells.push(cell); cell = ""; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}

const shortName = (column) => column.trim().toLowerCase().split(".").pop();

// Returns { metaLine, rows: [{ column: value }] } or null when the header
// can't be found. The header is recognised by a column that must be in it
// (e.g. "day_time") — not by the data name, because the metadata line above
// it ("com.samsung.health.weight,...") would match that too.
function parseTable(text, requiredColumn) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerIndex = lines.findIndex((line, i) => i < 5 && splitCsvLine(line).map(shortName).includes(requiredColumn));
  if (headerIndex === -1) return null;
  const header = splitCsvLine(lines[headerIndex]).map(shortName);
  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((name, i) => { if (name && !(name in row)) row[name] = (cells[i] ?? "").trim(); });
    rows.push(row);
  }
  return { metaLine: lines[0] || "", rows };
}

// --- dates ------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");
const utcKey = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

// "UTC+0100" / "UTC-05:30" → minutes. Missing → null.
export function parseOffset(value) {
  const m = /([+-])(\d{2}):?(\d{2})/.exec(value || "");
  if (!m) return null;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

// Samsung's day_time is the day's midnight in UTC, standing for that calendar
// date — so its UTC date IS the local date. Anything else is treated as a
// regular epoch timestamp.
export function dayKeyFromDayTime(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return utcKey(new Date(ms));
}

// start_time like "2024-03-12 06:31:00.000" (UTC) or epoch ms, plus a
// time_offset like "UTC+0100". Returns { iso, dayKey } in the local time of
// the measurement.
export function parseStartTime(value, offsetText, fallbackOffsetMin = 0) {
  if (!value) return null;
  let utcMs;
  if (/^\d{10,}$/.test(value)) utcMs = Number(value);
  else {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
    if (!m) return null;
    utcMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }
  const offset = parseOffset(offsetText) ?? fallbackOffsetMin;
  const local = new Date(utcMs + offset * 60000);
  return { iso: new Date(utcMs).toISOString(), dayKey: utcKey(local) };
}

// --- recognising files -------------------------------------------------------

function kindOf(name, metaLine) {
  const hay = `${name} ${metaLine}`.toLowerCase();
  if (hay.includes("step_daily_trend")) return "steps";
  if (hay.includes("pedometer_day_summary")) return "steps-summary";
  if (/com\.samsung\.health\.weight|(^|[^a-z])weight[^a-z]/.test(hay) && !hay.includes("goal")) return "weight";
  return null;
}

// Steps per day from rows with { count|step_count, day_time, source_type }.
// The watch and the phone each log their own row per day; source_type -2 is
// Samsung's merged total across devices. Use that when present, otherwise
// the highest single device — never the sum, which would double-count.
function stepsFromRows(rows) {
  const merged = new Map();
  const perDevice = new Map();
  for (const row of rows) {
    const day = dayKeyFromDayTime(row.day_time);
    const count = Number(row.count ?? row.step_count);
    if (!day || !(count >= 0)) continue;
    const target = String(row.source_type) === "-2" ? merged : perDevice;
    target.set(day, Math.max(target.get(day) || 0, Math.round(count)));
  }
  const result = new Map(perDevice);
  merged.forEach((count, day) => result.set(day, count));
  return result;
}

function weightsFromRows(rows, fallbackOffsetMin) {
  const out = [];
  for (const row of rows) {
    const weightKg = Number(String(row.weight || "").replace(",", "."));
    if (!(weightKg > 20 && weightKg < 400)) continue;
    const time = parseStartTime(row.start_time, row.time_offset, fallbackOffsetMin);
    if (!time) continue;
    out.push({
      id: `shealth-weight-${row.datauuid || time.iso}`,
      date: time.iso,
      dayKey: time.dayKey,
      weightKg: Math.round(weightKg * 10) / 10,
    });
  }
  return out;
}

// Pure. `files`: [{ name, text }]. Returns
// { steps: Map<dayKey, count>, weights: [...], used: [names], ignored: [names] }.
export function parseSamsungExport(files, fallbackOffsetMin = 0) {
  const steps = new Map();
  const daily = new Map(); // from step_daily_trend — preferred over pedometer summaries
  const weights = new Map();
  const used = [];
  const ignored = [];

  for (const { name, text } of files) {
    const firstLine = text.slice(0, 300).split(/\r?\n/)[0] || "";
    const kind = kindOf(name, firstLine);
    if (kind === "steps" || kind === "steps-summary") {
      const table = parseTable(text, "day_time");
      if (!table) { ignored.push(name); continue; }
      const found = stepsFromRows(table.rows);
      const into = kind === "steps" ? daily : steps;
      found.forEach((count, day) => into.set(day, Math.max(into.get(day) || 0, count)));
      used.push(name);
    } else if (kind === "weight") {
      const table = parseTable(text, "start_time");
      if (!table) { ignored.push(name); continue; }
      weightsFromRows(table.rows, fallbackOffsetMin).forEach((w) => weights.set(w.id, w));
      used.push(name);
    } else {
      ignored.push(name);
    }
  }
  daily.forEach((count, day) => steps.set(day, count));
  return {
    steps,
    weights: [...weights.values()].sort((a, b) => a.date.localeCompare(b.date)),
    used,
    ignored,
  };
}

// --- writing ----------------------------------------------------------------

// Adds/updates without removing anything. A manually logged weight on the
// same day with the same value isn't duplicated.
export async function applySamsungImport({ steps, weights }, { importSteps = true, importWeights = true } = {}) {
  let stepDays = 0;
  let weightCount = 0;
  if (importSteps) {
    for (const [date, count] of steps) {
      if (!(count > 0)) continue;
      const existing = (await storage.getDailyLog(date)) || { date, proteinG: 0 };
      await storage.saveDailyLog({ ...existing, date, steps: count, stepsSource: "samsung-health", updatedAt: new Date().toISOString() });
      stepDays++;
    }
  }
  if (importWeights) {
    const existing = await storage.getBodyLogs();
    const manual = new Set(
      existing.filter((l) => l.weightKg != null).map((l) => `${localDay(l.date)}|${l.weightKg}`)
    );
    for (const w of weights) {
      if (manual.has(`${w.dayKey}|${w.weightKg}`) && !existing.some((l) => l.id === w.id)) continue;
      await storage.saveBodyLog({ id: w.id, date: w.date, weightKg: w.weightKg, waistCm: null, note: "Samsung Health", source: "samsung-health" });
      weightCount++;
    }
  }
  return { stepDays, weightCount };
}

function localDay(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// --- UI ---------------------------------------------------------------------

// Button + file picker + preview + confirm. `onDone` re-renders the caller.
export function renderSamsungImport(onDone) {
  const wrap = document.createElement("div");
  wrap.className = "samsung-import";

  const help = document.createElement("details");
  help.className = "samsung-help";
  help.innerHTML =
    "<summary>Stappen en gewicht uit Samsung Health importeren</summary>" +
    "<ol>" +
    "<li>Open <b>Samsung Health</b> → ⋮ (rechtsboven) → <b>Instellingen</b> → <b>Persoonlijke gegevens downloaden</b>.</li>" +
    "<li>Wacht tot de download klaar is. De bestanden staan in <b>Download/Samsung Health/</b>.</li>" +
    "<li>Tik hieronder op <b>Bestanden kiezen</b> en selecteer de bestanden met <b>step_daily_trend</b> en <b>weight</b> in de naam (meerdere tegelijk mag; andere bestanden worden genegeerd).</li>" +
    "</ol>" +
    "<p>Je ziet eerst wat er gevonden is. Er wordt niets verwijderd: stappen per dag worden bijgewerkt, gewichtsmetingen toegevoegd. Twee keer dezelfde export importeren is geen probleem.</p>";
  wrap.appendChild(help);

  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".csv,text/csv,text/comma-separated-values,text/plain";
  input.hidden = true;
  wrap.appendChild(input);

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "btn btn-secondary";
  pick.textContent = "Bestanden kiezen";
  pick.addEventListener("click", () => input.click());
  wrap.appendChild(pick);

  const result = document.createElement("div");
  result.className = "samsung-result";
  wrap.appendChild(result);

  input.addEventListener("change", async () => {
    const files = [...input.files];
    input.value = "";
    if (!files.length) return;
    result.innerHTML = "";
    const status = document.createElement("p");
    status.className = "sync-status";
    status.textContent = "Bestanden lezen...";
    result.appendChild(status);

    let parsed;
    try {
      const texts = await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
      parsed = parseSamsungExport(texts, -new Date().getTimezoneOffset());
    } catch (err) {
      status.textContent = `Kon de bestanden niet lezen: ${err.message}`;
      status.classList.add("warn");
      return;
    }

    if (!parsed.steps.size && !parsed.weights.length) {
      status.textContent = parsed.used.length
        ? "Geen stappen of gewicht gevonden in deze bestanden."
        : "Geen Samsung Health-bestanden herkend. Kies de bestanden met step_daily_trend of weight in de naam.";
      status.classList.add("warn");
      return;
    }

    const days = [...parsed.steps.keys()].sort();
    const lines = [];
    if (days.length) lines.push(`Stappen: ${days.length} dagen (${days[0]} t/m ${days[days.length - 1]})`);
    if (parsed.weights.length) {
      const last = parsed.weights[parsed.weights.length - 1];
      lines.push(`Gewicht: ${parsed.weights.length} metingen (laatste ${last.weightKg} kg op ${last.dayKey})`);
    }
    if (parsed.ignored.length) lines.push(`${parsed.ignored.length} andere bestanden genegeerd`);
    status.textContent = "Gevonden:";
    const list = document.createElement("ul");
    list.className = "samsung-found";
    lines.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
    result.appendChild(list);

    const options = {};
    const option = (key, label, enabled) => {
      if (!enabled) return;
      const row = document.createElement("label");
      row.className = "samsung-option";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = true;
      options[key] = box;
      row.append(box, document.createTextNode(` ${label}`));
      result.appendChild(row);
    };
    option("importSteps", "Stappen importeren", days.length > 0);
    option("importWeights", "Gewicht importeren", parsed.weights.length > 0);

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn btn-primary";
    confirm.textContent = "Importeren";
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      const done = await applySamsungImport(parsed, {
        importSteps: options.importSteps?.checked ?? false,
        importWeights: options.importWeights?.checked ?? false,
      });
      const parts = [];
      if (done.stepDays) parts.push(`${done.stepDays} ${done.stepDays === 1 ? "dag" : "dagen"} stappen`);
      if (done.weightCount) parts.push(`${done.weightCount} ${done.weightCount === 1 ? "gewichtsmeting" : "gewichtsmetingen"}`);
      onDone?.(parts.length ? `Geïmporteerd: ${parts.join(" en ")}.` : "Niets geïmporteerd.");
    });
    result.appendChild(confirm);
  });

  return wrap;
}
