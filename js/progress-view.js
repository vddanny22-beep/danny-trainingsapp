import * as storage from "./storage.js";
import { renderSparkline } from "./sparkline.js";
import { volumeByWeek, volumeByCategory, percentChange } from "./volume-stats.js";
import { makeDecimalInput, parseDecimal } from "./decimal-input.js";

// Voortgang tab: body metrics (weight/waist/note) logged by date, plus local-only
// progress photos. Entirely separate from sessions/sync — never touches
// sheet-sync.js. Ported from the Sheet's "Voortgang" tab, but date-based
// instead of week-numbered, and with real photo storage instead of a checklist.
export async function renderProgressView(container) {
  container.innerHTML = "";

  const heading = document.createElement("h2");
  heading.textContent = "Voortgang";
  container.appendChild(heading);

  container.appendChild(await renderVolumeSection());
  container.appendChild(await renderBodyLogSection());
  container.appendChild(await renderPhotoSection());
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
  section.appendChild(renderSparkline(weeks.map((week) => week.volume)));

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

async function renderBodyLogSection() {
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
    section.replaceWith(await renderBodyLogSection());
  });

  section.appendChild(form);

  const logs = await storage.getBodyLogs();
  section.appendChild(renderTrends(logs));
  section.appendChild(renderLogList(logs));

  return section;
}

function renderTrends(logs) {
  const wrap = document.createElement("div");
  wrap.className = "trend-section";

  const chronological = [...logs].reverse();
  const weights = chronological.filter((l) => l.weightKg != null).map((l) => l.weightKg);
  const waists = chronological.filter((l) => l.waistCm != null).map((l) => l.waistCm);

  if (weights.length >= 2) {
    const label = document.createElement("div");
    label.className = "progress-label";
    label.textContent = `Gewicht: ${weights[0]}kg → ${weights[weights.length - 1]}kg`;
    wrap.appendChild(label);
    wrap.appendChild(renderSparkline(weights));
  }

  if (waists.length >= 2) {
    const label = document.createElement("div");
    label.className = "progress-label";
    label.textContent = `Taille: ${waists[0]}cm → ${waists[waists.length - 1]}cm`;
    wrap.appendChild(label);
    wrap.appendChild(renderSparkline(waists));
  }

  if (!wrap.children.length) {
    const empty = document.createElement("p");
    empty.textContent = "Log minstens 2 metingen om een trend te zien.";
    wrap.appendChild(empty);
  }

  return wrap;
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

async function renderPhotoSection() {
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
    section.replaceWith(await renderPhotoSection());
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
