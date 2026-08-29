// Keeps an in-progress workout alive. The Vandaag tab rebuilds itself from
// scratch every time you open it, so without this everything typed is lost the
// moment you tap another tab — which the AI Coach actively invites you to do
// mid-workout. Persisting also survives the phone locking, the browser
// evicting the page, or the app being closed between sets.

const DRAFT_KEY = "trainingsapp.workoutDraft";

// A workout doesn't span half a day. Anything older is a leftover from a
// session that was abandoned or already logged some other way, and silently
// refilling the form with it would be worse than starting clean.
const MAX_DRAFT_AGE_MS = 12 * 60 * 60 * 1000;

function hasAnyContent(draft) {
  if (draft.note?.trim()) return true;
  return Object.values(draft.sets || {}).some((sets) =>
    sets.some((set) => String(set.weight ?? "").trim() || String(set.reps ?? "").trim())
  );
}

// Returns { note, sets } for `dayId`, or null when there is nothing worth
// restoring. A draft for a different day is not returned: switching days in
// the picker means a different workout.
export function loadDraft(dayId) {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
  } catch {
    return null;
  }
  if (!draft || draft.dayId !== dayId) return null;

  if (!draft.updatedAt || Date.now() - new Date(draft.updatedAt).getTime() > MAX_DRAFT_AGE_MS) {
    clearDraft();
    return null;
  }
  if (!hasAnyContent(draft)) {
    clearDraft();
    return null;
  }
  return { note: draft.note || "", sets: draft.sets || {} };
}

// Only ever called from a real input event, so the presence of a stored draft
// means the user actually typed something.
export function saveDraft(dayId, { note, sets }) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      dayId,
      note,
      sets,
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    // Storage full or blocked — the workout still works, it just won't survive
    // leaving the tab.
  }
}

export function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
}
