// IndexedDB wrapper. Object stores: "days" (schema), "sessions" (workout log),
// "bodyLogs" (weight/waist/note), "photos" (progress photo blobs) and
// "chatMessages" (AI coach conversation history).

const DB_NAME = "trainingsapp";
const DB_VERSION = 3;

let dbPromise = null;

export function initDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      // Every store is added only if missing, never recreated — this runs
      // again on a real device with real existing data every time DB_VERSION
      // goes up, so it must never touch what's already there.
      const db = req.result;
      if (!db.objectStoreNames.contains("days")) {
        db.createObjectStore("days", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("bodyLogs")) {
        db.createObjectStore("bodyLogs", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("photos")) {
        db.createObjectStore("photos", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("chatMessages")) {
        db.createObjectStore("chatMessages", { keyPath: "id" });
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

export async function deleteSession(id) {
  const store = await tx("sessions", "readwrite");
  return requestToPromise(store.delete(id));
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

// Body metrics log: { id, date, weightKg, waistCm, note }. Local-only — never synced to the Sheet.
export async function getBodyLogs() {
  const store = await tx("bodyLogs", "readonly");
  const logs = await requestToPromise(store.getAll());
  return logs.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function saveBodyLog(entry) {
  const store = await tx("bodyLogs", "readwrite");
  return requestToPromise(store.put(entry));
}

export async function deleteBodyLog(id) {
  const store = await tx("bodyLogs", "readwrite");
  return requestToPromise(store.delete(id));
}

// Progress photos: { id, date, label, blob }. Blobs stored natively — IndexedDB
// supports them directly via structured clone, no base64 encoding needed.
export async function getPhotos() {
  const store = await tx("photos", "readonly");
  const photos = await requestToPromise(store.getAll());
  return photos.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function savePhoto(entry) {
  const store = await tx("photos", "readwrite");
  return requestToPromise(store.put(entry));
}

export async function deletePhoto(id) {
  const store = await tx("photos", "readwrite");
  return requestToPromise(store.delete(id));
}

// AI coach chat history: { id, role ("user"/"assistant"), content, createdAt }.
// Local-only — never synced to the Sheet, never sent anywhere except back to
// the AI provider as conversation context for the next reply.
export async function getChatMessages() {
  const store = await tx("chatMessages", "readonly");
  const messages = await requestToPromise(store.getAll());
  return messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export async function saveChatMessage(message) {
  const store = await tx("chatMessages", "readwrite");
  return requestToPromise(store.put(message));
}

export async function clearChatMessages() {
  const store = await tx("chatMessages", "readwrite");
  return requestToPromise(store.clear());
}

// Wipes and rewrites every data store in ONE transaction, so a restore either
// lands completely or not at all — a half-written database would leave the
// user with neither their old data nor their backup. Chat history is
// deliberately left alone: it isn't part of a backup.
export async function replaceAllData({ days, sessions, bodyLogs, photos }) {
  const db = await initDB();
  const storeNames = ["days", "sessions", "bodyLogs", "photos"];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);

    const rewrite = (name, items) => {
      const store = transaction.objectStore(name);
      store.clear();
      (items || []).forEach((item) => store.put(item));
    };
    rewrite("days", days);
    rewrite("sessions", sessions);
    rewrite("bodyLogs", bodyLogs);
    rewrite("photos", photos);
  });
}
