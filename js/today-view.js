import * as storage from "./storage.js";
import {
  recommendNext, incrementFor, weightStackOf, formatRir, formatAdviceWeight, formatTargetReps, RIR_OPTIONS,
} from "./progression.js";
import { startRestTimer, stopRestTimer } from "./rest-timer.js";
import { loadDraft, saveDraft, clearDraft, getDraftDayId } from "./workout-draft.js";
import { makeDecimalInput, parseDecimal } from "./decimal-input.js";
import { showToast } from "./ui-toast.js";
import { renderProgressRing, updateProgressRing } from "./progress-ring.js";
import { formatSetsLine, formatCardio } from "./formatters.js";
import { renderDailyCard } from "./daily-log.js";
import { recordsBySession, formatRecord } from "./exercise-stats.js";
import { makeMuscleResolver, sessionMuscleSets } from "./muscles.js";
import { renderBodyMap, renderBodyMapLegend } from "./body-map.js";
import { getDeloadState, deloadSets, renderDeloadBanner } from "./deload.js";

// Every render bumps this; a render that finds it changed after an await has
// been overtaken (e.g. the day picker changed while it was still loading the
// last-time data) and stops, so a slower stale render can never append its
// day's exercises on top of the one now on screen.
let renderToken = 0;

export async function renderTodayView(container) {
  const token = ++renderToken;
  const days = await storage.getDays();
  if (!days.length) {
    container.innerHTML = "<p>Nog geen schema. Ga naar het Schema-tabblad om er een te maken.</p>";
    return;
  }

  const defaultDay = await pickDefaultDay(days);
  if (token !== renderToken) return;
  await renderForDay(container, days, defaultDay.id);
}

async function pickDefaultDay(days) {
  const draftDay = days.find((d) => d.id === getDraftDayId());
  if (draftDay) return draftDay;
  const lastSession = await storage.getLastSession();
  if (!lastSession) return days[0];
  const lastIndex = days.findIndex((d) => d.id === lastSession.dayId);
  if (lastIndex === -1) return days[0];
  return days[(lastIndex + 1) % days.length];
}

// Dashboard strip shown above the day picker: today's date, the selected
// day's name, and a live progress ring for "sets completed / total sets".
// Purely presentational — totalSets/completed are just counts of what the
// form below already tracks, no new training logic.
function renderHero(day, totalSets) {
  const hero = document.createElement("div");
  hero.className = "today-hero";

  const text = document.createElement("div");
  text.className = "today-hero-text";

  const date = document.createElement("p");
  date.className = "today-hero-date";
  date.textContent = formatHeroDate(new Date());
  text.appendChild(date);

  const dayName = document.createElement("h2");
  dayName.className = "today-hero-day";
  dayName.textContent = day.name;
  text.appendChild(dayName);
  const subtitle = document.createElement("p");
  subtitle.className = "hero-subtitle";
  subtitle.textContent = "Bouw verder aan je kracht.";
  text.appendChild(subtitle);
  const stats = document.createElement("p");
  stats.className = "hero-stats";
  stats.textContent = day.exercises.length + " oefeningen  /  " + totalSets + " sets";
  text.appendChild(stats);

  hero.appendChild(text);

  const ringSvg = renderProgressRing(0, totalSets ? `0/${totalSets}` : "–");
  ringSvg.classList.add("today-hero-ring");
  const progress = document.createElement("div");
  progress.className = "hero-progress";
  progress.appendChild(ringSvg);
  const progressLabel = document.createElement("span");
  progressLabel.textContent = "SETS VOLTOOID";
  progress.appendChild(progressLabel);
  hero.appendChild(progress);

  return { hero, ringSvg };
}

function formatHeroDate(date) {
  return date.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
}

// Recomputes "sets completed" straight from the form's current inputs (same
// weight/reps validity check buildSessionFromForm uses to decide what counts
// as a real set) and pushes it into the already-mounted ring.
function refreshProgressRing(ringSvg, form, totalSets) {
  const completed = [...form.querySelectorAll(".set-row")].filter((row) => parseSetRow(row) !== null).length;
  const fraction = totalSets ? completed / totalSets : 0;
  updateProgressRing(ringSvg, fraction, totalSets ? `${completed}/${totalSets}` : "–");
}

