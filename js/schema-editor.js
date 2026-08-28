import * as storage from "./storage.js";
import { getSyncUrl, setSyncUrl, syncNow } from "./sheet-sync.js";

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
  addDayBtn.addEventListener("click", async () => {
    const name = prompt("Naam van de nieuwe dag (bijv. 'Zaterdag – Push'):");
    if (!name) return;
    await storage.saveDay({
      id: crypto.randomUUID(),
      name,
      order: days.length,
      exercises: [],
    });
    renderSchemaEditor(container);
  });
  container.appendChild(addDayBtn);
  container.appendChild(renderSyncSettings());
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

  const renameBtn = smallButton("Naam wijzigen", async () => {
    const name = prompt("Nieuwe naam:", day.name);
    if (!name) return;
    await storage.saveDay({ ...day, name });
    renderSchemaEditor(rootContainer);
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

  const addExerciseBtn = smallButton("+ Oefening toevoegen", async () => {
    const name = prompt("Naam van de oefening:");
    if (!name) return;
    const updatedDay = {
      ...day,
      exercises: [
        ...day.exercises,
        { id: crypto.randomUUID(), name, sets: 4, repMin: 6, repMax: 10 },
      ],
    };
    await storage.saveDay(updatedDay);
    renderSchemaEditor(rootContainer);
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

  const editBtn = smallButton("Bewerken", async () => {
    const name = prompt("Naam:", exercise.name);
    if (!name) return;
    const sets = parseInt(prompt("Aantal sets:", exercise.sets), 10) || exercise.sets;
    const repMin = parseInt(prompt("Rep-range, minimum:", exercise.repMin), 10) || exercise.repMin;
    const repMax = parseInt(prompt("Rep-range, maximum:", exercise.repMax), 10) || exercise.repMax;
    const updatedExercises = day.exercises.map((e) =>
      e.id === exercise.id ? { ...e, name, sets, repMin, repMax } : e
    );
    await storage.saveDay({ ...day, exercises: updatedExercises });
    renderSchemaEditor(rootContainer);
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
