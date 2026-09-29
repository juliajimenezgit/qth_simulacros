import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCuratedInstructions } from '../src/utils/curatedInstructions.js';

const rule = (id, difficulty = null, active = true) => ({ id, title: 'Regla de prueba', content: 'Contenido de calidad verificable.', difficulty, active });
test('includes all active common rules and only the requested difficulty', () => {
  const file = { version: 1, instructions: [rule('common'), rule('p', 'P'), rule('f', 'F'), rule('d', 'D'), rule('disabled', null, false)] };
  const rows = selectCuratedInstructions(file, 'FACIL');
  assert.deepEqual(rows.map(row => row.id), ['common', 'f']);
  assert.equal(rows[1].difficulty, 'FACIL');
  assert.ok(rows.every(row => row.origin === 'CURATED'));
});
test('rejects malformed rules instead of silently ignoring user edits', () => {
  assert.throws(() => selectCuratedInstructions({ version: 1, instructions: [rule('bad', 'UNKNOWN')] }, 'FACIL'));
});
