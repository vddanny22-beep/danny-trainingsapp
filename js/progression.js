// Pure functions, no DOM/storage — the progressive-overload rule.
//
// Replaces the Sheet's old "last set hit the top of the range → add weight"
// rule, which ignored every set but the last and had no idea how hard that
// set was. This one looks at ALL sets plus the RIR (reps in reserve) logged
// after the last set:
//
//   - not every prescribed set done            → keep the weight
//   - every set at the top of the range, RIR≥1 → increase
//     (RIR ≥ 3: say clearly the weight was too light)
//   - every set at the top, but RIR 0          → keep the weight; same reps
//                                                 with a rep in reserve first
//   - last set under the bottom of the range   → keep, warn it may be too heavy
//                                                 (never lowered automatically)
//   - otherwise                                → keep, beat last time's reps
//
// Older sessions logged before RIR existed have lastSetRir undefined. For
// those, hitting the top on every set is treated as enough to increase —
// stricter than the old rule (which only looked at the last set), but it
// doesn't freeze progression just because RIR wasn't tracked back then.

// RIR 4 is stored as "4 or more" — the button reads "4+".
export const RIR_OPTIONS = [0, 1, 2, 3, 4];
export const RIR_MAX = 4;

export function formatRir(rir) {
  if (rir == null) return "";
  return rir >= RIR_MAX ? `${RIR_MAX}+` : String(rir);
}

// Fallback when an exercise has no incrementKg of its own (added before this
// setting existed and not touched by the migration, e.g. on an "Overig" day).
// Leg press/squat-type compounds take bigger jumps; everything else 2.5 kg.
export function defaultIncrementKg(exerciseName) {
  return /leg\s*press|squat|deadlift/i.test(exerciseName || "") ? 5 : 2.5;
}

export function incrementFor(exercise) {
  const inc = Number(exercise?.incrementKg);
  return inc > 0 ? inc : defaultIncrementKg(exercise?.name);
}

// Kills float noise (52 + 2.3 = 54.300000000000004) without rounding a real
// machine weight to some "nicer" step: two decimals keeps 2.2/2.3/2.7 kg
// stacks exactly as entered.
export function addKg(a, b) {
  return Math.round((a + b) * 100) / 100;
}

// Reps to aim for next time at the same weight: every set that fell short of
// the top of the range gets one more rep; missing sets are asked for at the
// bottom of the range. More reps at the same weight IS progression.
export function targetRepsFor(sets, targetSets, repMin, repMax) {
  const target = [];
  for (let i = 0; i < targetSets; i++) {
    const set = sets[i];
    if (!set) target.push(repMin);
    else target.push(Math.min(repMax, Math.max(repMin, set.reps + (set.reps < repMax ? 1 : 0))));
  }
  return target;
}

// `sets`: [{ weight, reps }] in order as logged. `lastSetRir`: 0..4 or null.
// `exercise`: { name, sets, repMin, repMax, incrementKg }.
// Returns null when there is nothing to base advice on. Otherwise:
// {
//   action: "increase" | "hold" | "improve" | "too-heavy",
//   label:  short Dutch line for the chip/summary,
//   detail: one-sentence explanation,
//   currentWeight, nextWeight,
//   targetReps: number[]  (only for non-increase actions — the reps to beat)
// }
export function recommendNext(sets, lastSetRir, exercise) {
  const valid = (sets || []).filter((s) => Number.isFinite(s?.weight) && Number.isFinite(s?.reps));
  if (!valid.length) return null;

  const targetSets = exercise.sets || valid.length;
  const { repMin, repMax } = exercise;
  const last = valid[valid.length - 1];
  const currentWeight = last.weight;
  const rir = lastSetRir == null || lastSetRir === "" ? null : Number(lastSetRir);
  const hold = (action, label, detail) => ({
    action,
    label,
    detail,
    currentWeight,
    nextWeight: currentWeight,
    targetReps: targetRepsFor(valid, targetSets, repMin, repMax),
  });

  if (valid.length < targetSets) {
    return hold(
      "hold",
      "Gewicht behouden",
      `Pas ${valid.length} van ${targetSets} sets gedaan — eerst alle sets voltooien voordat het gewicht omhoog gaat.`
    );
  }

  if (last.reps < repMin) {
    return hold(
      "too-heavy",
      "Mogelijk te zwaar",
      `Laatste set ${last.reps} reps, onder de ${repMin}. Gewicht behouden; blijft dit zo, verlaag dan zelf het gewicht.`
    );
  }

  const allTop = valid.every((s) => s.reps >= repMax);
  if (!allTop) {
    return hold("improve", "Eerst reps verbeteren", `Nog niet alle sets op ${repMax} reps — hetzelfde gewicht, meer reps.`);
  }

  if (rir === 0) {
    return hold(
      "hold",
      "Gewicht behouden",
      `Alle sets op ${repMax} reps, maar op RIR 0. Eerst dezelfde reps met nog 1 rep over, dan verhogen.`
    );
  }

  const nextWeight = addKg(currentWeight, incrementFor(exercise));
  let detail;
  if (rir == null) detail = `Alle sets op ${repMax} reps (geen RIR gelogd).`;
  else if (rir >= RIR_MAX) detail = `Alle sets op ${repMax} reps met RIR ${formatRir(rir)}: dit gewicht was waarschijnlijk duidelijk te licht. Verhogen, eventueel met meer dan één stap.`;
  else if (rir >= 3) detail = `Alle sets op ${repMax} reps met RIR ${rir}: verhogen is duidelijk verstandig.`;
  else detail = `Alle sets op ${repMax} reps met RIR ${rir}.`;

  return {
    action: "increase",
    label: "Volgende keer verhogen",
    detail,
    currentWeight,
    nextWeight,
    targetReps: null,
  };
}

// One-line summary like "52 kg behouden" / "54.5 kg (+2.5)".
export function formatAdviceWeight(rec) {
  if (!rec) return "";
  if (rec.action === "increase") return `${rec.nextWeight} kg (+${addKg(rec.nextWeight, -rec.currentWeight)})`;
  return `${rec.currentWeight} kg behouden`;
}

export function formatTargetReps(rec) {
  if (!rec?.targetReps) return "";
  return `Doel: minimaal ${rec.targetReps.join(" / ")}`;
}
