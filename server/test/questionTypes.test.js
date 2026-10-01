import test from 'node:test';
import assert from 'node:assert/strict';
import { batchTypePlan, splitTypePlan, typeSelectionError, QUESTION_TYPES, TEACHER_TYPE_COUNTS, typeCountsForLevel, typeErrors, typeInstruction, typeTargets } from '../src/utils/questionTypes.js';

const sum = counts => Object.values(counts).reduce((a, b) => a + b, 0);

test('the teachers\' sample has 200 Principiante, 150 Élite and 70 Aleatorio questions', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(TEACHER_TYPE_COUNTS).map(([level, counts]) => [level, sum(counts)])), { PRINCIPIANTE: 200, ELITE: 150, ALEATORIO: 70 });
});

test('each level gets the teachers\' mix, rounded to add up to the number of questions', () => {
  assert.deepEqual(typeCountsForLevel('PRINCIPIANTE', 10), { LITERAL: 5, CONCEPTUAL: 2, CLASIFICACION: 1, COMPARACION: 1, APLICACION_PRACTICA: 1, CALCULO: 0, DETALLE_DIFICIL: 0, RELACION_CONCEPTOS: 0 });
  // The real mix, scaled: 200 Principiante questions are exactly the teachers' ones.
  assert.deepEqual(typeCountsForLevel('PRINCIPIANTE', 200), TEACHER_TYPE_COUNTS.PRINCIPIANTE);
  // Aleatorio never has comparisons, practical cases or calculations.
  const aleatorio = typeCountsForLevel('ALEATORIO', 30);
  assert.equal(aleatorio.COMPARACION + aleatorio.APLICACION_PRACTICA + aleatorio.CALCULO + aleatorio.RELACION_CONCEPTOS, 0);
  for (const level of Object.keys(TEACHER_TYPE_COUNTS)) for (const total of [1, 7, 10, 33, 120]) assert.equal(sum(typeCountsForLevel(level, total)), total);
});

test('a test that combines levels adds up the mix of each one', () => {
  const targets = typeTargets({ PRINCIPIANTE: 10, ELITE: 10, ALEATORIO: 10 });
  assert.equal(sum(targets), 30);
  assert.ok(targets.CALCULO >= 1);
  assert.deepEqual(Object.keys(targets), QUESTION_TYPES);
});

test('calculations go to F and D, relations only to D, and a full type is rejected until the quota is relaxed', () => {
  const targets = { ...typeTargets({ ELITE: 10 }) };
  const typeCounts = new Map([['LITERAL', targets.LITERAL]]);
  assert.deepEqual(typeErrors({ type: 'CALCULO', difficulty: 'FACIL', targets, typeCounts }), []);
  assert.deepEqual(typeErrors({ type: 'CALCULO', difficulty: 'PRINCIPIANTE', targets, typeCounts }), ['TIPO_NO_ADECUADO_AL_NIVEL']);
  assert.deepEqual(typeErrors({ type: 'RELACION_CONCEPTOS', difficulty: 'FACIL', targets, typeCounts }), ['TIPO_NO_ADECUADO_AL_NIVEL']);
  assert.deepEqual(typeErrors({ type: 'CALCULO', difficulty: 'DIFICIL', targets, typeCounts }), []);
  assert.deepEqual(typeErrors({ type: 'LITERAL', difficulty: 'DIFICIL', targets, typeCounts }), ['TIPO_EXCEDIDO']);
  assert.deepEqual(typeErrors({ type: 'LITERAL', difficulty: 'DIFICIL', targets, typeCounts, relax: true }), []);
  // Without a mix (a single document outside a test) nothing is enforced.
  assert.deepEqual(typeErrors({ type: 'CALCULO', difficulty: 'PRINCIPIANTE', targets: null, typeCounts }), []);
});

