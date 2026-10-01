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

test('maps PDF pages to the printed manual page', async () => {
  const { manualPageNumbers } = await import('../src/services/pdfService.js');
  const pages = [
    { page: 1, text: 'TEORÍA DEL FUEGO\nportada' },
    { page: 4, text: '1. Conceptos básicos\ntexto\n20' },
    { page: 5, text: 'Caracterización\ntexto\n21' },
    { page: 6, text: 'Tabla\n1500' },
    { page: 7, text: 'texto\n23' },
  ];
  assert.deepEqual([...manualPageNumbers(pages)], [[1, 17], [4, 20], [5, 21], [6, 22], [7, 23]]);
  // Numbers repeated by overlaid text («127127») and numbering that shifts part-way through.
  const repeated = [{ page: 3, text: 'texto\n127127' }, { page: 4, text: 'texto\n128128' }, { page: 5, text: 'texto\n128' }, { page: 6, text: 'texto\n129' }];
  assert.deepEqual([...manualPageNumbers(repeated)], [[3, 127], [4, 128], [5, 128], [6, 129]]);
  // A single numbered page in a very short PDF, and isolated numbers that prove nothing.
  assert.deepEqual([...manualPageNumbers([{ page: 1, text: 'portada' }, { page: 2, text: 'texto\n288' }])], [[1, 287], [2, 288]]);
  assert.equal(manualPageNumbers([{ page: 1, text: 'Tabla\n1500' }, { page: 2, text: 'Tabla\n30' }]).size, 0);
});
