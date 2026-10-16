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
  if (Object.keys(draft.rir || {}).length) return true;
  if (Object.values(draft.cardio || {}).some((v) => String(v ?? "").trim())) return true;
  return Object.values(draft.sets || {}).some((sets) =>
    sets.some((set) => String(set.weight ?? "").trim() || String(set.reps ?? "").trim())
  );
}

// Returns { note, sets, rir, cardio } for `dayId`, or null when there is nothing worth
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
  // rir/cardio are absent in drafts saved by an older version of the app.
  return { note: draft.note || "", sets: draft.sets || {}, rir: draft.rir || {}, cardio: draft.cardio || null };
}

// The day an unfinished, still-fresh workout belongs to, or null. Lets the
// Vandaag tab reopen on THAT day instead of the "next in rotation" day — a
// day picked by hand would otherwise vanish behind the default on every tab
// switch, draft and all.
export function getDraftDayId() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
  } catch {
    return null;
  }
  return draft?.dayId && loadDraft(draft.dayId) ? draft.dayId : null;
}

// Only ever called from a real input event, so the presence of a stored draft
// means the user actually typed something.
export function saveDraft(dayId, { note, sets, rir, cardio }) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      dayId,
      note,
      sets,
      rir,
      cardio,
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
