import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
const chunks = Array.from({ length: 20 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, text: 'Contenido', page: i + 1 }));
let rows, batches, retrievalCalls, instructionsStarted, knowledgeStarted, chatCalls;
const question = text => ({ question: text, option_a: 'Uno', option_b: 'Dos', option_c: 'Tres', option_d: 'Cuatro', correct_answer: 'A', explanation: 'Explicación de la respuesta', source_title: 'Hidráulica', topic: 'Presión', chapter: 'Capítulo', reference: 'Manual página 1', difficulty: 'FACIL', source_chunk_id: chunks[0].id });
mock.module('../src/config/env.js', { namedExports: { env: { questionSimilarityThreshold: 0.13 } } });
mock.module('../src/db/pool.js', { namedExports: {
  withTransaction: async fn => fn({ query: async () => ({ rows: [] }) }),
  query: async (sql, params) => {
    if (sql.includes('embedding is null')) return { rows: [] };
    if (sql.includes('from document_chunks')) return { rows: chunks };
    if (sql.includes('select question')) return { rows };
    if (sql.includes('select id, question, embedding')) return { rows: rows.some(row => row.embedding === params[0]) ? [{ distance: 0 }] : [] };
    if (sql.includes('insert into questions')) {
      const row = { question: params[4], embedding: params[16], reference: params[14] };
      rows.push(row); return { rows: [row] };
    }
    return { rows: [] };
  },
} });
mock.module('../src/services/documentService.js', { namedExports: { assertDocumentAccess: async () => ({ status: 'AVAILABLE', original_filename: 'Hidraulica.pdf', content_type: 'TEMA' }) } });
mock.module('../src/services/openaiService.js', { namedExports: {
  isOpenAiConfigured: () => true,
  createEmbedding: async () => { retrievalCalls++; return [1]; },
  createEmbeddings: async inputs => { batches.push(inputs); return inputs.map(input => [input.includes('reemplazo') ? 2 : 1]); },
  createChatJson: async () => {
    chatCalls++;
    return JSON.stringify({ questions: chatCalls === 1 ? [question('Pregunta original repetida'), question('Pregunta original repetida')] : [question('Pregunta nueva de reemplazo')] });
  },
} });
mock.module('../src/services/qualityInstructionService.js', { namedExports: { retrieveQualityInstructions: async () => {
  instructionsStarted = true; await Promise.resolve(); assert.equal(knowledgeStarted, true); return [];
} } });
mock.module('../src/services/qualityKnowledgeService.js', { namedExports: {
  retrievePrivateQualityKnowledge: async () => { assert.equal(instructionsStarted, true); knowledgeStarted = true; return {}; },
  formatPrivateQualityKnowledge: () => ({ rules: '', annotations: '', officialExamples: '' }),
} });
const { generateQuestions } = await import('../src/services/questionService.js');
test('batches embeddings, skips discarded semantic retrieval and still detects same-batch duplicates', async () => {
  rows = []; batches = []; retrievalCalls = 0; instructionsStarted = false; knowledgeStarted = false; chatCalls = 0;
  const result = await generateQuestions({ user: { id: 'owner' }, documentId: 'document', count: 2, difficulty: 'FACIL', testId: 'test' });
  assert.equal(result.length, 2);
  assert.deepEqual(batches.map(batch => batch.length), [2, 1]);
  assert.equal(retrievalCalls, 0);
  assert.equal(chatCalls, 2);
  assert.ok(result[1].question.includes('reemplazo'));
  assert.ok(result.every(row => row.reference === 'Manual página 1'));
});