// A set only "counts" once both weight and reps parse to real numbers. Shared
// by the ring above and buildSessionFromForm below, so "completed" always
// means the same thing whether it's driving the dashboard or deciding what
// gets saved.
function parseSetRow(row) {
  const weight = parseDecimal(row.querySelector(".weight-input").value);
  const reps = parseInt(row.querySelector(".reps-input").value, 10);
  if (Number.isNaN(weight) || Number.isNaN(reps)) return null;
  return { weight, reps };
}

// Toggles the little checkmark on each set row using the same "counts as
// done" rule as the ring and the final save, so all three always agree.
function refreshSetCheckmarks(form) {
  form.querySelectorAll(".set-row").forEach((row) => {
    row.classList.toggle("done", parseSetRow(row) !== null);
  });
}

// The first exercise always opens expanded; the rest start collapsed so the
// day reads as "what's next" instead of a wall of sets. An exercise with any
// restored draft data expands too, so resuming a half-finished workout still
// shows the sets already filled in.
function autoExpandBlocks(form) {
  [...form.querySelectorAll(".exercise-block")].forEach((block, index) => {
    const hasData = [...block.querySelectorAll(".set-row")].some((row) => parseSetRow(row) !== null);
    if (index === 0 || hasData) block.classList.add("expanded");
    block.querySelector(".exercise-header").setAttribute("aria-expanded", String(block.classList.contains("expanded")));
  });
}

async function renderForDay(container, days, selectedDayId) {
  const token = ++renderToken;
  const deload = getDeloadState().active;
  const plannedDay = days.find((d) => d.id === selectedDayId) || days[0];
  // During a deload week every exercise is shown with half its sets; the
  // schema itself is untouched.
  const day = deload
    ? { ...plannedDay, exercises: plannedDay.exercises.map((ex) => ({ ...ex, sets: deloadSets(ex.sets) })) }
    : plannedDay;
  container.innerHTML = "";

  const totalSets = day.exercises.reduce((sum, ex) => sum + ex.sets, 0);
  const { hero, ringSvg } = renderHero(day, totalSets);
  container.appendChild(hero);
  const dailyCard = await renderDailyCard();
  const deloadBanner = renderDeloadBanner(await storage.getSessions(), days, () => renderForDay(container, days, day.id));
  if (token !== renderToken) return;
  container.appendChild(dailyCard);
  if (deloadBanner) container.appendChild(deloadBanner);

  const picker = document.createElement("select");
  picker.className = "day-picker";
  picker.setAttribute("aria-label", "Kies je trainingsdag");
  days.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    if (d.id === day.id) opt.selected = true;
    picker.appendChild(opt);
  });
  picker.addEventListener("change", () => renderForDay(container, days, picker.value));
  container.appendChild(picker);
  const section = document.createElement("div");
  section.className = "workout-section-heading";
  section.innerHTML = '<h3>Je oefeningen</h3><span>Vul je sets in</span>';
  container.appendChild(section);

  if (!day.exercises.length) {
    const empty = document.createElement("p");
    empty.textContent = "Deze dag heeft nog geen oefeningen. Voeg ze toe via het Schema-tabblad.";
    container.appendChild(empty);
    return;
  }

  const form = document.createElement("form");
  form.className = "today-form";
  if (deload) form.dataset.deload = "1";

  for (const [index, exercise] of day.exercises.entries()) {
    form.appendChild(await renderExerciseBlock(exercise, day, index, deload));
  }

  form.appendChild(renderCardioSection(await findLastCardio()));
  if (token !== renderToken) return;

  const note = document.createElement("textarea");
  note.className = "session-note-input";
  note.placeholder = "Notitie (optioneel) — bv. slecht geslapen, schouder gevoelig";
  note.rows = 2;
  form.appendChild(note);

  const draft = loadDraft(day.id);
  if (draft) {
    applyDraft(form, draft);
    form.querySelectorAll(".exercise-block").forEach((block) => block._refreshAdvice?.());
    // The form is appended below, so appending here puts the notice directly
    // above it, under the day picker.
    container.appendChild(renderDraftNotice(container, days, day));
  }

  // Ring and per-set checkmarks start reflecting whatever was just restored
  // from the draft (or stay at their empty state on a fresh form), not just
  // future keystrokes. Exercises with restored data also auto-expand, so
  // reopening a half-finished workout doesn't hide the sets already filled in.
  refreshProgressRing(ringSvg, form, totalSets);
  refreshSetCheckmarks(form);
  autoExpandBlocks(form);

  // Every keystroke, so nothing is lost however the tab goes away — a switch,
  // a reload, or the phone killing the page between sets. The same listener
  // also drives the dashboard ring and the per-set checkmarks, so filling in
  // a set updates all three without extra "input" subscriptions on the form.
  form.addEventListener("input", () => {
    saveDraft(day.id, collectDraft(form));
    refreshProgressRing(ringSvg, form, totalSets);
    refreshSetCheckmarks(form);
  });

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Sessie opslaan";
  form.appendChild(saveBtn);

  const status = document.createElement("p");
  status.className = "save-status";
  form.appendChild(status);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const session = buildSessionFromForm(form, day);
    if (!session.entries.length) {
      status.textContent = "Vul minstens één set in (gewicht + reps) voordat je opslaat.";
      return;
    }
    await storage.saveSession(session);
    stopRestTimer(); // workout logged — no set left to rest between
    clearDraft(); // it's a real session now, not something still in progress
    status.textContent = "Opgeslagen. Volgende keer suggereert de app het nieuwe gewicht.";

    // Records are computed over the whole history including this session,
    // so a backdated or edited session elsewhere can't fake one.
    const records = recordsBySession(await storage.getSessions()).get(session.id) || [];
    navigator.vibrate?.(records.length ? [30, 60, 30] : 20);
    showToast(records.length ? `Sessie opgeslagen — ${records.length} ${records.length === 1 ? "nieuw record" : "nieuwe records"}!` : "Sessie opgeslagen");
    form.appendChild(renderWorkoutSummary(session, records, days));

    // The old behaviour left a permanently dead button here: pressing save
    // again would log a duplicate session, but there was also no way forward
    // without switching tabs. Swapping the button gives an explicit next step
    // and still can't double-submit.
    const againBtn = document.createElement("button");
    againBtn.type = "button";
    againBtn.className = "btn btn-secondary";
    againBtn.textContent = "Nog een training loggen";
    againBtn.addEventListener("click", () => renderTodayView(container));
    saveBtn.replaceWith(againBtn);
  });

  container.appendChild(form);
}

