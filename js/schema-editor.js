import * as storage from "./storage.js";
import { getSyncUrl, setSyncUrl, syncNow } from "./sheet-sync.js";
import {
  getRestSeconds, setRestSeconds, REST_PRESETS,
  notificationsSupported, notificationsEnabled, notificationsBlocked, requestNotificationPermission,
} from "./rest-timer.js";
import { downloadBackup, restoreBackupFromFile } from "./backup.js";
import { confirmDialog } from "./ui-dialog.js";
import { showToast } from "./ui-toast.js";
import { makeDecimalInput, parseDecimal } from "./decimal-input.js";
import { incrementFor, weightStackOf, parseWeightStack, formatWeightStack } from "./progression.js";
import { getSchemaSnapshot, restoreSchemaSnapshot } from "./migrations.js";
import { MUSCLES, musclesFor, defaultMusclesFor } from "./muscles.js";

// Renders the full schema editor (all days, expandable to their exercises)
// into `container`. Every mutation re-fetches from storage and re-renders,
// which is simple and fine at this data size.
export async function renderSchemaEditor(container) {
  const days = await storage.getDays();
  container.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Schema";
  container.appendChild(heading);

  const list = document.createElement("div");
  list.className = "day-list";
  days.forEach((day, index) => list.appendChild(renderDayCard(day, container, days, index)));
  container.appendChild(list);

  const addDayBtn = document.createElement("button");
  addDayBtn.className = "btn btn-secondary";
  addDayBtn.textContent = "+ Dag toevoegen";
  addDayBtn.addEventListener("click", () => {
    addDayBtn.replaceWith(renderDayNameForm({
      submitLabel: "Toevoegen",
      onCancel: () => renderSchemaEditor(container),
      onSubmit: async (name) => {
        await storage.saveDay({
          id: crypto.randomUUID(),
          name,
          // One past the highest existing order rather than days.length:
          // deleting a day leaves a gap, and counting would hand the new day
          // an order another day already holds.
          order: days.length ? Math.max(...days.map((d) => d.order)) + 1 : 0,
          exercises: [],
        });
        renderSchemaEditor(container);
      },
    }));
  });
  container.appendChild(addDayBtn);
  container.appendChild(renderTrainingSettings());
  container.appendChild(renderBackupSettings());
  const snapshotSection = await renderSnapshotSettings(container);
  if (snapshotSection) container.appendChild(snapshotSection);
  container.appendChild(renderSyncSettings());
}

function renderBackupSettings() {
  const section = document.createElement("section");
  section.className = "sync-settings";

  const heading = document.createElement("h3");
  heading.textContent = "Back-up";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "sync-help";
  help.textContent = "Al je gegevens staan alleen op dit toestel. Maak een back-upbestand met je schema, sessies, metingen, eiwit/stappen en foto's — bewaar dat ergens veilig, en zet het terug als je een nieuwe telefoon hebt.";
  section.appendChild(help);

  const status = document.createElement("p");
  status.className = "sync-status";

  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "btn btn-secondary";
  exportBtn.textContent = "Back-up downloaden";
  exportBtn.addEventListener("click", async () => {
    exportBtn.disabled = true;
    status.textContent = "Back-up maken...";
    status.classList.remove("warn");
    const result = await downloadBackup();
    status.textContent = result.message;
    status.classList.toggle("warn", !result.ok);
    exportBtn.disabled = false;
  });
  section.appendChild(exportBtn);

  // Hidden input + its own button, so the restore can be confirmed before the
  // file picker even opens.
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "application/json,.json";
  fileInput.hidden = true;
  section.appendChild(fileInput);

  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "btn btn-secondary btn-danger";
  importBtn.textContent = "Back-up terugzetten";
  importBtn.addEventListener("click", async () => {
    // Highest-stakes confirmation in the app — it replaces everything on the
    // device — so it gets the danger styling, and confirmDialog's default
    // focus on the cancel button (never the destructive one) matters most
    // right here.
    const confirmed = await confirmDialog({
      title: "Back-up terugzetten",
      body: "Terugzetten vervangt je huidige schema, sessies, metingen, eiwit/stappen en foto's door die uit het back-upbestand. Doorgaan?",
      confirmLabel: "Terugzetten",
      danger: true,
    });
    if (!confirmed) return;
    fileInput.click();
  });
  section.appendChild(importBtn);

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    importBtn.disabled = true;
    status.textContent = "Terugzetten...";
    status.classList.remove("warn");
    const result = await restoreBackupFromFile(file);
    status.textContent = result.message;
    status.classList.toggle("warn", !result.ok);
    importBtn.disabled = false;
    fileInput.value = "";
    // Every tab is now showing data that no longer exists; a reload is the
    // simplest way to get the whole app onto the restored state at once.
    if (result.ok) setTimeout(() => location.reload(), 1800);
  });

  section.appendChild(status);
  return section;
}

