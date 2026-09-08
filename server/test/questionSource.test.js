import test from 'node:test';
import assert from 'node:assert/strict';
import {formatCeisSourceLabel, stripLegacyCeisPrefix, containsCategoryReference} from '../src/utils/questionSource.js';
test('Trauma chapters use the canonical topic title without chapter numbers', () => {
  for (const title of ['Capítulo 5 Trauma', 'Tema 2 Trauma', 'Urgencias Traumáticas', null]) {
    assert.equal(formatCeisSourceLabel(title, 'M4-Sanitario-v13-02-trauma-cap5.pdf'), 'Urgencias Traumáticas del CEIS Guadalajara');
  }
});
test('removes structural labels for other topics and manuals while preserving the content title', () => {
  assert.equal(formatCeisSourceLabel('Capítulo 2 Hidráulica', ''), 'Hidráulica del CEIS Guadalajara');
  assert.equal(formatCeisSourceLabel('Tema 4 Incendios en túneles', ''), 'Incendios en túneles del CEIS Guadalajara');
  assert.equal(formatCeisSourceLabel('Manual 1 Incendios', ''), 'Incendios del CEIS Guadalajara');
});
test('existing question prefixes can be replaced without altering the actual question', () => {
  const question = '¿Cuál es el grupo de acción encargado de controlar la seguridad del punto del incidente y realizar el rescate de las víctimas?';
  assert.equal(stripLegacyCeisPrefix(`Capítulo 5 Trauma del CEIS Guadalajara. ${question}`), question);
});
test('rejects category identifiers in questions and options, without rejecting medical content', () => {
  for (const text of ['Según el capítulo 5, ¿qué ocurre?', 'Tema II', 'Manual 4', 'M4-Sanitario-v13-02-trauma.pdf']) assert.equal(containsCategoryReference(text), true);
  for (const text of ['Urgencias Traumáticas del CEIS Guadalajara. ¿Qué grupo interviene?', 'El grupo de rescate', 'Ventilación manual']) assert.equal(containsCategoryReference(text), false);
});
