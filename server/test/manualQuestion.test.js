import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const testId = '00000000-0000-4000-8000-000000000001';
const documentId = '00000000-0000-4000-8000-000000000002';
const payload = {
  testId, documentId, question: '¿Cuál es la respuesta correcta?',
  option_a: 'Uno', option_b: 'Dos', option_c: 'Tres', option_d: 'Cuatro',
  correct_answer: 'B', explanation: 'Esta es la explicación del profesor.',
  source_title: 'Mi manual', topic: 'Mi tema', chapter: 'Mi capítulo', reference: 'Página 14, apartado 2',
  difficulty: 'FACIL',
};
let owner = 'teacher';
let status = 'COMPLETED';
let documentAllowed = true;
let calls = [];
mock.module('../src/db/pool.js', { namedExports: {
  withTransaction: async callback => callback({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('from question_sets')) return { rows: owner ? [{ id: testId, user_id: owner, status }] : [] };
    if (sql.includes('from documents')) return { rows: documentAllowed ? [{ id: documentId }] : [] };
    if (sql.includes('insert into questions')) return { rows: [{ id: 'new-question', user_id: params[0], is_manual: true }] };
    return { rows: [] };
  } }),
} });
const { createManualQuestion } = await import('../src/services/manualQuestionService.js');
const teacher = { id: 'teacher', role: 'PROFESOR' };

test.beforeEach(() => { owner = 'teacher'; status = 'COMPLETED'; documentAllowed = true; calls = []; });

test('saves all manual fields on the selected test and updates its count', async () => {
  const result = await createManualQuestion(teacher, { ...payload, question: `  ${payload.question}  ` });
  assert.equal(result.is_manual, true);
  const insert = calls.find(call => call.sql.includes('insert into questions'));
  assert.deepEqual(insert.params, ['teacher', documentId, testId, ...[
    'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer',
    'explanation', 'source_title', 'topic', 'chapter', 'reference', 'difficulty',
  ].map(field => payload[field])]);
  assert.ok(calls.some(call => call.sql.includes('update question_sets')));
});

test('rejects missing content, invalid identifiers and invalid answer or difficulty before writing', async () => {
  for (const field of ['question', 'option_a', 'option_b', 'option_c', 'option_d', 'explanation', 'source_title', 'topic', 'chapter', 'reference', 'testId', 'documentId', 'correct_answer', 'difficulty']) {
    await assert.rejects(createManualQuestion(teacher, { ...payload, [field]: ' ' }), { status: 400 });
  }
  assert.equal(calls.length, 0);
});

test('blocks another teacher’s test, a missing test, and inaccessible documents', async () => {
  owner = 'other';
  await assert.rejects(createManualQuestion(teacher, payload), { status: 404 });
  owner = null;
  await assert.rejects(createManualQuestion(teacher, payload), { status: 404 });
  owner = 'teacher'; documentAllowed = false;
  await assert.rejects(createManualQuestion(teacher, payload), { status: 404 });
  assert.ok(!calls.some(call => call.sql.includes('insert into questions')));
  const documentQuery = calls.find(call => call.sql.includes('from documents'));
  assert.deepEqual(documentQuery.params, [documentId, 'teacher', false]);
});

test('administrator additions remain owned by the test owner', async () => {
  const result = await createManualQuestion({ id: 'admin', role: 'ADMIN' }, payload);
  assert.equal(result.user_id, 'teacher');
});

test('blocks an active generation without inserting questions', async () => {
  status = 'GENERATING';
  await assert.rejects(createManualQuestion(teacher, payload), { status: 409 });
  assert.ok(!calls.some(call => call.sql.includes('insert into questions')));
});

test('allows adding to an interrupted test without changing its generation status', async () => {
  status = 'ERROR';
  await createManualQuestion(teacher, payload);
  assert.ok(calls.some(call => call.sql.includes('insert into questions')));
  assert.ok(!calls.some(call => /set status/.test(call.sql)));
});
