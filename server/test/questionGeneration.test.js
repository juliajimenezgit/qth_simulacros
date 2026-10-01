import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
// The generation prints its progress to the terminal. In tests that output shares the channel the
// runner uses to collect results and occasionally corrupted it («Unable to deserialize cloned data»).
for (const method of ['log', 'info', 'warn', 'error']) mock.method(console, method, () => {});
import { sourceReference } from '../src/utils/questionValidation.js';

let responses;
let saved;
let prompts;
let embeddingBatches;
let qualityStarted;
let privateQualityStarted;
let historyQueries;
let chunkQueries;
let balanceWrites;
let statements;
let testInsert;
let audited = 0;
// The fragment where the reviewer found the answer (null: the model's one).
let auditSource = null;
// PDFs of the M1 syllabus: manual → theme → chapter.
const SOURCES = {
  manual: { content_type: 'MANUAL', original_filename: 'M1-Incendios-v6-00-completo.pdf' },
  theme: { content_type: 'TEMA', original_filename: 'M1-Incendios-v6-01-teoriaFuego.pdf' },
  chapter: { content_type: 'CAPITULO', original_filename: 'M1-Incendios-v6-01-teoriaFuego-cap1.pdf' },
};
let auditFormats = null;
// A realistic mix within the caps: INCORRECTA under 25%, Todas/Ninguna under 15%.
const DEFAULT_FORMATS = ['DIRECTA', 'INCORRECTA', 'CIFRA', 'COMPARACION', 'TODAS_NINGUNA', 'CLASIFICACION', 'DIRECTA', 'INCORRECTA', 'CORRECTA', 'CIFRA'];
let inFlight = 0;
let maxInFlight = 0;
const chunks = Array.from({ length: 60 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  text: `Contenido evaluable ${index}`, page: index + 1,
}));
// One call per attempt (parts of 8) unless a test asks for parallel parts.
const env = { questionSimilarityThreshold: 0.13, generationPartSize: 8 };
mock.module('../src/config/env.js', { namedExports: { env } });
mock.module('../src/db/pool.js', { namedExports: {
  query: async (sql, params) => {
    statements.push(sql);
    if (sql.includes('select id, content_type')) return { rows: params[0].map(id => ({ id, ...(SOURCES[id] || { content_type: 'TEMA', original_filename: `${id}.pdf` }) })) };
    if (sql.includes('insert into question_sets')) {
      testInsert = { sql, params };
      return { rows: [{ id: 'test', name: 'Prueba', test_difficulty: params[5] }] };
    }
    if (sql.includes('q.*')) return { rows: saved.map(row => ({ ...row, original_filename: 'Hidraulica.pdf', content_type: 'TEMA' })) };
    if (sql.includes('embedding is null')) return { rows: [] };
    if (sql.includes('from document_chunks')) { chunkQueries.push({ sql, params }); return { rows: chunks }; }
    if (sql.includes('select question')) { historyQueries.push({ sql, params }); return { rows: saved }; }
    if (sql.includes('select id, question, embedding')) return { rows: params[0] === '[0.00000000]' || saved.some(row => row.embedding === params[0]) ? [{ id: "historical-match", question: "Pregunta histórica sobre la presión", distance: 0 }] : [] };
    if (sql.includes("where status = 'GENERATING'")) return { rows: [], rowCount: 2 };
    if (sql.trim().startsWith('update questions')) return { rows: params.includes('missing') ? [] : [{ id: params.at(-1), sql }] };
    if (sql.trim().startsWith('delete from questions')) return { rows: [], rowCount: params[0] === 'missing' ? 0 : 1 };
    if (sql.includes('insert into questions')) {
      const row = { id: saved.length, question: params[4], embedding: params[16],
        option_a: params[5], option_b: params[6], option_c: params[7], option_d: params[8],
        correct_answer: params[9], explanation: params[10], chapter: params[13], reference: params[14], difficulty: params[15] };
      saved.push(row);
      return { rows: [row] };
    }
    return { rows: [] };
  },
  withTransaction: async callback => callback({ query: async (sql, params) => {
    if (sql.includes('update questions set option_a')) {
      balanceWrites.push(params);
      const row = saved.find(row => row.id === params[0]);
      Object.assign(row, { option_a: params[1], option_b: params[2], option_c: params[3], option_d: params[4], correct_answer: params[5] });
    }
    return { rows: sql.includes('update question_sets') ? [{ id: 'test', status: 'COMPLETED', generated_count: saved.length }] : [] };
  } }),
} });
mock.module('../src/services/documentService.js', { namedExports: {
  assertDocumentAccess: async () => ({ status: 'AVAILABLE', original_filename: 'Hidraulica.pdf', content_type: 'TEMA' }),
} });
mock.module('../src/services/openaiService.js', { namedExports: {
  isOpenAiConfigured: () => true,
  estimatedCost: () => null,
  createEmbeddings: async (inputs) => {
    embeddingBatches.push(inputs);
    return inputs.map(input => [input.includes('Duplicada') ? 0 : [...input].reduce((value, char) => (value * 31 + char.codePointAt(0)) % 1000000007, 1)]);
  },
  createChatJson: async (messages) => {
    if (messages[0].content.includes('corrector')) return JSON.stringify({ option_a: 'Uno corto.', option_b: 'Dos corto.', option_c: 'Tres corto.', option_d: 'Cuatro corto.', explanation: 'Explicación suficiente' });
    prompts.push(messages[1].content);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(resolve => setImmediate(resolve));
    inFlight -= 1;
    const id = messages[1].content.match(/FRAGMENTO 1 \| id=([^ ]+)/)[1];
    return JSON.stringify({ questions: (responses.shift() || []).map(candidate => ({
      ...candidate, source_chunk_id: candidate.source_chunk_id ?? id,
    })) });
  },
} });
mock.module('../src/services/questionAuditService.js', { namedExports: {
  // Formats rotate across the whole test, like a real mix, so the per-format caps are not hit by the mock.
  auditCandidates: async candidates => candidates.map(candidate => ({ errors: candidate.question.explanation === 'Explicación sin evidencia' ? ['EXPLICACION_INSUFICIENTE'] : [], format: (auditFormats || DEFAULT_FORMATS)[audited++ % (auditFormats || DEFAULT_FORMATS).length], sourceChunkId: auditSource })),
} });
mock.module('../src/services/qualityInstructionService.js', { namedExports: {
  retrieveQualityInstructions: async () => {
    qualityStarted = true;
    await Promise.resolve();
    assert.equal(privateQualityStarted, true);
    return [];
  },
} });
mock.module('../src/services/qualityKnowledgeService.js', { namedExports: {
  retrievePrivateQualityKnowledge: async () => {
    assert.equal(qualityStarted, true);
    privateQualityStarted = true;
    return [];
  },
  formatPrivateQualityKnowledge: () => ({ rules: '', annotations: '', officialExamples: '' }),
} });
const { generateQuestions, generateConfiguredQuestions, exportQuestionsRows, updateQuestion, deleteQuestion, markInterruptedQuestionSets, listQuestions } = await import('../src/services/questionService.js');
const question = (text) => ({
  question: text, option_a: 'Uno', option_b: 'Dos', option_c: 'Tres', option_d: 'Cuatro',
  correct_answer: 'A', explanation: 'Explicación suficiente', source_title: 'Hidráulica',
  topic: 'Conceptos', chapter: 'Conceptos', difficulty: 'FACIL',
});
const input = { user: { id: 'owner' }, documentId: 'document', count: 1, difficulty: 'FACIL', testId: 'test' };
function reset(batches) { audited = 0; auditFormats = null; maxInFlight = 0; responses = batches; statements = []; balanceWrites = []; chunkQueries = []; historyQueries = []; saved = []; prompts = []; embeddingBatches = []; qualityStarted = false; privateQualityStarted = false; }

