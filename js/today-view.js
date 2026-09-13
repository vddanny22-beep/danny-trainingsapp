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
  const day = days.find((d) => d.id === selectedDayId) || days[0];
  container.innerHTML = "";

  const totalSets = day.exercises.reduce((sum, ex) => sum + ex.sets, 0);
  const { hero, ringSvg } = renderHero(day, totalSets);
  container.appendChild(hero);

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

  for (const [index, exercise] of day.exercises.entries()) {
    form.appendChild(await renderExerciseBlock(exercise, day, index));
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

async function renderExerciseBlock(exercise, day, index) {
  const block = document.createElement("div");
  block.className = "exercise-block";
  block.dataset.exerciseId = exercise.id;
  block.dataset.exerciseName = exercise.name;
  block.dataset.exerciseIndex = index + 1;

  // Fetched once and used below — the suggestion is derived from exactly the
  // sets shown as "vorige keer".
  const last = await storage.getLastEntryForExerciseName(exercise.name);
  const suggestedWeight = computeSuggestedWeight(last, exercise, day);

  block.appendChild(renderExerciseHeader(exercise, suggestedWeight, block));

  const body = document.createElement("div");
  body.className = "exercise-body";

  const meta = document.createElement("p");
  meta.className = "exercise-meta";
  meta.textContent = `${exercise.sets} sets, ${exercise.repMin}-${exercise.repMax} reps`;
  body.appendChild(meta);

  // The suggestion alone doesn't say whether you cruised through last time or
  // barely finished — the actual reps do, and that's what decides whether to
  // push today.
  if (last?.entry.sets.length) {
    const previous = document.createElement("p");
    previous.className = "previous-sets";
    const setsText = last.entry.sets.map((set) => `${set.weight}×${set.reps}`).join("  ");
    previous.textContent = `Vorige keer (${formatShortDate(last.date)}): ${setsText}`;
    body.appendChild(previous);
  }

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
    repsInput.placeholder = "reps";
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

  block.appendChild(body);
  return block;
}

// Tappable summary row: exercise name, its suggested-weight chip, and a
// chevron that flips the block's collapsed/expanded state. Kept separate
// from the sets themselves (`.exercise-body`) so collapsing one exercise
// never touches the inputs the form actually reads on save.
function renderExerciseHeader(exercise, suggestedWeight, block) {
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
  chip.textContent = suggestedWeight != null ? `${suggestedWeight} kg` : "–";
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
