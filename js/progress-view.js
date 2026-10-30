import * as storage from "./storage.js";
import { renderSparkline } from "./sparkline.js";
import { volumeByWeek, volumeByCategory, percentChange, weeklyTrend } from "./volume-stats.js";
import { makeDecimalInput, parseDecimal } from "./decimal-input.js";
import { historyByExercise, summariseExercise, trainingOverview, hasProgressed, recordsBySession, formatRecord } from "./exercise-stats.js";
import {
  MUSCLES, makeMuscleResolver, recentMuscleSets, plannedMuscleSets, volumeStatus, formatSets, muscleRecovery, muscleLabel,
} from "./muscles.js";
import { renderBodyMap, renderBodyMapLegend } from "./body-map.js";
import { renderSamsungImport } from "./samsung-import.js";
import { showToast } from "./ui-toast.js";
import { getGoalWeight, setGoalWeight, weightRate, assessTempo, formatKgSigned } from "./body-goal.js";
import {
  getTargets, setTargets, latestWeightKg, dailyAverages, dailySeries,
} from "./daily-log.js";
import { formatSetsLine } from "./formatters.js";
import { formatRir } from "./progression.js";

// Voortgang tab: body metrics (weight/waist/note) logged by date, plus local-only
// progress photos. Entirely separate from sessions/sync — never touches
// sheet-sync.js. Ported from the Sheet's "Voortgang" tab, but date-based
// instead of week-numbered, and with real photo storage instead of a checklist.
export async function renderProgressView(container) {
  container.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Voortgang";
  container.appendChild(heading);

  const [logs, sessions, days] = await Promise.all([storage.getBodyLogs(), storage.getSessions(), storage.getDays()]);

  // LICHAAM: weight and waist as separate cards — for a recomp the waist says
  // more than the scale, which can sit still while fat goes and muscle comes.
  const bodyHeading = document.createElement("h3");
  bodyHeading.className = "overview-heading";
  bodyHeading.textContent = "Lichaam";
  container.appendChild(bodyHeading);
  const statRow = renderStatRow(logs);
  if (statRow) container.appendChild(statRow);
  else {
    const empty = document.createElement("p");
    empty.className = "sync-help";
    empty.textContent = "Nog geen metingen — log hieronder je gewicht en taille.";
    container.appendChild(empty);
  }
  const recompHint = renderRecompHint(logs);
  if (recompHint) container.appendChild(recompHint);
  container.appendChild(renderGoalBox(container, logs));

  container.appendChild(renderTrainingOverview(sessions));
  container.appendChild(renderMuscleSection(sessions, days));
  const recordsSection = renderRecordsSection(sessions);
  if (recordsSection) container.appendChild(recordsSection);
  container.appendChild(renderExerciseProgress(sessions, days));
  container.appendChild(await renderDailySection(container, logs));

  container.appendChild(await renderBodyLogSection(container, logs));
  container.appendChild(await renderPhotoSection(container));
  container.appendChild(await renderVolumeSection());
}

// Chronological (oldest-first) {date, value} points for one metric — shared
// by the headline stat cards above and the trend charts further down, so
// both always agree on what counts as a measurement for that metric.
function metricPoints(logs, key) {
  return [...logs].reverse().filter((l) => l[key] != null).map((l) => ({ date: l.date, value: l[key] }));
}

// Two big-number cards (latest weight/waist + change since the first log in
// range) above everything else, so the tab opens on "where am I now" instead
// of a form. Omitted entirely until there's at least one measurement to show.
function renderStatRow(logs) {
  const cards = [renderStatCard("Gewicht", metricPoints(logs, "weightKg"), "kg"), renderStatCard("Taille", metricPoints(logs, "waistCm"), "cm")].filter(
    Boolean
  );
  if (!cards.length) return null;

  const row = document.createElement("div");
  row.className = "stat-row";
  cards.forEach((card) => row.appendChild(card));
  return row;
}