test('keeps valid siblings of an invalid candidate and saves exactly the requested count', async () => {
  reset([[{}, question('Primera pregunta válida'), question('Segunda pregunta válida')]]);
  const result = await generateQuestions(input);
  assert.equal(result.length, 1);
  assert.equal(saved.length, 1);
  assert.equal(prompts.length, 1);
});

test('uses spare candidates to finish 25 unique questions despite rejected duplicates', async () => {
  const valid = (n, offset = 0) => Array.from({ length: n }, (_, i) => question(`Pregunta válida número ${offset + i}`));
  reset([valid(8), valid(8, 8), valid(7, 16), [question('Duplicada pregunta anterior'), question('Duplicada otra pregunta'), ...valid(2, 23)]]);
  assert.equal((await generateQuestions({ ...input, count: 25 })).length, 25);
  assert.equal(prompts.length, 4);
  assert.equal(chunkQueries.length, 1);
  assert.deepEqual(chunkQueries[0].params, ['document', 'owner']);
  assert.match(chunkQueries[0].sql, /order by coalesce\(usage.question_count, 0\)/);
  assert.deepEqual(embeddingBatches.map(batch => batch.length), [8, 8, 7, 4]);
  assert.match(prompts[3], /Numero de preguntas solicitadas: 4/);
  // A shrinking batch must continue after the previous context (three windows of 10 fragments), not revisit earlier pages.
  assert.match(prompts[3], /FRAGMENTO 1 \| id=.* \| pagina=31 \|/);
});