// Shown under the form after saving: new records first (the moment they
// matter), then which muscles this workout hit.
function renderWorkoutSummary(session, records, days) {
  const wrap = document.createElement("section");
  wrap.className = "workout-summary";

  if (records.length) {
    const box = document.createElement("div");
    box.className = "records-box";
    const title = document.createElement("p");
    title.className = "records-title";
    title.textContent = records.length === 1 ? "🏆 Nieuw record" : `🏆 ${records.length} nieuwe records`;
    box.appendChild(title);
    records.forEach((record) => {
      const line = document.createElement("p");
      line.className = "records-line";
      line.textContent = formatRecord(record);
      box.appendChild(line);
    });
    wrap.appendChild(box);
  }

  const heading = document.createElement("p");
  heading.className = "progress-label";
  heading.textContent = "Getrainde spieren";
  wrap.appendChild(heading);
  wrap.appendChild(renderBodyMap(sessionMuscleSets(session, makeMuscleResolver(days)), { label: "Spierkaart van deze training", fullAt: 4 }));
  wrap.appendChild(renderBodyMapLegend("weinig", "veel sets"));
  return wrap;
}

// Raw form contents, including half-filled rows — unlike buildSessionFromForm,
// which drops anything incomplete. A draft has to keep exactly what's on
// screen, including the set you're halfway through typing.
function collectDraft(form) {
  const sets = {};
  const rir = {};
  form.querySelectorAll(".exercise-block").forEach((block) => {
    sets[block.dataset.exerciseId] = [...block.querySelectorAll(".set-row")].map((row) => ({
      weight: row.querySelector(".weight-input").value,
      reps: row.querySelector(".reps-input").value,
    }));
    if (block.dataset.rir) rir[block.dataset.exerciseId] = block.dataset.rir;
  });
  return { note: form.querySelector(".session-note-input").value, sets, rir, cardio: collectCardioRaw(form) };
}

