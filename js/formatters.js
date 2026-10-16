// Small display helpers shared by the Vandaag, Geschiedenis and Voortgang tabs.

// "52 kg — 10 / 10 / 10 / 7" when every set used the same weight (the normal
// case), "52×10 / 50×8" when they differ.
export function formatSetsLine(sets) {
  if (!sets.length) return "";
  const sameWeight = sets.every((set) => set.weight === sets[0].weight);
  if (sameWeight) return `${sets[0].weight} kg — ${sets.map((set) => set.reps).join(" / ")}`;
  return sets.map((set) => `${set.weight}×${set.reps}`).join(" / ");
}

// "10 min · 13% helling · 3.5 km/u" for a session's cardio-after-training.
export function formatCardio(cardio) {
  if (!cardio) return "";
  const parts = [`${cardio.minutes} min`];
  if (cardio.inclinePct != null) parts.push(`${cardio.inclinePct}% helling`);
  if (cardio.speedKmh != null) parts.push(`${cardio.speedKmh} km/u`);
  return parts.join(" · ");
}
