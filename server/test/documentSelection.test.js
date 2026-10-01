import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedAncestor, toggleSource } from '../../client/src/utils/documentSelection.js';
const doc = (id, content_type, original_filename, status = 'AVAILABLE') => ({id, content_type, original_filename, status});
const docs = [
  doc('m1', 'MANUAL', 'M1-Incendios-v6-00-completo.pdf'),
  doc('t1', 'TEMA', 'M1-Incendios-v6-01-teoriaFuego.pdf'),
  doc('c1', 'CAPITULO', 'M1-Incendios-v6-01-teoriaFuego-cap1.pdf'),
  doc('t2', 'TEMA', 'M1-Incendios-v6-02-hidraulica.pdf'),
  doc('c2', 'CAPITULO', 'm1-incendios-v6-02-hidraulica-cap2.pdf'),
  doc('other', 'CAPITULO', 'M4-Sanitario-v13-01-soporteVital-cap1.pdf'),
  doc('processing', 'CAPITULO', 'M1-Incendios-v6-01-teoriaFuego-cap3.pdf', 'PROCESSING'),
  doc('unknown', 'TEMA', 'Desconocido.pdf'),
];
test('the generator uses exactly what is selected and never a PDF together with the one that contains it', () => {
  // A manual alone: its themes and chapters are not added.
  assert.deepEqual(toggleSource(docs, [], docs[0]), ['m1']);
  // A chapter alone.
  assert.deepEqual(toggleSource(docs, [], docs[2]), ['c1']);
  // Selecting a theme unselects its chapters, which it already includes.
  assert.deepEqual(toggleSource(docs, ['c1', 'other'], docs[1]).sort(), ['other', 't1']);
  // A chapter inside a selected theme cannot be selected apart.
  assert.deepEqual(toggleSource(docs, ['t1'], docs[2]), ['t1']);
  assert.equal(selectedAncestor(docs, ['m1'], docs[2]).id, 'm1');
  assert.equal(selectedAncestor(docs, ['t2'], docs[2]), null);
});

test('documents outside the manual - theme - chapter naming are independent', () => {
  assert.deepEqual(toggleSource(docs, ['t1'], docs[7]).sort(), ['t1', 'unknown']);
  assert.equal(selectedAncestor(docs, ['unknown'], docs[2]), null);
});
