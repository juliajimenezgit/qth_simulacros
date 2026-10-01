import test from 'node:test';
import assert from 'node:assert/strict';
import { explanationWithoutReference, shortReference } from '../../client/src/utils/reference.js';

test('the review reference keeps the page and section number but not the file or section title', () => {
  assert.equal(shortReference('M1-Incendios-v6-06-vegetacion.pdf - página 250 - apartado 3.2.3. Vapor de agua-Humedad'), 'Página 250 - apartado 3.2.3');
  assert.equal(shortReference('M1-Incendios-v6-01-teoriaFuego - pagina 9 - apartado 3.2.1. Combustiones de aportación'), 'Página 9 - apartado 3.2.1');
  assert.equal(shortReference('M7-Mandos-v4-04-myc.pdf - página 20 - apartado 1. Definición del Proceso'), 'Página 20 - apartado 1');
  // Manual questions may only have the page, or their own wording.
  assert.equal(shortReference('Página 14'), 'Página 14');
  assert.equal(shortReference('manual.pdf - Anexo de tablas'), 'Anexo de tablas');
});

test('an explanation that starts with its own location does not repeat it', () => {
  assert.equal(explanationWithoutReference('Pág. 23, apartado 3.2.3. Procesamiento de la Información: La prioridad puede venir dada por…'), 'La prioridad puede venir dada por…');
  assert.equal(explanationWithoutReference('Valores de la humedad relativa por debajo del 30%…'), 'Valores de la humedad relativa por debajo del 30%…');
});