function renderStatCard(label, points, unit) {
  if (!points.length) return null;
  const last = points[points.length - 1];

  const card = document.createElement("div");
  card.className = "stat-card";

  const labelEl = document.createElement("p");
  labelEl.className = "stat-card-label";
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const valueEl = document.createElement("p");
  valueEl.className = "stat-card-value";
  valueEl.append(String(last.value));
  const unitEl = document.createElement("span");
  unitEl.className = "stat-card-unit";
  unitEl.textContent = ` ${unit}`;
  valueEl.appendChild(unitEl);
  card.appendChild(valueEl);

  if (points.length >= 2) {
    const first = points[0];
    const trend = weeklyTrend(points);
    // Same rounding weeklyTrend applies to its own total, so the fallback
    // can't show floating-point noise the normal path never would.
    const totalDelta = trend ? trend.total : Math.round((last.value - first.value) * 10) / 10;
    const deltaEl = document.createElement("p");
    deltaEl.className = "stat-card-delta";
    deltaEl.textContent = `${formatSigned(totalDelta, unit)} sinds ${formatShortDate(first.date)}`;
    card.appendChild(deltaEl);
  }

  return card;
}

// Goal weight + tempo: how far to go, how fast it's going, and whether that
// pace protects muscle. Editable in place.
function renderGoalBox(rootContainer, logs) {
  const box = document.createElement("div");
  box.className = "goal-box";
  const points = metricPoints(logs, "weightKg");
  const current = points.length ? points[points.length - 1].value : null;
  const goal = getGoalWeight();
  const rate = weightRate(points);
  const tempo = current != null ? assessTempo(rate, current, goal) : null;

  const lines = [];
  if (goal != null && current != null) {
    const remaining = Math.round((goal - current) * 10) / 10;
    lines.push(["goal-main", remaining === 0 ? `Doel ${goal} kg bereikt!` : `Doel ${goal} kg · nog ${formatKgSigned(remaining)} kg`]);
  } else if (goal != null) {
    lines.push(["goal-main", `Doel ${goal} kg`]);
  }
  if (rate) {
    lines.push(["goal-rate", `Tempo: ${formatKgSigned(rate.perWeekKg)} kg/week (${formatKgSigned(rate.perWeekPct)}%/week, laatste 4 weken)`]);
  } else if (points.length) {
    lines.push(["goal-rate", "Tempo: weeg je minstens 3× over een week om je tempo te zien."]);
  }
  if (tempo) {
    lines.push([`goal-verdict level-${tempo.level}`, tempo.text]);
    if (tempo.weeksToGoal) lines.push(["goal-eta", `In dit tempo bereik je je doel over ±${tempo.weeksToGoal} ${tempo.weeksToGoal === 1 ? "week" : "weken"}.`]);
  }
  lines.forEach(([cls, text]) => {
    const p = document.createElement("p");
    p.className = cls;
    p.textContent = text;
    box.appendChild(p);
  });

  const form = document.createElement("form");
  form.className = "goal-form";
  form.noValidate = true;
  form.hidden = true; // opened by the button below
  const input = makeDecimalInput("inline-form-input", "Doelgewicht (kg)");
  input.setAttribute("aria-label", "Doelgewicht in kg");
  input.value = goal ?? "";
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn btn-small btn-accent";
  save.textContent = "Opslaan";
  form.append(input, save);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = parseDecimal(input.value);
    setGoalWeight(value > 0 ? Math.round(value * 10) / 10 : null);
    renderProgressView(rootContainer);
  });

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "btn btn-small";
  toggle.textContent = goal != null ? "Doel wijzigen" : "Doelgewicht instellen";
  toggle.addEventListener("click", () => {
    form.hidden = !form.hidden;
    if (!form.hidden) input.focus();
  });
  box.appendChild(toggle);
  box.appendChild(form);
  return box;
}

// Waist down while weight holds steady = the recomp working. Over the last
// ~4 weeks of measurements; silent when there isn't enough data.
function renderRecompHint(logs) {
  const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
  const recent = (key) => metricPoints(logs, key).filter((p) => new Date(p.date).getTime() >= cutoff);
  const weight = recent("weightKg");
  const waist = recent("waistCm");
  if (weight.length < 2 || waist.length < 2) return null;
  const dWeight = weight[weight.length - 1].value - weight[0].value;
  const dWaist = waist[waist.length - 1].value - waist[0].value;
  let text = null;
  if (dWaist <= -0.5 && Math.abs(dWeight) <= 1) text = "Taille daalt terwijl je gewicht stabiel blijft — precies wat je bij body recomposition wilt zien.";
  else if (dWaist <= -0.5) text = "Je taille daalt: je verliest vet.";
  else if (dWaist >= 1) text = "Je taille stijgt de laatste weken — check je voeding.";
  if (!text) return null;
  const p = document.createElement("p");
  p.className = "recomp-hint";
  p.textContent = text;
  return p;
}

