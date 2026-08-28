// Default schema, matching Danny's current "Trainingsschema" Google Sheet split
// at the time this app was built. Loaded once, on first run only — fully
// editable afterward through the Schema Editor.

function exercise(name) {
  return { id: crypto.randomUUID(), name, sets: 4, repMin: 6, repMax: 10 };
}

export function getSeedDays() {
  const pushExercises = () => [
    exercise("Chest Press"),
    exercise("Shoulder Press"),
    exercise("Pec Fly"),
    exercise("Cable Lateral Raise"),
    exercise("Triceps Pushdown"),
    exercise("Bar Pushdown"),
  ];

  const pullExercises = () => [
    exercise("Lat Pulldown"),
    exercise("Seated Row"),
    exercise("Chest Supported Row"),
    exercise("Rear Delt"),
    exercise("Biceps Curl"),
    exercise("Cable Hammer Curl"),
  ];

  const legExercises = () => [
    exercise("Hack Squat"),
    exercise("Leg Extension"),
    exercise("Leg Curl"),
    exercise("Calf Raise"),
  ];

  return [
    { id: crypto.randomUUID(), name: "Maandag – Push", order: 0, exercises: pushExercises() },
    { id: crypto.randomUUID(), name: "Dinsdag – Pull", order: 1, exercises: pullExercises() },
    { id: crypto.randomUUID(), name: "Woensdag – Legs", order: 2, exercises: legExercises() },
    { id: crypto.randomUUID(), name: "Donderdag – Push", order: 3, exercises: pushExercises() },
    { id: crypto.randomUUID(), name: "Vrijdag – Pull", order: 4, exercises: pullExercises() },
  ];
}