test('still rejects an exhausted source instead of accepting duplicates', async () => {
  reset(Array.from({ length: 9 }, () => [question('Duplicada pregunta anterior')]));
  await assert.rejects(generateQuestions(input), { status: 422 });
  assert.equal(prompts.length, 9);
  assert.equal(saved.length, 0);
});


test('rejects duplicates inside an embedding batch before saving and replaces them', async () => {
  reset([[question('Pregunta idéntica del lote'), question('Pregunta idéntica del lote')], [question('Pregunta distinta de reemplazo')]]);
  assert.equal((await generateQuestions({ ...input, count: 2 })).length, 2);
  assert.equal(prompts.length, 2);
  assert.equal(new Set(saved.map(row => row.question)).size, 2);
});

test('does not request embeddings for malformed candidates or structural references', async () => {
  reset([[{}, question('En el capítulo 5 se explica qué concepto')], [question('Pregunta válida de reemplazo')]]);
  assert.equal((await generateQuestions(input)).length, 1);
  assert.deepEqual(embeddingBatches.map(batch => batch.length), [1]);
});


test('feeds the matched historical question back into the next attempt', async () => {
  reset([[question('Duplicada pregunta anterior')], [question('Pregunta sobre un hecho nuevo')]]);
  assert.equal((await generateQuestions(input)).length, 1);
  assert.match(prompts[1], /Candidata descartada: Duplicada pregunta anterior/);
  assert.match(prompts[1], /Coincide con: Pregunta histórica sobre la presión/);
  assert.match(prompts[0], /Cambiar palabras.*NO crea una pregunta nueva/);
  assert.match(historyQueries[0].sql, /source_chunk_id = any\(\$3::uuid\[\]\)/);
  assert.deepEqual(historyQueries[0].params, ['document', 'owner', chunks.slice(0, 8).map(chunk => chunk.id), 'test']);
  // Questions of this test come first in the exclusion list, from any document.
  assert.match(historyQueries[0].sql, /document_id = \$1 or question_set_id = \$4/);
  // Inside a test, duplicates are searched across the whole test, not the document history.
  assert.ok(statements.some(sql => sql.includes('select id, question, embedding') && sql.includes('question_set_id = $2')));
  assert.ok(!statements.some(sql => sql.includes('select id, question, embedding') && sql.includes('document_id = $2')));
});


test('rejects wrong levels while deriving references from the verified source', async () => {
  reset([[{ ...question('Pregunta con nivel equivocado'), difficulty: 'DIFICIL' }, question('Pregunta válida que se conserva'),
    { ...question('Pregunta con página inventada'), reference: 'Hidraulica.pdf - página 999 - apartado inventado' }],
    [question('Pregunta nueva de reemplazo')]]);
  const result = await generateQuestions({ ...input, count: 2 });
  assert.equal(result.length, 2);
  assert.ok(result.every(row => row.difficulty === 'FACIL'));
  assert.equal(prompts.length, 1);
  assert.ok(result.every(row => row.reference === sourceReference({ original_filename: 'Hidraulica.pdf' }, chunks[0])));
  assert.ok(result[0].question.includes('que se conserva'));
});

test('rejects unauthorized source IDs even when a model supplies a plausible reference', async () => {
  reset([[{ ...question('Pregunta con fragmento inventado'), source_chunk_id: '99999999-9999-4999-8999-999999999999' }],
    [question('Pregunta con fuente autorizada')]]);
  assert.equal((await generateQuestions(input)).length, 1);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /FRAGMENTO_NO_AUTORIZADO/);
  assert.deepEqual(embeddingBatches.map(batch => batch.length), [1]);
});

