// Pure functions, no DOM/storage — per-exercise and whole-training statistics
// for the Voortgang tab and the AI Coach context. Exercises are grouped by
// name (not id), the same way progression carries across Push and Push 2.
// Cardio lives on the session, not in entries, so none of this counts it.

import { bestOneRepMax, sessionVolume } from "./volume-stats.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function entryVolume(entry) {
  return Math.round((entry.sets || []).reduce((sum, s) => sum + s.weight * s.reps, 0) * 10) / 10;
}

// Chronological (oldest first) list of every logged entry per exercise name:
// Map<name, [{ date, sets, lastSetRir, topWeight, e1rm, volume }]>.
export function historyByExercise(sessions) {
  const chronological = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
  const byName = new Map();
  for (const session of chronological) {
    for (const entry of session.entries || []) {
      if (!entry.sets?.length) continue;
      if (!byName.has(entry.exerciseName)) byName.set(entry.exerciseName, []);
      byName.get(entry.exerciseName).push({
        date: session.date,
        sets: entry.sets,
        lastSetRir: entry.lastSetRir ?? null,
        topWeight: Math.max(...entry.sets.map((s) => s.weight)),
        e1rm: bestOneRepMax(entry),
        volume: entryVolume(entry),
      });
    }
  }
  return byName;
}

// Summary for one exercise's chronological history (see historyByExercise).
export function summariseExercise(history) {
  if (!history?.length) return null;
  const last = history[history.length - 1];
  const lastWeight = last.sets[last.sets.length - 1].weight;

  // Best weight = heaviest weight ever used, with the most reps done at it.
  let bestWeight = 0;
  let bestWeightReps = 0;
  for (const point of history) {
    for (const set of point.sets) {
      if (set.weight > bestWeight || (set.weight === bestWeight && set.reps > bestWeightReps)) {
        bestWeight = set.weight;
        bestWeightReps = set.reps;
      }
    }
  }

  return {
    count: history.length,
    firstDate: history[0].date,
    lastDate: last.date,
    lastWeight,
    lastSets: last.sets,
    lastRir: last.lastSetRir,
    bestWeight,
    bestWeightReps,
    totalVolume: Math.round(history.reduce((sum, p) => sum + p.volume, 0)),
    firstE1rm: history[0].e1rm,
    lastE1rm: last.e1rm,
    bestE1rm: Math.max(...history.map((p) => p.e1rm)),
    e1rmSeries: history.map((p) => p.e1rm),
    weightSeries: history.map((p) => p.topWeight),
  };
}

// Has this exercise progressed over roughly the last `windowDays`? Compares the
// latest e1RM against the latest entry from before the window (or the very
// first entry when everything is recent). e1RM rather than weight, so "same
// weight, more reps" counts as the progress it is.
export function hasProgressed(history, now = new Date(), windowDays = 28) {
  if (!history || history.length < 2) return false;
  const cutoff = now.getTime() - windowDays * DAY_MS;
  const before = history.filter((p) => new Date(p.date).getTime() <= cutoff);
  const reference = before.length ? before[before.length - 1] : history[0];
  const latest = history[history.length - 1];
  return latest !== reference && latest.e1rm > reference.e1rm;
}

// Whole-training numbers for the "TRAINING" overview card.
export function trainingOverview(sessions, now = new Date()) {
  const since = (days) => now.getTime() - days * DAY_MS;
  const in7 = sessions.filter((s) => new Date(s.date).getTime() > since(7));
  const in30 = sessions.filter((s) => new Date(s.date).getTime() > since(30));
  const byName = historyByExercise(sessions);
  const tracked = [...byName.values()].filter((h) => h.length >= 2);
  const sum = (list) => Math.round(list.reduce((total, s) => total + sessionVolume(s), 0));

  return {
    sessions7: in7.length,
    sessions30: in30.length,
    volume30: sum(in30),
    volumeTotal: sum(sessions),
    progressed: tracked.filter((h) => hasProgressed(h, now)).length,
    tracked: tracked.length,
    cardio30: in30.filter((s) => s.cardio?.minutes > 0).length,
  };
}

// Simple pattern flags per exercise for the AI Coach: stagnation, constant
// RIR 0, dropping reps. Uses the last `n` entries.
export function exerciseFlags(history, n = 4) {
  const recent = (history || []).slice(-n);
  const flags = [];
  if (recent.length < 3) return flags;
  const e1rms = recent.map((p) => p.e1rm);
  if (Math.max(...e1rms.slice(1)) <= e1rms[0]) flags.push(`geen e1RM-progressie in de laatste ${recent.length} keer`);
  const rirs = recent.map((p) => p.lastSetRir).filter((r) => r != null);
  if (rirs.length >= 3 && rirs.every((r) => r === 0)) flags.push("structureel RIR 0");
  const totalReps = recent.map((p) => p.sets.reduce((sum, s) => sum + s.reps, 0));
  const sameWeight = recent.every((p) => p.topWeight === recent[0].topWeight);
  if (sameWeight && totalReps.every((r, i) => i === 0 || r < totalReps[i - 1])) flags.push("teruglopende reps op hetzelfde gewicht");
  return flags;
}