// Only shown when the schema migration saved a copy of the old schema: a way
// back if the new plan doesn't suit, without touching any logged session.
async function renderSnapshotSettings(rootContainer) {
  const snapshot = await getSchemaSnapshot();
  if (!snapshot?.days?.length) return null;

  const section = document.createElement("section");
  section.className = "sync-settings";
  const heading = document.createElement("h3");
  heading.textContent = "Vorig schema";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "sync-help";
  const savedOn = new Date(snapshot.savedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });
  help.textContent = `Bij de update naar het nieuwe schema is je oude schema bewaard (${savedOn}). Terugzetten vervangt alleen het schema; je sessies, metingen en foto's blijven zoals ze zijn.`;
  section.appendChild(help);

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary";
  btn.textContent = "Oud schema terugzetten";
  btn.addEventListener("click", async () => {
    const confirmed = await confirmDialog({
      title: "Oud schema terugzetten",
      body: "Je huidige schema wordt vervangen door het schema van vóór de update. Doorgaan?",
      confirmLabel: "Terugzetten",
      danger: true,
    });
    if (!confirmed) return;
    await restoreSchemaSnapshot();
    showToast("Oud schema teruggezet");
    renderSchemaEditor(rootContainer);
  });
  section.appendChild(btn);
  return section;
}

