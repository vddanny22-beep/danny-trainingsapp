import * as storage from "./storage.js";
import { getSeedDays } from "./seed.js";
import { renderTodayView } from "./today-view.js";
import { renderSchemaEditor } from "./schema-editor.js";
import { renderHistoryView } from "./history-view.js";
import { renderProgressView } from "./progress-view.js";

const content = document.getElementById("content");
const navToday = document.getElementById("nav-today");
const navHistory = document.getElementById("nav-history");
const navSchema = document.getElementById("nav-schema");
const navProgress = document.getElementById("nav-progress");

async function seedIfEmpty() {
  const days = await storage.getDays();
  if (days.length) return;
  for (const day of getSeedDays()) {
    await storage.saveDay(day);
  }
}

function setActiveNav(button) {
  [navToday, navHistory, navSchema, navProgress].forEach((b) => b.classList.remove("active"));
  button.classList.add("active");
}

async function showToday() {
  setActiveNav(navToday);
  await renderTodayView(content);
}

async function showHistory() {
  setActiveNav(navHistory);
  await renderHistoryView(content);
}

async function showSchema() {
  setActiveNav(navSchema);
  await renderSchemaEditor(content);
}

async function showProgress() {
  setActiveNav(navProgress);
  await renderProgressView(content);
}

navToday.addEventListener("click", showToday);
navHistory.addEventListener("click", showHistory);
navSchema.addEventListener("click", showSchema);
navProgress.addEventListener("click", showProgress);

async function init() {
  await storage.initDB();
  await seedIfEmpty();
  await showToday();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  }
}

init();