test('regenerates only the candidate rejected by documentary review', async () => {
  reset([[question('Pregunta válida con evidencia'), { ...question('Pregunta que requiere corrección'), explanation: 'Explicación sin evidencia' }], [question('Pregunta corregida con evidencia')]]);
  const result = await generateQuestions({ ...input, count: 2 });
  assert.equal(result.length, 2);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /EXPLICACION_INSUFICIENTE/);
});


test('persists a balanced all-P test and exports the final correct answer positions', async () => {
  const inputQuestions = Array.from({ length: 10 }, (_, index) => ({ ...question(`Pregunta principiante número ${index}`), difficulty: 'P', correct_answer: index === 9 ? 'A' : 'B' }));
  reset([inputQuestions.slice(0, 8), inputQuestions.slice(8)]);
  const result = await generateConfiguredQuestions({ user: input.user, selectedDocumentIds: ['document'],
    contentCounts: { TEMA: 10, MANUAL: 0, CAPITULO: 0 }, difficultyCounts: { P: 10, F: 0, D: 0 }, testName: 'Prueba' });
  assert.equal(result.test.status, 'COMPLETED');
  assert.equal(balanceWrites.length, 10);
  assert.deepEqual(['A', 'B', 'C', 'D'].map(letter => saved.filter(row => row.correct_answer === letter).length).sort(), [2, 2, 3, 3]);
  const exported = await exportQuestionsRows(input.user, '', 'test');
  assert.equal(exported.length, 10);
  assert.ok(exported.every(row => row.Nivel === 'P'));
  for (const [index, row] of exported.entries()) {
    assert.equal(row[`Opcion ${row.Correcta}`], index === 9 ? 'Uno' : 'Dos');
    assert.equal(row.Correcta, result.questions[index].correct_answer);
  }
});


test('keeps validated questions when retries run out without marking the test complete', async () => {
  reset([[question('Pregunta válida que permanece')]]);
  await assert.rejects(generateConfiguredQuestions({ user: input.user, selectedDocumentIds: ['document'],
    contentCounts: { TEMA: 2, MANUAL: 0, CAPITULO: 0 }, difficultyCounts: { P: 0, F: 2, D: 0 } }), { status: 422 });
  assert.equal(saved.length, 1);
  assert.ok(statements.some(sql => sql.includes("status = 'ERROR'") && sql.includes('select count(*)')));
  assert.ok(statements.every(sql => !sql.includes('delete from questions')));
  assert.equal(balanceWrites.length, 0);
});


test('export preserves a resolved chapter in a topic document', async () => {
  reset([]);
  saved.push({ ...question('Pregunta con capítulo verificado'), chapter: 'Capítulo 3 Hidráulica' });
  const exported = await exportQuestionsRows(input.user, '', 'test');
  assert.equal(exported[0].Capitulo, 'Capítulo 3 Hidráulica');
});

test('generates different documents in parallel and still completes the requested split', async () => {
  reset([[question('Pregunta del primer documento')], [question('Pregunta del segundo documento')]]);
  const result = await generateConfiguredQuestions({ user: input.user, selectedDocumentIds: ['document', 'second'],
    contentCounts: { TEMA: 2, MANUAL: 0, CAPITULO: 0 }, documentCounts: { document: 1, second: 1 }, difficultyCounts: { P: 0, F: 2, D: 0 } });
  assert.equal(result.test.status, 'COMPLETED');
  assert.equal(saved.length, 2);
  assert.equal(maxInFlight, 2);
});

test('tells the model how many INCORRECTA slots are left and forbids them once exhausted', async () => {
  reset([Array.from({ length: 8 }, (_, index) => question(`Pregunta de cupo número ${index}`))]);
  await generateQuestions({ ...input, count: 4 });
  assert.match(prompts[0], /Como máximo 1 preguntas de este lote pueden pedir la INCORRECTA/);
  assert.match(prompts[0], /option_words/);
});

test('rebalances unequal options instead of discarding the question', async () => {
  reset([[{ ...question('Pregunta con opciones desiguales'), option_a: 'Una opción mucho más larga que todas las demás alternativas juntas.' }]]);
  const [stored] = await generateQuestions(input);
  assert.equal(prompts.length, 1);
  assert.equal(stored.option_a, 'Uno corto.');
});

