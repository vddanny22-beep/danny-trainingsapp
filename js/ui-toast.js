// Lightweight snackbar for transient confirmations (e.g. "Sessie opgeslagen").
// Purely additive: existing inline .save-status text stays as the reliable,
// accessible confirmation — this is just a visual accent layered on top, and
// it disappears on its own, so nothing depends on it being seen.
const DISMISS_AFTER_MS = 2500;

let toastEl = null;
let hideTimer = null;

function ensureToast() {
  if (toastEl) return toastEl;
  toastEl = document.createElement("div");
  toastEl.className = "ui-toast";
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  document.body.appendChild(toastEl);
  return toastEl;
}

export function showToast(message) {
  const el = ensureToast();
  el.textContent = message;
  el.classList.add("visible");

  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    el.classList.remove("visible");
  }, DISMISS_AFTER_MS);
}
