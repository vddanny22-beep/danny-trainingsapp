import * as storage from "./storage.js";
import { parseDecimal } from "./decimal-input.js";

// Protein and steps per calendar day — the two numbers that say most about
// fat loss next to training: enough protein keeps muscle in a deficit, steps
// are the biggest lever on daily energy use. Logged on the Vandaag tab (also
// on rest days), summarised on Voortgang, passed to the AI Coach.
// Every tap saves immediately; there is no separate save button to forget.

const TARGETS_KEY = "trainingsapp.dailyTargets";
const PROTEIN_PER_KG = 2; // g per kg body weight — upper-middle of the usual 1.6–2.2 for a deficit
const DEFAULT_PROTEIN_G = 160;
const DEFAULT_STEPS = 8000;
export const PROTEIN_STEPS = [10, 20, 30, 40];

// Local calendar date, not toISOString() (that's UTC and would put a late
// evening log on the next day).
export function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Protein target defaults to 2 g/kg of the latest logged body weight, until
// set by hand.
export function getTargets(latestWeightKg) {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(TARGETS_KEY) || "{}") || {};
  } catch {
    stored = {};
  }
  const derivedProtein = latestWeightKg > 0 ? Math.round((latestWeightKg * PROTEIN_PER_KG) / 5) * 5 : DEFAULT_PROTEIN_G;
  return {
    proteinG: stored.proteinG > 0 ? stored.proteinG : derivedProtein,
    steps: stored.steps > 0 ? stored.steps : DEFAULT_STEPS,
    proteinIsDerived: !(stored.proteinG > 0) && latestWeightKg > 0,
  };
}

export function setTargets(targets) {
  try {
    localStorage.setItem(TARGETS_KEY, JSON.stringify(targets));
  } catch {
    // storage blocked — targets fall back to the defaults
  }
}

export async function latestWeightKg() {
  const logs = await storage.getBodyLogs();
  return logs.find((l) => l.weightKg != null)?.weightKg ?? null;
}

// Pure: averages over the `days` calendar days up to and including today,
// counting only days that have a value (an unlogged day isn't a zero).
export function dailyAverages(logs, now = new Date(), days = 7) {
  const keys = new Set();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    keys.add(localDateKey(d));
  }
  const inRange = logs.filter((l) => keys.has(l.date));
  const avg = (field) => {
    const values = inRange.map((l) => l[field]).filter((v) => v > 0);
    return values.length ? { avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length), days: values.length } : null;
  };
  return { protein: avg("proteinG"), steps: avg("steps") };
}

// Pure: last `days` days oldest-first, 0 where nothing was logged.
export function dailySeries(logs, field, now = new Date(), days = 14) {
  const byDate = new Map(logs.map((l) => [l.date, l]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    series.push(byDate.get(localDateKey(d))?.[field] || 0);
  }
  return series;
}

function formatNumber(n) {
  return Math.round(n).toLocaleString("nl-NL");
}

// Collapsed card on the Vandaag tab: summary in one line, tap to log.
export async function renderDailyCard() {
  const today = localDateKey();
  const entry = (await storage.getDailyLog(today)) || { date: today, proteinG: 0, steps: 0 };
  const targets = getTargets(await latestWeightKg());

  const card = document.createElement("details");
  card.className = "daily-card";

  const summary = document.createElement("summary");
  card.appendChild(summary);
  const refreshSummary = () => {
    summary.innerHTML = "";
    const title = document.createElement("span");
    title.className = "daily-card-title";
    title.textContent = "Vandaag";
    summary.appendChild(title);
    const values = document.createElement("span");
    values.className = "daily-card-values";
    values.textContent = `Eiwit ${formatNumber(entry.proteinG || 0)}/${targets.proteinG} g · Stappen ${formatNumber(entry.steps || 0)}/${formatNumber(targets.steps)}`;
    summary.appendChild(values);
  };
  refreshSummary();

  const save = async () => {
    await storage.saveDailyLog({ ...entry, updatedAt: new Date().toISOString() });
    refreshSummary();
    refreshBars();
  };

  // Protein: quick-add buttons (no typing for a shake or a meal), plus an
  // exact total field for corrections.
  const proteinRow = document.createElement("div");
  proteinRow.className = "daily-row";
  const proteinLabel = document.createElement("p");
  proteinLabel.className = "daily-label";
  proteinLabel.textContent = "Eiwit (gram) toevoegen";
  proteinRow.appendChild(proteinLabel);
  const proteinBar = progressBar();
  proteinRow.appendChild(proteinBar.el);
  const quick = document.createElement("div");
  quick.className = "daily-quick";
  PROTEIN_STEPS.forEach((grams) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "daily-quick-btn";
    btn.textContent = `+${grams}`;
    btn.setAttribute("aria-label", `${grams} gram eiwit toevoegen`);
    btn.addEventListener("click", async () => {
      entry.proteinG = (entry.proteinG || 0) + grams;
      proteinInput.value = entry.proteinG;
      navigator.vibrate?.(10);
      await save();
    });
    quick.appendChild(btn);
  });
  proteinRow.appendChild(quick);
  const proteinInput = numericField(entry.proteinG || "", "Totaal eiwit vandaag (g)");
  proteinInput.addEventListener("change", async () => {
    const value = parseDecimal(proteinInput.value);
    entry.proteinG = value > 0 ? Math.round(value) : 0;
    await save();
  });
  proteinRow.appendChild(labelled("Totaal vandaag", proteinInput));
  card.appendChild(proteinRow);

  // Steps: one number, read off the watch/phone at the end of the day.
  const stepsRow = document.createElement("div");
  stepsRow.className = "daily-row";
  const stepsBar = progressBar();
  const stepsInput = numericField(entry.steps || "", "Stappen vandaag");
  stepsInput.addEventListener("change", async () => {
    const value = parseDecimal(stepsInput.value.replace(/\./g, ""));
    entry.steps = value > 0 ? Math.round(value) : 0;
    await save();
  });
  stepsRow.appendChild(labelled("Stappen vandaag", stepsInput));
  stepsRow.appendChild(stepsBar.el);
  card.appendChild(stepsRow);

  function refreshBars() {
    proteinBar.set((entry.proteinG || 0) / targets.proteinG);
    stepsBar.set((entry.steps || 0) / targets.steps);
  }
  refreshBars();

  return card;
}

function numericField(value, ariaLabel) {
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.className = "daily-input";
  input.value = value;
  input.setAttribute("aria-label", ariaLabel);
  return input;
}

function labelled(text, input) {
  const label = document.createElement("label");
  label.className = "daily-field";
  const caption = document.createElement("span");
  caption.textContent = text;
  label.append(caption, input);
  return label;
}

function progressBar() {
  const track = document.createElement("div");
  track.className = "daily-bar";
  const fill = document.createElement("div");
  fill.className = "daily-bar-fill";
  track.appendChild(fill);
  return {
    el: track,
    set(fraction) {
      fill.style.width = `${Math.min(1, Math.max(0, fraction)) * 100}%`;
      track.classList.toggle("done", fraction >= 1);
    },
  };
}
