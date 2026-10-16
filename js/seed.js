// The training plan: Push / Pull / Legs / Push 2 / Pull 2, body-recomposition
// focus (hypertrophy, progressive overload, recovery-aware volume).
//
// Used in two places:
//  - getSeedDays(): the schema loaded on a first-ever run (fully editable after);
//  - migrations.js: the one-time upgrade of an existing schema to this plan.
// Compounds sit in the 6–10 range with 4 sets; isolation work gets 3 sets and
// a higher range, which is where it actually grows best.

export const PLAN = {
  Push: [
    { name: "Chest Press", sets: 4, repMin: 6, repMax: 10, incrementKg: 2.5 },
    { name: "Shoulder Press", sets: 3, repMin: 6, repMax: 10, incrementKg: 2.5 },
    { name: "Pec Fly", sets: 3, repMin: 10, repMax: 15, incrementKg: 2.5 },
    { name: "Cable Lateral Raise", sets: 3, repMin: 12, repMax: 20, incrementKg: 2.5 },
    { name: "Triceps Pushdown", sets: 3, repMin: 8, repMax: 12, incrementKg: 2.5 },
    { name: "Overhead Cable Extension", sets: 3, repMin: 10, repMax: 15, incrementKg: 2.5 },
  ],
  Pull: [
    { name: "Lat Pulldown", sets: 4, repMin: 6, repMax: 10, incrementKg: 2.5 },
    { name: "Chest Supported Row", sets: 4, repMin: 6, repMax: 10, incrementKg: 2.5 },
    { name: "Rear Delt", sets: 3, repMin: 12, repMax: 20, incrementKg: 2.5 },
    { name: "Biceps Curl", sets: 3, repMin: 8, repMax: 12, incrementKg: 2.5 },
    { name: "Cable Hammer Curl", sets: 3, repMin: 10, repMax: 15, incrementKg: 2.5 },
  ],
  Legs: [
    { name: "Leg Press", sets: 4, repMin: 6, repMax: 10, incrementKg: 5 },
    { name: "Leg Extension", sets: 3, repMin: 10, repMax: 15, incrementKg: 2.5 },
    { name: "Leg Curl", sets: 3, repMin: 10, repMax: 15, incrementKg: 2.5 },
    { name: "Calf Raise", sets: 3, repMin: 10, repMax: 15, incrementKg: 2.5 },
  ],
};

function exercises(category) {
  return PLAN[category].map((ex) => ({ id: crypto.randomUUID(), ...ex }));
}

export function getSeedDays() {
  return [
    { id: crypto.randomUUID(), name: "Maandag – Push", order: 0, exercises: exercises("Push") },
    { id: crypto.randomUUID(), name: "Dinsdag – Pull", order: 1, exercises: exercises("Pull") },
    { id: crypto.randomUUID(), name: "Woensdag – Legs", order: 2, exercises: exercises("Legs") },
    { id: crypto.randomUUID(), name: "Donderdag – Push 2", order: 3, exercises: exercises("Push") },
    { id: crypto.randomUUID(), name: "Vrijdag – Pull 2", order: 4, exercises: exercises("Pull") },
  ];
}
