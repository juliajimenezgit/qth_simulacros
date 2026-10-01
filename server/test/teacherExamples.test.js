import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, cleanExplanation, cleanStem, formatTeacherExamples, guideLevel, pickTeacherExamples } from '../src/services/teacherExamplesService.js';

test('removes the manual label from stems and the location from explanations', () => {
  assert.equal(cleanStem('Teoría del Fuego del CEIS Guadalajara. ¿Cuál es el porcentaje del oxígeno en el aire?'), '¿Cuál es el porcentaje del oxígeno en el aire?');
  assert.equal(cleanStem('Manual 1 de Incendios de los CEIS. ¿Qué es la dilatación?'), '¿Qué es la dilatación?');
  assert.equal(cleanStem('Según el CEIS de Guadalajara (Hidráulica), ¿qué presión de vapor tendrá el agua a 20ºC?'), '¿Qué presión de vapor tendrá el agua a 20ºC?');
  assert.equal(cleanStem('De acuerdo con el manual de Riesgos Tecnológicos del CEIS Guadalajara, el alcance de la demolición puede ser...'), 'El alcance de la demolición puede ser...');
  // Context that does not name the source is kept.
  assert.equal(cleanStem('De acuerdo con la descripción operativa del batefuegos, ¿cuál es su finalidad?'), 'De acuerdo con la descripción operativa del batefuegos, ¿cuál es su finalidad?');
  assert.equal(cleanExplanation('Página 54, columna de la derecha en características del nitrógeno: Es un gas incoloro, inodoro e insípido.'), 'Es un gas incoloro, inodoro e insípido.');
  assert.equal(cleanExplanation('Pág. 21 Izquierda. Apnea: 0. Bradipnea: menos de 12 resp/min.'), 'Apnea: 0. Bradipnea: menos de 12 resp/min.');
  assert.equal(cleanExplanation('El oxígeno está al 21 % en el aire. Respuesta correcta la b).'), 'El oxígeno está al 21 % en el aire.');
});

const example = (question, options, type) => ({ question, option_a: options[0], option_b: options[1], option_c: options[2], option_d: options[3], correct_answer: 'A', explanation: 'Explicación con suficientes palabras para enseñar algo útil.', type });

test('classifies examples by the shape the teachers use', () => {
  assert.equal(classify(example('¿Cuál es el porcentaje de oxígeno?', ['21%.', '11%.', '31%.', '78%.'])), 'CIFRA');
  assert.equal(classify(example('El mecanismo de extinción primario del CO2 es...', ['Sofocación.', 'Enfriamiento.', 'Inhibición.', 'Ninguna es correcta.'])), 'TODAS_NINGUNA');
  assert.equal(classify(example('¿Cuál de los siguientes términos no es un mecanismo de extinción?', ['Reacción en cadena.', 'Desalimentación.', 'Sofocación.', 'Enfriamiento.'])), 'NEGATIVA');
  assert.equal(classify(example('¿Cómo se denomina la mezcla de espumógeno y agua?', ['Mezcla espumante.', 'Mezcla espumosa.', 'Espuma física.', 'Espumógeno.'])), 'CORTA');
});

test('picks one example per type of the level mix and marks the valid answer', () => {
  const pool = ['CORTA', 'CORTA', 'CORTA', 'CIFRA', 'NEGATIVA', 'TODAS_NINGUNA', 'AFIRMACIONES']
    .map((type, index) => example(`Pregunta ${index}`, ['Uno.', 'Dos.', 'Tres.', 'Cuatro.'], type));
  const picked = pickTeacherExamples(pool, 'PRINCIPIANTE', () => 0);
  assert.deepEqual(picked.map(item => item.type), ['CORTA', 'CORTA', 'CIFRA', 'NEGATIVA', 'TODAS_NINGUNA', 'AFIRMACIONES']);
  assert.equal(new Set(picked).size, picked.length);
  assert.match(formatTeacherExamples(picked), /- Uno\.   ← válida/);
  assert.equal(formatTeacherExamples([]), 'Sin ejemplos disponibles.');
});

test('assigns the mixed «aleatorio» questions to P, F or D with the QTH guide criteria', () => {
  const level = (question, options, type) => guideLevel({ ...example(question, options, type), type: type || classify(example(question, options)) });
  // P: direct question, clearly different options.
  assert.equal(level('¿Qué tipo de quemadura tiene consistencia acartonada?', ['Tercer grado.', 'Primer grado.', 'Escaldadura.', 'Eritema solar.']), 'PRINCIPIANTE');
  // F: close figures, similar options or Ninguna.
  assert.equal(level('¿Qué porcentaje de oxígeno tiene el aire?', ['21%.', '19%.', '23%.', '25%.']), 'FACIL');
  assert.equal(level('¿Cuál es el mecanismo primario del CO2?', ['Sofocación.', 'Enfriamiento.', 'Inhibición.', 'Ninguna es correcta.']), 'FACIL');
  // Options that are too similar or a minimal change of words: F for the guide, not P.
  assert.equal(level('¿Cómo se denomina la mezcla de espumógeno y agua?', ['Mezcla espumante.', 'Mezcla espumosa.', 'Espuma física.', 'Espumógeno.']), 'FACIL');
  assert.equal(level('¿Cómo se denominan los compuestos añadidos al agua?', ['Aditivos.', 'Adiciones.', 'Adheridos.', 'Aligerados.']), 'FACIL');
  assert.equal(level('¿Qué potencia tienen las lámparas halógenas?', ['70 w.', '40 w.', '55 w.', '85 w.']), 'FACIL');
  // A sibling list stays in P.
  assert.equal(level('¿Qué clase de fuego producen los metales?', ['Clase D.', 'Clase A.', 'Clase B.', 'Clase F.']), 'PRINCIPIANTE');
  // D: long statements or calculations.
  assert.equal(level('Señala la afirmación correcta sobre la ventilación:', Array(4).fill(0).map((_, i) => `A mayor superficie de salida, mayor será el caudal y menor el diferencial ${i}.`)), 'DIFICIL');
});
