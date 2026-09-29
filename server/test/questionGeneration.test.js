import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
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
const chunks = Array.from({ length: 60 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  text: `Contenido evaluable ${index}`, page: index + 1,
}));
mock.module('../src/config/env.js', { namedExports: { env: { questionSimilarityThreshold: 0.13 } } });
mock.module('../src/db/pool.js', { namedExports: {
  query: async (sql, params) => {
    statements.push(sql);
    if (sql.includes('select id, content_type')) return { rows: [{ id: 'document', content_type: 'TEMA' }] };
    if (sql.includes('insert into question_sets')) return { rows: [{ id: 'test', name: 'Prueba' }] };
    if (sql.includes('q.*')) return { rows: saved.map(row => ({ ...row, original_filename: 'Hidraulica.pdf', content_type: 'TEMA' })) };
    if (sql.includes('embedding is null')) return { rows: [] };
    if (sql.includes('from document_chunks')) { chunkQueries.push({ sql, params }); return { rows: chunks }; }
    if (sql.includes('select question')) { historyQueries.push({ sql, params }); return { rows: saved }; }
    if (sql.includes('select id, question, embedding')) return { rows: params[0] === '[0.00000000]' || saved.some(row => row.embedding === params[0]) ? [{ id: "historical-match", question: "Pregunta histórica sobre la presión", distance: 0 }] : [] };
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
  createEmbeddings: async (inputs) => {
    embeddingBatches.push(inputs);
    return inputs.map(input => [input.includes('Duplicada') ? 0 : [...input].reduce((value, char) => (value * 31 + char.codePointAt(0)) % 1000000007, 1)]);
  },
  createChatJson: async (messages) => {
    prompts.push(messages[1].content);
    const id = messages[1].content.match(/FRAGMENTO 1 \| id=([^ ]+)/)[1];
    return JSON.stringify({ questions: (responses.shift() || []).map(candidate => ({
      ...candidate, source_chunk_id: candidate.source_chunk_id ?? id,
    })) });
  },
} });
mock.module('../src/services/questionAuditService.js', { namedExports: {
  auditCandidates: async candidates => candidates.map((candidate, index) => ({ errors: candidate.question.explanation === 'Explicación sin evidencia' ? ['EXPLICACION_INSUFICIENTE'] : [], format: ['DIRECTA', 'CIFRA', 'COMPARACION'][index % 3] })),
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
const { generateQuestions, generateConfiguredQuestions, exportQuestionsRows } = await import('../src/services/questionService.js');
const question = (text) => ({
  question: text, option_a: 'Uno', option_b: 'Dos', option_c: 'Tres', option_d: 'Cuatro',
  correct_answer: 'A', explanation: 'Explicación suficiente', source_title: 'Hidráulica',
  topic: 'Conceptos', chapter: 'Conceptos', difficulty: 'FACIL',
});
const input = { user: { id: 'owner' }, documentId: 'document', count: 1, difficulty: 'FACIL', testId: 'test' };
function reset(batches) { responses = batches; statements = []; balanceWrites = []; chunkQueries = []; historyQueries = []; saved = []; prompts = []; embeddingBatches = []; qualityStarted = false; privateQualityStarted = false; }

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
  // A shrinking batch must continue after the previous context, not revisit page 37.
  assert.match(prompts[3], /FRAGMENTO 1 \| id=.* \| pagina=55 \|/);
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
  assert.deepEqual(historyQueries[0].params, ['document', 'owner', chunks.slice(0, 12).map(chunk => chunk.id)]);
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