test('meets the INCORRECTA/Todas/Ninguna minimum by adding Ninguna instead of failing', async () => {
  reset([Array.from({ length: 8 }, (_, index) => question(`Pregunta directa número ${index}`))]);
  auditFormats = ['DIRECTA', 'DIRECTA', 'INCORRECTA', 'DIRECTA'];
  const result = await generateQuestions({ ...input, count: 4 });
  assert.equal(result.length, 4);
  assert.equal(prompts.length, 1);
  // 30% of 4 questions is 2: one INCORRECTA, and the last slot gets «Ninguna es correcta» (max one, 15%).
  const withNone = result.filter(row => [row.option_a, row.option_b, row.option_c, row.option_d].includes('Ninguna es correcta.'));
  assert.equal(withNone.length, 1);
});

test('never asks a batch for more INCORRECTA or Todas/Ninguna than the caps allow', async () => {
  reset([Array.from({ length: 8 }, (_, index) => question(`Pregunta de un test corto ${index}`))]);
  await generateQuestions({ ...input, count: 5 });
  // 5 questions: at most 1 INCORRECTA and 1 Todas/Ninguna, so the batch is asked for 2, not 4.
  assert.match(prompts[0], /En este lote, al menos 2 de las 8 preguntas/);
  assert.match(prompts[0], /Como máximo 1 preguntas de este lote pueden incluir «Todas son correctas.»/);
});

test('edits a question only within its owner, normalising the text', async () => {
  reset([]);
  await updateQuestion('q1', { id: 'teacher', role: 'TEACHER' }, { question: '  ¿Qué es la pirólisis?  ', correct_answer: 'B' });
  const update = statements.find(sql => sql.trim().startsWith('update questions'));
  assert.match(update, /question = \$1, correct_answer = \$2/);
  assert.match(update, /and user_id = \$4/);
  await updateQuestion('q1', { id: 'admin', role: 'ADMIN' }, { explanation: 'Explicación revisada.' });
  assert.doesNotMatch(statements.filter(sql => sql.trim().startsWith('update questions')).at(-1), /user_id/);
  await assert.rejects(updateQuestion('q1', { id: 'teacher' }, {}), { status: 400 });
  await assert.rejects(updateQuestion('missing', { id: 'teacher' }, { explanation: 'Otra explicación.' }), { status: 404 });
});

test('deletes a question only within its owner and reports a missing one', async () => {
  reset([]);
  await deleteQuestion('q1', { id: 'teacher', role: 'TEACHER' });
  assert.match(statements.find(sql => sql.trim().startsWith('delete from questions')), /and user_id = \$2/);
  await assert.rejects(deleteQuestion('missing', { id: 'admin', role: 'ADMIN' }), { status: 404 });
});

test('refuses to export without a selected test', async () => {
  reset([]);
  await assert.rejects(exportQuestionsRows({ id: 'owner' }, ''), { status: 400 });
});

test('marks the tests left generating by a server restart as interrupted, keeping their questions', async () => {
  reset([]);
  assert.equal(await markInterruptedQuestionSets(), 2);
  const sql = statements.find(statement => statement.includes("where status = 'GENERATING'"));
  assert.match(sql, /set status = 'ERROR'/);
  assert.match(sql, /select count\(\*\) from questions where question_set_id = question_sets.id/);
});

test('lets the developer see every teacher\'s questions, like the administrator', async () => {
  reset([]);
  await listQuestions({ id: 'julia', role: 'DESARROLLADOR' });
  await listQuestions({ id: 'laura', role: 'PROFESOR' });
  const listings = statements.filter(sql => sql.includes('q.*'));
  assert.doesNotMatch(listings[0], /q.user_id = \$/);
  assert.match(listings[1], /q.user_id = \$1/);
});

test('hides the demo tests from the content views', async () => {
  reset([]);
  const { listQuestionSets } = await import('../src/services/questionService.js');
  await listQuestionSets({ id: 'julia', role: 'DESARROLLADOR' });
  await listQuestionSets({ id: 'laura', role: 'PROFESOR' });
  const listings = statements.filter(sql => sql.includes('from question_sets qs'));
  assert.match(listings[0], /where not qs.is_demo\s+group by/);
  assert.match(listings[1], /where not qs.is_demo and qs.user_id = \$1/);
});