function applyDraft(form, draft) {
  form.querySelectorAll(".exercise-block").forEach((block) => {
    const saved = draft.sets[block.dataset.exerciseId];
    if (!saved) return;
    [...block.querySelectorAll(".set-row")].forEach((row, i) => {
      if (!saved[i]) return;
      // A blank saved weight means the user cleared the prefilled suggestion;
      // restoring it as-is is what keeps the form exactly as they left it.
      row.querySelector(".weight-input").value = saved[i].weight ?? "";
      row.querySelector(".reps-input").value = saved[i].reps ?? "";
    });
  });
  form.querySelectorAll(".exercise-block").forEach((block) => {
    const rir = draft.rir?.[block.dataset.exerciseId];
    if (rir != null && rir !== "") setBlockRir(block, String(rir));
  });
  if (draft.cardio) {
    const fields = cardioFields(form);
    Object.entries(fields).forEach(([key, input]) => {
      input.value = draft.cardio[key] ?? "";
    });
    if (Object.values(draft.cardio).some((v) => String(v ?? "").trim())) form.querySelector(".cardio-section").open = true;
  }
  form.querySelector(".session-note-input").value = draft.note || "";
}

function renderDraftNotice(container, days, day) {
  const notice = document.createElement("div");
  notice.className = "draft-notice";

  const text = document.createElement("span");
  text.textContent = "Onafgemaakte training hersteld.";
  notice.appendChild(text);

  const discardBtn = document.createElement("button");
  discardBtn.type = "button";
  discardBtn.className = "btn btn-small";
  discardBtn.textContent = "Leegmaken";
  discardBtn.addEventListener("click", () => {
    clearDraft();
    renderForDay(container, days, day.id);
  });
  notice.appendChild(discardBtn);

  return notice;
}

