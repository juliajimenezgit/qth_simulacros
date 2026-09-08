import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterTitleFromFilename, extractDocumentDisplayTitle } from '../src/services/pdfService.js';

test('collects complete multiline headings without swallowing credits or body text', () => {
  for (const [text, expected] of [
    ['INCENDIOS EN\nTÚNELES\nJuan Carlos Muñoz Matías', 'Incendios en Túneles'],
    ['INCENDIOS DE INTERIOR\nVENTILACIÓN DE\nINCENDIOS\nArturo Arnalich', 'Incendios de Interior Ventilación de Incendios'],
    ['EQUIPOS OPERATIVOS\nY HERRAMIENTAS DE\nINTERVENCIÓN\nAUTORES\nOTRO NOMBRE', 'Equipos Operativos y Herramientas de Intervención'],
    ['RESCATE ACUÁTICO\nPARTE 2\nOTRO TÍTULO', 'Rescate Acuático'],
  ]) assert.equal(extractDocumentDisplayTitle([{ text }], 'documento.pdf'), expected);
});

test('complete manuals use their known title instead of cover credits', () => {
  assert.equal(extractDocumentDisplayTitle([{ text: 'AUTORES\nOTRO NOMBRE' }], 'M1-Incendios-v6-00-completo.pdf'), 'Incendios');
});

test('extracts complete titles from the actual uploaded topic PDFs', async () => {
  const { extractPdfPages } = await import('../src/services/pdfService.js');
  for (const [filename, expected] of [
    ['M1-Incendios-v6-04-tuneles.pdf', 'Incendios en Túneles'],
    ['M1-Incendios-v6-03-interiorVentilacion.pdf', 'Incendios de Interior Ventilación de Incendios'],
    ['M1-Incendios-v6-05-industriales.pdf', 'Incendios Industriales'],
    ['M1-Incendios-v6-06-vegetacion.pdf', 'Incendios de Vegetación'],
    ['m1-incendios-v6-01-teoriafuego.pdf', 'Teoría del Fuego'],
    ['m1-incendios-v6-02-hidraulica.pdf', 'Hidráulica'],
    ['M1-Incendios-v6-00-completo.pdf', 'Incendios'],
  ]) {
    const pages = await extractPdfPages(new URL(`../../docs/${filename}`, import.meta.url));
    assert.equal(extractDocumentDisplayTitle(pages, filename), expected, filename);
  }
});

test('chapter filenames take precedence over generic or unrelated PDF headings', () => {
  for (const text of ['CAPÍTULO', 'CAPÍTULO\n1', 'OTRO ENCABEZADO']) {
    assert.equal(extractDocumentDisplayTitle([{ text }], 'M1-Incendios-v6-01-teoriaFuego-cap1.pdf'), 'Capítulo 1 Teoría del Fuego');
  }
});

test('supports lowercase filenames, multi-digit chapters, accents and separators', () => {
  assert.equal(chapterTitleFromFilename('m1-incendios-v6-01-teoriafuego-cap12.pdf'), 'Capítulo 12 Teoría del Fuego');
  assert.equal(chapterTitleFromFilename('M1-Incendios-v6-02-hidraulica-cap02.PDF'), 'Capítulo 2 Hidráulica');
  assert.equal(chapterTitleFromFilename('Rescate Acuático_capitulo_3.pdf'), 'Capítulo 3 Rescate Acuático');
  assert.equal(chapterTitleFromFilename('M6-EOV-v4-01-equipos-EPIvestuario-cap1.pdf'), 'Capítulo 1 Equipos EPI Vestuario');
});

test('preserves nonchapter title extraction and rejects generic headings', () => {
  assert.equal(chapterTitleFromFilename('M1-Incendios-v6-00-completo.pdf'), null);
  assert.equal(extractDocumentDisplayTitle([{ text: 'TEORÍA DEL FUEGO' }], 'tema.pdf'), 'Teoría del Fuego');
  assert.equal(extractDocumentDisplayTitle([{ text: 'CAPÍTULO' }], 'Rescate-acuático.pdf'), 'Rescate Acuático');
});

test('identifies parent manual and topic without requiring parent PDFs to be uploaded', async () => {
  const { documentHierarchyFromFilename } = await import('../src/services/pdfService.js');
  assert.deepEqual(documentHierarchyFromFilename('M1-Incendios-v6-01-teoriaFuego-cap1.pdf', 'CAPITULO'), {
    manual_label: 'M1 · Incendios', topic_label: 'Tema 1 · Teoría del Fuego',
  });
  assert.deepEqual(documentHierarchyFromFilename('m1-incendios-v6-02-hidraulica.pdf', 'TEMA'), {
    manual_label: 'M1 · Incendios', topic_label: null,
  });
  assert.deepEqual(documentHierarchyFromFilename('M1-Incendios-v6-00-completo.pdf', 'MANUAL'), {
    manual_label: null, topic_label: null,
  });
  assert.deepEqual(documentHierarchyFromFilename('Rescate-cap1.pdf', 'CAPITULO'), {
    manual_label: null, topic_label: null,
  });
});