function renderOverviewCard(label, value, sub) {
  const card = document.createElement("div");
  card.className = "stat-card";
  const labelEl = document.createElement("p");
  labelEl.className = "stat-card-label";
  labelEl.textContent = label;
  card.appendChild(labelEl);
  const valueEl = document.createElement("p");
  valueEl.className = "stat-card-value";
  valueEl.textContent = value;
  card.appendChild(valueEl);
  if (sub) {
    const subEl = document.createElement("p");
    subEl.className = "stat-card-delta";
    subEl.textContent = sub;
    card.appendChild(subEl);
  }
  return card;
}

function renderTrainingOverview(sessions) {
  const wrap = document.createElement("section");
  const heading = document.createElement("h3");
  heading.className = "overview-heading";
  heading.textContent = "Training";
  wrap.appendChild(heading);

  const o = trainingOverview(sessions);
  const grid = document.createElement("div");
  grid.className = "stat-row stat-grid";
  grid.appendChild(renderOverviewCard("Laatste 7 dagen", `${o.sessions7}×`, "trainingen"));
  grid.appendChild(renderOverviewCard("Laatste 30 dagen", `${o.sessions30}×`, o.cardio30 ? `trainingen · ${o.cardio30}× cardio` : "trainingen"));
  grid.appendChild(renderOverviewCard("Volume 30 dagen", formatKg(o.volume30), `totaal ${formatKg(o.volumeTotal)}`));
  grid.appendChild(renderOverviewCard("Progressie", `${o.progressed}/${o.tracked}`, "oefeningen sterker dan 4 wk geleden"));
  wrap.appendChild(grid);
  return wrap;
}

// Per exercise: last weight, best weight, reps, total volume, e1RM and a trend
// line. Current schema's exercises first (in schema order), then anything that
// is only in the history (e.g. dropped from the schema by the migration).
function renderExerciseProgress(sessions, days) {
  const section = document.createElement("section");
  section.className = "trend-section";
  const heading = document.createElement("h3");
  heading.textContent = "Per oefening";
  section.appendChild(heading);

  const byName = historyByExercise(sessions);
  if (!byName.size) {
    const empty = document.createElement("p");
    empty.textContent = "Log een training via Vandaag om hier je voortgang per oefening te zien.";
    section.appendChild(empty);
    return section;
  }

  const schemaExercises = new Map();
  days.forEach((day) => day.exercises.forEach((ex) => {
    if (!schemaExercises.has(ex.name)) schemaExercises.set(ex.name, ex);
  }));
  const inSchema = [...schemaExercises.keys()].filter((name) => byName.has(name));
  const historyOnly = [...byName.keys()].filter((name) => !schemaExercises.has(name));

  inSchema.forEach((name) => section.appendChild(renderExerciseCard(name, byName.get(name), schemaExercises.get(name))));
  if (historyOnly.length) {
    const sub = document.createElement("p");
    sub.className = "progress-sublabel";
    sub.textContent = "Niet meer in je schema:";
    section.appendChild(sub);
    historyOnly.forEach((name) => section.appendChild(renderExerciseCard(name, byName.get(name), null)));
  }
  return section;
}

function formatDeltaKg(first, last) {
  const delta = Math.round((last - first) * 10) / 10;
  if (delta === 0) return "gelijk";
  return delta > 0 ? `+${delta} kg` : `${delta} kg`;
}

