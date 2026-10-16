import * as storage from "./storage.js";
import { PLAN } from "./seed.js";
import { dayCategory } from "./volume-stats.js";
import { defaultIncrementKg } from "./progression.js";

// One-time, versioned upgrades of the stored SCHEMA (the "days" store).
//
// schemaVersion lives in the IndexedDB "meta" store, next to the data it
// describes. A database without it is version 1: everything logged before
// this mechanism existed. Each migration runs once, in order, and records
// its version in the same transaction as its writes (see
// storage.commitDaysMigration), so an interrupted migration simply runs again.
//
// What a migration may touch: the schema (sets, rep ranges, new per-exercise
// settings). What it never touches: sessions, body logs, photos, chat — those
// stores aren't even opened. Historical sessions keep their own exerciseName/
// exerciseId/sets exactly as logged.

export const CURRENT_SCHEMA_VERSION = 2;
const SNAPSHOT_KEY = "schemaSnapshotBeforeV2";

// "Chest-Supported Row " and "chest supported row" are the same exercise.
export function normaliseName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// The seed's day names, renamed to say which of the two Push/Pull days they are.
// Only exact matches: a day the user renamed themselves is left alone.
const DAY_RENAMES = {
  "Donderdag – Push": "Donderdag – Push 2",
  "Vrijdag – Pull": "Vrijdag – Pull 2",
};

// v1 → v2: the hypertrophy plan from seed.js PLAN.
// Pure — takes and returns plain day objects, no storage — so it can be tested
// on its own. Returns { days, removed: [{ dayName, exerciseName }], added: [...] }.
//
// Per Push/Pull/Legs day (by the same name-based category the volume stats use):
//  - an exercise whose name matches a plan exercise keeps its object, id and
//    any extra fields, and gets the plan's sets/reps/incrementKg;
//  - a plan exercise the day didn't have yet is added with a fresh id;
//  - an exercise not in the plan is dropped from the schema (its history
//    stays in the sessions, and the full old schema is snapshotted first).
// Any other day (category "Overig") keeps its exercises; they only get an
// incrementKg default if they had none.
export function migrateDaysV1toV2(days) {
  const removed = [];
  const added = [];

  const migrated = days.map((day) => {
    const category = dayCategory(day.name);
    const plan = PLAN[category];
    const name = DAY_RENAMES[day.name] || day.name;

    if (!plan) {
      return {
        ...day,
        name,
        exercises: (day.exercises || []).map((ex) =>
          ex.incrementKg > 0 ? ex : { ...ex, incrementKg: defaultIncrementKg(ex.name) }
        ),
      };
    }

    const unused = [...(day.exercises || [])];
    const exercises = plan.map((target) => {
      const index = unused.findIndex((ex) => normaliseName(ex.name) === normaliseName(target.name));
      if (index === -1) {
        added.push({ dayName: name, exerciseName: target.name });
        return { id: crypto.randomUUID(), ...target };
      }
      const [existing] = unused.splice(index, 1);
      // Keeps the existing name too, so name-based history lookups (and the
      // way the user spelled it) stay exactly as they were.
      return { ...existing, sets: target.sets, repMin: target.repMin, repMax: target.repMax, incrementKg: target.incrementKg };
    });
    unused.forEach((ex) => removed.push({ dayName: name, exerciseName: ex.name }));

    return { ...day, name, exercises };
  });

  return { days: migrated, removed, added };
}

// Runs every pending migration. Returns a short Dutch summary when something
// changed (for a one-time toast), or null when the schema was already current.
export async function runMigrations() {
  const stored = await storage.getMeta("schemaVersion");
  const version = Number.isInteger(stored) ? stored : 1;
  if (version >= CURRENT_SCHEMA_VERSION) return null;

  let summary = null;

  if (version < 2) {
    const before = await storage.getDays();
    const { days, removed } = migrateDaysV1toV2(before);
    // Snapshot of the schema exactly as it was, so the change can be undone
    // from the Schema tab. Not overwritten if an older one exists — the
    // first snapshot is the one that holds the user's real old schema.
    const existingSnapshot = await storage.getMeta(SNAPSHOT_KEY);
    const meta = { schemaVersion: 2, schemaMigratedAt: new Date().toISOString() };
    if (!existingSnapshot && before.length) meta[SNAPSHOT_KEY] = { savedAt: new Date().toISOString(), days: before };
    await storage.commitDaysMigration(days, meta);

    const removedNames = [...new Set(removed.map((r) => r.exerciseName))];
    summary = before.length
      ? "Schema bijgewerkt naar het nieuwe hypertrofieschema." +
        (removedNames.length ? ` Uit het schema gehaald: ${removedNames.join(", ")} (historie blijft bewaard).` : "")
      : null;
  }

  return summary;
}

export async function markSchemaCurrent() {
  await storage.setMeta("schemaVersion", CURRENT_SCHEMA_VERSION);
}

export async function getSchemaSnapshot() {
  return storage.getMeta(SNAPSHOT_KEY);
}

// Puts the pre-migration schema back (sessions untouched). Version stays 2,
// so the migration doesn't immediately overwrite it again on the next launch.
export async function restoreSchemaSnapshot() {
  const snapshot = await getSchemaSnapshot();
  if (!snapshot?.days?.length) return false;
  await storage.replaceDays(snapshot.days);
  return true;
}
