// Pure functions, no DOM/storage — ported from the "Trainingsschema" Sheet's
// automatic weight progression rule (see the sheet's "Start" tab, "Automatisering" row).

const UPPER_BODY_INCREMENT_KG = 2.5;
const LEG_DAY_INCREMENT_KG = 5;

// True if the last set's reps reached (or passed) the top of the prescribed rep range.
export function hitTopOfRange(lastSetReps, repRangeMax) {
  return lastSetReps >= repRangeMax;
}

// Whether a day counts as a "leg day" for increment purposes, based on its name
// (the sheet's split names leg days literally, e.g. "Woensdag – Legs").
export function isLegDay(dayName) {
  return /legs?/i.test(dayName || "");
}

// The weight to suggest next time, given the last weight used, whether the last
// set hit the top of the rep range, and whether this is a leg-day exercise.
// Unchanged if the top of the range wasn't reached, matching the sheet's rule.
export function suggestNextWeight(lastWeight, hitTop, legDay) {
  if (!hitTop) return lastWeight;
  return lastWeight + (legDay ? LEG_DAY_INCREMENT_KG : UPPER_BODY_INCREMENT_KG);
}
