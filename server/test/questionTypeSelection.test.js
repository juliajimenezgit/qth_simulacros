import test from 'node:test';
import assert from 'node:assert/strict';
import { availableTypes, QUESTION_TYPE_DESCRIPTIONS, QUESTION_TYPE_LABELS, typeSelectionWarning } from '../../client/src/utils/questionTypes.js';
import { QUESTION_TYPES } from '../src/utils/questionTypes.js';

test('the generator offers the eight types of the QTH guide, with their description', () => {
  assert.deepEqual(Object.keys(QUESTION_TYPE_LABELS), QUESTION_TYPES);
  assert.deepEqual(Object.keys(QUESTION_TYPE_DESCRIPTIONS), QUESTION_TYPES);
});

test('warns before generating when the selected types cannot fill the selected levels', () => {
  assert.match(typeSelectionWarning(['CALCULO'], { PRINCIPIANTE: 10, ELITE: 0, ALEATORIO: 0 }), /Principiante/);
  assert.match(typeSelectionWarning(['RELACION_CONCEPTOS'], { PRINCIPIANTE: 0, ELITE: 10, ALEATORIO: 0 }), /solo existe en preguntas difíciles/);
  assert.equal(typeSelectionWarning(['CALCULO'], { PRINCIPIANTE: 0, ELITE: 10, ALEATORIO: 0 }), '');
  assert.equal(typeSelectionWarning(['LITERAL', 'CALCULO'], { PRINCIPIANTE: 10, ELITE: 0, ALEATORIO: 0 }), '');
  assert.match(typeSelectionWarning([], { PRINCIPIANTE: 10, ELITE: 0, ALEATORIO: 0 }), /al menos un tipo/);
});

test('with only Principiante, calculations and relations of concepts are not available', () => {
  const only = levels => availableTypes({ PRINCIPIANTE: 0, ELITE: 0, ALEATORIO: 0, ...levels });
  assert.ok(!only({ PRINCIPIANTE: 10 }).includes('CALCULO'));
  assert.ok(!only({ PRINCIPIANTE: 10 }).includes('RELACION_CONCEPTOS'));
  assert.equal(only({ PRINCIPIANTE: 10 }).length, 6);
  // Élite or Aleatorio bring F and D questions: all types.
  assert.equal(only({ PRINCIPIANTE: 10, ELITE: 5 }).length, 8);
  assert.equal(only({ ALEATORIO: 10 }).length, 8);
});
