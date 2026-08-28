import * as storage from "./storage.js";
import { getSyncUrl, setSyncUrl, syncNow } from "./sheet-sync.js";
import {
  getRestSeconds, setRestSeconds, REST_PRESETS,
  notificationsSupported, notificationsEnabled, notificationsBlocked, requestNotificationPermission,
} from "./rest-timer.js";
import { downloadBackup, restoreBackupFromFile } from "./backup.js";

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
  days.forEach((day) => list.appendChild(renderDayCard(day, container)));
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
          order: days.length,
          exercises: [],
        });
        renderSchemaEditor(container);
      },
    }));
  });
  container.appendChild(addDayBtn);
  container.appendChild(renderTrainingSettings());
  container.appendChild(renderBackupSettings());
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
  help.textContent = "Al je gegevens staan alleen op dit toestel. Maak een back-upbestand met je schema, sessies, metingen en foto's — bewaar dat ergens veilig, en zet het terug als je een nieuwe telefoon hebt.";
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
  importBtn.addEventListener("click", () => {
    if (!confirm("Terugzetten vervangt je huidige schema, sessies, metingen en foto's door die uit het back-upbestand. Doorgaan?")) return;
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

function renderDayCard(day, rootContainer) {
  const card = document.createElement("div");
  card.className = "day-card";

  const header = document.createElement("div");
  header.className = "day-card-header";

  const title = document.createElement("h3");
  title.textContent = day.name;
  header.appendChild(title);

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
  header.appendChild(renameBtn);

  const deleteDayBtn = smallButton("Dag verwijderen", async () => {
    if (!confirm(`"${day.name}" verwijderen, inclusief alle oefeningen?`)) return;
    await storage.deleteDay(day.id);
    renderSchemaEditor(rootContainer);
  });
  deleteDayBtn.classList.add("btn-danger");
  header.appendChild(deleteDayBtn);

  card.appendChild(header);

  const exerciseList = document.createElement("ul");
  exerciseList.className = "exercise-list";
  day.exercises.forEach((ex) => exerciseList.appendChild(renderExerciseRow(day, ex, rootContainer)));
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

function renderExerciseRow(day, exercise, rootContainer) {
  const row = document.createElement("li");
  row.className = "exercise-row";

  const label = document.createElement("span");
  label.textContent = `${exercise.name} — ${exercise.sets} sets, ${exercise.repMin}-${exercise.repMax} reps`;
  row.appendChild(label);

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
        renderSchemaEditor(rootContainer);
      },
    }));
  });
  row.appendChild(editBtn);

  const deleteBtn = smallButton("Verwijderen", async () => {
    if (!confirm(`"${exercise.name}" verwijderen?`)) return;
    const updatedExercises = day.exercises.filter((e) => e.id !== exercise.id);
    await storage.saveDay({ ...day, exercises: updatedExercises });
    renderSchemaEditor(rootContainer);
  });
  deleteBtn.classList.add("btn-danger");
  row.appendChild(deleteBtn);

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

// The same four fields for both adding and editing an exercise; `exercise`
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

  form.appendChild(formRow("Oefening", nameInput));
  form.appendChild(formRow("Sets", setsInput));
  form.appendChild(formRow("Reps min.", repMinInput));
  form.appendChild(formRow("Reps max.", repMaxInput));

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
    onSubmit({ name, sets, repMin, repMax });
  });

  focusOnInsert(nameInput);
  return form;
}
