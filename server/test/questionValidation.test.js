import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceAnswers, LETTERS, optionKey, validateCandidate, sourceReference, enrichChapters, spreadSections, coverageKey, distributionErrors, hasPositionalReferences } from '../src/utils/questionValidation.js';
const document = { original_filename: 'Manual.pdf' };
const chunk = { id: 'source', text: 'Capítulo 3 Hidráulica\nLa presión de servicio es 10 bar.', page: 12, section: '3.1 Presión' };
const question = { question: '¿Cuál es la presión de servicio?', option_a: '8 bar', option_b: '10 bar', option_c: '12 bar', option_d: '14 bar', correct_answer: 'B', explanation: 'La presión de servicio es 10 bar; los demás valores difieren del dato de la fuente.', source_chunk_id: chunk.id, difficulty: 'PRINCIPIANTE', reference: sourceReference(document, chunk) };

test('balances 9 B and 1 A without changing contents or the correct option', () => {
  const input = Array.from({ length: 10 }, (_, i) => ({ ...question, id: i, correct_answer: i === 9 ? 'A' : 'B' }));
  const before = structuredClone(input);
  for (let run = 0; run < 30; run++) {
    const result = balanceAnswers(input);
    assert.deepEqual(LETTERS.map(letter => result.filter(row => row.correct_answer === letter).length).sort(), [2, 2, 3, 3]);
    for (const [index, row] of result.entries()) {
      assert.equal(row[optionKey(row.correct_answer)], input[index][optionKey(input[index].correct_answer)]);
      assert.deepEqual(LETTERS.map(letter => row[optionKey(letter)]).sort(), LETTERS.map(letter => input[index][optionKey(letter)]).sort());
      assert.equal(row.explanation, input[index].explanation);
    }
    assert.doesNotMatch(result.map(row => row.correct_answer).join(''), /(.)\1\1|(..)\2\2|(.{4})\3/u);
  }
  assert.deepEqual(input, before);
});
test('detects positional dependencies but allows order-independent Todas/Ninguna', () => {
  for (const text of ['Todas las anteriores', 'B y C son correctas', 'La respuesta B es válida', 'La primera opción']) assert.ok(hasPositionalReferences(text));
  for (const text of ['Todas son correctas', 'Ninguna es correcta', 'La respuesta a la pregunta se obtiene del texto', 'Los equipos de primera respuesta', 'Los fuegos de clase A y B', 'El tipo C es correcto']) assert.equal(hasPositionalReferences(text), false);
  assert.throws(() => balanceAnswers([{ ...question, option_d: 'Todas las anteriores' }]));
});
test('rejects wrong level, invented source, repeated options and unsupported explanation page', () => {
  const validate = changes => validateCandidate({ ...question, ...changes }, { document, contextChunks: [chunk], difficulty: 'PRINCIPIANTE' }).errors;
  assert.deepEqual(validate({}), []);
  assert.ok(validate({ difficulty: 'DIFICIL' }).includes('DIFICULTAD_INCORRECTA'));
  assert.ok(validate({ source_chunk_id: 'invented' }).includes('FRAGMENTO_NO_AUTORIZADO'));
  // Model references are ignored; persistence derives them from the verified chunk.
  assert.deepEqual(validate({ reference: 'Manual.pdf - página 99 - apartado 3.1 Presión' }), []);
  assert.ok(validate({ option_d: ' 10 BAR ' }).includes('OPCIONES_REPETIDAS_O_VACIAS'));
  assert.ok(validate({ explanation: 'La página 99 indica la respuesta.' }).includes('PAGINA_EXPLICACION_INCORRECTA'));
});
test('inherits chapter from recovered headings and interleaves sections', () => {
  const rows = [{ ...chunk, id: 'a', section: 'Capítulo 3 Hidráulica' }, { ...chunk, id: 'b', page: 13, text: 'Más datos' }, { ...chunk, id: 'c', page: 14, text: 'Otros datos' }];
  const enriched = enrichChapters(rows);
  assert.equal(enriched[2].chapter, 'Capítulo 3 Hidráulica');
  const spread = spreadSections([{ ...chunk, id: 'a' }, { ...chunk, id: 'b' }, { ...chunk, id: 'c', section: 'Caudal' }, { ...chunk, id: 'd', section: 'Caudal' }]);
  assert.deepEqual(spread.map(row => row.id), ['a', 'c', 'b', 'd']);
  assert.equal(enrichChapters([{ ...chunk, text: 'Sin encabezado', section: null }])[0].chapter, 'No identificado');
});
test('enforces section coverage and mixed formats without requiring every format', () => {
  const options = { chunk, format: 'DIRECTA', sectionCounts: new Map([[coverageKey(chunk), 1]]), formatCounts: new Map([['DIRECTA', 7]]), availableSections: [coverageKey(chunk), 'caudal'], count: 10 };
  assert.deepEqual(distributionErrors(options), []);
  assert.deepEqual(distributionErrors({ ...options, sectionCounts: new Map([[coverageKey(chunk), 2]]) }), ['COBERTURA_REPETIDA']);
  assert.deepEqual(distributionErrors({ ...options, sectionCounts: new Map([[coverageKey(chunk), 2]]), availableSections: [coverageKey(chunk)] }), []);
});


test('balances every supported test size without obvious answer patterns', () => {
  for (let count = 1; count <= 120; count++) {
    const rows = balanceAnswers(Array.from({ length: count }, () => ({ ...question })));
    const counts = LETTERS.map(letter => rows.filter(row => row.correct_answer === letter).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    assert.doesNotMatch(rows.map(row => row.correct_answer).join(''), /(.)\1\1|(..)\2\2|(.{4})\3/u);
  }
});

test('rewrites letter references and printed pages in explanations instead of rejecting', async () => {
  const { replaceLetterReferences, alignExplanationPages } = await import('../src/utils/questionValidation.js');
  const q = { option_a: '10 bar.', option_b: '12 bar.', option_c: '14 bar.', option_d: '8 bar.' };
  assert.equal(replaceLetterReferences('La opción A es la correcta; B, C y D son incorrectas.', q),
    'La opción «10 bar» es la correcta; «12 bar», «14 bar» y «8 bar» son incorrectas.');
  assert.equal(replaceLetterReferences('Los fuegos de clase A y B arden distinto.', q), 'Los fuegos de clase A y B arden distinto.');
  assert.equal(alignExplanationPages('Según la pág. 9 del manual.', { page: 14 }), 'Según la pág. 14 del manual.');
  assert.equal(alignExplanationPages('Según el manual (pág. 9).', { page: null }), 'Según el manual.');
});
