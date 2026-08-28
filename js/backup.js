import * as storage from "./storage.js";

// Full local backup: schema, sessions, body metrics and photos in one JSON
// file. This is the only way data leaves the phone in a restorable form — the
// Sheet sync is one-way and covers sessions only — so it's also what makes
// moving to a new phone possible. Chat history is deliberately excluded: it's
// a conversation log, not training data.

const BACKUP_APP = "trainingsapp";
const BACKUP_VERSION = 1;

// Photos are Blobs, which JSON can't hold, so they travel as data URLs.
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// fetch() parses data: URLs natively, which beats hand-rolling base64 decoding.
async function dataUrlToBlob(dataUrl) {
  const response = await fetch(dataUrl);
  return response.blob();
}

export async function buildBackup() {
  const [days, sessions, bodyLogs, photos] = await Promise.all([
    storage.getDays(),
    storage.getSessions(),
    storage.getBodyLogs(),
    storage.getPhotos(),
  ]);

  const encodedPhotos = [];
  for (const photo of photos) {
    encodedPhotos.push({
      id: photo.id,
      date: photo.date,
      label: photo.label,
      dataUrl: await blobToDataUrl(photo.blob),
    });
  }

  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    days,
    sessions,
    bodyLogs,
    photos: encodedPhotos,
  };
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Returns { ok, message } — never throws, so the caller can show the result
// straight to the user.
export async function downloadBackup() {
  let blob;
  try {
    const backup = await buildBackup();
    blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  } catch (err) {
    return { ok: false, message: `Back-up maken mislukt: ${err.message}` };
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `trainingsapp-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on a delay: revoking immediately can cancel the download in some
  // browsers before it has finished reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60000);

  return { ok: true, message: `Back-up gedownload (${formatSize(blob.size)}).` };
}

function isPlainArray(value) {
  return Array.isArray(value);
}

// Checks the file really is one of our backups before letting it replace
// everything — restoring is destructive, so a wrong file must fail loudly
// rather than wipe the user's training history.
function validateBackup(parsed) {
  if (!parsed || typeof parsed !== "object") return "Dit bestand bevat geen geldige back-up.";
  if (parsed.app !== BACKUP_APP) return "Dit lijkt geen back-up van deze app te zijn.";
  if (parsed.version > BACKUP_VERSION) {
    return "Deze back-up komt uit een nieuwere versie van de app. Werk de app eerst bij.";
  }
  if (!isPlainArray(parsed.days) || !isPlainArray(parsed.sessions)) {
    return "Deze back-up is beschadigd (schema of sessies ontbreken).";
  }
  return null;
}

// Replaces all training data with the contents of `file`.
// Returns { ok, message } — never throws.
export async function restoreBackupFromFile(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, message: "Kon het bestand niet lezen. Is het een back-up-JSON van deze app?" };
  }

  const problem = validateBackup(parsed);
  if (problem) return { ok: false, message: problem };

  try {
    const photos = [];
    for (const photo of parsed.photos || []) {
      if (!photo.dataUrl) continue;
      photos.push({
        id: photo.id,
        date: photo.date,
        label: photo.label,
        blob: await dataUrlToBlob(photo.dataUrl),
      });
    }

    await storage.replaceAllData({
      days: parsed.days,
      sessions: parsed.sessions,
      bodyLogs: parsed.bodyLogs || [],
      photos,
    });
  } catch (err) {
    return { ok: false, message: `Terugzetten mislukt: ${err.message}. Je bestaande gegevens zijn ongewijzigd.` };
  }

  const counts = [
    `${parsed.days.length} dagen`,
    `${parsed.sessions.length} sessies`,
    `${(parsed.bodyLogs || []).length} metingen`,
    `${(parsed.photos || []).length} foto's`,
  ].join(", ");
  return { ok: true, message: `Back-up teruggezet: ${counts}.` };
}
