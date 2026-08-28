import * as storage from "./storage.js";
import { renderSparkline } from "./sparkline.js";
import { bestOneRepMax } from "./volume-stats.js";

// Renders the Geschiedenis tab: a session list (newest first) and a lightweight
// per-exercise progress trend, built from the same session history storage.js
// already tracks. No charting library — a small hand-rolled SVG polyline is
// plenty for 5-10 data points per exercise.
export async function renderHistoryView(container) {
  const sessions = await storage.getSessions();
  container.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Geschiedenis";
  container.appendChild(heading);

  if (!sessions.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nog geen sessies gelogd. Log een training via Vandaag om hier je geschiedenis te zien.";
    container.appendChild(empty);
    return;
  }

  container.appendChild(renderProgressSection(sessions));
  container.appendChild(renderSessionList(sessions, container));
}

function renderSessionList(sessions, container) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = "Sessies";
  section.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "session-list";
  sessions.forEach((session) => list.appendChild(renderSessionItem(session, container)));
  section.appendChild(list);
  return section;
}

function formatSessionDate(session) {
  return new Date(session.date).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function renderSessionItem(session, container) {
  const item = document.createElement("li");
  item.className = "session-item";

  const header = document.createElement("div");
  header.className = "session-item-header";

  const summary = document.createElement("div");
  summary.className = "session-summary";
  summary.textContent = `${formatSessionDate(session)} — ${session.dayName} (${session.entries.length} oefeningen)`;
  header.appendChild(summary);

  const editBtn = smallButton("Bewerken", () => {
    body.replaceWith(renderSessionEditor(session, container));
    editBtn.disabled = true;
  });
  header.appendChild(editBtn);

  const deleteBtn = smallButton("Verwijderen", async () => {
    if (!confirm(`Sessie van ${formatSessionDate(session)} (${session.dayName}) verwijderen?`)) return;
    await storage.deleteSession(session.id);
    renderHistoryView(container);
  });
  deleteBtn.classList.add("btn-danger");
  header.appendChild(deleteBtn);

  item.appendChild(header);

  const body = renderSessionDetails(session);
  item.appendChild(body);

  return item;
}

function renderSessionDetails(session) {
  const wrap = document.createElement("div");

  const details = document.createElement("ul");
  details.className = "session-details";
  session.entries.forEach((entry) => {
    const detail = document.createElement("li");
    const setsText = entry.sets.map((s) => `${s.weight}kg×${s.reps}`).join(", ");
    detail.textContent = `${entry.exerciseName}: ${setsText}`;
    details.appendChild(detail);
  });
  wrap.appendChild(details);

  if (session.note) {
    const note = document.createElement("p");
    note.className = "session-note";
    note.textContent = session.note;
    wrap.appendChild(note);
  }

  return wrap;
}

// Inline editor for one logged session. Correcting a mistyped weight matters
// beyond the history list: today-view suggests the next weight from the most
// recent entry for that exercise, so a stray "500" would otherwise skew every
// future suggestion.
function renderSessionEditor(session, container) {
  const form = document.createElement("form");
  form.className = "session-editor";

  session.entries.forEach((entry, entryIndex) => {
    const block = document.createElement("fieldset");
    block.className = "exercise-block";
    block.dataset.entryIndex = entryIndex;

    const legend = document.createElement("legend");
    legend.textContent = entry.exerciseName;
    block.appendChild(legend);

    entry.sets.forEach((set, setIndex) => {
      const row = document.createElement("div");
      row.className = "set-row";

      const label = document.createElement("span");
      label.textContent = `Set ${setIndex + 1}`;
      row.appendChild(label);

      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.step = "0.5";
      weightInput.className = "weight-input";
      weightInput.value = set.weight;
      row.appendChild(weightInput);

      const repsInput = document.createElement("input");
      repsInput.type = "number";
      repsInput.className = "reps-input";
      repsInput.value = set.reps;
      row.appendChild(repsInput);

      block.appendChild(row);
    });

    form.appendChild(block);
  });

  const noteInput = document.createElement("textarea");
  noteInput.className = "session-note-input";
  noteInput.placeholder = "Notitie (optioneel)";
  noteInput.rows = 2;
  noteInput.value = session.note || "";
  form.appendChild(noteInput);

  const status = document.createElement("p");
  status.className = "save-status";

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = "Wijzigingen opslaan";
  form.appendChild(saveBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn btn-secondary";
  cancelBtn.textContent = "Annuleren";
  cancelBtn.addEventListener("click", () => renderHistoryView(container));
  form.appendChild(cancelBtn);

  form.appendChild(status);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const entries = [];
    form.querySelectorAll(".exercise-block").forEach((block) => {
      const original = session.entries[Number(block.dataset.entryIndex)];
      const sets = [];
      block.querySelectorAll(".set-row").forEach((row) => {
        const weight = parseFloat(row.querySelector(".weight-input").value);
        const reps = parseInt(row.querySelector(".reps-input").value, 10);
        if (!Number.isNaN(weight) && !Number.isNaN(reps)) sets.push({ weight, reps });
      });
      if (sets.length) entries.push({ ...original, sets });
    });

    if (!entries.length) {
      status.textContent = "Er blijft geen enkele set over. Gebruik \"Verwijderen\" als je de hele sessie wilt wissen.";
      return;
    }

    await storage.saveSession({ ...session, entries, note: noteInput.value.trim() });
    renderHistoryView(container);
  });

  return form;
}

