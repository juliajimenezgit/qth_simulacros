import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
let raw;
let calls = [];
mock.module('../src/services/openaiService.js', { namedExports: { createChatJson: async messages => {
  calls.push(messages);
  return Array.isArray(raw) ? raw.shift() : raw;
} } });
const { answerSourceChunk, auditCandidates, validateReview } = await import('../src/services/questionAuditService.js');
const sourceChunk = { id: 'source', text: 'La presión de servicio es 10 bar y el caudal nominal es 20 litros por minuto.' };
const question = { correct_answer: 'B' };
const valid = () => ({ index: 0, format: 'CIFRA', stem_clear: true, single_question: true, difficulty_matches: true, options_distinct: true, answer_blends_in: true, not_contestable: true, calculation_correct: true, same_category: true, explanation_complete: true, options: ['A', 'B', 'C', 'D'].map(letter => ({ letter, selectable: letter === 'B', plausible: true, discardable_without_knowledge: false, discard_pattern: 'ninguno', absolutes_supported: true, evidence: 'La presión de servicio es 10 bar', reason: 'El valor del manual permite descartar los demás valores.' })) });
test('requires a literal quote for the answer and lets it discard invented distractors', () => {
  const review = valid();
  assert.deepEqual(validateReview(review, question, sourceChunk), []);
  // An acceptable invented value (12 bar) is discarded by the answer's quote.
  review.options[2].evidence = 'No se menciona en el fragmento';
  assert.deepEqual(validateReview(review, question, sourceChunk), []);
  review.options[1].evidence = 'El manual dice 200 bares';
  // Only the valid answer must come from the manual; distractors never need their own quote.
  assert.deepEqual(validateReview(review, question, sourceChunk), ['EVIDENCIA_NO_DOCUMENTADA_B']);
});
test('rejects an invented distractor the reviewer finds implausible', () => {
  const review = valid();
  review.options[0].plausible = false;
  assert.deepEqual(validateReview(review, question, sourceChunk), ['OPCION_NO_PLAUSIBLE_A']);
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

test('rejects an unclear stem or one that asks more than one thing', () => {
  const review = valid();
  review.stem_clear = false;
  review.single_question = false;
  assert.deepEqual(validateReview(review, question, sourceChunk), ['ENUNCIADO_CONFUSO', 'ENUNCIADO_VARIAS_COSAS']);
});

test('retries only invalid audit output', async () => {
  const badQuote = valid();
  badQuote.options[0].evidence = 'La presión es de diez bares';
  badQuote.options[1].evidence = 'La presión es de diez bares';
  raw = [JSON.stringify({ reviews: [badQuote] }), JSON.stringify({ reviews: [valid()] }), JSON.stringify({ reviews: [valid()] })];
  calls = [];
  const candidates = [{ question: { ...question, question: 'Primera candidata' }, sourceChunk },
    { question: { ...question, question: 'Segunda candidata' }, sourceChunk }];
  const results = await auditCandidates(candidates, 'PRINCIPIANTE');
  assert.deepEqual(results.map(result => result.errors), [[], []]);
  assert.equal(calls.length, 3);
  const retry = calls.find(messages => messages[1].content.includes('EVIDENCIA_NO_DOCUMENTADA_B'));
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
  assert.deepEqual((await auditCandidates(candidates, 'PRINCIPIANTE'))[0], { errors: [], format: 'CIFRA', sourceChunkId: 'source' });
});

test('grounds an option copied from the manual even if the reviewer paraphrases every quote', () => {
  const review = valid();
  for (const option of review.options) option.evidence = 'Cita parafraseada por el revisor sin respaldo';
  const copied = { ...question, option_b: 'Diez bares de presión.', option_c: 'El caudal nominal es 20 litros por minuto.' };
  // The valid answer (B) is not literal in the manual: rejected, whatever the distractors say.
  assert.deepEqual(validateReview(review, copied, sourceChunk), ['EVIDENCIA_NO_DOCUMENTADA_B']);
  // Copied from the manual, it is grounded by its own text.
  assert.deepEqual(validateReview(review, { ...copied, correct_answer: 'C' }, sourceChunk).filter(error => error.startsWith('EVIDENCIA')), []);
});

test('ignores location labels before a quote and grounds a short answer in the fragment', () => {
  const review = valid();
  for (const option of review.options) option.evidence = 'Cita parafraseada por el revisor sin respaldo';
  review.options[1].evidence = 'Pág. 58, 3.1. Presión: La presión de servicio es 10 bar';
  assert.deepEqual(validateReview(review, question, sourceChunk), []);
  review.options[1].evidence = 'Cita parafraseada por el revisor sin respaldo';
  assert.deepEqual(validateReview(review, { ...question, option_b: '10 bar.' }, sourceChunk), []);
  assert.deepEqual(validateReview(review, { ...question, option_b: '14 bar.' }, sourceChunk), ['EVIDENCIA_NO_DOCUMENTADA_B']);
});

test('rejects a discardable option only with one of the three named patterns', () => {
  const review = valid();
  // False according to the source but no named pattern: a good distractor, not discardable.
  review.options[0].discardable_without_knowledge = true;
  assert.deepEqual(validateReview(review, question, sourceChunk), []);
  // Any named pattern on an option the reviewer itself rates plausible is a contradiction: a credible wrong
  // definition or another agent's real data is a good distractor.
  review.options[0].discard_pattern = 'contradice_proposito';
  assert.deepEqual(validateReview(review, question, sourceChunk), []);
  review.options[0].discard_pattern = 'categoria_ajena';
  assert.deepEqual(validateReview(review, question, sourceChunk), []);
  review.options[0].plausible = false;
  assert.deepEqual(validateReview(review, question, sourceChunk), ['OPCION_NO_PLAUSIBLE_A', 'DESCARTABLE_SIN_SABER_A']);
  // Todas/Ninguna is judged by structure, not by plausibility or discardability.
  const withAll = { ...question, option_d: 'Todas son correctas.' };
  const global = valid();
  Object.assign(global.options[3], { plausible: false, discardable_without_knowledge: true, discard_pattern: 'autocontradictoria' });
  assert.deepEqual(validateReview(global, withAll, sourceChunk), []);
});

test('shows the reviewer the source fragment and its nearest neighbours only', async () => {
  const { reviewFragments } = await import('../src/services/questionAuditService.js');
  const fragments = Array.from({ length: 12 }, (_, index) => ({ id: `f${index}`, page: index + 1, text: '' }));
  const shown = reviewFragments(fragments[6], fragments);
  assert.equal(shown[0].id, 'f6');
  // One neighbour: each fragment is ~300 tokens and every review pays for them.
  assert.equal(shown.length, 2);
  assert.equal(Math.abs(shown[1].page - shown[0].page), 1);
});

test('the reviewer judges the level with the QTH guide of the requested level only', async () => {
  raw = JSON.stringify({ reviews: [valid()] });
  calls = [];
  await auditCandidates([{ question: { ...question, question: 'Pregunta de nivel F' }, sourceChunk }], 'FACIL');
  const prompt = calls[0][1].content;
  assert.match(prompt, /Nivel F \(Fácil \/ intermedia\)/);
  assert.match(prompt, /profundidad del contenido, la similitud entre opciones y el nivel de dominio/);
  assert.doesNotMatch(prompt, /Nivel P \(Principiante\)\. Qué mide|Nivel D \(Difícil\)\. Qué mide/);
  // The curated rules are only sent when generating.
  assert.doesNotMatch(prompt, /reglas CURATED/);
});

test('when it asks for the INCORRECTA, the three true statements are the ones that must come from the manual', () => {
  const review = { ...valid(), format: 'INCORRECTA' };
  for (const option of review.options) option.evidence = 'Cita parafraseada por el revisor sin respaldo';
  const incorrecta = { ...question, option_a: 'La presión de servicio es 10 bar.', option_b: 'La presión de servicio es 14 bar.',
    option_c: 'El caudal nominal es 20 litros por minuto.', option_d: 'Se mide con un manómetro calibrado.' };
  // B (the false one, the valid answer) needs no support; D is a true statement the manual does not support.
  assert.deepEqual(validateReview(review, incorrecta, sourceChunk), ['EVIDENCIA_NO_DOCUMENTADA_D']);
  // Reworded but supported by the manual: accepted (copying it literally is asked when generating).
  review.options[3].evidence = 'El caudal nominal es 20 litros por minuto';
  assert.deepEqual(validateReview(review, { ...incorrecta, option_d: 'Su caudal nominal llega a veinte litros cada minuto.' }, sourceChunk), []);
});

test('the other options must come from the manual when «Todas son correctas» is the valid answer, and none with «Ninguna»', () => {
  const review = valid();
  for (const option of review.options) option.evidence = 'Cita parafraseada por el revisor sin respaldo';
  review.options[1].selectable = false;
  review.options[3].selectable = true;
  const all = { ...question, correct_answer: 'D', option_a: 'La presión de servicio es 10 bar.', option_b: 'El caudal nominal es 20 litros por minuto.', option_c: 'Usa mangueras de 45 mm.', option_d: 'Todas son correctas.' };
  assert.deepEqual(validateReview(review, all, sourceChunk), ['EVIDENCIA_NO_DOCUMENTADA_C']);
  assert.deepEqual(validateReview(review, { ...all, option_d: 'Ninguna es correcta.' }, sourceChunk), []);
});

test('rejects two options that mean the same and an answer that gives itself away', () => {
  const review = valid();
  review.options_distinct = false;
  review.answer_blends_in = false;
  assert.deepEqual(validateReview(review, question, sourceChunk), ['OPCIONES_EQUIVALENTES', 'RESPUESTA_SE_DELATA']);
});

test('rejects a question a well-prepared student could contest', async () => {
  const review = valid();
  review.not_contestable = false;
  assert.deepEqual(validateReview(review, question, sourceChunk), ['PREGUNTA_IMPUGNABLE']);
  raw = JSON.stringify({ reviews: [valid()] });
  calls = [];
  await auditCandidates([{ question, sourceChunk }], 'PRINCIPIANTE');
  // The reviewer gets the contestable cases found in generated tests.
  assert.match(calls[0][1].content, /estacionario.*estacional/);
  assert.match(calls[0][1].content, /parcialmente cierta/);
});

test('the reference points to the fragment where the reviewer found the answer', () => {
  const page92 = { id: 'p92', page: 92, text: 'Cuando el plano neutro desciende hasta el suelo, el humo ocupa todo el recinto.' };
  const page93 = { id: 'p93', page: 93, text: 'La ventilación horizontal se realiza a través de huecos de fachada.' };
  const review = valid();
  review.options[1].evidence = 'el plano neutro desciende hasta el suelo, el humo ocupa todo el recinto';
  // The model named page 93, but the answer is on page 92.
  assert.equal(answerSourceChunk(review, question, [page93, page92], 'p93').id, 'p92');
  // When the answer is in the fragment the model named, that one is kept.
  assert.equal(answerSourceChunk(review, question, [page92, { ...page92, id: 'copy' }], 'copy').id, 'copy');
  // Nothing found: the model's fragment is kept.
  review.options[1].evidence = 'Una cita que no está en ningún fragmento del temario';
  assert.equal(answerSourceChunk(review, question, [page93], 'p93'), null);
});

test('rejects a calculation whose valid option is not the exact result', async () => {
  const review = valid();
  review.calculation_correct = false;
  assert.deepEqual(validateReview(review, question, sourceChunk), ['CALCULO_INCORRECTO']);
  raw = JSON.stringify({ reviews: [valid()] });
  calls = [];
  await auditCandidates([{ question: { ...question, question: '¿Cuántas calorías absorben 2 kg de agua?' }, sourceChunk }], 'DIFICIL');
  assert.match(calls[0][1].content, /rehaz tú el cálculo/);
  assert.match(calls[0][1].content, /las opciones están en miles/);
  // A question without figures does not get the calculation instructions.
  calls = [];
  await auditCandidates([{ question: { ...question, question: '¿Qué es el agua?' }, sourceChunk }], 'DIFICIL');
  assert.doesNotMatch(calls[0][1].content, /rehaz tú el cálculo/);
});
