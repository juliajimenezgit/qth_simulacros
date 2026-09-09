import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentJobs } from '../src/utils/questionAllocation.js';
const documents = [{ id: 'topic', content_type: 'TEMA' }, { id: 'chapter1', content_type: 'CAPITULO' }, { id: 'chapter2', content_type: 'CAPITULO' }];
test('preserves exact counts per document and global difficulty across mixed content', () => {
  const jobs = buildDocumentJobs(documents, { topic: 3, chapter1: 5, chapter2: 2 }, { MANUAL: 0, TEMA: 3, CAPITULO: 7 }, { P: 4, F: 3, D: 3 });
  for (const [id, expected] of Object.entries({ topic: 3, chapter1: 5, chapter2: 2 })) {
    assert.equal(jobs.filter(job => job.documentId === id).reduce((sum, job) => sum + job.count, 0), expected);
  }
  for (const [level, expected] of Object.entries({ PRINCIPIANTE: 4, FACIL: 3, DIFICIL: 3 })) {
    assert.equal(jobs.filter(job => job.difficulty === level).reduce((sum, job) => sum + job.count, 0), expected);
  }
});
test('excludes zero counts and supports a single difficulty', () => {
  assert.deepEqual(buildDocumentJobs(documents, { chapter2: 10 }, { MANUAL: 0, TEMA: 0, CAPITULO: 10 }, { P: 0, F: 0, D: 10 }), [{ documentId: 'chapter2', difficulty: 'DIFICIL', count: 10 }]);
});
test('rejects documents outside the selection and mismatched totals', () => {
  assert.throws(() => buildDocumentJobs(documents, { unknown: 5 }, { MANUAL: 0, TEMA: 5, CAPITULO: 0 }, { P: 5, F: 0, D: 0 }));
  assert.throws(() => buildDocumentJobs(documents, { topic: 5 }, { MANUAL: 0, TEMA: 4, CAPITULO: 1 }, { P: 5, F: 0, D: 0 }));
  for (const count of [4, 6]) assert.throws(() => buildDocumentJobs(documents, { topic: 5 }, { MANUAL: 0, TEMA: 5, CAPITULO: 0 }, { P: count, F: 0, D: 0 }));
});
