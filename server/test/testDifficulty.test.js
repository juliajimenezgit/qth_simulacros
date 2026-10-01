import test from 'node:test';
import assert from 'node:assert/strict';
import { distributeTestDifficulty, testDifficultyLabel, TEST_DIFFICULTIES } from '../../client/src/utils/testDifficulty.js';
import { difficultyCountsFor, TEST_LEVELS, testLevelName } from '../src/utils/testLevels.js';

test('Principiante only has P questions, Élite has F and D, and Aleatorio mixes all three', () => {
  assert.deepEqual(distributeTestDifficulty('PRINCIPIANTE', 10), { P: 10, F: 0, D: 0 });
  assert.deepEqual(distributeTestDifficulty('ELITE', 10), { P: 0, F: 5, D: 5 });
  assert.deepEqual(distributeTestDifficulty('ALEATORIO', 10), { P: 4, F: 3, D: 3 });
  for (const level of Object.keys(TEST_DIFFICULTIES)) {
    for (const total of [1, 2, 7, 120]) {
      assert.equal(Object.values(distributeTestDifficulty(level, total)).reduce((a, b) => a + b), total);
    }
  }
});

test('the app shows the levels in the order Principiante, Élite, Aleatorio, and client and server agree', () => {
  assert.deepEqual(Object.values(TEST_DIFFICULTIES).map(level => level.label), ['Principiante', 'Élite', 'Aleatorio']);
  for (const [name, { levels }] of Object.entries(TEST_DIFFICULTIES)) assert.deepEqual(levels, TEST_LEVELS[name]);
});

test('review shows the level chosen for the test, even for a small test', () => {
  assert.equal(testDifficultyLabel({ test_difficulty: 'ALEATORIO', difficulty_counts: { P: 1, F: 0, D: 0 } }), 'Aleatorio');
  assert.equal(testDifficultyLabel({ test_difficulty: 'ELITE' }), 'Élite');
  assert.equal(testDifficultyLabel({ test_difficulty: 'PRINCIPIANTE' }), 'Principiante');
});

test('older tests take the level that matches their mix and default to Principiante', () => {
  assert.equal(testDifficultyLabel({ test_difficulty: 'CUSTOM', difficulty_counts: { P: 4, F: 3, D: 3 } }), 'Aleatorio');
  assert.equal(testDifficultyLabel({ difficulty_counts: { P: 0, F: 5, D: 5 } }), 'Élite');
  assert.equal(testDifficultyLabel({ difficulty_counts: { P: 5, F: 5, D: 0 } }), 'Personalizada');
  assert.equal(testDifficultyLabel({}), 'Principiante');
});

test('a test can combine levels: each level is split into its own difficulties', () => {
  assert.deepEqual(difficultyCountsFor({ PRINCIPIANTE: 10, ELITE: 10, ALEATORIO: 10 }), { P: 14, F: 8, D: 8 });
  assert.deepEqual(difficultyCountsFor({ PRINCIPIANTE: 0, ELITE: 7, ALEATORIO: 0 }), { P: 0, F: 4, D: 3 });
  assert.equal(testLevelName({ PRINCIPIANTE: 0, ELITE: 12, ALEATORIO: 0 }), 'ELITE');
  assert.equal(testLevelName({ PRINCIPIANTE: 10, ELITE: 10, ALEATORIO: 10 }), 'CUSTOM');
  // The server split matches what the app shows for a single level.
  for (const name of Object.keys(TEST_LEVELS)) assert.deepEqual(difficultyCountsFor({ [name]: 11 }), distributeTestDifficulty(name, 11));
});

test('review lists the questions of each level of a combined test', () => {
  assert.equal(testDifficultyLabel({ test_difficulty: 'CUSTOM', level_counts: { PRINCIPIANTE: 10, ELITE: 10, ALEATORIO: 10 } }), '10 Principiante · 10 Élite · 10 Aleatorio');
  assert.equal(testDifficultyLabel({ test_difficulty: 'CUSTOM', level_counts: { PRINCIPIANTE: 5, ELITE: 0, ALEATORIO: 15 } }), '5 Principiante · 15 Aleatorio');
});