test('persists the selected test difficulty separately from question levels', async () => {
  reset([[question('Pregunta del test fácil')]]);
  await generateConfiguredQuestions({ user: input.user, selectedDocumentIds: ['document'],
    contentCounts: { TEMA: 1, MANUAL: 0, CAPITULO: 0 }, difficultyCounts: { P: 0, F: 1, D: 0 },
    testDifficulty: 'FACIL', testName: 'Prueba' });
  assert.match(testInsert.sql, /test_difficulty/);
  assert.equal(testInsert.params[5], 'FACIL');
  assert.deepEqual(JSON.parse(testInsert.params[3]), { P: 0, F: 1, D: 0 });
});

test('exports manual wording, explanation and source metadata without automatic rewriting', async () => {
  reset([]);
  saved.push({ id: 'manual', is_manual: true, question: 'Enunciado literal del profesor',
    option_a: 'Uno', option_b: 'Dos', option_c: 'Tres', option_d: 'Cuatro', correct_answer: 'C',
    explanation: 'Página 14: explicación escrita por el profesor.', source_title: 'Manual propio',
    topic: 'Tema propio', chapter: 'Capítulo propio', reference: 'Página 14', difficulty: 'FACIL' });
  const [row] = await exportQuestionsRows(input.user, '', 'test');
  assert.equal(row.Pregunta, 'Enunciado literal del profesor');
  assert.equal(row.Explicacion, 'Página 14: explicación escrita por el profesor.');
  assert.equal(row.Manual, 'Manual propio');
  assert.equal(row.Tema, 'Tema propio');
  assert.equal(row.Capitulo, 'Capítulo propio');
  assert.equal(row.Correcta, 'C');
  assert.equal(row.Nivel, 'F');
});

test('the model writes in the teacher\'s order and the correct answer becomes an option before shuffling', async () => {
  const { fromTeacherOrder } = await import('../src/services/questionService.js');
  const converted = fromTeacherOrder({ idea: 'El oxígeno del aire', question_type: 'LITERAL', question: '¿Qué porcentaje de oxígeno tiene el aire?',
    correct_option: '21 %.', distractors: ['19 %.', '23 %.', '25 %.'], explanation: 'El aire tiene un 21 % de oxígeno.' });
  assert.deepEqual(
    [converted.option_a, converted.option_b, converted.option_c, converted.option_d, converted.correct_answer],
    ['21 %.', '19 %.', '23 %.', '25 %.', 'A'],
  );
  assert.equal('idea' in converted || 'distractors' in converted, false);
  assert.equal(converted.question_type, 'LITERAL');
  // The old format still works.
  const old = { question: 'x', option_a: 'a', correct_answer: 'B' };
  assert.equal(fromTeacherOrder(old), old);
});

test('reviews only the candidates still needed and the next one only after a rejection', async () => {
  reset([[question('Primera candidata válida'), question('Segunda candidata válida'), question('Tercera candidata válida'), question('Cuarta candidata válida')]]);
  await generateQuestions({ ...input, count: 1 });
  // One question was missing: one review, not four.
  assert.equal(audited, 1);

  reset([[{ ...question('Candidata rechazada en la revisión'), explanation: 'Explicación sin evidencia' }, question('Candidata de reserva aprobada'), question('Otra candidata que no hace falta revisar')]]);
  const result = await generateQuestions({ ...input, count: 1 });
  assert.equal(audited, 2);
  assert.match(result[0].question, /reserva aprobada/);
});

test('a candidate outside the teachers\' mix of types is discarded before paying for its review', async () => {
  reset([[{ ...question('Pregunta conceptual que ya no cabe'), question_type: 'CONCEPTUAL' }, { ...question('Pregunta literal que falta'), question_type: 'LITERAL' }]]);
  const targets = { LITERAL: 1, CONCEPTUAL: 0, CLASIFICACION: 0, COMPARACION: 0, APLICACION_PRACTICA: 0, CALCULO: 0, DETALLE_DIFICIL: 0, RELACION_CONCEPTOS: 0 };
  const typeState = new Map();
  const result = await generateQuestions({ ...input, count: 1, typeTargets: targets, typeState });
  assert.match(result[0].question, /literal que falta/);
  assert.equal(audited, 1);
  assert.equal(typeState.get('LITERAL'), 1);
});

