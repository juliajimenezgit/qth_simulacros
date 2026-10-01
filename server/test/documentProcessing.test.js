import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const realPdf = await import('../src/services/pdfService.js');
let pages;
let statements;
let failExtraction = false;
mock.module('../src/services/pdfService.js', { namedExports: {
  ...realPdf,
  extractPdfPages: async () => { if (failExtraction) throw new Error('PDF dañado'); return pages; },
} });
mock.module('../src/services/openaiService.js', { namedExports: {
  isOpenAiConfigured: () => true,
  createEmbeddings: async (texts) => texts.map(() => [0.1, 0.2]),
} });
mock.module('../src/db/pool.js', { namedExports: {
  query: async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes('select * from documents')) return { rows: [{ id: 'doc', storage_path: 'x.pdf', original_filename: 'm1-incendios-v6-01-teoriafuego.pdf' }] };
    return { rows: [] };
  },
  withTransaction: async (callback) => callback({ query: async (sql, params) => { statements.push({ sql, params }); return { rows: [] }; } }),
} });
const { processDocument } = await import('../src/services/documentService.js');

const body = 'La combustión es una reacción química de oxidación en la que se desprende energía en forma de calor y luz, y que se manifiesta visualmente mediante el fuego cuando el combustible y el comburente reaccionan.';

test('stores the printed manual page of every fragment, not the page inside the chapter PDF', async () => {
  statements = [];
  failExtraction = false;
  pages = [
    { page: 1, text: 'TEORÍA DEL FUEGO\nportada' },
    { page: 4, text: `1. Conceptos básicos\n${body}\n20` },
    { page: 5, text: `2. Reacciones\n${body}\n21` },
  ];
  await processDocument('doc');
  const inserts = statements.filter(({ sql }) => sql.includes('insert into document_chunks'));
  assert.ok(inserts.length >= 2);
  // Columns: document_id, text, page, manual_page, section, embedding.
  assert.deepEqual(inserts.map(({ params }) => [params[2], params[3]]), inserts.map(({ params }) => [params[2], params[2] + 16]));
  assert.ok(statements.some(({ sql }) => sql.includes("status = 'AVAILABLE'")));
});

test('marks the document with an error when the PDF cannot be read', async () => {
  statements = [];
  failExtraction = true;
  await processDocument('doc');
  const failed = statements.find(({ sql }) => sql.includes("status = 'ERROR'"));
  assert.equal(failed.params[1], 'PDF dañado');
});
