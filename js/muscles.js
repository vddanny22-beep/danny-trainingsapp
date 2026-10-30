// Pure functions, no DOM/storage — which muscles an exercise trains, and how
// many hard sets each muscle group got. Feeds the body map (body-map.js), the
// weekly volume list on Voortgang and the AI Coach.
//
// Counting convention (common in hypertrophy programming): a set counts as 1
// for every PRIMARY muscle and 0.5 for every SECONDARY muscle. Cardio is not
// in session entries, so it never counts.

// `target` is a weekly hard-set range for hypertrophy; null = no target shown
// (trained indirectly, nothing to warn about).
export const MUSCLES = [
  { key: "chest", label: "Borst", target: [10, 20] },
  { key: "frontDelts", label: "Voorkant schouder", target: [6, 16] },
  { key: "sideDelts", label: "Zijkant schouder", target: [10, 20] },
  { key: "rearDelts", label: "Achterkant schouder", target: [8, 16] },
  { key: "triceps", label: "Triceps", target: [10, 20] },
  { key: "biceps", label: "Biceps", target: [10, 20] },
  { key: "forearms", label: "Onderarmen", target: null },
  { key: "lats", label: "Lats (brede rugspier)", target: [10, 20] },
  { key: "upperBack", label: "Bovenrug / trapezius", target: [10, 20] },
  { key: "lowerBack", label: "Onderrug", target: null },
  { key: "abs", label: "Buikspieren", target: [6, 16] },
  { key: "glutes", label: "Bilspieren", target: [6, 16] },
  { key: "quads", label: "Quadriceps", target: [10, 20] },
  { key: "hamstrings", label: "Hamstrings", target: [8, 16] },
  { key: "calves", label: "Kuiten", target: [8, 16] },
];

export const MUSCLE_KEYS = MUSCLES.map((m) => m.key);
const BY_KEY = new Map(MUSCLES.map((m) => [m.key, m]));

export function muscleLabel(key) {
  return BY_KEY.get(key)?.label || key;
}

// Default mapping by exercise name. First match wins, so specific patterns
// ("leg curl", "rear delt", "overhead ... extension") come before the
// generic ones ("curl", "fly", "press").
const RULES = [
  [/rear\s*delt|reverse\s*(fly|pec)|face\s*pull/i, ["rearDelts"], ["upperBack"]],
  [/lateral|side\s*raise/i, ["sideDelts"], []],
  [/leg\s*curl|hamstring\s*curl/i, ["hamstrings"], []],
  [/leg\s*ext/i, ["quads"], []],
  [/leg\s*press|squat|hack|lunge|split\s*squat/i, ["quads", "glutes"], ["hamstrings"]],
  [/calf/i, ["calves"], []],
  [/romanian|rdl|stiff/i, ["hamstrings", "glutes"], ["lowerBack"]],
  [/deadlift/i, ["hamstrings", "glutes", "lowerBack"], ["upperBack", "quads"]],
  [/hip\s*thrust|glute/i, ["glutes"], ["hamstrings"]],
  [/back\s*ext|hyperext/i, ["lowerBack"], ["glutes", "hamstrings"]],
  [/tricep|pushdown|skull|kickback|overhead.*ext|french\s*press/i, ["triceps"], []],
  [/shoulder\s*press|overhead\s*press|military|arnold/i, ["frontDelts"], ["sideDelts", "triceps"]],
  [/chest\s*press|bench|push.?up|dip/i, ["chest"], ["frontDelts", "triceps"]],
  [/fly|pec\s*deck|crossover/i, ["chest"], ["frontDelts"]],
  [/pulldown|pull.?up|chin.?up|pullover/i, ["lats"], ["biceps", "upperBack"]],
  [/row/i, ["upperBack", "lats"], ["rearDelts", "biceps"]],
  [/shrug/i, ["upperBack"], []],
  [/hammer/i, ["biceps", "forearms"], []],
  [/curl/i, ["biceps"], ["forearms"]],
  [/wrist/i, ["forearms"], []],
  [/crunch|plank|sit.?up|leg\s*raise|ab\s|abs|core|wood\s*chop/i, ["abs"], []],
];

export function defaultMusclesFor(exerciseName) {
  const name = String(exerciseName || "");
  for (const [pattern, primary, secondary] of RULES) {
    if (pattern.test(name)) return { primary: [...primary], secondary: [...secondary] };
  }
  return { primary: [], secondary: [] };
}

// An exercise's own setting (from the schema editor) wins over the default.
export function musclesFor(exercise) {
  const own = exercise?.muscles;
  if (own && (own.primary?.length || own.secondary?.length)) {
    return { primary: own.primary || [], secondary: own.secondary || [] };
  }
  return defaultMusclesFor(exercise?.name);
}