async function renderExerciseBlock(exercise, day, index, deload = false) {
  const block = document.createElement("div");
  block.className = "exercise-block";
  block.dataset.exerciseId = exercise.id;
  block.dataset.exerciseName = exercise.name;
  block.dataset.exerciseIndex = index + 1;
  block.dataset.rir = "";

  // Fetched once and used below — today's advice is derived from exactly the
  // sets (and RIR) shown as "vorige keer".
  const last = await storage.getLastEntryForExerciseName(exercise.name);
  const advice = last ? recommendNext(last.entry.sets, last.entry.lastSetRir, exercise) : null;
  // Deload: the weight you last worked with, not the next step up.
  const suggestedWeight = advice ? (deload ? advice.currentWeight : advice.nextWeight) : null;

  block.appendChild(renderExerciseHeader(exercise, suggestedWeight, block, deload ? null : advice));

  const body = document.createElement("div");
  body.className = "exercise-body";

  const meta = document.createElement("p");
  meta.className = "exercise-meta";
  const stack = weightStackOf(exercise);
  meta.textContent = `Doel: ${exercise.sets} × ${exercise.repMin}–${exercise.repMax} · ${stack.length ? `machine-reeks (${stack.length} standen)` : `stap +${incrementFor(exercise)} kg`}`;
  body.appendChild(meta);

  // The suggestion alone doesn't say whether you cruised through last time or
  // barely finished — the actual reps (and RIR) do.
  if (last?.entry.sets.length) {
    const previous = document.createElement("p");
    previous.className = "previous-sets";
    const rirText = last.entry.lastSetRir != null ? ` · RIR ${formatRir(last.entry.lastSetRir)}` : "";
    previous.textContent = `Vorige keer (${formatShortDate(last.date)}): ${formatSetsLine(last.entry.sets)}${rirText}`;
    body.appendChild(previous);
  }

  if (deload) body.appendChild(renderDeloadAdvice(exercise, suggestedWeight));
  else if (advice) body.appendChild(renderAdviceBox("Advies vandaag", advice));

  for (let i = 1; i <= exercise.sets; i++) {
    const setRow = document.createElement("div");
    setRow.className = "set-row";
    setRow.appendChild(renderSetCheckIcon());

    const setLabel = document.createElement("span");
    setLabel.className = "set-label";
    setLabel.textContent = `Set ${i}`;
    setRow.appendChild(setLabel);

    const weightInput = makeDecimalInput("weight-input", "kg");
    weightInput.setAttribute("aria-label", `${exercise.name}, set ${i}, gewicht in kg`);
    if (suggestedWeight != null) weightInput.value = suggestedWeight;
    setRow.appendChild(weightInput);

    const repsInput = document.createElement("input");
    repsInput.type = "number";
    repsInput.inputMode = "numeric";
    repsInput.placeholder = advice?.targetReps ? `${advice.targetReps[i - 1]}+` : "reps";
    repsInput.className = "reps-input";
    repsInput.setAttribute("aria-label", `${exercise.name}, set ${i}, herhalingen`);
    // Filling in reps means the set is done, so that's when the rest starts.
    // "change" rather than "input": this fires once the field is committed,
    // not on every keystroke, which would restart the timer mid-typing.
    repsInput.addEventListener("change", () => {
      if (repsInput.value.trim()) startRestTimer();
    });
    setRow.appendChild(repsInput);

    body.appendChild(setRow);
  }

  body.appendChild(renderRirPicker(block, exercise));

  const liveAdvice = document.createElement("div");
  liveAdvice.className = "advice-live";
  body.appendChild(liveAdvice);

  // Recomputed from what's on screen on every change in this block, so the
  // advice for next time is visible the moment the last set + RIR are in.
  const refreshAdvice = () => {
    if (deload) return; // a deload session doesn't drive next time's advice
    const sets = [...block.querySelectorAll(".set-row")].map(parseSetRow).filter(Boolean);
    liveAdvice.innerHTML = "";
    if (!sets.length) return;
    const rir = block.dataset.rir === "" ? null : Number(block.dataset.rir);
    const rec = recommendNext(sets, rir, exercise);
    if (!rec) return;
    if (rir == null && rec.action === "increase") {
      const hint = document.createElement("p");
      hint.className = "advice-hint";
      hint.textContent = "Kies je RIR om het advies voor volgende keer te zien.";
      liveAdvice.appendChild(hint);
      return;
    }
    liveAdvice.appendChild(renderAdviceBox("Advies volgende training", rec));
  };
  block._refreshAdvice = refreshAdvice;
  block.addEventListener("input", refreshAdvice);

  block.appendChild(body);
  return block;
}

function renderDeloadAdvice(exercise, weight) {
  const box = document.createElement("div");
  box.className = "advice-box advice-deload";
  const title = document.createElement("p");
  title.className = "advice-title";
  title.textContent = "Deload-week";
  const main = document.createElement("p");
  main.className = "advice-main";
  main.textContent = `${exercise.sets} sets${weight != null ? ` · ${weight} kg (zelfde gewicht)` : ""} · stop op RIR 3+`;
  const detail = document.createElement("p");
  detail.className = "advice-detail";
  detail.textContent = "Licht houden: deze training telt niet mee voor je progressie-advies.";
  box.append(title, main, detail);
  return box;
}

const ADVICE_CLASS = { increase: "advice-up", hold: "advice-hold", improve: "advice-hold", "too-heavy": "advice-warn" };

function renderAdviceBox(title, rec) {
  const box = document.createElement("div");
  box.className = `advice-box ${ADVICE_CLASS[rec.action] || ""}`;

  const heading = document.createElement("p");
  heading.className = "advice-title";
  heading.textContent = `${title}: ${rec.label}`;
  box.appendChild(heading);

  const main = document.createElement("p");
  main.className = "advice-main";
  main.textContent = [formatAdviceWeight(rec), formatTargetReps(rec)].filter(Boolean).join(" · ");
  box.appendChild(main);

  const detail = document.createElement("p");
  detail.className = "advice-detail";
  detail.textContent = rec.detail;
  box.appendChild(detail);
  return box;
}

