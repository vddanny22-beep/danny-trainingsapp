import * as storage from "./storage.js";
import { PLAN, PLAN_V3, buildDaysFromPlan } from "./seed.js";
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

export const CURRENT_SCHEMA_VERSION = 3;
const SNAPSHOT_KEY = "schemaSnapshotBeforeV2";
const SNAPSHOT_KEY_V3 = "schemaSnapshotBeforeV3";

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

// v2 → v3: the 6-day split (Rug + Biceps A, Borst + Triceps A, Benen,
// Schouders, Rug + Biceps B, Borst + Triceps B, Zondag rust) from seed.js
// PLAN_V3. Pure, like v1→v2. Returns { days, removed }.
//  - Exercises the user already has keep their id (first one found by name)
//    and their own machine settings: step, weight stack, muscles. Their name
//    is the plan's, which is the same spelling the v2 plan used.
//  - The same exercise on several days shares one id.
//  - The legs day keeps its id; the other days are new (their contents
//    changed completely, and sessions keep their own dayName anyway).
//  - Anything in the old schema that isn't in the new plan is dropped from
//    the SCHEMA only (listed in `removed`; history is untouched).
export function migrateDaysV2toV3(days) {
  const existing = new Map();
  (days || []).forEach((day) => (day.exercises || []).forEach((e) => {
    const key = normaliseName(e.name);
    if (!existing.has(key)) existing.set(key, e);
  }));
  const legsDay = (days || []).find((d) => dayCategory(d.name) === "Legs");

  const planNames = new Set(PLAN_V3.flatMap((d) => d.exercises.map((e) => normaliseName(e.name))));
  const removed = [...existing.values()].filter((e) => !planNames.has(normaliseName(e.name))).map((e) => e.name);

  const migrated = buildDaysFromPlan(PLAN_V3, {
    idFor: (name) => existing.get(normaliseName(name))?.id || null,
    dayIdFor: (name) => (legsDay && /Benen/.test(name) ? legsDay.id : null),
    extrasFor: (name) => {
      const old = existing.get(normaliseName(name));
      if (!old) return {};
      const extras = {};
      if (old.incrementKg > 0) extras.incrementKg = old.incrementKg;
      if (Array.isArray(old.weightStack) && old.weightStack.length) extras.weightStack = old.weightStack;
      if (old.muscles && (old.muscles.primary?.length || old.muscles.secondary?.length)) extras.muscles = old.muscles;
      return extras;
    },
  });
  return { days: migrated, removed };
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

  if (version < 3) {
    // Re-read: the v2 step above may just have rewritten the days.
    const before = await storage.getDays();
    const { days, removed } = migrateDaysV2toV3(before);
    const meta = { schemaVersion: 3, schemaMigratedAt: new Date().toISOString() };
    if (!(await storage.getMeta(SNAPSHOT_KEY_V3)) && before.length) {
      meta[SNAPSHOT_KEY_V3] = { savedAt: new Date().toISOString(), days: before };
    }
    // replaceDays semantics inside the same transaction: old day records
    // that the new plan doesn't reuse are deleted from the "days" store
    // (they live on in the snapshot); nothing else is touched.
    const keep = new Set(days.map((d) => d.id));
    await storage.commitDaysMigration(days, meta, before.map((d) => d.id).filter((id) => !keep.has(id)));
    summary = before.length
      ? "Nieuw 6-daags schema actief: Rug + Biceps, Borst + Triceps, Benen, Schouders. Je historie blijft volledig bewaard." +
        (removed.length ? ` Niet meer in het schema: ${removed.join(", ")}.` : "")
      : null;
  }

  return summary;
}

export async function markSchemaCurrent() {
  await storage.setMeta("schemaVersion", CURRENT_SCHEMA_VERSION);
}

// The most recent pre-migration schema: before v3 if that migration ran,
// else before v2.
export async function getSchemaSnapshot() {
  return (await storage.getMeta(SNAPSHOT_KEY_V3)) || storage.getMeta(SNAPSHOT_KEY);
}

// Puts the pre-migration schema back (sessions untouched). The version stays
// current, so the migration doesn't immediately overwrite it on next launch.
export async function restoreSchemaSnapshot() {
  const snapshot = await getSchemaSnapshot();
  if (!snapshot?.days?.length) return false;
  await storage.replaceDays(snapshot.days);
  return true;
}
