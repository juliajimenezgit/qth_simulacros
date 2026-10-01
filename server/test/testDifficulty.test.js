import test from 'node:test';
import assert from 'node:assert/strict';
import { distributeTestDifficulty, testDifficultyLabel } from '../../client/src/utils/testDifficulty.js';

test('test presets generate the requested mixtures and preserve totals', () => {
  assert.deepEqual(distributeTestDifficulty('PRINCIPIANTE', 10), { P: 5, F: 5, D: 0 });
  assert.deepEqual(distributeTestDifficulty('FACIL', 10), { P: 0, F: 5, D: 5 });
  assert.deepEqual(distributeTestDifficulty('DIFICIL', 10), { P: 4, F: 3, D: 3 });
  for (const preset of ['PRINCIPIANTE', 'FACIL', 'DIFICIL']) {
    for (const total of [1, 2, 7, 120]) {
      assert.equal(Object.values(distributeTestDifficulty(preset, total)).reduce((a, b) => a + b), total);
    }
  }
});

test('review preserves the chosen title even for a small or subsequently edited test', () => {
  assert.equal(testDifficultyLabel({ test_difficulty: 'DIFICIL', difficulty_counts: { P: 1, F: 0, D: 0 } }), 'Difícil');
  assert.equal(testDifficultyLabel({ test_difficulty: 'PRINCIPIANTE' }), 'Principiante');
  assert.equal(testDifficultyLabel({ test_difficulty: 'FACIL' }), 'Fácil');
  assert.equal(testDifficultyLabel({ test_difficulty: 'CUSTOM', difficulty_counts: { P: 5, F: 5, D: 0 } }), 'Personalizada');
});

test('older tests use their recorded mix without inventing a title for missing data', () => {
  assert.equal(testDifficultyLabel({ difficulty_counts: { P: 5, F: 5, D: 0 } }), 'Principiante');
  assert.equal(testDifficultyLabel({ difficulty_counts: { P: 0, F: 5, D: 5 } }), 'Fácil');
  assert.equal(testDifficultyLabel({ difficulty_counts: { P: 4, F: 3, D: 3 } }), 'Difícil');
  assert.equal(testDifficultyLabel({}), 'No disponible');
});
