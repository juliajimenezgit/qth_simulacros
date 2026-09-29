import test from 'node:test';
import assert from 'node:assert/strict';
import {formatCeisSourceLabel, stripLegacyCeisPrefix, containsCategoryReference, stripSectionReference} from '../src/utils/questionSource.js';
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

test('removes the section from the question text and keeps the question itself', () => {
  const cases = {
    '2.3.1. ESPECIFICACIONES. ¿Qué presión soporta la manguera?': '¿Qué presión soporta la manguera?',
    'Según el apartado 3.2.2. El Proceso, ¿cuál de las siguientes actividades NO forma parte del proceso?': '¿Cuál de las siguientes actividades NO forma parte del proceso?',
    'Según el manual El Mando Intermedio del CEIS Guadalajara, apartado 3.3.5. Llegada al siniestro, ¿cuál es una condición?': '¿Cuál es una condición?',
    'Según el manual, apartado 3.3.6. Plan de acción, ¿cuál es el orden correcto?': '¿Cuál es el orden correcto?',
    'En el apartado 6.2 Ambigüedad del rol, señala la respuesta CORRECTA:': 'Señala la respuesta CORRECTA:',
    '¿Qué presión alcanza 2.5 bar en la bomba?': '¿Qué presión alcanza 2.5 bar en la bomba?',
    'Según el manual, ¿qué es el empowerment?': 'Según el manual, ¿qué es el empowerment?',
    'en caso de duda, ¿qué hace el mando?': 'en caso de duda, ¿qué hace el mando?',
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(stripSectionReference(input), expected);
  assert.equal(stripSectionReference('Gases. ¿Qué gas arde con llama azul?'), '¿Qué gas arde con llama azul?');
  assert.equal(stripSectionReference('Sustancias y fórmulas químicas básicas. ¿Qué es una sustancia?', '1.1.2. Sustancias y fórmulas químicas básicas'), '¿Qué es una sustancia?');
  assert.equal(stripSectionReference('Un incendio se declara en un sótano. ¿Qué haces primero?'), 'Un incendio se declara en un sótano. ¿Qué haces primero?');
  assert.equal(stripSectionReference('El humo es negro. ¿Qué indica?'), 'El humo es negro. ¿Qué indica?');
});