function renderExerciseCard(name, history, exercise) {
  const s = summariseExercise(history);
  const card = document.createElement("details");
  card.className = "exercise-progress";

  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.className = "exercise-progress-name";
  title.textContent = name;
  summary.appendChild(title);
  const chip = document.createElement("span");
  chip.className = hasProgressed(history) ? "chip chip-up" : "chip chip-muted";
  chip.textContent = `${s.lastWeight} kg`;
  summary.appendChild(chip);
  card.appendChild(summary);

  const lines = [
    `Laatst (${formatShortDate(s.lastDate)}): ${formatSetsLine(s.lastSets)}${s.lastRir != null ? ` · RIR ${formatRir(s.lastRir)}` : ""}`,
    `Beste gewicht: ${s.bestWeight} kg × ${s.bestWeightReps}`,
    `Totaal volume: ${formatKg(s.totalVolume)} over ${s.count} ${s.count === 1 ? "sessie" : "sessies"}`,
  ];
  // e1RM is only a meaningful number for work in a lowish rep range; for a
  // 12–20 rep lateral raise it would mostly be noise, so the trend shows the
  // working weight there instead.
  const e1rmRelevant = (exercise ? exercise.repMax : Math.min(...s.lastSets.map((x) => x.reps))) <= 12;
  if (e1rmRelevant) lines.push(`Geschat 1RM: ${s.firstE1rm} → ${s.lastE1rm} kg (${formatDeltaKg(s.firstE1rm, s.lastE1rm)})`);
  else lines.push(`Werkgewicht: ${s.weightSeries[0]} → ${s.weightSeries[s.weightSeries.length - 1]} kg (${formatDeltaKg(s.weightSeries[0], s.weightSeries[s.weightSeries.length - 1])})`);

  lines.forEach((text) => {
    const line = document.createElement("p");
    line.className = "exercise-progress-line";
    line.textContent = text;
    card.appendChild(line);
  });
  if (history.length >= 2) card.appendChild(renderSparkline(e1rmRelevant ? s.e1rmSeries : s.weightSeries));
  return card;
}

const STATUS_TEXT = { none: "niet getraind", low: "onder doel", ok: "op doel", high: "boven doel" };

// Body map + list: hard sets per muscle group, rolling 7 days or what the
// schema plans per week, against a hypertrophy target range per muscle.
function renderMuscleSection(sessions, days) {
  const section = document.createElement("section");
  section.className = "trend-section muscle-section";

  const heading = document.createElement("h3");
  heading.className = "overview-heading";
  heading.textContent = "Spieren";
  section.appendChild(heading);

  const resolve = makeMuscleResolver(days);
  const views = {
    recent: { label: "7 dagen", sets: recentMuscleSets(sessions, resolve) },
    planned: { label: "Schema", sets: plannedMuscleSets(days) },
    recovery: { label: "Herstel", recovery: muscleRecovery(sessions, resolve) },
  };
  const caption = document.createElement("p");
  caption.className = "sync-help";

  const toggle = document.createElement("div");
  toggle.className = "segmented";
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Spierkaart weergave");
  const mapSlot = document.createElement("div");
  mapSlot.className = "body-map-slot";
  const list = document.createElement("div");
  list.className = "muscle-list";

  const show = (key) => {
    const view = views[key];
    toggle.querySelectorAll("button").forEach((b) => {
      const active = b.dataset.view === key;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", String(active));
    });
    mapSlot.innerHTML = "";
    if (view.recovery) {
      const r = view.recovery;
      mapSlot.appendChild(renderBodyMap({}, {
        label: "Spierkaart, herstel",
        heat: (k) => r[k].recovered,
        describe: (k) => `${muscleLabel(k)}: ${r[k].hoursLeft ? `nog ~${r[k].hoursLeft} u herstel` : "hersteld"}`,
      }));
      mapSlot.appendChild(renderBodyMapLegend("net getraind", "hersteld"));
      caption.textContent = "Schatting: een spier herstelt in ongeveer 24 uur + 6 uur per harde set (max. 72 uur). Een richtlijn, geen meting — voel je je nog niet hersteld, dan klopt dat ook.";
      renderRecoveryList(list, r);
    } else {
      mapSlot.appendChild(renderBodyMap(view.sets, { label: `Spierkaart, ${view.label.toLowerCase()}` }));
      mapSlot.appendChild(renderBodyMapLegend());
      caption.textContent = view === views.planned
        ? "Wat je schema per week voorschrijft als je elke dag één keer traint. Hoofdspier telt 1, hulpspier ½. Doel voor spiergroei meestal ±10–20 sets per week."
        : "Harde sets per spiergroep in de laatste 7 dagen: hoofdspier telt 1, hulpspier ½. Doel voor spiergroei meestal ±10–20 sets per week.";
      renderMuscleList(list, view.sets);
    }
  };
  Object.entries(views).forEach(([key, view]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.view = key;
    btn.textContent = view.label;
    btn.addEventListener("click", () => show(key));
    toggle.appendChild(btn);
  });

  section.appendChild(toggle);
  section.appendChild(mapSlot);
  section.appendChild(caption);
  section.appendChild(list);
  show("recent");
  return section;
}