// Looks up muscles for a logged entry. History entries only carry the name,
// so the current schema's exercise of that name is used when there is one
// (that's where custom muscle settings live), else the name-based default.
export function makeMuscleResolver(days) {
  const byName = new Map();
  (days || []).forEach((day) => (day.exercises || []).forEach((ex) => {
    if (!byName.has(ex.name)) byName.set(ex.name, ex);
  }));
  const cache = new Map();
  return (exerciseName) => {
    if (!cache.has(exerciseName)) cache.set(exerciseName, musclesFor(byName.get(exerciseName) || { name: exerciseName }));
    return cache.get(exerciseName);
  };
}

function emptyTotals() {
  return Object.fromEntries(MUSCLE_KEYS.map((key) => [key, 0]));
}

function addSets(totals, muscles, sets) {
  muscles.primary.forEach((m) => { if (m in totals) totals[m] += sets; });
  muscles.secondary.forEach((m) => { if (m in totals) totals[m] += sets * 0.5; });
}

// Sets per muscle for one session (what the post-workout map shows).
export function sessionMuscleSets(session, resolve) {
  const totals = emptyTotals();
  (session.entries || []).forEach((entry) => addSets(totals, resolve(entry.exerciseName), (entry.sets || []).length));
  return totals;
}

// Sets per muscle over the last `days` days (rolling, not calendar week, so
// Monday morning doesn't read as "nothing trained").
export function recentMuscleSets(sessions, resolve, now = new Date(), days = 7) {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const totals = emptyTotals();
  sessions
    .filter((s) => new Date(s.date).getTime() > cutoff && new Date(s.date).getTime() <= now.getTime())
    .forEach((s) => (s.entries || []).forEach((entry) => addSets(totals, resolve(entry.exerciseName), (entry.sets || []).length)));
  return totals;
}

// What the schema prescribes per week if every day is trained once — shows a
// structural gap (e.g. no direct ab work) before any week has been logged.
export function plannedMuscleSets(days) {
  const totals = emptyTotals();
  (days || []).forEach((day) => (day.exercises || []).forEach((ex) => addSets(totals, musclesFor(ex), ex.sets || 0)));
  return totals;
}

// "low" | "ok" | "high" | "none" | null (no target).
export function volumeStatus(key, sets) {
  const target = BY_KEY.get(key)?.target;
  if (!target) return null;
  if (sets <= 0) return "none";
  if (sets < target[0]) return "low";
  if (sets > target[1]) return "high";
  return "ok";
}

// Heat for the body map: 0 = untouched, 1 = at the bottom of the target range,
// capped at 1.5. Muscles without a target use 10 sets as their reference.
export function muscleHeat(key, sets) {
  const target = BY_KEY.get(key)?.target;
  const reference = target ? target[0] : 10;
  return Math.min(1.5, sets / reference);
}

export function formatSets(sets) {
  return Number.isInteger(sets) ? String(sets) : sets.toFixed(1).replace(".", ",");
}

// --- Recovery ---------------------------------------------------------------
// Rough model, meant as a guide, not physiology: a muscle needs about 24 h
// plus 6 h per hard set it got (primary 1, secondary ½) to recover, capped
// at 72 h. Several recent sessions: the least-recovered one counts.
const HOUR_MS = 60 * 60 * 1000;

export function recoveryHoursFor(sets) {
  return Math.min(72, 24 + 6 * sets);
}

// Returns { [muscle]: { recovered: 0..1, hoursLeft, sets, trainedAt } } for
// every muscle; untouched muscles are fully recovered (recovered = 1).
export function muscleRecovery(sessions, resolve, now = new Date()) {
  const result = Object.fromEntries(MUSCLE_KEYS.map((key) => [key, { recovered: 1, hoursLeft: 0, sets: 0, trainedAt: null }]));
  for (const session of sessions) {
    const at = new Date(session.date).getTime();
    const elapsed = (now.getTime() - at) / HOUR_MS;
    if (elapsed < 0 || elapsed >= 72) continue;
    const sets = sessionMuscleSets(session, resolve);
    for (const key of MUSCLE_KEYS) {
      if (!(sets[key] > 0)) continue;
      const needed = recoveryHoursFor(sets[key]);
      const recovered = Math.min(1, elapsed / needed);
      if (recovered < result[key].recovered) {
        result[key] = { recovered, hoursLeft: Math.max(0, Math.ceil(needed - elapsed)), sets: sets[key], trainedAt: session.date };
      }
    }
  }
  return result;
}
