// IndexedDB wrapper. Two object stores: "days" (schema) and "sessions" (log).

const DB_NAME = "trainingsapp";
const DB_VERSION = 1;

let dbPromise = null;

export function initDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("days")) {
        db.createObjectStore("days", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return initDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getDays() {
  const store = await tx("days", "readonly");
  const days = await requestToPromise(store.getAll());
  return days.sort((a, b) => a.order - b.order);
}

export async function saveDay(day) {
  const store = await tx("days", "readwrite");
  return requestToPromise(store.put(day));
}

export async function deleteDay(id) {
  const store = await tx("days", "readwrite");
  return requestToPromise(store.delete(id));
}

export async function getSessions() {
  const store = await tx("sessions", "readonly");
  const sessions = await requestToPromise(store.getAll());
  return sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function saveSession(session) {
  const store = await tx("sessions", "readwrite");
  return requestToPromise(store.put(session));
}

export async function getLastSession() {
  const sessions = await getSessions();
  return sessions.length ? sessions[0] : null;
}

// Most recent past entry for a given exercise, searched newest-first across all sessions.
// Matched by name, not id: the same exercise (e.g. "Chest Press") gets a separate
// id per day in the schema (Monday's Push day and Thursday's Push day each have
// their own exercise objects), but progression should carry across both, same as
// it did in the Sheet.
export async function getLastEntryForExerciseName(exerciseName) {
  const sessions = await getSessions();
  for (const session of sessions) {
    const entry = session.entries.find((e) => e.exerciseName === exerciseName);
    if (entry) return entry;
  }
  return null;
}
