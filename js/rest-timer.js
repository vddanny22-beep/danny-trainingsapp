// Rest timer between sets. One timer at a time, shown as a bar pinned just
// above the bottom tab bar. Started from the Vandaag tab when a set's reps are
// filled in; the user can extend it, or dismiss it early.

const DURATION_KEY = "trainingsapp.restSeconds";
const DEFAULT_SECONDS = 90;
const EXTEND_SECONDS = 30;

// Preset durations offered in the settings picker.
export const REST_PRESETS = [60, 90, 120, 150, 180];

export function getRestSeconds() {
  const stored = parseInt(localStorage.getItem(DURATION_KEY), 10);
  return Number.isNaN(stored) ? DEFAULT_SECONDS : stored;
}

export function setRestSeconds(seconds) {
  localStorage.setItem(DURATION_KEY, String(seconds));
}

let barEl = null;
let timeEl = null;
let fillEl = null;
let intervalId = null;
// Wall-clock deadline rather than a tick count: setInterval is throttled in
// background tabs and drifts, and the phone screen is usually off while
// resting — comparing against Date.now() stays correct through all of that.
let endsAt = 0;
let totalMs = 0;
// Created on the first start (a user gesture), so the finish beep is allowed
// to play later, when no gesture is in progress.
let audioCtx = null;

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function ensureBar() {
  if (barEl) return barEl;

  barEl = document.createElement("div");
  barEl.className = "rest-timer";
  barEl.hidden = true;

  const progress = document.createElement("div");
  progress.className = "rest-timer-progress";
  fillEl = document.createElement("div");
  fillEl.className = "rest-timer-fill";
  progress.appendChild(fillEl);
  barEl.appendChild(progress);

  const row = document.createElement("div");
  row.className = "rest-timer-row";

  const label = document.createElement("span");
  label.className = "rest-timer-label";
  label.textContent = "Rust";
  row.appendChild(label);

  timeEl = document.createElement("span");
  timeEl.className = "rest-timer-time";
  row.appendChild(timeEl);

  const extendBtn = document.createElement("button");
  extendBtn.type = "button";
  extendBtn.className = "btn btn-small rest-timer-btn";
  extendBtn.textContent = `+${EXTEND_SECONDS}s`;
  extendBtn.addEventListener("click", () => {
    // Extending an already-finished timer has to restart from now, not from a
    // deadline that has already passed, and has to get the interval running
    // again — tick() stopped it when it hit zero.
    const finished = intervalId === null;
    endsAt = (finished ? Date.now() : endsAt) + EXTEND_SECONDS * 1000;
    totalMs = finished ? EXTEND_SECONDS * 1000 : totalMs + EXTEND_SECONDS * 1000;
    if (finished) {
      barEl.classList.remove("done");
      intervalId = setInterval(tick, 250);
    }
    tick();
  });
  row.appendChild(extendBtn);

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "btn btn-small rest-timer-btn";
  doneBtn.textContent = "Klaar";
  doneBtn.addEventListener("click", stopRestTimer);
  row.appendChild(doneBtn);

  barEl.appendChild(row);
  document.body.appendChild(barEl);
  return barEl;
}

// Short beep through WebAudio — avoids shipping an audio file, and works
// offline. Silently does nothing where audio is blocked or unavailable.
function playChime() {
  if (!audioCtx) return;
  try {
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    [880, 1174].forEach((frequency, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = frequency;
      const startAt = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.2, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.18);
    });
  } catch {
    // Audio unavailable — the visual countdown and vibration still cover it.
  }
}

function tick() {
  const remaining = endsAt - Date.now();
  timeEl.textContent = formatTime(remaining);
  const ratio = totalMs > 0 ? Math.max(0, remaining) / totalMs : 0;
  fillEl.style.width = `${Math.min(100, ratio * 100)}%`;

  if (remaining > 0) return;

  clearInterval(intervalId);
  intervalId = null;
  barEl.classList.add("done");
  timeEl.textContent = "Klaar!";
  playChime();
  navigator.vibrate?.([200, 100, 200]);
}

export function startRestTimer(seconds = getRestSeconds()) {
  ensureBar();

  // Constructed here because this call always originates from a user
  // interaction; browsers block an AudioContext created without one.
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      audioCtx = null;
    }
  }

  totalMs = seconds * 1000;
  endsAt = Date.now() + totalMs;
  barEl.hidden = false;
  barEl.classList.remove("done");
  document.body.classList.add("rest-timer-open");

  clearInterval(intervalId);
  tick();
  intervalId = setInterval(tick, 250);
}

export function stopRestTimer() {
  clearInterval(intervalId);
  intervalId = null;
  if (barEl) {
    barEl.hidden = true;
    barEl.classList.remove("done");
  }
  document.body.classList.remove("rest-timer-open");
}
