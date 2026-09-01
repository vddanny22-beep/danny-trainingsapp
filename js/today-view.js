import * as storage from "./storage.js";
import { hitTopOfRange, isLegDay, suggestNextWeight } from "./progression.js";
import { startRestTimer, stopRestTimer } from "./rest-timer.js";
import { loadDraft, saveDraft, clearDraft } from "./workout-draft.js";
import { makeDecimalInput, parseDecimal } from "./decimal-input.js";
import { showToast } from "./ui-toast.js";
import { renderProgressRing, updateProgressRing } from "./progress-ring.js";

export async function renderTodayView(container) {
  const days = await storage.getDays();
  if (!days.length) {
    container.innerHTML = "<p>Nog geen schema. Ga naar het Schema-tabblad om er een te maken.</p>";
    return;
  }

  const defaultDay = await pickDefaultDay(days);
  await renderForDay(container, days, defaultDay.id);
}

async function pickDefaultDay(days) {
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

  hero.appendChild(text);

  const ringSvg = renderProgressRing(0, totalSets ? `0/${totalSets}` : "–");
  ringSvg.classList.add("today-hero-ring");
  hero.appendChild(ringSvg);

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

async function renderForDay(container, days, selectedDayId) {
  const day = days.find((d) => d.id === selectedDayId) || days[0];
  container.innerHTML = "";

  const totalSets = day.exercises.reduce((sum, ex) => sum + ex.sets, 0);
  const { hero, ringSvg } = renderHero(day, totalSets);
  container.appendChild(hero);

  const picker = document.createElement("select");
  picker.className = "day-picker";
  days.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.name;
    if (d.id === day.id) opt.selected = true;
    picker.appendChild(opt);
  });
  picker.addEventListener("change", () => renderForDay(container, days, picker.value));
  container.appendChild(picker);

  if (!day.exercises.length) {
    const empty = document.createElement("p");
    empty.textContent = "Deze dag heeft nog geen oefeningen. Voeg ze toe via het Schema-tabblad.";
    container.appendChild(empty);
    return;
  }

  const form = document.createElement("form");
  form.className = "today-form";

  for (const exercise of day.exercises) {
    form.appendChild(await renderExerciseBlock(exercise, day));
  }

  const note = document.createElement("textarea");
  note.className = "session-note-input";
  note.placeholder = "Notitie (optioneel) — bv. slecht geslapen, schouder gevoelig";
  note.rows = 2;
  form.appendChild(note);

  const draft = loadDraft(day.id);
  if (draft) {
    applyDraft(form, draft);
    // The form is appended below, so appending here puts the notice directly
    // above it, under the day picker.
    container.appendChild(renderDraftNotice(container, days, day));
  }

  // Ring starts reflecting whatever was just restored from the draft (or
  // stays at 0/total on a fresh form), not just future keystrokes.
  refreshProgressRing(ringSvg, form, totalSets);

  // Every keystroke, so nothing is lost however the tab goes away — a switch,
  // a reload, or the phone killing the page between sets. The same listener
  // also drives the dashboard ring, so filling in a set updates both without
  // a second "input" subscription on the form.
  form.addEventListener("input", () => {
    saveDraft(day.id, collectDraft(form));
    refreshProgressRing(ringSvg, form, totalSets);
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
    navigator.vibrate?.(20);
    status.textContent = "Opgeslagen. Volgende keer suggereert de app het nieuwe gewicht.";
    showToast("Sessie opgeslagen");

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

// Raw form contents, including half-filled rows — unlike buildSessionFromForm,
// which drops anything incomplete. A draft has to keep exactly what's on
// screen, including the set you're halfway through typing.
function collectDraft(form) {
  const sets = {};
  form.querySelectorAll(".exercise-block").forEach((block) => {
    sets[block.dataset.exerciseId] = [...block.querySelectorAll(".set-row")].map((row) => ({
      weight: row.querySelector(".weight-input").value,
      reps: row.querySelector(".reps-input").value,
    }));
  });
  return { note: form.querySelector(".session-note-input").value, sets };
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

async function renderExerciseBlock(exercise, day) {
  const block = document.createElement("fieldset");
  block.className = "exercise-block";
  block.dataset.exerciseId = exercise.id;
  block.dataset.exerciseName = exercise.name;

  const legend = document.createElement("legend");
  legend.textContent = `${exercise.name} (${exercise.sets} sets, ${exercise.repMin}-${exercise.repMax} reps)`;
  block.appendChild(legend);

  // Fetched once and used for both lines below — the suggestion is derived
  // from exactly the sets shown as "vorige keer".
  const last = await storage.getLastEntryForExerciseName(exercise.name);

  const suggestedWeight = computeSuggestedWeight(last, exercise, day);
  if (suggestedWeight != null) {
    const hint = document.createElement("p");
    hint.className = "suggested-weight";
    hint.textContent = `Voorgesteld gewicht: ${suggestedWeight} kg`;
    block.appendChild(hint);
  }

  // The suggestion alone doesn't say whether you cruised through last time or
  // barely finished — the actual reps do, and that's what decides whether to
  // push today.
  if (last?.entry.sets.length) {
    const previous = document.createElement("p");
    previous.className = "previous-sets";
    const setsText = last.entry.sets.map((set) => `${set.weight}×${set.reps}`).join("  ");
    previous.textContent = `Vorige keer (${formatShortDate(last.date)}): ${setsText}`;
    block.appendChild(previous);
  }

  for (let i = 1; i <= exercise.sets; i++) {
    const setRow = document.createElement("div");
    setRow.className = "set-row";

    const setLabel = document.createElement("span");
    setLabel.textContent = `Set ${i}`;
    setRow.appendChild(setLabel);

    const weightInput = makeDecimalInput("weight-input", "kg");
    if (suggestedWeight != null) weightInput.value = suggestedWeight;
    setRow.appendChild(weightInput);

    const repsInput = document.createElement("input");
    repsInput.type = "number";
    repsInput.placeholder = "reps";
    repsInput.className = "reps-input";
    // Filling in reps means the set is done, so that's when the rest starts.
    // "change" rather than "input": this fires once the field is committed,
    // not on every keystroke, which would restart the timer mid-typing.
    repsInput.addEventListener("change", () => {
      if (repsInput.value.trim()) startRestTimer();
    });
    setRow.appendChild(repsInput);

    block.appendChild(setRow);
  }

  return block;
}

function formatShortDate(date) {
  return new Date(date).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

function computeSuggestedWeight(last, exercise, day) {
  if (!last || !last.entry.sets.length) return null;
  const lastSet = last.entry.sets[last.entry.sets.length - 1];
  if (lastSet.weight == null || lastSet.reps == null) return null;
  const hitTop = hitTopOfRange(lastSet.reps, exercise.repMax);
  return suggestNextWeight(lastSet.weight, hitTop, isLegDay(day.name));
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
      entries.push({
        exerciseId: block.dataset.exerciseId,
        exerciseName: block.dataset.exerciseName,
        sets,
      });
    }
  });

  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    dayId: day.id,
    dayName: day.name,
    note: form.querySelector(".session-note-input").value.trim(),
    entries,
  };
}
