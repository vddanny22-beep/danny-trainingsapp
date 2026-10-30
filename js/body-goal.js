// Goal weight and weight-change tempo. For a recomp with a fat-loss focus the
// rate matters as much as the direction: losing faster than ~0.75–1% of body
// weight a week makes it hard to keep muscle and strength.

const GOAL_KEY = "trainingsapp.goalWeightKg";
const DAY_MS = 24 * 60 * 60 * 1000;

export function getGoalWeight() {
  try {
    const value = Number(localStorage.getItem(GOAL_KEY));
    return value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function setGoalWeight(kg) {
  try {
    if (kg > 0) localStorage.setItem(GOAL_KEY, String(kg));
    else localStorage.removeItem(GOAL_KEY);
  } catch {
    // storage blocked — the goal just isn't remembered
  }
}

// Pure. Least-squares slope through the weigh-ins of the last `days` days,
// in kg per week — a daily-weighing scale bounces up and down by a kilo, so
// first-vs-last would mostly measure noise. Null with fewer than 3 points or
// less than a week between first and last.
export function weightRate(points, now = new Date(), days = 28) {
  const cutoff = now.getTime() - days * DAY_MS;
  const recent = points
    .map((p) => ({ t: new Date(p.date).getTime(), v: p.value }))
    .filter((p) => p.t >= cutoff && p.t <= now.getTime() && p.v > 0);
  if (recent.length < 3) return null;
  const span = recent[recent.length - 1].t - recent[0].t;
  if (span < 7 * DAY_MS) return null;
  const n = recent.length;
  const meanT = recent.reduce((s, p) => s + p.t, 0) / n;
  const meanV = recent.reduce((s, p) => s + p.v, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of recent) {
    num += (p.t - meanT) * (p.v - meanV);
    den += (p.t - meanT) ** 2;
  }
  if (!den) return null;
  const perWeekKg = (num / den) * 7 * DAY_MS;
  const current = recent[recent.length - 1].v;
  return {
    perWeekKg: Math.round(perWeekKg * 100) / 100,
    perWeekPct: Math.round((perWeekKg / current) * 1000) / 10,
    points: n,
  };
}

// Pure. Plain-language verdict on the tempo, from the perspective of fat
// loss unless the goal lies above the current weight.
export function assessTempo(rate, currentKg, goalKg) {
  if (!rate) return null;
  const wantsGain = goalKg != null && goalKg > currentKg;
  const pct = rate.perWeekPct;
  let level;
  let text;
  if (wantsGain) {
    if (pct > 0.5) { level = "warn"; text = "Je komt snel aan — een deel daarvan is waarschijnlijk vet."; }
    else if (pct >= 0.1) { level = "ok"; text = "Rustig aankomen — goed tempo voor spieropbouw."; }
    else { level = "info"; text = "Je gewicht stijgt (nog) niet richting je doel."; }
  } else if (pct <= -1) { level = "warn"; text = "Te snel: meer dan 1% per week. Risico op spier- en krachtverlies — eet iets meer."; }
  else if (pct <= -0.75) { level = "warn"; text = "Aan de snelle kant. Let op je kracht en eiwit."; }
  else if (pct <= -0.25) { level = "ok"; text = "Gezond afvaltempo voor vetverlies met behoud van spier."; }
  else if (pct < 0.15) { level = "info"; text = "Langzaam of stabiel — prima voor recomp zolang je taille daalt."; }
  else { level = "warn"; text = "Je gewicht stijgt. Check je voeding als vetverlies je doel is."; }

  let weeksToGoal = null;
  if (goalKg != null) {
    const remaining = goalKg - currentKg;
    if (Math.abs(remaining) < 0.05) weeksToGoal = 0;
    else if (Math.sign(remaining) === Math.sign(rate.perWeekKg) && Math.abs(rate.perWeekKg) >= 0.05) {
      weeksToGoal = Math.ceil(Math.abs(remaining / rate.perWeekKg));
    }
  }
  return { level, text, weeksToGoal };
}

export function formatKgSigned(kg) {
  const rounded = Math.round(kg * 100) / 100;
  return `${rounded > 0 ? "+" : ""}${String(rounded).replace(".", ",")}`;
}