test('a retry is told why its candidates failed without the whole review', async () => {
  const { compactFeedback } = await import('../src/services/questionService.js');
  const details = ['A', 'B', 'C', 'D'].map(letter => ({ letter, evidence: 'Una cita muy larga del manual '.repeat(10), reason: `Motivo de ${letter}` }));
  assert.deepEqual(compactFeedback({ question: 'Pregunta', errors: ['DESCARTABLE_SIN_SABER_C', 'EXPLICACION_INSUFICIENTE'], details }),
    { question: 'Pregunta', errors: ['DESCARTABLE_SIN_SABER_C', 'EXPLICACION_INSUFICIENTE'], details: [{ opcion: 'C', motivo: 'Motivo de C' }] });
  // Word counts are kept: the model cannot fix a length it does not see.
  const lengths = [{ palabras_por_opcion: { A: 19, B: 6, C: 7, D: 8 }, maximo_diferencia: 5 }];
  assert.deepEqual(compactFeedback({ question: 'Pregunta', errors: ['OPCIONES_LONGITUD_DESIGUAL'], details: lengths }).details, lengths);
  assert.deepEqual(compactFeedback({ question: 'Pregunta', errors: ['NIVEL_NO_ADECUADO'], details }), { question: 'Pregunta', errors: ['NIVEL_NO_ADECUADO'] });
});

test('an attempt is written in parallel parts of four, each on its own fragments', async () => {
  env.generationPartSize = 4;
  try {
    reset([[question('Primera parte, primera'), question('Primera parte, segunda')], [question('Segunda parte, primera'), question('Segunda parte, segunda')]]);
    const result = await generateQuestions({ ...input, count: 4 });
    assert.equal(result.length, 4);
    // 8 candidates in two calls of 4, sent at once.
    assert.equal(prompts.length, 2);
    assert.ok(prompts.every(prompt => /Numero de preguntas solicitadas: 4/.test(prompt)));
    const firstFragment = prompt => prompt.match(/FRAGMENTO 1 \| id=([^ ]+)/)[1];
    assert.notEqual(firstFragment(prompts[0]), firstFragment(prompts[1]));
  } finally {
    env.generationPartSize = 8;
  }
});

test('the distractor guide and the word count are inside the steps where the model writes the options', async () => {
  reset([[question('Pregunta para ver las instrucciones')]]);
  await generateQuestions(input);
  const prompt = prompts[0];
  const step6 = prompt.slice(prompt.indexOf('6. Crea después los tres distractores'), prompt.indexOf('7. Antes de responder'));
  assert.match(step6, /correct_option_words − 2 y correct_option_words \+ 2 palabras/);
  assert.match(step6, /Un buen distractor|un distractor no debe ser absurdo, pero tampoco discutible/i);
  // The guide is said once, where it is applied.
  assert.equal(prompt.split('un distractor no debe ser absurdo, pero tampoco discutible').length - 1, 1);
  assert.match(prompt, /7\. Antes de responder, comprueba las cuatro opciones\. Cuenta las palabras/);
  assert.match(prompt, /Como máximo 12 palabras/);
});

test('questions come from the selected manual, theme or chapter, never from a PDF and another that contains it', async () => {
  const user = { id: 'owner', role: 'ADMIN' };
  const one = (id, type) => ({ user, selectedDocumentIds: [id], contentCounts: { MANUAL: 0, TEMA: 0, CAPITULO: 0, [type]: 1 }, difficultyCounts: { P: 0, F: 1, D: 0 } });
  // A chapter alone is a valid source.
  reset([[question('Pregunta del capítulo')]]);
  assert.equal((await generateConfiguredQuestions(one('chapter', 'CAPITULO'))).questions.length, 1);
  // A theme together with its own chapter is rejected before generating anything.
  reset([[question('No debería generarse')]]);
  await assert.rejects(generateConfiguredQuestions({ user, selectedDocumentIds: ['theme', 'chapter'],
    contentCounts: { MANUAL: 0, TEMA: 1, CAPITULO: 1 }, difficultyCounts: { P: 0, F: 2, D: 0 } }), { status: 400, message: /ya está incluido en otro/ });
  assert.equal(prompts.length, 0);
});

test('the saved reference uses the page of the fragment where the answer was found', async () => {
  reset([[question('Pregunta con el fragmento vecino')]]);
  auditSource = chunks[1].id;
  try {
    const [saved] = await generateQuestions(input);
    assert.equal(saved.reference, sourceReference({ original_filename: 'Hidraulica.pdf' }, chunks[1]));
  } finally {
    auditSource = null;
  }
});