// Recovering muscles first, least recovered at the top; the rest summarised.
function renderRecoveryList(list, recovery) {
  list.innerHTML = "";
  const recovering = MUSCLES.filter(({ key }) => recovery[key].hoursLeft > 0)
    .sort((a, b) => recovery[b.key].hoursLeft - recovery[a.key].hoursLeft);
  if (!recovering.length) {
    const row = document.createElement("div");
    row.className = "muscle-row status-ok";
    row.innerHTML = '<span class="muscle-row-name">Alle spieren zijn hersteld</span><span></span><span class="muscle-row-status">klaar</span>';
    list.appendChild(row);
    return;
  }
  recovering.forEach(({ key, label }) => {
    const r = recovery[key];
    const row = document.createElement("div");
    row.className = `muscle-row ${r.recovered < 0.5 ? "status-low" : "status-ok"}`;
    const name = document.createElement("span");
    name.className = "muscle-row-name";
    name.textContent = label;
    const value = document.createElement("span");
    value.className = "muscle-row-value";
    value.textContent = `${Math.round(r.recovered * 100)}%`;
    const chip = document.createElement("span");
    chip.className = "muscle-row-status";
    chip.textContent = `nog ~${r.hoursLeft} u`;
    row.append(name, value, chip);
    list.appendChild(row);
  });
}

function renderMuscleList(list, setsByMuscle) {
  list.innerHTML = "";
  MUSCLES.forEach(({ key, label, target }) => {
    const sets = setsByMuscle[key] || 0;
    const status = volumeStatus(key, sets);
    const row = document.createElement("div");
    row.className = `muscle-row${status ? ` status-${status}` : ""}`;

    const name = document.createElement("span");
    name.className = "muscle-row-name";
    name.textContent = label;
    row.appendChild(name);

    const value = document.createElement("span");
    value.className = "muscle-row-value";
    value.textContent = target ? `${formatSets(sets)} / ${target[0]}–${target[1]}` : formatSets(sets);
    row.appendChild(value);

    if (status) {
      const chip = document.createElement("span");
      chip.className = "muscle-row-status";
      chip.textContent = STATUS_TEXT[status];
      row.appendChild(chip);
    }
    list.appendChild(row);
  });
}

// Records from the last 30 days, newest first; omitted when there are none.
function renderRecordsSection(sessions) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const records = [...recordsBySession(sessions).values()]
    .flat()
    .filter((r) => new Date(r.date).getTime() >= cutoff)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!records.length) return null;

  const section = document.createElement("section");
  section.className = "trend-section";
  const heading = document.createElement("h3");
  heading.className = "overview-heading";
  heading.textContent = `🏆 Records (30 dagen): ${records.length}`;
  section.appendChild(heading);
  records.slice(0, 10).forEach((record) => {
    const line = document.createElement("p");
    line.className = "records-line";
    line.textContent = `${formatShortDate(record.date)} — ${formatRecord(record)}`;
    section.appendChild(line);
  });
  return section;
}