function renderTrainingSettings() {
  const section = document.createElement("section");
  section.className = "sync-settings";

  const heading = document.createElement("h3");
  heading.textContent = "Trainingsinstellingen";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "sync-help";
  help.textContent = "Rusttijd tussen sets. De timer start automatisch zodra je de reps van een set invult.";
  section.appendChild(help);

  const picker = document.createElement("select");
  picker.className = "day-picker";
  const current = getRestSeconds();
  REST_PRESETS.forEach((seconds) => {
    const opt = document.createElement("option");
    opt.value = seconds;
    opt.textContent = seconds >= 60 && seconds % 60 === 0
      ? `${seconds / 60} min`
      : `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
    if (seconds === current) opt.selected = true;
    picker.appendChild(opt);
  });

  const status = document.createElement("p");
  status.className = "sync-status";

  picker.addEventListener("change", () => {
    setRestSeconds(parseInt(picker.value, 10));
    status.textContent = "Rusttijd opgeslagen.";
  });

  section.appendChild(picker);
  section.appendChild(status);
  section.appendChild(renderNotificationSetting());
  return section;
}

// Opt-in, because a permission prompt fired unannounced mid-workout is the
// kind of thing people deny once and then can't easily undo.
function renderNotificationSetting() {
  const wrap = document.createElement("div");
  wrap.className = "notification-setting";

  const help = document.createElement("p");
  help.className = "sync-help";
  wrap.appendChild(help);

  if (!notificationsSupported()) {
    help.textContent = "Meldingen worden niet ondersteund door deze browser. Het scherm blijft tijdens het rusten wel aan, zodat je de piep hoort.";
    return wrap;
  }

  const status = document.createElement("p");
  status.className = "sync-status";

  const enableBtn = document.createElement("button");
  enableBtn.type = "button";
  enableBtn.className = "btn btn-small";
  enableBtn.textContent = "Meldingen aanzetten";
  enableBtn.addEventListener("click", async () => {
    enableBtn.disabled = true;
    const result = await requestNotificationPermission();
    refresh();
    if (result === "denied") {
      status.textContent = "Meldingen geweigerd. Je kunt dit aanzetten via de site-instellingen van je browser.";
      status.classList.add("warn");
    }
  });
  wrap.appendChild(enableBtn);
  wrap.appendChild(status);

  function refresh() {
    const enabled = notificationsEnabled();
    const blocked = notificationsBlocked();
    help.textContent = enabled
      ? "Je krijgt een melding zodra je rust erop zit, ook als je de app even weglegt. Tijdens het rusten blijft het scherm aan."
      : "Zet meldingen aan om een seintje te krijgen als je rust erop zit, ook als je de app even weglegt.";
    enableBtn.hidden = enabled || blocked;
    if (blocked && !status.textContent) {
      status.textContent = "Meldingen staan geblokkeerd in je browser-instellingen.";
      status.classList.add("warn");
    }
  }

  refresh();
  return wrap;
}

function renderSyncSettings() {
  const section = document.createElement("section");
  section.className = "sync-settings";

  const heading = document.createElement("h3");
  heading.textContent = "Sync-instellingen";
  section.appendChild(heading);

  const help = document.createElement("p");
  help.className = "sync-help";
  help.textContent = "Eenmalig instellen: plak hier de Apps Script webapp-URL (zie sheet-sync/AppsScript.gs voor de stappen). Dit stuurt nieuw gelogde sessies naar een apart 'App Log'-tabblad in je Sheet, als backup.";
  section.appendChild(help);

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.placeholder = "https://script.google.com/macros/s/.../exec";
  urlInput.value = getSyncUrl();
  urlInput.className = "sync-url-input";
  section.appendChild(urlInput);

  const status = document.createElement("p");
  status.className = "sync-status";

  const saveBtn = smallButton("Opslaan", () => {
    setSyncUrl(urlInput.value);
    status.textContent = "URL opgeslagen.";
  });
  section.appendChild(saveBtn);

  const syncBtn = document.createElement("button");
  syncBtn.className = "btn btn-secondary";
  syncBtn.textContent = "Sync nu";
  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    status.textContent = "Bezig met synchroniseren...";
    const result = await syncNow();
    status.textContent = result.message || (result.ok ? "Klaar." : "Mislukt.");
    status.classList.toggle("warn", !result.ok);
    syncBtn.disabled = false;
  });
  section.appendChild(syncBtn);

  section.appendChild(status);
  return section;
}

// Moves the item at `from` to `to` and renumbers every day's order from
// scratch. Renumbering rather than swapping two order values: a deleted day
// can leave two days holding the same order, and swapping equal values is a
// silent no-op.
async function moveDay(days, from, to, rootContainer) {
  if (to < 0 || to >= days.length) return;
  const reordered = [...days];
  const [moved] = reordered.splice(from, 1);
  reordered.splice(to, 0, moved);
  for (let i = 0; i < reordered.length; i++) {
    if (reordered[i].order !== i) await storage.saveDay({ ...reordered[i], order: i });
  }
  renderSchemaEditor(rootContainer);
}

async function moveExercise(day, from, to, rootContainer) {
  if (to < 0 || to >= day.exercises.length) return;
  const exercises = [...day.exercises];
  const [moved] = exercises.splice(from, 1);
  exercises.splice(to, 0, moved);
  await storage.saveDay({ ...day, exercises });
  renderSchemaEditor(rootContainer);
}

// Arrow-only button, so it needs a spoken label of its own.
function moveButton(direction, disabled, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-small btn-move";
  btn.textContent = direction === "up" ? "↑" : "↓";
  btn.setAttribute("aria-label", direction === "up" ? "Omhoog verplaatsen" : "Omlaag verplaatsen");
  btn.disabled = disabled;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderDayCard(day, rootContainer, days, index) {
  const card = document.createElement("div");
  card.className = "day-card";

  const header = document.createElement("div");
  header.className = "day-card-header";

  const title = document.createElement("h3");
  title.textContent = day.name;
  header.appendChild(title);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.appendChild(moveButton("up", index === 0, () => moveDay(days, index, index - 1, rootContainer)));
  actions.appendChild(moveButton("down", index === days.length - 1, () => moveDay(days, index, index + 1, rootContainer)));

  const renameBtn = smallButton("Naam wijzigen", () => {
    header.replaceWith(renderDayNameForm({
      value: day.name,
      submitLabel: "Opslaan",
      onCancel: () => renderSchemaEditor(rootContainer),
      onSubmit: async (name) => {
        await storage.saveDay({ ...day, name });
        renderSchemaEditor(rootContainer);
      },
    }));
  });
  actions.appendChild(renameBtn);

  const deleteDayBtn = smallButton("Dag verwijderen", async () => {
    const confirmed = await confirmDialog({
      title: "Dag verwijderen",
      body: `"${day.name}" verwijderen, inclusief alle oefeningen?`,
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!confirmed) return;
    navigator.vibrate?.(20);
    await storage.deleteDay(day.id);
    showToast("Dag verwijderd");
    renderSchemaEditor(rootContainer);
  });
  deleteDayBtn.classList.add("btn-danger");
  actions.appendChild(deleteDayBtn);

  header.appendChild(actions);
  card.appendChild(header);

  const exerciseList = document.createElement("ul");
  exerciseList.className = "exercise-list";
  day.exercises.forEach((ex, exIndex) =>
    exerciseList.appendChild(renderExerciseRow(day, ex, rootContainer, exIndex))
  );
  card.appendChild(exerciseList);

  const addExerciseBtn = smallButton("+ Oefening toevoegen", () => {
    addExerciseBtn.replaceWith(renderExerciseForm({
      submitLabel: "Toevoegen",
      onCancel: () => renderSchemaEditor(rootContainer),
      onSubmit: async (values) => {
        await storage.saveDay({
          ...day,
          exercises: [...day.exercises, { id: crypto.randomUUID(), ...values }],
        });
        renderSchemaEditor(rootContainer);
      },
    }));
  });
  card.appendChild(addExerciseBtn);

  return card;
}

// Which muscles an exercise trains, and the machine's weight step and
// stack, belong to the movement/machine, not to one day: Push and Push 2
// each hold their own "Chest Press". Copy them to every same-named exercise
// on other days, so Monday's and Thursday's advice can't disagree. Sets and
// rep ranges stay per day.
async function syncMachineByName(savedDayId, { name, muscles, incrementKg, weightStack }) {
  const days = await storage.getDays();
  for (const day of days) {
    if (day.id === savedDayId) continue;
    if (!day.exercises.some((e) => e.name === name)) continue;
    await storage.saveDay({
      ...day,
      exercises: day.exercises.map((e) => (e.name === name ? { ...e, muscles, incrementKg, weightStack } : e)),
    });
  }
}

function renderExerciseRow(day, exercise, rootContainer, index) {
  const row = document.createElement("li");
  row.className = "exercise-row";

  const label = document.createElement("span");
  const step = weightStackOf(exercise).length ? "machine-reeks" : `+${incrementFor(exercise)} kg`;
  label.textContent = `${exercise.name} — ${exercise.sets} × ${exercise.repMin}–${exercise.repMax} · ${step}`;
  row.appendChild(label);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.appendChild(moveButton("up", index === 0, () => moveExercise(day, index, index - 1, rootContainer)));
  actions.appendChild(moveButton("down", index === day.exercises.length - 1, () => moveExercise(day, index, index + 1, rootContainer)));

  const editBtn = smallButton("Bewerken", () => {
    // Replaces the row's contents rather than the <li> itself, so the form
    // stays properly nested inside the exercise list.
    row.innerHTML = "";
    row.classList.add("exercise-row-editing");
    row.appendChild(renderExerciseForm({
      exercise,
      submitLabel: "Opslaan",
      onCancel: () => renderSchemaEditor(rootContainer),
      onSubmit: async (values) => {
        const updatedExercises = day.exercises.map((e) =>
          e.id === exercise.id ? { ...e, ...values } : e
        );
        await storage.saveDay({ ...day, exercises: updatedExercises });
        await syncMachineByName(day.id, values);
        renderSchemaEditor(rootContainer);
      },
    }));
  });
  actions.appendChild(editBtn);

  const deleteBtn = smallButton("Verwijderen", async () => {
    const confirmed = await confirmDialog({
      title: "Oefening verwijderen",
      body: `"${exercise.name}" verwijderen?`,
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!confirmed) return;
    navigator.vibrate?.(20);
    const updatedExercises = day.exercises.filter((e) => e.id !== exercise.id);
    await storage.saveDay({ ...day, exercises: updatedExercises });
    showToast("Oefening verwijderd");
    renderSchemaEditor(rootContainer);
  });
  deleteBtn.classList.add("btn-danger");
  actions.appendChild(deleteBtn);

  row.appendChild(actions);
  return row;
}

function smallButton(text, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn btn-small";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

// --- Inline forms ---------------------------------------------------------
// Every schema edit used to run through prompt(): four stacked browser popups
// just to change one exercise, with no validation and no way back once you'd
// started. Now that the app installs and runs full-screen, those dialogs were
// the last thing that still looked like a web page, so each edit happens in a
// small form in place instead.

function formRow(labelText, input) {
  const row = document.createElement("label");
  row.className = "inline-form-row";
  const caption = document.createElement("span");
  caption.textContent = labelText;
  row.appendChild(caption);
  row.appendChild(input);
  return row;
}

function textInput(value, placeholder) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inline-form-input";
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function numberInput(value) {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "inline-form-input";
  input.min = "1";
  input.value = value;
  return input;
}

function formActions(submitLabel, onCancel) {
  const actions = document.createElement("div");
  actions.className = "inline-form-actions";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "btn btn-small btn-accent";
  submit.textContent = submitLabel;
  actions.appendChild(submit);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-small";
  cancel.textContent = "Annuleren";
  cancel.addEventListener("click", onCancel);
  actions.appendChild(cancel);

  return actions;
}

// Focused once it is actually in the document — focus() on a detached node
// does nothing, and these forms are built before being inserted.
function focusOnInsert(input) {
  requestAnimationFrame(() => input.focus());
}

// Tri-state chips per muscle group: tap cycles off → hoofdspier → hulpspier.
// Feeds the body map and weekly volume (muscles.js).
function renderMusclePicker(initial) {
  const wrap = document.createElement("div");
  wrap.className = "muscle-picker";
  const caption = document.createElement("p");
  caption.className = "inline-form-caption";
  caption.textContent = "Spieren (tik: hoofd → hulp → uit)";
  wrap.appendChild(caption);

  const state = new Map();
  const chips = document.createElement("div");
  chips.className = "muscle-chips";
  const buttons = new Map();
  const paint = (key) => {
    const btn = buttons.get(key);
    const value = state.get(key) || "off";
    btn.dataset.state = value;
    btn.setAttribute("aria-pressed", String(value !== "off"));
    btn.querySelector(".muscle-chip-role").textContent = value === "primary" ? "hoofd" : value === "secondary" ? "hulp" : "";
  };
  const api = {
    el: wrap,
    touched: false,
    set(muscles) {
      state.clear();
      muscles.primary.forEach((m) => state.set(m, "primary"));
      muscles.secondary.forEach((m) => { if (!state.has(m)) state.set(m, "secondary"); });
      buttons.forEach((_, key) => paint(key));
    },
    get() {
      const primary = [];
      const secondary = [];
      state.forEach((value, key) => {
        if (value === "primary") primary.push(key);
        if (value === "secondary") secondary.push(key);
      });
      return { primary, secondary };
    },
  };
  MUSCLES.forEach(({ key, label }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "muscle-chip";
    const name = document.createElement("span");
    name.textContent = label;
    const role = document.createElement("span");
    role.className = "muscle-chip-role";
    btn.append(name, role);
    btn.addEventListener("click", () => {
      const next = { off: "primary", primary: "secondary", secondary: "off" }[state.get(key) || "off"];
      if (next === "off") state.delete(key);
      else state.set(key, next);
      api.touched = true;
      paint(key);
    });
    buttons.set(key, btn);
    chips.appendChild(btn);
  });
  wrap.appendChild(chips);
  api.set(initial);
  return api;
}

// One text field, shared by "add day" and "rename day".
function renderDayNameForm({ value = "", submitLabel, onSubmit, onCancel }) {
  const form = document.createElement("form");
  form.className = "inline-form";
  // Native constraint validation would otherwise block submit before our own
  // check runs, and report it in a browser-language tooltip instead of the
  // in-form Dutch message the rest of the app uses.
  form.noValidate = true;

  const nameInput = textInput(value, "bijv. Zaterdag – Push");
  form.appendChild(formRow("Naam", nameInput));

  const error = document.createElement("p");
  error.className = "inline-form-error";
  form.appendChild(error);
  form.appendChild(formActions(submitLabel, onCancel));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      error.textContent = "Vul een naam in.";
      return;
    }
    onSubmit(name);
  });

  focusOnInsert(nameInput);
  return form;
}

// The same five fields for both adding and editing an exercise; `exercise`
// is omitted when adding, and the defaults match what the old prompt flow
// silently assumed.
function renderExerciseForm({ exercise, submitLabel, onSubmit, onCancel }) {
  const form = document.createElement("form");
  form.className = "inline-form";
  // Native constraint validation would otherwise block submit before our own
  // check runs, and report it in a browser-language tooltip instead of the
  // in-form Dutch message the rest of the app uses.
  form.noValidate = true;

  const nameInput = textInput(exercise?.name ?? "", "bijv. Chest Press");
  const setsInput = numberInput(exercise?.sets ?? 4);
  const repMinInput = numberInput(exercise?.repMin ?? 6);
  const repMaxInput = numberInput(exercise?.repMax ?? 10);
  // Free decimal, never rounded: Basic-Fit stacks step 2.2/2.3/2.4/2.7 kg.
  const incrementInput = makeDecimalInput("inline-form-input", "2.5");
  incrementInput.value = exercise ? incrementFor(exercise) : 2.5;

  form.appendChild(formRow("Oefening", nameInput));
  form.appendChild(formRow("Sets", setsInput));
  form.appendChild(formRow("Reps min.", repMinInput));
  form.appendChild(formRow("Reps max.", repMaxInput));
  form.appendChild(formRow("Stap (kg)", incrementInput));

  // Optional real weight stack of this machine. When filled, the advice
  // jumps to the next weight in this list instead of adding the step above.
  const stackInput = document.createElement("textarea");
  stackInput.className = "inline-form-input weight-stack-input";
  stackInput.rows = 2;
  stackInput.inputMode = "decimal";
  stackInput.placeholder = "bijv. 45,5; 47,7; 50; 52,3";
  stackInput.value = formatWeightStack(weightStackOf(exercise));
  form.appendChild(formRow("Gewichten machine (optioneel)", stackInput));
  const stackHelp = document.createElement("p");
  stackHelp.className = "inline-form-caption";
  stackHelp.textContent = "De echte standen van deze machine, gescheiden door ; of een spatie. Leeg = de stap hierboven gebruiken.";
  form.appendChild(stackHelp);

  const musclePicker = renderMusclePicker(exercise ? musclesFor(exercise) : defaultMusclesFor(""));
  form.appendChild(musclePicker.el);
  // A new exercise gets the name-based default as soon as its name is typed,
  // until the user taps a chip themselves.
  nameInput.addEventListener("change", () => {
    if (!musclePicker.touched) musclePicker.set(defaultMusclesFor(nameInput.value));
  });

  const error = document.createElement("p");
  error.className = "inline-form-error";
  form.appendChild(error);
  form.appendChild(formActions(submitLabel, onCancel));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const sets = parseInt(setsInput.value, 10);
    const repMin = parseInt(repMinInput.value, 10);
    const repMax = parseInt(repMaxInput.value, 10);
    const incrementKg = parseDecimal(incrementInput.value);

    // Written as `!(x >= 1)` so a blank field (NaN) fails too.
    if (!name) {
      error.textContent = "Vul een naam in.";
      return;
    }
    if (!(sets >= 1)) {
      error.textContent = "Vul minstens 1 set in.";
      return;
    }
    if (!(repMin >= 1) || !(repMax >= 1)) {
      error.textContent = "Vul een geldige rep-range in.";
      return;
    }
    if (repMax < repMin) {
      error.textContent = "Maximale reps mogen niet lager zijn dan de minimale.";
      return;
    }
    const weightStack = parseWeightStack(stackInput.value);
    if (weightStack === null) {
      error.textContent = "Gewichten machine: gebruik getallen gescheiden door ; of een spatie, bijv. 45,5; 47,7; 50.";
      return;
    }
    if (!(incrementKg > 0)) {
      error.textContent = "Vul een gewichtsstap in, bijv. 2.5 of 2,3.";
      return;
    }
    onSubmit({ name, sets, repMin, repMax, incrementKg, weightStack, muscles: musclePicker.get() });
  });

  focusOnInsert(nameInput);
  return form;
}
