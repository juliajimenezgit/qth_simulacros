export const TEST_DIFFICULTIES = {
  PRINCIPIANTE: { label: "Principiante", levels: ["P", "F"] },
  FACIL: { label: "Fácil", levels: ["F", "D"] },
  DIFICIL: { label: "Difícil", levels: ["P", "F", "D"] },
};

export function distributeTestDifficulty(difficulty, total) {
  const levels = TEST_DIFFICULTIES[difficulty].levels;
  const counts = { P: 0, F: 0, D: 0 };
  levels.forEach((level, index) => {
    counts[level] = Math.floor(total / levels.length) + (index < total % levels.length ? 1 : 0);
  });
  return counts;
}

export function testDifficultyLabel(test) {
  if (test.test_difficulty === "CUSTOM") return "Personalizada";
  if (TEST_DIFFICULTIES[test.test_difficulty]) return TEST_DIFFICULTIES[test.test_difficulty].label;
  // Older tests only stored their mix, so use it when it identifies a preset.
  if (!test.difficulty_counts) return "No disponible";
  const levels = ["P", "F", "D"].filter(level => Number(test.difficulty_counts[level]) > 0);
  return Object.values(TEST_DIFFICULTIES).find(preset =>
    preset.levels.length === levels.length && preset.levels.every(level => levels.includes(level)),
  )?.label || "Personalizada";
}