// Protein and steps: 7-day averages against the daily targets, a 14-day trend,
// and the targets themselves (editable).
async function renderDailySection(rootContainer, bodyLogs) {
  const section = document.createElement("section");
  section.className = "trend-section";
  const heading = document.createElement("h3");
  heading.className = "overview-heading";
  heading.textContent = "Eiwit & stappen";
  section.appendChild(heading);

  const logs = await storage.getDailyLogs();
  const weight = bodyLogs.find((l) => l.weightKg != null)?.weightKg ?? (await latestWeightKg());
  const targets = getTargets(weight);
  const averages = dailyAverages(logs);

  const grid = document.createElement("div");
  grid.className = "stat-row stat-grid";
  grid.appendChild(renderOverviewCard(
    "Eiwit (gem. 7 d)",
    averages.protein ? `${averages.protein.avg} g` : "–",
    `doel ${targets.proteinG} g${averages.protein ? ` · ${averages.protein.days} d gelogd` : ""}`
  ));
  grid.appendChild(renderOverviewCard(
    "Stappen (gem. 7 d)",
    averages.steps ? averages.steps.avg.toLocaleString("nl-NL") : "–",
    `doel ${targets.steps.toLocaleString("nl-NL")}${averages.steps ? ` · ${averages.steps.days} d gelogd` : ""}`
  ));
  section.appendChild(grid);

  const proteinSeries = dailySeries(logs, "proteinG");
  const stepsSeries = dailySeries(logs, "steps");
  if (proteinSeries.filter((v) => v > 0).length >= 2) {
    const label = document.createElement("div");
    label.className = "progress-sublabel";
    label.textContent = "Eiwit, laatste 14 dagen";
    section.append(label, renderSparkline(proteinSeries, { area: true }));
  }
  if (stepsSeries.filter((v) => v > 0).length >= 2) {
    const label = document.createElement("div");
    label.className = "progress-sublabel";
    label.textContent = "Stappen, laatste 14 dagen";
    section.append(label, renderSparkline(stepsSeries, { area: true }));
  }

  const form = document.createElement("form");
  form.className = "inline-form daily-targets";
  form.noValidate = true;
  const proteinInput = makeDecimalInput("inline-form-input", String(targets.proteinG));
  proteinInput.value = targets.proteinG;
  const stepsInput = makeDecimalInput("inline-form-input", String(targets.steps));
  stepsInput.inputMode = "numeric";
  stepsInput.value = targets.steps;
  const row = (text, input) => {
    const label = document.createElement("label");
    label.className = "inline-form-row";
    const caption = document.createElement("span");
    caption.textContent = text;
    label.append(caption, input);
    return label;
  };
  form.appendChild(row("Eiwitdoel (g/dag)", proteinInput));
  form.appendChild(row("Stappendoel", stepsInput));
  const hint = document.createElement("p");
  hint.className = "sync-help";
  hint.textContent = targets.proteinIsDerived
    ? `Eiwitdoel nu automatisch: 2 g per kg van je laatste gewicht (${weight} kg).`
    : "Eigen doelen ingesteld.";
  form.appendChild(hint);
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn btn-small btn-accent";
  save.textContent = "Doelen opslaan";
  form.appendChild(save);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const proteinG = Math.round(parseDecimal(proteinInput.value));
    const steps = Math.round(parseDecimal(stepsInput.value.replace(/\./g, "")));
    setTargets({ proteinG: proteinG > 0 ? proteinG : null, steps: steps > 0 ? steps : null });
    renderProgressView(rootContainer);
  });
  section.appendChild(form);
  section.appendChild(renderSamsungImport((message) => {
    showToast(message, 4000);
    renderProgressView(rootContainer);
  }));
  return section;
}

const WEEKS_SHOWN = 12;
const CATEGORY_WINDOW_WEEKS = 4;

function formatKg(volume) {
  return `${Math.round(volume).toLocaleString("nl-NL")} kg`;
}

// Whole-schema training stats, as opposed to the Geschiedenis tab's
// per-exercise trends: total work done per week, and how it splits over
// movement types — which is where a lagging Pull or skipped leg day shows up.
async function renderVolumeSection() {
  const section = document.createElement("section");
  section.className = "trend-section";

  const heading = document.createElement("h3");
  heading.textContent = "Trainingsvolume";
  section.appendChild(heading);

  const sessions = await storage.getSessions();
  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.textContent = "Log een training via Vandaag om je volume hier te zien.";
    section.appendChild(empty);
    return section;
  }

  const weeks = volumeByWeek(sessions, WEEKS_SHOWN);
  const thisWeek = weeks[weeks.length - 1];
  const lastWeek = weeks[weeks.length - 2];

  const summary = document.createElement("div");
  summary.className = "progress-label";
  summary.textContent = thisWeek.sessions
    ? `Deze week: ${formatKg(thisWeek.volume)} · ${thisWeek.sets} sets · ${thisWeek.sessions} ${thisWeek.sessions === 1 ? "sessie" : "sessies"}`
    : "Deze week nog niet getraind.";
  section.appendChild(summary);

  const change = lastWeek ? percentChange(thisWeek.volume, lastWeek.volume) : null;
  if (change !== null) {
    const delta = document.createElement("p");
    delta.className = change >= 0 ? "volume-delta up" : "volume-delta down";
    delta.textContent = `${change >= 0 ? "+" : ""}${change}% t.o.v. vorige week (${formatKg(lastWeek.volume)})`;
    section.appendChild(delta);
  }

  const caption = document.createElement("p");
  caption.className = "sync-help";
  caption.textContent = `Volume per week, laatste ${WEEKS_SHOWN} weken (gewicht × reps, alle sets bij elkaar).`;
  section.appendChild(caption);
  section.appendChild(renderSparkline(weeks.map((week) => week.volume), { area: true }));

  section.appendChild(renderCategoryBreakdown(sessions));
  return section;
}

