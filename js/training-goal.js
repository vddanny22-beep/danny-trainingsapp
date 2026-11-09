// Training phase: CUT / RECOMP (now) or LEAN MASS (later). The schema stays
// the same in both; the phase changes the emphasis around it:
//  - CUT / RECOMP: cardio after most sessions, watch recovery, don't add
//    volume just to burn calories, keep/build strength;
//  - LEAN MASS: less cardio, room for a bit more volume, AI Coach advice
//    aimed at maximal hypertrophy, weight is allowed to go up slowly.
// Stored like the other personal settings (rest time, targets).

const GOAL_KEY = "trainingsapp.trainingGoal";

export const TRAINING_GOALS = {
  cut: {
    label: "CUT / RECOMP",
    summary: "Vet verliezen, spiermassa en kracht opbouwen of behouden.",
    cardioMinutesPerWeek: 100, // ~15–20 min after most of the 6 sessions
    cardioHint: "±15–20 min incline walking na de meeste trainingen (10–13%, 3,5–4,0 km/u).",
  },
  "lean-mass": {
    label: "LEAN MASS",
    summary: "Maximale spieropbouw met zo min mogelijk vettoename.",
    cardioMinutesPerWeek: 40,
    cardioHint: "Cardio mag lager: 2–3× per week kort, vooral voor conditie en herstel.",
  },
};

export function getTrainingGoal() {
  try {
    const value = localStorage.getItem(GOAL_KEY);
    return value in TRAINING_GOALS ? value : "cut";
  } catch {
    return "cut";
  }
}

export function setTrainingGoal(goal) {
  try {
    if (goal in TRAINING_GOALS) localStorage.setItem(GOAL_KEY, goal);
  } catch {
    // storage blocked — the default (cut) stays in effect
  }
}

export function trainingGoalInfo(goal = getTrainingGoal()) {
  return { key: goal, ...TRAINING_GOALS[goal] };
}

// Pure. Cardio over the last `days` days: sessions with cardio, total minutes.
export function cardioSummary(sessions, now = new Date(), days = 7) {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  const recent = sessions.filter((s) => s.cardio?.minutes > 0 && new Date(s.date).getTime() > cutoff && new Date(s.date) <= now);
  return {
    count: recent.length,
    minutes: Math.round(recent.reduce((sum, s) => sum + s.cardio.minutes, 0)),
  };
}