function smallButton(text, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-small";
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function renderProgressSection(sessions) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = "Voortgang per oefening";
  section.appendChild(heading);

  // Chronological (oldest first) for trend plotting, opposite of the session list.
  const chronological = [...sessions].reverse();

  const byExercise = new Map();
  for (const session of chronological) {
    for (const entry of session.entries) {
      if (!entry.sets.length) continue;
      const topWeight = Math.max(...entry.sets.map((s) => s.weight));
      if (!byExercise.has(entry.exerciseName)) byExercise.set(entry.exerciseName, { weights: [], oneRepMaxes: [] });
      const trend = byExercise.get(entry.exerciseName);
      trend.weights.push(topWeight);
      trend.oneRepMaxes.push(bestOneRepMax(entry));
    }
  }

  const list = document.createElement("div");
  list.className = "progress-list";
  for (const [exerciseName, trend] of byExercise.entries()) {
    list.appendChild(renderProgressRow(exerciseName, trend));
  }
  section.appendChild(list);
  return section;
}

// Rounded to 1 decimal to avoid floating-point noise like
// "42.4 - 39 = 3.3999999999999986".
function formatDelta(first, last) {
  const delta = Math.round((last - first) * 10) / 10;
  if (delta === 0) return "gelijk gebleven";
  return delta > 0 ? `+${delta}kg` : `${delta}kg`;
}

function renderProgressRow(exerciseName, { weights, oneRepMaxes }) {
  const row = document.createElement("div");
  row.className = "progress-row";

  const label = document.createElement("div");
  label.className = "progress-label";
  label.textContent = `${exerciseName}: ${weights[0]}kg → ${weights[weights.length - 1]}kg (${formatDelta(weights[0], weights[weights.length - 1])})`;
  row.appendChild(label);

  // The plotted line is the estimated 1RM, not the raw top weight. This app's
  // progression rule only adds weight once you reach the top of the rep range,
  // so the weight trend is a staircase that sits flat for weeks while the reps
  // — and the actual strength — keep climbing.
  const estimate = document.createElement("div");
  estimate.className = "progress-sublabel";
  estimate.textContent = `Geschat 1RM: ${oneRepMaxes[0]}kg → ${oneRepMaxes[oneRepMaxes.length - 1]}kg (${formatDelta(oneRepMaxes[0], oneRepMaxes[oneRepMaxes.length - 1])})`;
  row.appendChild(estimate);

  row.appendChild(renderSparkline(oneRepMaxes));
  return row;
}
