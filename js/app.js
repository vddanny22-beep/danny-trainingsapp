import * as storage from "./storage.js";
import { getSeedDays } from "./seed.js";
import { renderTodayView } from "./today-view.js";
import { renderSchemaEditor } from "./schema-editor.js";
import { renderHistoryView } from "./history-view.js";
import { renderProgressView } from "./progress-view.js";
import { renderChatView } from "./chat-view.js";
import { watchForUpdates } from "./app-update.js";
import { runMigrations, markSchemaCurrent } from "./migrations.js";
import { showToast } from "./ui-toast.js";

const content = document.getElementById("content");
const navToday = document.getElementById("nav-today");
const navHistory = document.getElementById("nav-history");
const navSchema = document.getElementById("nav-schema");
const navProgress = document.getElementById("nav-progress");
const navChat = document.getElementById("nav-chat");
const navIndicator = document.querySelector(".nav-indicator");

const TABS = {
  today: { button: navToday, render: renderTodayView },
  history: { button: navHistory, render: renderHistoryView },
  schema: { button: navSchema, render: renderSchemaEditor },
  progress: { button: navProgress, render: renderProgressView },
  chat: { button: navChat, render: renderChatView },
};

// Order matters here: it's how the moving nav-indicator pill maps a button to
// a horizontal slot (index 0..4 of 5 equal-width tabs).
const NAV_BUTTONS = [navToday, navHistory, navSchema, navProgress, navChat];

// Each tab keeps its own scroll offset, restored when you switch back to it —
// without this, returning to a tab always dropped you back at the top even
// if you were scrolled deep into a list a moment before.
const scrollPositions = {};
let activeTab = null;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

async function switchTab(name) {
  // Also runs when tapping the already-active tab, matching the previous
  // behaviour where every nav click re-rendered from storage (e.g. to pick up
  // a session just saved elsewhere) — only the transition/scroll bookkeeping
  // is new here, not whether a re-render happens.
  if (activeTab) scrollPositions[activeTab] = window.scrollY;

  const { button, render } = TABS[name];
  setActiveNav(button);

  // Renders, then restores that tab's scroll position — done inside the same
  // function passed to startViewTransition so the restored position is what
  // gets captured as the transition's "new" state, not a jump the user sees
  // after the crossfade finishes.
  const renderAndRestore = async () => {
    await render(content);
    activeTab = name;
    window.scrollTo(0, scrollPositions[name] || 0);
  };

  // startViewTransition accepts an async callback and waits for the promise
  // it returns before capturing the "new" screenshot, so passing the render
  // function straight through gives one clean cross-fade from the old tab's
  // content to the new tab's content — already-loaded, nothing skeletal in
  // between. Feature-detected, and skipped under reduced-motion so that
  // setting is honored instead of forcing the animation anyway.
  if (document.startViewTransition && !prefersReducedMotion()) {
    document.startViewTransition(() => renderAndRestore());
  } else {
    await renderAndRestore();
  }
}

function setActiveNav(button) {
  NAV_BUTTONS.forEach((b) => { b.classList.remove("active"); b.removeAttribute("aria-current"); });
  button.setAttribute("aria-current", "page");
  button.classList.add("active");

  const index = NAV_BUTTONS.indexOf(button);
  if (navIndicator && index !== -1) navIndicator.style.setProperty("--nav-index", index);
}

// Returns true when it seeded — a fresh schema is already in the current
// format, so there's nothing for migrations.js to upgrade.
async function seedIfEmpty() {
  const days = await storage.getDays();
  if (days.length) return false;
  for (const day of getSeedDays()) {
    await storage.saveDay(day);
  }
  return true;
}

navToday.addEventListener("click", () => switchTab("today"));
navHistory.addEventListener("click", () => switchTab("history"));
navSchema.addEventListener("click", () => switchTab("schema"));
navProgress.addEventListener("click", () => switchTab("progress"));
navChat.addEventListener("click", () => switchTab("chat"));

async function init() {
  await storage.initDB();
  if (await seedIfEmpty()) await markSchemaCurrent();

  // Before the first render, so no tab ever shows the old schema. A failed
  // migration leaves the data exactly as it was (it's one transaction) and
  // the app keeps working on the old schema rather than not starting at all.
  let migrationSummary = null;
  try {
    migrationSummary = await runMigrations();
  } catch (err) {
    console.error("Schema migration failed:", err);
  }

  await switchTab("today");
  if (migrationSummary) showToast(migrationSummary, 7000);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("service-worker.js")
      .then(watchForUpdates)
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  }
}

init();
