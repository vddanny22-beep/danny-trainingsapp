// Training plans. The schema itself lives in IndexedDB ("days") and is fully
// editable in the Schema tab; these constants are only used:
//  - getSeedDays(): the schema loaded on a first-ever run;
//  - migrations.js: the one-time upgrades of an existing schema.

// v2 (Push / Pull / Legs / Push 2 / Pull 2). Kept because migrations.js
// still upgrades a v1 schema through it before reaching the current plan.
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

// v3: 6-day bodybuilding split inspired by Ronnie Coleman's classic layout
// (back + biceps and chest + triceps twice a week, legs once, a separate
// shoulder day), with moderate volume for a cut/recomp: ±11–15 work sets a
// day, room for ~20 min cardio after. Exercise names match the existing ones
// on purpose — history and next-time advice are looked up by name.
const ex = (name, sets, repMin, repMax, incrementKg = 2.5) => ({ name, sets, repMin, repMax, incrementKg });

export const PLAN_V3 = [
  {
    name: "Maandag – Rug + Biceps A",
    focus: "Rugdikte · zware horizontale trekkracht",
    exercises: [
      ex("Chest Supported Row", 3, 6, 10),
      ex("Lat Pulldown", 3, 8, 12),
      ex("Rear Delt", 2, 12, 20),
      ex("Biceps Curl", 3, 8, 12),
      ex("Cable Hammer Curl", 2, 10, 15),
    ],
  },
  {
    name: "Dinsdag – Borst + Triceps A",
    focus: "Zwaardere borsttraining",
    exercises: [
      ex("Chest Press", 3, 6, 10),
      ex("Pec Fly", 3, 10, 15),
      ex("Triceps Pushdown", 3, 8, 12),
      ex("Overhead Cable Extension", 2, 10, 15),
    ],
  },
  {
    name: "Woensdag – Benen",
    focus: "Benen 1× per week · iets uitgebreider",
    exercises: [
      ex("Leg Press", 4, 6, 10, 5),
      ex("Leg Extension", 3, 10, 15),
      ex("Leg Curl", 3, 10, 15),
      ex("Calf Raise", 3, 10, 15),
    ],
  },
  {
    name: "Donderdag – Schouders",
    focus: "Brede schouders / V-taper",
    exercises: [
      ex("Shoulder Press", 3, 6, 10),
      ex("Cable Lateral Raise", 4, 12, 20),
      ex("Rear Delt", 3, 12, 20),
      ex("Cable Face Pull", 2, 12, 20),
      ex("Shrugs", 2, 10, 15),
    ],
  },
  {
    name: "Vrijdag – Rug + Biceps B",
    focus: "Rugbreedte / lats",
    exercises: [
      ex("Lat Pulldown", 3, 6, 10),
      ex("Chest Supported Row", 3, 8, 12),
      ex("Straight-Arm Cable Pulldown", 2, 10, 15),
      ex("Rear Delt", 2, 12, 20),
      ex("Biceps Curl", 3, 8, 12),
      ex("Cable Hammer Curl", 2, 10, 15),
    ],
  },
  {
    name: "Zaterdag – Borst + Triceps B",
    focus: "Tweede borstprikkel · hypertrofie / pomp",
    exercises: [
      ex("Chest Press", 3, 8, 12),
      ex("Pec Fly", 3, 10, 15),
      ex("Triceps Pushdown", 3, 10, 15),
      ex("Overhead Cable Extension", 2, 10, 15),
    ],
  },
  { name: "Zondag – Rust", focus: "Rustdag · herstel", rest: true, exercises: [] },
];

// One id per exercise name across all days: Rear Delt on Monday, Thursday
// and Friday is the same exercise, not three records. `idFor(name)` lets the
// migration hand in the ids the user's schema already has; `extrasFor(name)`
// carries the user's own machine settings (step, weight stack, muscles),
// which win over the plan's default step.
export function buildDaysFromPlan(plan, { idFor = () => null, dayIdFor = () => null, extrasFor = () => ({}) } = {}) {
  const ids = new Map();
  const exerciseId = (name) => {
    if (!ids.has(name)) ids.set(name, idFor(name) || crypto.randomUUID());
    return ids.get(name);
  };
  return plan.map((day, order) => {
    const built = {
      id: dayIdFor(day.name) || crypto.randomUUID(),
      name: day.name,
      focus: day.focus,
      order,
      exercises: day.exercises.map((e) => ({ id: exerciseId(e.name), ...e, ...extrasFor(e.name) })),
    };
    if (day.rest) built.rest = true;
    return built;
  });
}

export function getSeedDays() {
  return buildDaysFromPlan(PLAN_V3);
}
