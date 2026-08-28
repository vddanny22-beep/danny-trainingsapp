import * as storage from "./storage.js";
import { renderSparkline } from "./sparkline.js";

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
  container.appendChild(renderSessionList(sessions));
}

function renderSessionList(sessions) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = "Sessies";
  section.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "session-list";
  sessions.forEach((session) => {
    const item = document.createElement("li");
    item.className = "session-item";

    const dateLabel = new Date(session.date).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const summary = document.createElement("div");
    summary.className = "session-summary";
    summary.textContent = `${dateLabel} — ${session.dayName} (${session.entries.length} oefeningen)`;
    item.appendChild(summary);

    const details = document.createElement("ul");
    details.className = "session-details";
    session.entries.forEach((entry) => {
      const detail = document.createElement("li");
      const setsText = entry.sets.map((s) => `${s.weight}kg×${s.reps}`).join(", ");
      detail.textContent = `${entry.exerciseName}: ${setsText}`;
      details.appendChild(detail);
    });
    item.appendChild(details);

    list.appendChild(item);
  });
  section.appendChild(list);
  return section;
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
      if (!byExercise.has(entry.exerciseName)) byExercise.set(entry.exerciseName, []);
      byExercise.get(entry.exerciseName).push(topWeight);
    }
  }

  const list = document.createElement("div");
  list.className = "progress-list";
  for (const [exerciseName, weights] of byExercise.entries()) {
    list.appendChild(renderProgressRow(exerciseName, weights));
  }
  section.appendChild(list);
  return section;
}

function renderProgressRow(exerciseName, weights) {
  const row = document.createElement("div");
  row.className = "progress-row";

  const label = document.createElement("div");
  label.className = "progress-label";
  const first = weights[0];
  const last = weights[weights.length - 1];
  // Rounded to 1 decimal to avoid floating-point noise like "42.4 - 39 = 3.3999999999999986".
  const delta = Math.round((last - first) * 10) / 10;
  const deltaText = delta === 0 ? "gelijk gebleven" : delta > 0 ? `+${delta}kg` : `${delta}kg`;
  label.textContent = `${exerciseName}: ${first}kg → ${last}kg (${deltaText})`;
  row.appendChild(label);

  row.appendChild(renderSparkline(weights));
  return row;
}
