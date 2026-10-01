// The app shows three test levels. Internally each question keeps its QTH guide difficulty:
// Principiante only has P questions, Élite has F and D, and Aleatorio mixes P, F and D.
export const TEST_DIFFICULTIES = {
  PRINCIPIANTE: { label: "Principiante", levels: ["P"] },
  ELITE: { label: "Élite", levels: ["F", "D"] },
  ALEATORIO: { label: "Aleatorio", levels: ["P", "F", "D"] },
};

// How each question difficulty is named in the app, using the test levels.
export const QUESTION_LEVELS = {
  PRINCIPIANTE: { label: "Principiante", short: "P" },
  FACIL: { label: "Élite · fácil", short: "F" },
  DIFICIL: { label: "Élite · difícil", short: "D" },
};

export function distributeTestDifficulty(difficulty, total) {
  const levels = TEST_DIFFICULTIES[difficulty].levels;
  const counts = { P: 0, F: 0, D: 0 };
  levels.forEach((level, index) => {
    counts[level] = Math.floor(total / levels.length) + (index < total % levels.length ? 1 : 0);
  });
  return counts;
}

// What the review shows: one level, or the questions of each level when the test combines them.
export function testDifficultyLabel(test) {
  if (TEST_DIFFICULTIES[test.test_difficulty]) return TEST_DIFFICULTIES[test.test_difficulty].label;
  if (test.level_counts) {
    return Object.entries(TEST_DIFFICULTIES)
      .filter(([name]) => test.level_counts[name] > 0)
      .map(([name, { label }]) => `${test.level_counts[name]} ${label}`)
      .join(" · ");
  }
  // Older tests may only have their mix stored, so use it when it identifies a level.
  if (!test.difficulty_counts) return "Principiante";
  const levels = ["P", "F", "D"].filter(level => Number(test.difficulty_counts[level]) > 0);
  return Object.values(TEST_DIFFICULTIES).find(preset =>
    preset.levels.length === levels.length && preset.levels.every(level => levels.includes(level)),
  )?.label || "Personalizada";
}
