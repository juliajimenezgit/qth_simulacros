import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let matches = [];
let statements = [];
const client = { query: async (sql, params) => {
  statements.push({ sql, params });
  if (sql.includes('select id, original_filename')) return { rows: matches };
  if (sql.includes('insert into documents')) return { rows: [{ id: 'new-document' }] };
  return { rows: [] };
} };
mock.module('../src/db/pool.js', { namedExports: {
  query: client.query,
  withTransaction: async (callback) => callback(client),
} });
mock.module('../src/services/openaiService.js', { namedExports: {
  createEmbeddings: async () => [], isOpenAiConfigured: () => false,
} });
const { createDocumentRecord } = await import('../src/services/documentService.js');
const input = { userId: 'owner', user: { role: 'PROFESOR' }, file: {
  originalname: 'Tema.pdf', filename: 'unique.pdf', path: '/tmp/unique.pdf',
}, contentType: 'TEMA' };

test('duplicate upload requests a choice before writing anything', async () => {
  statements = [];
  matches = [{ id: 'existing', original_filename: 'Tema.pdf', storage_path: '/tmp/private.pdf' }];
  await assert.rejects(createDocumentRecord(input), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.details.code, 'DUPLICATE_DOCUMENT');
    assert.equal(error.details.documents[0].id, 'existing');
    assert.equal(error.details.documents[0].storage_path, undefined);
    return true;
  });
  assert.equal(statements.some(({ sql }) => /insert|delete/.test(sql)), false);
});

test('explicit keep uploads another copy without deleting the original', async () => {
  statements = [];
  matches = [{ id: 'existing' }];
  assert.equal((await createDocumentRecord({ ...input, duplicateAction: 'keep' })).id, 'new-document');
  assert.equal(statements.some(({ sql }) => sql.includes('delete from documents')), false);
});

test('replacement cannot target a document outside the matching accessible records', async () => {
  statements = [];
  matches = [{ id: 'existing' }];
  await assert.rejects(createDocumentRecord({ ...input, duplicateAction: 'replace', replaceId: 'unrelated' }), { status: 409 });
  assert.equal(statements.some(({ sql }) => /insert|delete/.test(sql)), false);
});

test('a new name uploads normally and scopes the lookup to the current user', async () => {
  statements = [];
  matches = [];
  await createDocumentRecord(input);
  const lookup = statements.find(({ sql }) => sql.includes('select id, original_filename'));
  assert.deepEqual(lookup.params, ['Tema.pdf', 'owner', false]);
  assert.ok(statements[0].sql.includes('pg_advisory_xact_lock'));
});

test('replacement removes only the selected duplicate and creates the new record', async () => {
  statements = [];
  matches = [{ id: 'existing', storage_path: `/tmp/nonexistent-${crypto.randomUUID()}.pdf` }, { id: 'other-copy' }];
  await createDocumentRecord({ ...input, duplicateAction: 'replace', replaceId: 'existing' });
  const deletion = statements.find(({ sql }) => sql.includes('delete from documents'));
  assert.deepEqual(deletion.params, ['existing']);
  assert.ok(statements.some(({ sql }) => sql.includes('insert into documents')));
});