test('the generator is told exactly which types its batch must have', () => {
  const targets = typeTargets({ PRINCIPIANTE: 10 });
  // 5 literal, 2 conceptual, 1 classification, 1 comparison and 1 practical case missing: a batch of 4.
  assert.deepEqual(batchTypePlan({ targets, typeCounts: new Map(), difficulty: 'PRINCIPIANTE', count: 4 }), [['LITERAL', 2], ['CONCEPTUAL', 1], ['CLASIFICACION', 1]]);
  assert.match(typeInstruction({ targets, typeCounts: new Map(), difficulty: 'PRINCIPIANTE', count: 4 }), /genera exactamente 2 LITERAL, 1 CONCEPTUAL, 1 CLASIFICACION/);
  // Once literal is covered, it is no longer asked for.
  const later = batchTypePlan({ targets, typeCounts: new Map([['LITERAL', 5]]), difficulty: 'PRINCIPIANTE', count: 4 });
  assert.ok(!later.some(([type]) => type === 'LITERAL'));
  // Calculations and relations only in D batches, and first.
  const elite = typeTargets({ ELITE: 10 });
  const forD = Object.fromEntries(batchTypePlan({ targets: elite, typeCounts: new Map(), difficulty: 'DIFICIL', count: 4 }));
  assert.equal(forD.CALCULO, 1);
  assert.equal(forD.RELACION_CONCEPTOS, 1);
  assert.equal(Object.values(forD).reduce((a, b) => a + b), 4);
  const forF = Object.fromEntries(batchTypePlan({ targets: elite, typeCounts: new Map(), difficulty: 'FACIL', count: 8 }));
  assert.equal(forF.CALCULO, 1);
  assert.equal(forF.RELACION_CONCEPTOS, undefined);
});

test('the types of a batch are dealt to its parallel parts so each one gets a mix', () => {
  const parts = splitTypePlan([['LITERAL', 4], ['CONCEPTUAL', 2], ['CLASIFICACION', 1], ['COMPARACION', 1]], [4, 4]);
  assert.deepEqual(parts.map(part => part.reduce((sum, [, n]) => sum + n, 0)), [4, 4]);
  assert.ok(parts.every(part => part.length >= 2));
  assert.deepEqual(splitTypePlan(null, [4, 4]), [null, null]);
});

test('with some types selected, each level keeps the teachers\' proportions among them', () => {
  // Principiante: 108 literal and 32 conceptual questions → about 77 % and 23 %.
  assert.deepEqual(Object.fromEntries(Object.entries(typeTargets({ PRINCIPIANTE: 10 }, ['LITERAL', 'CONCEPTUAL'])).filter(([, n]) => n)), { LITERAL: 8, CONCEPTUAL: 2 });
  // The teachers never ask comparisons in Aleatorio: the selected types share it equally.
  assert.deepEqual(Object.fromEntries(Object.entries(typeTargets({ ALEATORIO: 10 }, ['COMPARACION', 'APLICACION_PRACTICA'])).filter(([, n]) => n)), { COMPARACION: 5, APLICACION_PRACTICA: 5 });
  // All selected: the teachers' mix, as before.
  assert.deepEqual(typeTargets({ PRINCIPIANTE: 10 }, QUESTION_TYPES), typeTargets({ PRINCIPIANTE: 10 }));
});

test('a selection that some question difficulty of the test cannot have is reported before generating', () => {
  assert.match(typeSelectionError(['CALCULO'], { P: 10, F: 0, D: 0 }), /preguntas principiante/);
  assert.match(typeSelectionError(['RELACION_CONCEPTOS'], { P: 0, F: 5, D: 5 }), /preguntas fáciles/);
  assert.equal(typeSelectionError(['CALCULO'], { P: 0, F: 5, D: 5 }), null);
  assert.equal(typeSelectionError(['LITERAL'], { P: 4, F: 3, D: 3 }), null);
});

test('a type the user did not select is never accepted, not even with relaxed quotas', () => {
  const targets = typeTargets({ PRINCIPIANTE: 10 }, ['LITERAL']);
  const check = (type, relax = false) => typeErrors({ type, difficulty: 'PRINCIPIANTE', targets, typeCounts: new Map(), relax, allowed: ['LITERAL'] });
  assert.deepEqual(check('CONCEPTUAL', true), ['TIPO_NO_SELECCIONADO']);
  assert.deepEqual(check(undefined), ['TIPO_NO_SELECCIONADO']);
  assert.deepEqual(check('LITERAL'), []);
});