function renderCategoryBreakdown(sessions) {
  const wrap = document.createElement("div");
  wrap.className = "category-breakdown";

  const since = new Date();
  since.setDate(since.getDate() - CATEGORY_WINDOW_WEEKS * 7);
  const categories = volumeByCategory(sessions, since);

  const heading = document.createElement("div");
  heading.className = "progress-label";
  heading.textContent = `Verdeling (laatste ${CATEGORY_WINDOW_WEEKS} weken)`;
  wrap.appendChild(heading);

  if (!categories.length) {
    const empty = document.createElement("p");
    empty.textContent = "Geen trainingen in deze periode.";
    wrap.appendChild(empty);
    return wrap;
  }

  // Bars are scaled against the biggest category, so the comparison between
  // movement types stays readable whatever the absolute numbers are.
  const max = categories[0].volume;
  categories.forEach((row) => {
    const item = document.createElement("div");
    item.className = "category-row";

    const label = document.createElement("div");
    label.className = "category-row-label";
    label.textContent = `${row.category} — ${formatKg(row.volume)} · ${row.sets} sets`;
    item.appendChild(label);

    const track = document.createElement("div");
    track.className = "category-bar";
    const fill = document.createElement("div");
    fill.className = "category-bar-fill";
    fill.style.width = `${max > 0 ? (row.volume / max) * 100 : 0}%`;
    track.appendChild(fill);
    item.appendChild(track);

    wrap.appendChild(item);
  });

  return wrap;
}

async function renderBodyLogSection(rootContainer, logs) {
  const section = document.createElement("section");

  const formHeading = document.createElement("h3");
  formHeading.textContent = "Meting loggen";
  section.appendChild(formHeading);

  const form = document.createElement("form");
  form.className = "body-log-form";

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "body-log-date";
  dateInput.value = new Date().toISOString().slice(0, 10);
  form.appendChild(dateInput);

  const weightInput = makeDecimalInput("body-log-weight", "Gewicht (kg)");
  form.appendChild(weightInput);

  const waistInput = makeDecimalInput("body-log-waist", "Taille (cm)");
  form.appendChild(waistInput);

  const noteInput = document.createElement("textarea");
  noteInput.placeholder = "Opmerking (optioneel)";
  noteInput.className = "body-log-note";
  form.appendChild(noteInput);

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Opslaan";
  form.appendChild(saveBtn);

  const status = document.createElement("p");
  status.className = "save-status";
  form.appendChild(status);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const weightKg = parseDecimal(weightInput.value);
    const waistCm = parseDecimal(waistInput.value);
    if (Number.isNaN(weightKg) && Number.isNaN(waistCm)) {
      status.textContent = "Vul minstens gewicht of taille in voordat je opslaat.";
      return;
    }
    await storage.saveBodyLog({
      id: crypto.randomUUID(),
      date: new Date(dateInput.value || Date.now()).toISOString(),
      weightKg: Number.isNaN(weightKg) ? null : weightKg,
      waistCm: Number.isNaN(waistCm) ? null : waistCm,
      note: noteInput.value.trim(),
    });
    status.textContent = "Opgeslagen.";
    // Full re-render, not just this section: a new log can change the
    // headline stat cards above too.
    renderProgressView(rootContainer);
  });

  section.appendChild(form);
  section.appendChild(renderTrends(logs));
  section.appendChild(renderLogList(logs));

  return section;
}

function renderTrends(logs) {
  const wrap = document.createElement("div");
  wrap.className = "trend-section";

  const weightPoints = metricPoints(logs, "weightKg");
  const waistPoints = metricPoints(logs, "waistCm");

  if (weightPoints.length >= 2) wrap.appendChild(renderMetricTrend("Gewicht", weightPoints, "kg", getGoalWeight()));
  if (waistPoints.length >= 2) wrap.appendChild(renderMetricTrend("Taille", waistPoints, "cm"));

  if (!wrap.children.length) {
    const empty = document.createElement("p");
    empty.textContent = "Log minstens 2 metingen om een trend te zien.";
    wrap.appendChild(empty);
  }

  return wrap;
}

function formatSigned(value, unit) {
  return `${value > 0 ? "+" : ""}${value}${unit}`;
}

