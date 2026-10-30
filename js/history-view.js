import * as storage from "./storage.js";
import { makeDecimalInput, parseDecimal } from "./decimal-input.js";
import { formatRir, RIR_OPTIONS } from "./progression.js";
import { formatCardio } from "./formatters.js";
import { recordsBySession } from "./exercise-stats.js";
import { confirmDialog } from "./ui-dialog.js";
import { showToast } from "./ui-toast.js";

// Renders the Geschiedenis tab: the session list (newest first), each
// editable/deletable. Per-exercise trends live on the Voortgang tab.
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

  container.appendChild(renderSessionList(sessions, container, recordsBySession(sessions)));
}

function renderSessionList(sessions, container, records) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = "Sessies";
  section.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "session-list";
  sessions.forEach((session) => list.appendChild(renderSessionItem(session, container, records.get(session.id) || [])));
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

function renderSessionItem(session, container, records) {
  const item = document.createElement("li");
  item.className = "session-item";

  const header = document.createElement("div");
  header.className = "session-item-header";

  const summary = document.createElement("div");
  summary.className = "session-summary";
  summary.textContent = `${formatSessionDate(session)} — ${session.dayName} (${session.entries.length} oefeningen)${session.deload ? " · deload" : ""}${records.length ? ` · 🏆 ${records.length}` : ""}`;
  if (records.length) summary.title = records.map((r) => r.exerciseName).join(", ");
  header.appendChild(summary);

  const editBtn = smallButton("Bewerken", () => {
    body.replaceWith(renderSessionEditor(session, container));
    editBtn.disabled = true;
  });
  header.appendChild(editBtn);

  const deleteBtn = smallButton("Verwijderen", async () => {
    const confirmed = await confirmDialog({
      title: "Sessie verwijderen",
      body: `Sessie van ${formatSessionDate(session)} (${session.dayName}) verwijderen?`,
      confirmLabel: "Verwijderen",
      danger: true,
    });
    if (!confirmed) return;
    navigator.vibrate?.(20);
    await storage.deleteSession(session.id);
    showToast("Sessie verwijderd");
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
    const rirText = entry.lastSetRir != null ? ` · RIR ${formatRir(entry.lastSetRir)}` : "";
    detail.textContent = `${entry.exerciseName}: ${setsText}${rirText}`;
    details.appendChild(detail);
  });
  if (session.cardio?.minutes > 0) {
    const cardio = document.createElement("li");
    cardio.className = "session-cardio";
    cardio.textContent = `Cardio: ${formatCardio(session.cardio)}`;
    details.appendChild(cardio);
  }
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
// Local date parts, not toISOString().slice(0,10): the latter converts to UTC
// first, so an evening session east of UTC would show as the next day.
function toDateInputValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Replaces the day but keeps the original time, so two sessions moved onto the
// same date still sort in the order they were logged.
function withDatePart(originalIso, dateInputValue) {
  const [year, month, day] = dateInputValue.split("-").map(Number);
  const next = new Date(originalIso);
  next.setFullYear(year, month - 1, day);
  return next.toISOString();
}

function renderSessionEditor(session, container) {
  const form = document.createElement("form");
  form.className = "session-editor";

  // Forgetting to log on the day used to be unfixable: the session landed on
  // whenever you got round to it, which quietly skewed the weekly volume.
  const dateRow = document.createElement("label");
  dateRow.className = "inline-form-row";
  const dateCaption = document.createElement("span");
  dateCaption.textContent = "Datum";
  dateRow.appendChild(dateCaption);
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.className = "inline-form-input session-date-input";
  dateInput.value = toDateInputValue(session.date);
  dateRow.appendChild(dateInput);
  form.appendChild(dateRow);

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

      const weightInput = makeDecimalInput("weight-input", "kg");
      weightInput.value = set.weight;
      row.appendChild(weightInput);

      const repsInput = document.createElement("input");
      repsInput.type = "number";
      repsInput.className = "reps-input";
      repsInput.value = set.reps;
      row.appendChild(repsInput);

      block.appendChild(row);
    });

    // RIR stays correctable afterwards — it drives next time's advice.
    const rirSelect = document.createElement("select");
    rirSelect.className = "inline-form-input rir-select";
    rirSelect.add(new Option("RIR: niet gelogd", ""));
    RIR_OPTIONS.forEach((value) => rirSelect.add(new Option(`RIR ${formatRir(value)}`, String(value))));
    rirSelect.value = entry.lastSetRir != null ? String(entry.lastSetRir) : "";
    block.appendChild(rirSelect);

    form.appendChild(block);
  });

  const cardioBlock = document.createElement("fieldset");
  cardioBlock.className = "exercise-block cardio-edit";
  const cardioLegend = document.createElement("legend");
  cardioLegend.textContent = "Cardio na training";
  cardioBlock.appendChild(cardioLegend);
  const cardioInput = (labelText, value) => {
    const input = makeDecimalInput("inline-form-input", "");
    input.value = value ?? "";
    const row = document.createElement("label");
    row.className = "inline-form-row";
    const caption = document.createElement("span");
    caption.textContent = labelText;
    row.append(caption, input);
    cardioBlock.appendChild(row);
    return input;
  };
  const cardioMinutes = cardioInput("Minuten", session.cardio?.minutes);
  const cardioIncline = cardioInput("Helling %", session.cardio?.inclinePct);
  const cardioSpeed = cardioInput("km/u", session.cardio?.speedKmh);
  form.appendChild(cardioBlock);

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
    form.querySelectorAll(".exercise-block[data-entry-index]").forEach((block) => {
      const original = session.entries[Number(block.dataset.entryIndex)];
      const sets = [];
      block.querySelectorAll(".set-row").forEach((row) => {
        const weight = parseDecimal(row.querySelector(".weight-input").value);
        const reps = parseInt(row.querySelector(".reps-input").value, 10);
        if (!Number.isNaN(weight) && !Number.isNaN(reps)) sets.push({ weight, reps });
      });
      if (!sets.length) return;
      const updated = { ...original, sets };
      const rirValue = block.querySelector(".rir-select").value;
      if (rirValue === "") delete updated.lastSetRir;
      else updated.lastSetRir = Number(rirValue);
      entries.push(updated);
    });

    if (!entries.length) {
      status.textContent = "Er blijft geen enkele set over. Gebruik \"Verwijderen\" als je de hele sessie wilt wissen.";
      return;
    }

    const updatedSession = {
      ...session,
      entries,
      note: noteInput.value.trim(),
      date: dateInput.value ? withDatePart(session.date, dateInput.value) : session.date,
    };
    const minutes = parseDecimal(cardioMinutes.value);
    if (minutes > 0) {
      const incline = parseDecimal(cardioIncline.value);
      const speed = parseDecimal(cardioSpeed.value);
      updatedSession.cardio = {
        ...(session.cardio || { type: "incline-walk" }),
        minutes,
        inclinePct: Number.isNaN(incline) ? null : incline,
        speedKmh: Number.isNaN(speed) ? null : speed,
      };
    } else {
      delete updatedSession.cardio;
    }
    await storage.saveSession(updatedSession);
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
