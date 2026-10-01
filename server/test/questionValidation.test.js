import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceAnswers, LETTERS, optionKey, validateCandidate, sourceReference, enrichChapters, spreadSections, coverageKey, distributionErrors, hasPositionalReferences, optionWordGap, questionFormat, invertedQuota, formatCap, withNoneOption, stripExplanationReference } from '../src/utils/questionValidation.js';
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
test('keeps the four options within 5 words of each other, ignoring Todas/Ninguna', () => {
  const validate = changes => validateCandidate({ ...question, ...changes }, { document, contextChunks: [chunk], difficulty: 'PRINCIPIANTE' }).errors;
  assert.ok(validate({ option_a: 'Ocho bar medidos en la entrada de la bomba principal' }).includes('OPCIONES_LONGITUD_DESIGUAL'));
  assert.deepEqual(validate({ option_a: 'Ocho bar en la bomba' }), []);
  const long = { option_a: 'Arden los vapores generados por la acción del calor.', option_b: 'No producen brasas al quemarse.', option_c: 'Proceden de sólidos de bajo punto de fusión.', option_d: 'Todas son correctas.' };
  assert.equal(optionWordGap(long), 4);
  assert.deepEqual(validate(long), []);
});
test('classifies Todas/Ninguna from the options and requires 30% INCORRECTA or Todas/Ninguna', () => {
  assert.equal(questionFormat({ ...question, option_d: 'Ninguna es correcta.' }, 'DIRECTA'), 'TODAS_NINGUNA');
  assert.equal(questionFormat(question, 'INCORRECTA'), 'INCORRECTA');
  assert.equal(questionFormat(question, 'CIFRA'), 'CIFRA');
  assert.deepEqual(invertedQuota(new Map([['DIRECTA', 5], ['INCORRECTA', 1]]), 10), { missing: 2, remaining: 4, required: 3, inverted: 1 });
  assert.equal(invertedQuota(new Map(), 3).required, 0);
  const options = { chunk, sectionCounts: new Map(), availableSections: [coverageKey(chunk)], count: 10 };
  // 4 slots left and 2 missing: there is still room for other formats.
  assert.deepEqual(distributionErrors({ ...options, format: 'DIRECTA', formatCounts: new Map([['DIRECTA', 3], ['CIFRA', 2], ['INCORRECTA', 1]]) }), []);
  // 2 slots left and 2 missing: only INCORRECTA or Todas/Ninguna are accepted.
  const tight = { ...options, formatCounts: new Map([['DIRECTA', 3], ['CIFRA', 4], ['TODAS_NINGUNA', 1]]) };
  assert.deepEqual(distributionErrors({ ...tight, format: 'DIRECTA' }), ['CUOTA_NEGATIVAS_PENDIENTE']);
  assert.deepEqual(distributionErrors({ ...tight, format: 'INCORRECTA' }), []);
  // Todas/Ninguna is capped at 15%: one in a 10-question test.
  assert.deepEqual(distributionErrors({ ...tight, format: 'TODAS_NINGUNA' }), ['FORMATO_EXCEDIDO']);
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
  const options = { chunk, format: 'DIRECTA', sectionCounts: new Map([[coverageKey(chunk), 1]]), formatCounts: new Map([['DIRECTA', 3], ['CIFRA', 2], ['INCORRECTA', 2]]), availableSections: [coverageKey(chunk), 'caudal'], count: 10 };
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

test('detects negative stems from the text and caps each format like the teachers\' tests', () => {
  for (const text of ['Señala la respuesta INCORRECTA:', '¿Cuál de las siguientes afirmaciones es incorrecta?', '¿Cuál de los siguientes NO es un agente extintor?', 'Son clases de fuego EXCEPTO:'])
    assert.equal(questionFormat({ ...question, question: text }, 'DIRECTA'), 'INCORRECTA');
  assert.equal(questionFormat({ ...question, question: '¿Qué gas no es tóxico?' }, 'DIRECTA'), 'DIRECTA');
  assert.equal(formatCap('INCORRECTA', 10), 2);
  // Only INCORRECTA is capped: the other formats are labelled by the model and only get guidance.
  assert.equal(formatCap('DIRECTA', 10), Infinity);
  assert.equal(formatCap('INCORRECTA', 50), 12);
  assert.equal(formatCap('INCORRECTA', 3), Infinity);
  const options = { chunk, sectionCounts: new Map(), availableSections: [coverageKey(chunk)], count: 10 };
  assert.deepEqual(distributionErrors({ ...options, format: 'INCORRECTA', formatCounts: new Map([['INCORRECTA', 2]]) }), ['FORMATO_EXCEDIDO']);
  assert.deepEqual(distributionErrors({ ...options, format: 'DIRECTA', formatCounts: new Map([['DIRECTA', 6], ['INCORRECTA', 2]]) }), []);
  assert.deepEqual(distributionErrors({ ...options, format: 'TODAS_NINGUNA', formatCounts: new Map([['DIRECTA', 4], ['INCORRECTA', 2]]) }), []);
});

test('stops requiring section spread in the last attempts', () => {
  const options = { chunk, format: 'DIRECTA', sectionCounts: new Map([[coverageKey(chunk), 2]]), formatCounts: new Map(), availableSections: [coverageKey(chunk), 'caudal'], count: 10 };
  assert.deepEqual(distributionErrors(options), ['COBERTURA_REPETIDA']);
  assert.deepEqual(distributionErrors({ ...options, relaxCoverage: true }), []);
});

test('turns an approved question into a Ninguna question without touching the answer or mentioned options', () => {
  const converted = withNoneOption({ ...question, explanation: 'La presión de servicio es 10 bar; 8 bar corresponde a otro equipo.' });
  assert.equal(converted.option_b, '10 bar');
  assert.equal(converted.option_a, '8 bar');
  assert.equal([converted.option_c, converted.option_d].filter(option => option === 'Ninguna es correcta.').length, 1);
  assert.equal(questionFormat(converted, 'CIFRA'), 'TODAS_NINGUNA');
  assert.match(converted.explanation, /Ninguna es correcta/);
});

test('removes the leading location from explanations: the reference is shown apart', () => {
  const cases = [
    ['Pág. 54, 2.4.1. Nitrógeno n2: Es un gas incoloro, inodoro e insípido.', 'Es un gas incoloro, inodoro e insípido.'],
    ['Página 39, 6.1.2 fuegos de clase B, 1º y 2 párrafos: Provocados por combustibles líquidos.', 'Provocados por combustibles líquidos.'],
    ['Página 43 7. Evolución de incendios. Se definen cuatro fases: inicio, desarrollo, propagación y extinción.', 'Se definen cuatro fases: inicio, desarrollo, propagación y extinción.'],
    ['Pág. 87, 1.1. Desarrollo genérico de un incendio de interior\nEl incendio comienza en el foco.', 'El incendio comienza en el foco.'],
    ['Apartado 1.2. Densidad: la densidad expresa la masa por unidad de volumen.', 'La densidad expresa la masa por unidad de volumen.'],
    ['Pág. 39, apartado 3.1. Agua. El agua es muy efectiva en fuegos tipo A por su gran poder de enfriamiento, ya que absorbe mucho calor al evaporarse y cubre el combustible.', 'El agua es muy efectiva en fuegos tipo A por su gran poder de enfriamiento, ya que absorbe mucho calor al evaporarse y cubre el combustible.'],
    ['Pág. 36, apartado 2.2.4. Espuma. Según la norma UNE 23600, la clasificación es: baja, media y alta expansión según su coeficiente de expansión en la mezcla final.', 'Según la norma UNE 23600, la clasificación es: baja, media y alta expansión según su coeficiente de expansión en la mezcla final.'],
    ['El oxígeno es el comburente más común (pág. 37).', 'El oxígeno es el comburente más común (pág. 37).'],
  ];
  for (const [input, expected] of cases) assert.equal(stripExplanationReference(input), expected);
});

test('always places Todas/Ninguna in D and keeps the answers balanced', () => {
  const plain = Array.from({ length: 16 }, (_, i) => ({ ...question, id: i }));
  const asDistractor = { ...question, id: 'distractor', option_c: 'Ninguna es correcta.' };
  const asAnswer = { ...question, id: 'answer', option_a: 'Todas son correctas.', correct_answer: 'A' };
  for (let run = 0; run < 50; run++) {
    const rows = balanceAnswers([asDistractor, ...plain, asAnswer]);
    const distractor = rows.find(row => row.id === 'distractor');
    const answer = rows.find(row => row.id === 'answer');
    assert.equal(distractor.option_d, 'Ninguna es correcta.');
    assert.notEqual(distractor.correct_answer, 'D');
    assert.equal(distractor[optionKey(distractor.correct_answer)], '10 bar');
    assert.equal(answer.option_d, 'Todas son correctas.');
    assert.equal(answer.correct_answer, 'D');
    const counts = LETTERS.map(letter => rows.filter(row => row.correct_answer === letter).length);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  }
  // Only one Todas/Ninguna option per question, since it always takes D.
  const validate = changes => validateCandidate({ ...question, ...changes }, { document, contextChunks: [chunk], difficulty: 'PRINCIPIANTE' }).errors;
  assert.ok(validate({ option_c: 'Todas son correctas.', option_d: 'Ninguna es correcta.' }).includes('VARIAS_OPCIONES_DE_CONJUNTO'));
});

test('caps Todas/Ninguna at 15% and its use as the valid answer at about a third', () => {
  assert.equal(formatCap('TODAS_NINGUNA', 20), 3);
  const options = { chunk, sectionCounts: new Map(), availableSections: [coverageKey(chunk)], count: 20, format: 'TODAS_NINGUNA' };
  assert.deepEqual(distributionErrors({ ...options, formatCounts: new Map([['TODAS_NINGUNA', 1]]), globalAnswer: true }), []);
  assert.deepEqual(distributionErrors({ ...options, formatCounts: new Map([['TODAS_NINGUNA', 1], ['TODAS_NINGUNA_CORRECTA', 1]]), globalAnswer: true }), ['TODAS_NINGUNA_CORRECTA_EXCEDIDA']);
  assert.deepEqual(distributionErrors({ ...options, formatCounts: new Map([['TODAS_NINGUNA', 1], ['TODAS_NINGUNA_CORRECTA', 1]]) }), []);
  // With 7 questions both caps (1 + 1) fall short of 30%: the minimum drops to what the caps allow.
  assert.equal(invertedQuota(new Map(), 7).required, 2);
  // The valid-answer counter is not a format: it does not count as a saved question.
  assert.equal(invertedQuota(new Map([['TODAS_NINGUNA', 1], ['TODAS_NINGUNA_CORRECTA', 1]]), 10).remaining, 9);
});
