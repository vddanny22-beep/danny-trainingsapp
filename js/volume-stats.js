// Pure functions, no DOM/storage — aggregate statistics over logged sessions.
// The Geschiedenis tab already trends the top weight of a single exercise;
// these answer the questions that needs a whole-schema view: am I doing more
// work over time, and is one movement type falling behind?

// Training volume = weight x reps, summed over every set. The standard proxy
// for "how much work did I do", and the reason a 5x5 at 60kg outranks a
// single heavy double.
export function sessionVolume(session) {
  let volume = 0;
  for (const entry of session.entries || []) {
    for (const set of entry.sets || []) {
      volume += set.weight * set.reps;
    }
  }
  // Rounded to avoid floating-point noise accumulating across many sets.
  return Math.round(volume * 10) / 10;
}

export function sessionSetCount(session) {
  let sets = 0;
  for (const entry of session.entries || []) {
    sets += (entry.sets || []).length;
  }
  return sets;
}

// Monday of the ISO week containing `date`, as a UTC date. Weeks are keyed by
// their Monday rather than by an ISO week number: it sorts and labels
// directly, and sidesteps the year-boundary edge cases of week numbering.
export function isoWeekStart(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = d.getUTCDay() || 7; // getUTCDay: Sunday is 0, ISO wants 7
  d.setUTCDate(d.getUTCDate() - (weekday - 1));
  return d;
}

function weekKey(date) {
  return isoWeekStart(date).toISOString().slice(0, 10);
}

// The last `weekCount` weeks, oldest first, including weeks with no training —
// a gap should show up as a dip in the trend, not be silently skipped.
export function volumeByWeek(sessions, weekCount = 12, now = new Date()) {
  const currentMonday = isoWeekStart(now);
  const weeks = [];
  for (let i = weekCount - 1; i >= 0; i--) {
    const monday = new Date(currentMonday);
    monday.setUTCDate(monday.getUTCDate() - i * 7);
    weeks.push({
      key: monday.toISOString().slice(0, 10),
      monday,
      volume: 0,
      sets: 0,
      sessions: 0,
    });
  }

  const byKey = new Map(weeks.map((week) => [week.key, week]));
  for (const session of sessions) {
    const bucket = byKey.get(weekKey(new Date(session.date)));
    if (!bucket) continue; // older than the window
    bucket.volume += sessionVolume(session);
    bucket.sets += sessionSetCount(session);
    bucket.sessions += 1;
  }

  weeks.forEach((week) => {
    week.volume = Math.round(week.volume * 10) / 10;
  });
  return weeks;
}

// Movement type read from the day's name — the same name-matching approach
// progression.js already uses to spot leg days. Legs is tested first: a day
// named "Legs" never also says push or pull.
export function dayCategory(dayName) {
  const name = dayName || "";
  if (/legs?|benen|onderlichaam/i.test(name)) return "Legs";
  if (/pull|rug|trek/i.test(name)) return "Pull";
  if (/push|borst|duw/i.test(name)) return "Push";
  return "Overig";
}

// Volume per movement type since `since`, largest first. Categories with no
// work in the window are dropped rather than shown as empty rows.
export function volumeByCategory(sessions, since) {
  const totals = new Map();
  for (const session of sessions) {
    if (since && new Date(session.date) < since) continue;
    const category = dayCategory(session.dayName);
    const current = totals.get(category) || { category, volume: 0, sets: 0 };
    current.volume += sessionVolume(session);
    current.sets += sessionSetCount(session);
    totals.set(category, current);
  }
  return [...totals.values()]
    .map((row) => ({ ...row, volume: Math.round(row.volume * 10) / 10 }))
    .sort((a, b) => b.volume - a.volume);
}

// Epley one-rep-max estimate. Lets a heavier-for-fewer-reps set be compared
// against a lighter-for-more-reps one, which raw top weight cannot: 60kg x 10
// (80kg e1RM) is real progress over 70kg x 3 (77kg e1RM), but looks like a
// step backwards if you only plot the weight.
export function estimatedOneRepMax(weight, reps) {
  if (!(weight > 0) || !(reps > 0)) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

// Best e1RM across the sets of one logged exercise.
export function bestOneRepMax(entry) {
  let best = 0;
  for (const set of entry.sets || []) {
    best = Math.max(best, estimatedOneRepMax(set.weight, set.reps));
  }
  return best;
}

// Percentage change between two volumes. Null when there's no meaningful
// baseline — "+100%" off a zero week says nothing.
export function percentChange(current, previous) {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
}
