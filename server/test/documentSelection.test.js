import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleDocumentSelection } from '../../client/src/utils/documentSelection.js';
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
test('a manual selects all available descendants across the full library', () => {
  assert.deepEqual(toggleDocumentSelection(docs, [], docs[0]), ['m1', 't1', 'c1', 't2', 'c2']);
});
test('a topic selects only its own chapters without duplicating existing selections', () => {
  assert.deepEqual(toggleDocumentSelection(docs, ['c1'], docs[1]), ['c1', 't1']);
});
test('deselecting a topic removes its branch but preserves the selected manual and siblings', () => {
  assert.deepEqual(toggleDocumentSelection(docs, ['m1', 't1', 'c1', 't2', 'c2'], docs[1]), ['m1', 't2', 'c2']);
});
test('deselecting a chapter preserves its previously selected topic', () => {
  const selected = toggleDocumentSelection(docs, [], docs[1]);
  assert.deepEqual(toggleDocumentSelection(docs, selected, docs[2]), ['t1']);
});
test('deselecting a chapter preserves both selected ancestors and other branches', () => {
  const selected = toggleDocumentSelection(docs, [], docs[0]);
  assert.deepEqual(toggleDocumentSelection(docs, selected, docs[2]), ['m1', 't1', 't2', 'c2']);
});
test('deselecting an independent chapter does not select its topic', () => {
  assert.deepEqual(toggleDocumentSelection(docs, ['c1'], docs[2]), []);
});
test('deselecting a manual leaves unrelated documents selected', () => {
  assert.deepEqual(toggleDocumentSelection(docs, ['m1', 't1', 'c1', 'other'], docs[0]), ['other']);
});
test('standalone documents and individual chapters remain independently selectable', () => {
  assert.deepEqual(toggleDocumentSelection(docs, [], docs[7]), ['unknown']);
  assert.deepEqual(toggleDocumentSelection(docs, [], docs[2]), ['c1']);
});
