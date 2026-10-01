// The app shows three test levels; internally each question keeps its QTH guide difficulty (P, F, D).
// Principiante only has P questions, Élite has F and D, and Aleatorio mixes all three.
export const TEST_LEVELS = {
  PRINCIPIANTE: ["P"],
  ELITE: ["F", "D"],
  ALEATORIO: ["P", "F", "D"],
};
export const TEST_LEVEL_NAMES = Object.keys(TEST_LEVELS);

// The questions of each test level, split evenly among its difficulties and added up:
// 10 Principiante + 10 Élite + 10 Aleatorio = 14 P, 8 F and 8 D.
export function difficultyCountsFor(levelCounts) {
  const counts = { P: 0, F: 0, D: 0 };
  for (const [name, total] of Object.entries(levelCounts)) {
    const levels = TEST_LEVELS[name];
    levels.forEach((level, index) => {
      counts[level] += Math.floor(total / levels.length) + (index < total % levels.length ? 1 : 0);
    });
  }
  return counts;
}

// A test with a single level is named after it; one that combines levels is CUSTOM.
export function testLevelName(levelCounts) {
  const used = TEST_LEVEL_NAMES.filter((name) => levelCounts[name] > 0);
  return used.length === 1 ? used[0] : "CUSTOM";
}