function renderMetricTrend(label, points, unit, goal = null) {
  const box = document.createElement("div");
  const first = points[0];
  const last = points[points.length - 1];

  const heading = document.createElement("div");
  heading.className = "progress-label";
  heading.textContent = `${label}: ${first.value}${unit} → ${last.value}${unit}`;
  box.appendChild(heading);

  const trend = weeklyTrend(points);
  // Rounded the same way weeklyTrend rounds its own total, so the fallback
  // line can't show floating-point noise that the normal path never would.
  const totalDelta = trend ? trend.total : Math.round((last.value - first.value) * 10) / 10;
  const detail = document.createElement("div");
  detail.className = "trend-rate";
  detail.textContent = trend
    ? `${formatSigned(totalDelta, unit)} totaal sinds ${formatShortDate(first.date)} · ${formatSigned(trend.perWeek, unit)}/week (over ${trend.weeks} weken)`
    // Real, just not extrapolated: two measurements a day or two apart don't
    // say anything reliable about a weekly rate.
    : `${formatSigned(totalDelta, unit)} totaal sinds ${formatShortDate(first.date)}`;
  box.appendChild(detail);

  box.appendChild(renderSparkline(points.map((p) => p.value), { area: true, height: 70, goal }));
  if (goal != null) {
    const legend = document.createElement("div");
    legend.className = "trend-rate";
    legend.textContent = `Stippellijn = doel (${goal} ${unit})`;
    box.appendChild(legend);
  }
  return box;
}

function formatShortDate(date) {
  return new Date(date).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
}

function renderLogList(logs) {
  const list = document.createElement("ul");
  list.className = "body-log-list";

  if (!logs.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nog geen metingen gelogd.";
    list.appendChild(empty);
    return list;
  }

  logs.forEach((log) => {
    const item = document.createElement("li");
    item.className = "body-log-item";

    const dateLabel = new Date(log.date).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const parts = [];
    if (log.weightKg != null) parts.push(`${log.weightKg}kg`);
    if (log.waistCm != null) parts.push(`${log.waistCm}cm`);

    const summary = document.createElement("div");
    summary.className = "session-summary";
    summary.textContent = `${dateLabel} — ${parts.join(", ") || "geen meting"}`;
    item.appendChild(summary);

    if (log.note) {
      const note = document.createElement("div");
      note.className = "session-details";
      note.textContent = log.note;
      item.appendChild(note);
    }

    list.appendChild(item);
  });

  return list;
}

async function renderPhotoSection(rootContainer) {
  const section = document.createElement("section");

  const heading = document.createElement("h3");
  heading.textContent = "Foto's";
  section.appendChild(heading);

  const form = document.createElement("form");
  form.className = "photo-form";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.className = "photo-file-input";
  form.appendChild(fileInput);

  const labelInput = document.createElement("input");
  labelInput.type = "text";
  labelInput.placeholder = "Label (bv. Start, 3 maanden)";
  labelInput.className = "photo-label-input";
  form.appendChild(labelInput);

  const addBtn = document.createElement("button");
  addBtn.type = "submit";
  addBtn.className = "btn btn-primary";
  addBtn.textContent = "Foto toevoegen";
  form.appendChild(addBtn);

  const status = document.createElement("p");
  status.className = "save-status";
  form.appendChild(status);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!file) {
      status.textContent = "Kies eerst een foto.";
      return;
    }
    await storage.savePhoto({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      label: labelInput.value.trim(),
      blob: file,
    });
    status.textContent = "Foto opgeslagen.";
    section.replaceWith(await renderPhotoSection(rootContainer));
  });

  section.appendChild(form);
  section.appendChild(await renderPhotoGallery());

  return section;
}

async function renderPhotoGallery() {
  const photos = await storage.getPhotos();
  const gallery = document.createElement("div");
  gallery.className = "photo-gallery";

  if (!photos.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nog geen foto's toegevoegd.";
    gallery.appendChild(empty);
    return gallery;
  }

  photos.forEach((photo) => {
    const cell = document.createElement("div");
    cell.className = "photo-cell";

    // Object URL, not a data: URI — no base64 conversion needed for a Blob
    // already sitting in IndexedDB.
    const url = URL.createObjectURL(photo.blob);
    const img = document.createElement("img");
    img.src = url;
    img.className = "photo-thumb";
    img.alt = photo.label || "Voortgangsfoto";
    cell.appendChild(img);

    img.addEventListener("click", () => {
      cell.classList.toggle("enlarged");
    });

    if (photo.label) {
      const label = document.createElement("div");
      label.className = "photo-cell-label";
      label.textContent = photo.label;
      cell.appendChild(label);
    }

    gallery.appendChild(cell);
  });

  return gallery;
}