// Five big buttons, no extra screen: tap to choose, tap again to clear.
function renderRirPicker(block, exercise) {
  const wrap = document.createElement("div");
  wrap.className = "rir-picker";

  const question = document.createElement("p");
  question.className = "rir-question";
  question.id = `rir-q-${exercise.id}`;
  question.textContent = "Hoeveel reps had je nog over na je laatste set?";
  wrap.appendChild(question);

  const row = document.createElement("div");
  row.className = "rir-buttons";
  row.setAttribute("role", "group");
  row.setAttribute("aria-labelledby", question.id);
  RIR_OPTIONS.forEach((value) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rir-btn";
    btn.dataset.rir = String(value);
    btn.textContent = formatRir(value);
    btn.setAttribute("aria-label", `RIR ${formatRir(value)}`);
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => {
      const next = block.dataset.rir === String(value) ? "" : String(value);
      setBlockRir(block, next);
      navigator.vibrate?.(10);
      // Buttons don't fire "input"; this one bubbles to the form so the draft,
      // ring and live advice all update exactly as for a typed set.
      block.dispatchEvent(new Event("input", { bubbles: true }));
    });
    row.appendChild(btn);
  });
  wrap.appendChild(row);
  return wrap;
}

function setBlockRir(block, value) {
  block.dataset.rir = value;
  block.querySelectorAll(".rir-btn").forEach((btn) => {
    const active = btn.dataset.rir === value;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

// --- Cardio na training ----------------------------------------------------
// Logged on the session, never as an exercise entry: it must show up in the
// history but stay out of volume, progression and the progress ring.

async function findLastCardio() {
  const sessions = await storage.getSessions();
  return sessions.find((s) => s.cardio?.minutes > 0)?.cardio || null;
}

function cardioFields(form) {
  return {
    minutes: form.querySelector(".cardio-minutes"),
    inclinePct: form.querySelector(".cardio-incline"),
    speedKmh: form.querySelector(".cardio-speed"),
  };
}

function collectCardioRaw(form) {
  const fields = cardioFields(form);
  return Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]));
}

// Null unless minutes is a real positive number; incline/speed are optional.
function parseCardio(form) {
  const raw = collectCardioRaw(form);
  const minutes = parseDecimal(raw.minutes);
  if (!(minutes > 0)) return null;
  const inclinePct = parseDecimal(raw.inclinePct);
  const speedKmh = parseDecimal(raw.speedKmh);
  return {
    type: "incline-walk",
    minutes,
    inclinePct: Number.isNaN(inclinePct) ? null : inclinePct,
    speedKmh: Number.isNaN(speedKmh) ? null : speedKmh,
  };
}

function renderCardioSection(lastCardio) {
  const details = document.createElement("details");
  details.className = "cardio-section";

  const summary = document.createElement("summary");
  summary.textContent = "Cardio na training (optioneel)";
  details.appendChild(summary);

  const grid = document.createElement("div");
  grid.className = "cardio-grid";
  const field = (labelText, className, placeholder) => {
    const label = document.createElement("label");
    label.className = "cardio-field";
    const caption = document.createElement("span");
    caption.textContent = labelText;
    label.appendChild(caption);
    const input = makeDecimalInput(className, placeholder);
    label.appendChild(input);
    grid.appendChild(label);
    return input;
  };
  const minutes = field("Minuten", "cardio-minutes", "10");
  const incline = field("Helling %", "cardio-incline", "13");
  const speed = field("km/u", "cardio-speed", "3.5");
  details.appendChild(grid);

  if (lastCardio) {
    const sameBtn = document.createElement("button");
    sameBtn.type = "button";
    sameBtn.className = "btn btn-small cardio-same";
    sameBtn.textContent = `Zelfde als vorige keer (${formatCardio(lastCardio)})`;
    sameBtn.addEventListener("click", () => {
      minutes.value = lastCardio.minutes ?? "";
      incline.value = lastCardio.inclinePct ?? "";
      speed.value = lastCardio.speedKmh ?? "";
      details.dispatchEvent(new Event("input", { bubbles: true }));
    });
    details.appendChild(sameBtn);
  }

  return details;
}

