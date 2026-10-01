import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestTestName } from '../../client/src/utils/testName.js';
const doc = original_filename => ({ original_filename });
const at = new Date(2026, 9, 1, 12, 51);

test('suggests the manual or topic name followed by the time', () => {
  assert.equal(suggestTestName([doc('m1-incendios-v6-01-teoriafuego.pdf')], at), 'teoriafuego_1251');
  assert.equal(suggestTestName([doc('M1-Incendios-v6-01-teoriaFuego-cap2.pdf')], at), 'teoriafuego_1251');
  assert.equal(suggestTestName([doc('M1-Incendios-v6-00-completo.pdf')], at), 'incendios_1251');
  assert.equal(suggestTestName([doc('M6-EOV-v4-03-equipos-extincion-cap4.pdf')], at), 'equiposextincion_1251');
  // A topic with its chapters keeps the topic name; topics of one manual take the manual name.
  assert.equal(suggestTestName([doc('m1-incendios-v6-01-teoriafuego.pdf'), doc('M1-Incendios-v6-01-teoriaFuego-cap1.pdf')], at), 'teoriafuego_1251');
  assert.equal(suggestTestName([doc('m1-incendios-v6-01-teoriafuego.pdf'), doc('m1-incendios-v6-02-hidraulica.pdf')], at), 'incendios_1251');
  assert.equal(suggestTestName([doc('m1-incendios-v6-02-hidraulica.pdf'), doc('M4-Sanitario-v13-02-trauma-cap5.pdf')], at), 'incendios-sanitario_1251');
  assert.equal(suggestTestName([{ original_filename: 'apuntes.pdf', display_title: 'Apuntes de Física' }], new Date(2026, 9, 1, 9, 5)), 'apuntesdefisica_0905');
});
