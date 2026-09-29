import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
let raw;
let calls = [];
mock.module('../src/services/openaiService.js', { namedExports: { createChatJson: async messages => {
  calls.push(messages);
  return Array.isArray(raw) ? raw.shift() : raw;
} } });
const { auditCandidates, validateReview } = await import('../src/services/questionAuditService.js');
const sourceChunk = { id: 'source', text: 'La presión de servicio es 10 bar y el caudal nominal es 20 litros por minuto.' };
const question = { correct_answer: 'B' };
const valid = () => ({ index: 0, format: 'CIFRA', difficulty_matches: true, same_category: true, explanation_complete: true, options: ['A', 'B', 'C', 'D'].map(letter => ({ letter, selectable: letter === 'B', plausible: true, absolutes_supported: true, evidence: 'La presión de servicio es 10 bar', reason: 'El valor del manual permite descartar los demás valores.' })) });
test('requires a literal quote for the answer and lets it discard the distractors', () => {
  const review = valid();
  assert.deepEqual(validateReview(review, question, sourceChunk), []);
  review.options[2].evidence = 'No se menciona en el fragmento';
  assert.deepEqual(validateReview(review, question, sourceChunk), []);
  review.options[1].evidence = 'El manual dice 200 bares';
  assert.deepEqual(validateReview(review, question, sourceChunk), ['EVIDENCIA_NO_DOCUMENTADA_B', 'EVIDENCIA_NO_DOCUMENTADA_C']);
});
test('accepts quotes from other batch fragments, joined by ellipsis or split by hyphenation', () => {
  const review = valid();
  const other = { id: 'other', text: 'El caudal nomi-\nnal de la lanza es 20 litros por minuto.' };
  review.options[1].evidence = 'La presión de servicio es 10 bar ... el caudal nominal de la lanza';
  assert.deepEqual(validateReview(review, question, [sourceChunk, other]), []);
  review.options[1].evidence = 'El caudal nominal de la lanza es 20 litros\nLa presión de servicio es 10 bar';
  assert.deepEqual(validateReview(review, question, [sourceChunk, other]), []);
  review.options[1].evidence = 'La presión de servicio es 10 bar … inventado por el auditor';
  assert.ok(validateReview(review, question, [sourceChunk, other]).includes('EVIDENCIA_NO_DOCUMENTADA_B'));
});
test('rejects weak distractors, unjustified absolutes, ambiguity and missing explanation', () => {
  const review = valid();
  review.same_category = false;
  review.explanation_complete = false;
  review.options[0].selectable = true;
  review.options[3].absolutes_supported = false;
  assert.deepEqual(validateReview(review, question, sourceChunk), ['DISTRACTORES_OTRA_CATEGORIA', 'EXPLICACION_INSUFICIENTE', 'RESPUESTA_NO_UNICA_O_INCORRECTA', 'ABSOLUTO_NO_JUSTIFICADO_D']);
});

test('retries only invalid audit output and uses the same curated rules', async () => {
  const badQuote = valid();
  badQuote.options[0].evidence = 'La presión es de diez bares';
  badQuote.options[1].evidence = 'La presión es de diez bares';
  raw = [JSON.stringify({ reviews: [badQuote] }), JSON.stringify({ reviews: [valid()] }), JSON.stringify({ reviews: [valid()] })];
  calls = [];
  const candidates = [{ question: { ...question, question: 'Primera candidata' }, sourceChunk },
    { question: { ...question, question: 'Segunda candidata' }, sourceChunk }];
  const results = await auditCandidates(candidates, 'PRINCIPIANTE', [{ title: 'Regla compartida', content: 'Distractores accesibles', origin: 'CURATED' }]);
  assert.deepEqual(results.map(result => result.errors), [[], []]);
  assert.equal(calls.length, 3);
  const retry = calls.find(messages => messages[1].content.includes('EVIDENCIA_NO_DOCUMENTADA_B'));
  assert.match(retry[1].content, /Regla compartida/);
  assert.match(retry[1].content, /Primera candidata/);
  assert.doesNotMatch(retry[1].content, /Segunda candidata/);
});

test('audits every question in its own call so none is left incomplete', async () => {
  raw = JSON.stringify({ reviews: [valid()] });
  calls = [];
  const candidates = Array.from({ length: 8 }, (_, index) => ({ question: { ...question, question: `Candidata ${index}` }, sourceChunk }));
  const results = await auditCandidates(candidates, 'PRINCIPIANTE');
  assert.deepEqual(results.map(result => result.errors), Array(8).fill([]));
  assert.equal(calls.length, 8);
});

test('keeps semantic rejections and exposes the option reason without retrying', async () => {
  const review = valid();
  review.options[0].plausible = false;
  raw = JSON.stringify({ reviews: [review] });
  calls = [];
  const [result] = await auditCandidates([{ question, sourceChunk }], 'PRINCIPIANTE');
  assert.deepEqual(result.errors, ['OPCION_NO_PLAUSIBLE_A']);
  assert.equal(result.details[0].reason, review.options[0].reason);
  assert.equal(calls.length, 1);
});

test('stops after one audit retry and still rejects unverified evidence', async () => {
  const review = valid();
  review.options[1].evidence = 'Cita que no aparece en el fragmento';
  raw = JSON.stringify({ reviews: [review] });
  calls = [];
  const [result] = await auditCandidates([{ question, sourceChunk }], 'PRINCIPIANTE');
  assert.ok(result.errors.includes('EVIDENCIA_NO_DOCUMENTADA_B'));
  assert.equal(calls.length, 2);
});
test('fails closed for malformed, missing or duplicate review results', async () => {
  const candidates = [{ question, sourceChunk }];
  for (const response of ['invalid', JSON.stringify({ reviews: [] }), JSON.stringify({ reviews: [valid(), valid()] })]) {
    raw = response;
    assert.ok((await auditCandidates(candidates, 'PRINCIPIANTE'))[0].errors.length);
  }
  raw = JSON.stringify({ reviews: [valid()] });
  assert.deepEqual((await auditCandidates(candidates, 'PRINCIPIANTE'))[0], { errors: [], format: 'CIFRA' });
});