// Tappable summary row: exercise name, its suggested-weight chip, and a
// chevron that flips the block's collapsed/expanded state. Kept separate
// from the sets themselves (`.exercise-body`) so collapsing one exercise
// never touches the inputs the form actually reads on save.
function renderExerciseHeader(exercise, suggestedWeight, block, advice) {
  const header = document.createElement("button");
  header.type = "button";
  header.className = "exercise-header";
  header.setAttribute("aria-expanded", "false");
  const thumb = document.createElement("span");
  thumb.className = "exercise-art";
  thumb.setAttribute("aria-hidden", "true");
  const leg = /leg|squat|calf/i.test(exercise.name);
  const cable = /cable|pull|row|fly|delt/i.test(exercise.name);
  const drawing = leg ? '<path d="M16 43h33M23 39l9-13 12 8-4 10M32 26l-7-9M21 17h12M44 34l7-13M49 20h7"/><circle cx="21" cy="12" r="4"/>' : cable ? '<path d="M16 49V12h35v37M12 49h12M44 49h12M34 12v13M26 25h16M27 29l7 5 8-5M34 34v10M26 49l8-5 8 5"/><circle cx="34" cy="24" r="4"/>' : '<path d="M14 27v14M20 21v26M20 34h26M46 21v26M52 27v14"/>';
  thumb.innerHTML = '<svg viewBox="0 0 68 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + drawing + '</svg>';
  header.appendChild(thumb);

  const name = document.createElement("span");
  name.className = "exercise-name";
  name.textContent = exercise.name;
  const title = document.createElement("span");
  title.className = "exercise-title";
  const detail = document.createElement("span");
  detail.className = "exercise-summary";
  detail.textContent = exercise.sets + " sets · " + exercise.repMin + "–" + exercise.repMax + " reps";
  title.append(name, detail);
  header.appendChild(title);

  const right = document.createElement("span");
  right.className = "exercise-header-right";

  const chip = document.createElement("span");
  chip.className = suggestedWeight != null ? "chip" : "chip chip-muted";
  if (advice?.action === "increase") chip.classList.add("chip-up");
  if (advice?.action === "too-heavy") chip.classList.add("chip-warn");
  chip.textContent = suggestedWeight != null ? `${advice?.action === "increase" ? "↑ " : ""}${suggestedWeight} kg` : "–";
  right.appendChild(chip);

  right.appendChild(renderChevronIcon());
  header.appendChild(right);

  header.addEventListener("click", () => {
    const expanded = block.classList.toggle("expanded");
    header.setAttribute("aria-expanded", String(expanded));
  });
  return header;
}

function renderChevronIcon() {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "exercise-chevron");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", "M9 6l6 6-6 6");
  svg.appendChild(path);
  return svg;
}

// Circle-outline/checkmark pair for one set row; CSS crossfades between them
// based on the row's own ".done" class (see refreshSetCheckmarks), so no DOM
// swapping is needed as the user types.
function renderSetCheckIcon() {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "set-check-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<circle class="check-bg" cx="12" cy="12" r="11"/>' +
    '<circle class="check-ring" cx="12" cy="12" r="10.5"/>' +
    '<path class="check-mark" d="M7 12.5l3 3 7-7"/>';
  return svg;
}

function formatShortDate(date) {
  return new Date(date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function buildSessionFromForm(form, day) {
  const entries = [];
  form.querySelectorAll(".exercise-block").forEach((block) => {
    const sets = [];
    block.querySelectorAll(".set-row").forEach((row) => {
      const parsed = parseSetRow(row);
      if (parsed) sets.push(parsed);
    });
    if (sets.length) {
      const entry = {
        exerciseId: block.dataset.exerciseId,
        exerciseName: block.dataset.exerciseName,
        sets,
      };
      // Only when chosen: an entry without lastSetRir means "not logged",
      // exactly like every session from before RIR existed.
      if (block.dataset.rir !== "") entry.lastSetRir = Number(block.dataset.rir);
      entries.push(entry);
    }
  });

  const session = {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    dayId: day.id,
    dayName: day.name,
    note: form.querySelector(".session-note-input").value.trim(),
    entries,
  };
  const cardio = parseCardio(form);
  if (cardio) session.cardio = cardio;
  if (form.dataset.deload) session.deload = true;
  return session;
}
