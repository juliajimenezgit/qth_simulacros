import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
let curated = [];
let custom = false;
let queries = [];
let embeddingCalls = 0;
mock.module('../src/utils/curatedInstructions.js', { namedExports: { loadCuratedInstructions: async () => curated } });
mock.module('../src/db/pool.js', { namedExports: { query: async (sql, params) => {
  queries.push({ sql, params });
  if (sql.includes('select id from quality_instructions')) return { rows: custom ? [{ id: 'custom' }] : [] };
  if (sql.includes('from quality_instructions')) return { rows: [{ id: 'custom-rule' }] };
  return { rows: [] };
} } });
mock.module('../src/services/openaiService.js', { namedExports: { createEmbedding: async () => { embeddingCalls++; return [1]; } } });
const { retrieveQualityInstructions } = await import('../src/services/qualityInstructionService.js');
const { retrievePrivateQualityKnowledge } = await import('../src/services/qualityKnowledgeService.js');
const input = { difficulty: 'FACIL', contextChunks: [{ text: 'Contenido factual' }] };
const reset = (rules) => { curated = rules; custom = false; queries = []; embeddingCalls = 0; };

test('uses edited file without embedding requests or old private DB rules', async () => {
  reset([{ id: 'reviewed', origin: 'CURATED' }]);
  assert.deepEqual(await retrieveQualityInstructions(input), curated);
  assert.equal(embeddingCalls, 0);
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /title not like '\[PRIVADA\] %'/);
});
test('keeps custom administrator rules while excluding stale private copies', async () => {
  reset([{ id: 'reviewed', origin: 'CURATED' }]); custom = true;
  assert.deepEqual((await retrieveQualityInstructions(input)).map(row => row.id), ['reviewed', 'custom-rule']);
  assert.equal(queries[1].params[3], true);
  assert.match(queries[1].sql, /title not like '\[PRIVADA\] %'/);
});
test('does not reintroduce raw quality guide alongside reviewed rules', async () => {
  reset([{ id: 'reviewed' }]);
  await retrievePrivateQualityKnowledge(input);
  assert.deepEqual(queries.map(row => [row.params[0], row.params[2]]), [['ANNOTATED_GUIDE', 2], ['OFFICIAL_EXAM', 1]]);
});
test('preserves legacy retrieval when no applicable file rules exist', async () => {
  reset(null);
  await retrieveQualityInstructions(input);
  assert.equal(queries[0].params[3], false);
  queries = [];
  await retrievePrivateQualityKnowledge(input);
  assert.deepEqual(queries.map(row => row.params[0]), ['QUALITY_GUIDE', 'ANNOTATED_GUIDE', 'OFFICIAL_EXAM']);
});


test('disabling every curated rule does not reactivate old private guidance', async () => {
  reset([]);
  assert.deepEqual(await retrieveQualityInstructions(input), []);
  queries = [];
  await retrievePrivateQualityKnowledge(input);
  assert.ok(queries.every(row => row.params[0] !== 'QUALITY_GUIDE'));
});
