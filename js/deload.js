// Stagnation → deload suggestion. Several exercises stalling at once usually
// means accumulated fatigue (more likely in a calorie deficit), and a light
// week tends to fix that faster than grinding on. The app only SUGGESTS it;
// nothing changes until the user taps "start".
//
// Deload here = volume deload: half the sets, the SAME weight, stop at RIR 3+.
// Keeping the weight means no rounding of real machine weights, and strength
// is kept while fatigue drops. Sessions logged during a deload are marked
// `deload: true` and are ignored for next-time advice and stagnation checks.

import { bestOneRepMax } from "./volume-stats.js";

const STATE_KEY = "trainingsapp.deload";
const DAY_MS = 24 * 60 * 60 * 1000;
export const DELOAD_DAYS = 7;
const SNOOZE_DAYS = 14;
const MIN_DAYS_BETWEEN = 35;
const MIN_STALLED = 3;
const STALL_ENTRIES = 3;
const STALL_MIN_SPAN_DAYS = 10;

function readState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeState(state) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // storage blocked — the deload state just isn't remembered
  }
}

export function getDeloadState(now = new Date()) {
  const state = readState();
  const active = state.activeUntil && new Date(state.activeUntil) > now;
  // An expired deload counts as ended at its planned end date.
  if (state.activeUntil && !active && !state.lastEndedAt) {
    state.lastEndedAt = state.activeUntil;
    delete state.activeUntil;
    writeState(state);
  }
  return { ...state, active: Boolean(active) };
}

export function startDeload(now = new Date()) {
  const until = new Date(now.getTime() + DELOAD_DAYS * DAY_MS);
  writeState({ ...readState(), startedAt: now.toISOString(), activeUntil: until.toISOString(), lastEndedAt: null });
}

export function stopDeload(now = new Date()) {
  const state = readState();
  delete state.activeUntil;
  writeState({ ...state, lastEndedAt: now.toISOString() });
}

export function snoozeDeload(now = new Date()) {
  writeState({ ...readState(), snoozedUntil: new Date(now.getTime() + SNOOZE_DAYS * DAY_MS).toISOString() });
}

// Half the sets, rounded up (4 → 2, 3 → 2).
export function deloadSets(sets) {
  return Math.max(1, Math.ceil(sets / 2));
}

// Pure. Exercises (by name, from the current schema) whose estimated 1RM
// didn't improve over their last 3 non-deload entries, spread over at least
// 10 days. e1RM, so "same weight, more reps" counts as progress, not a stall.
export function stalledExercises(sessions, days) {
  const names = new Set((days || []).flatMap((d) => (d.exercises || []).map((e) => e.name)));
  const byName = new Map();
  [...sessions]
    .filter((s) => !s.deload)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .forEach((s) => (s.entries || []).forEach((entry) => {
      if (!names.has(entry.exerciseName) || !entry.sets?.length) return;
      if (!byName.has(entry.exerciseName)) byName.set(entry.exerciseName, []);
      byName.get(entry.exerciseName).push({ date: s.date, e1rm: bestOneRepMax(entry) });
    }));

  const stalled = [];
  byName.forEach((history, name) => {
    const recent = history.slice(-STALL_ENTRIES);
    if (recent.length < STALL_ENTRIES) return;
    const span = (new Date(recent[recent.length - 1].date) - new Date(recent[0].date)) / DAY_MS;
    if (span < STALL_MIN_SPAN_DAYS) return;
    if (Math.max(...recent.slice(1).map((p) => p.e1rm)) <= recent[0].e1rm) stalled.push(name);
  });
  return stalled;
}

// Pure. { suggest, stalled } — suggest only when enough exercises stall, no
// deload is running, it wasn't snoozed, and the last one is long enough ago.
export function deloadSuggestion(sessions, days, state, now = new Date()) {
  const stalled = stalledExercises(sessions, days);
  const recentlyDeloaded = state.lastEndedAt && now - new Date(state.lastEndedAt) < MIN_DAYS_BETWEEN * DAY_MS;
  const snoozed = state.snoozedUntil && new Date(state.snoozedUntil) > now;
  return {
    stalled,
    suggest: stalled.length >= MIN_STALLED && !state.active && !snoozed && !recentlyDeloaded,
  };
}

function formatDay(iso) {
  return new Date(iso).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

// Banner for the Vandaag tab, or null. `onChange` re-renders the tab.
export function renderDeloadBanner(sessions, days, onChange) {
  const state = getDeloadState();
  const banner = document.createElement("div");
  banner.className = "deload-banner";

  const title = document.createElement("p");
  title.className = "deload-title";
  const body = document.createElement("p");
  body.className = "deload-body";
  const actions = document.createElement("div");
  actions.className = "deload-actions";
  const button = (text, cls, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `btn btn-small ${cls}`;
    btn.textContent = text;
    btn.addEventListener("click", () => { onClick(); onChange?.(); });
    actions.appendChild(btn);
  };

  if (state.active) {
    banner.classList.add("active");
    title.textContent = `Deload-week t/m ${formatDay(state.activeUntil)}`;
    body.textContent = "Helft van de sets, zelfde gewicht, stop elke set met nog 3+ reps over. Deze trainingen tellen niet mee voor je progressie-advies.";
    button("Deload stoppen", "", () => stopDeload());
  } else {
    const { suggest, stalled } = deloadSuggestion(sessions, days, state);
    if (!suggest) return null;
    title.textContent = "Deload voorgesteld";
    body.textContent = `${stalled.length} oefeningen staan al 3 trainingen stil (${stalled.join(", ")}). Dat wijst vaak op opgebouwde vermoeidheid. Voorstel: 1 week de helft van de sets, zelfde gewicht, RIR 3+.`;
    button("Deload-week starten", "btn-accent", () => startDeload());
    button("Niet nu", "", () => snoozeDeload());
  }
  banner.append(title, body, actions);
  return banner;
}
