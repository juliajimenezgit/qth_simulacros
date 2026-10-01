// What a question measures (QTH guide), separate from its format (how the answer is asked). Generated tests
// follow the mix measured on the 420 teachers' questions: 200 Principiante, 150 Élite and 70 Aleatorio.
export const QUESTION_TYPES = [
  "LITERAL", "CONCEPTUAL", "CLASIFICACION", "COMPARACION", "APLICACION_PRACTICA", "CALCULO", "DETALLE_DIFICIL", "RELACION_CONCEPTOS",
];

export const QUESTION_TYPE_LABELS = {
  LITERAL: "Literal",
  CONCEPTUAL: "Conceptual",
  CLASIFICACION: "Clasificación",
  COMPARACION: "Comparación",
  APLICACION_PRACTICA: "Aplicación práctica",
  CALCULO: "Cálculo o fórmula",
  DETALLE_DIFICIL: "Detalle difícil",
  RELACION_CONCEPTOS: "Relación de conceptos",
};

export const QUESTION_TYPE_DEFINITIONS = "Tipo de pregunta (question_type), según lo que mide: LITERAL, pregunta directamente por un dato, definición o frase del temario; CONCEPTUAL, mide si el alumno entiende una idea o concepto, no solo si lo ha memorizado; CLASIFICACION, pregunta por categorías, tipos, grupos, fases, niveles o partes de un procedimiento; COMPARACION, obliga a diferenciar entre dos o más conceptos parecidos; APLICACION_PRACTICA, plantea una situación concreta (por ejemplo, una actuación de bomberos) y exige aplicar el temario para resolverla; CALCULO, requiere resolver un problema, hacer cálculos, cambiar unidades o aplicar una fórmula; DETALLE_DIFICIL, pregunta por información muy específica (un dato de una tabla, una nota, una excepción o un apartado poco visible); RELACION_CONCEPTOS, combina varias partes del temario y exige relacionarlas para llegar a la respuesta.";

// Questions of each type in the teachers' tests of each level.
export const TEACHER_TYPE_COUNTS = {
  PRINCIPIANTE: { LITERAL: 108, CONCEPTUAL: 32, CLASIFICACION: 26, COMPARACION: 10, APLICACION_PRACTICA: 14, CALCULO: 0, DETALLE_DIFICIL: 10, RELACION_CONCEPTOS: 0 },
  ELITE: { LITERAL: 43, CONCEPTUAL: 35, CLASIFICACION: 15, COMPARACION: 8, APLICACION_PRACTICA: 16, CALCULO: 20, DETALLE_DIFICIL: 6, RELACION_CONCEPTOS: 7 },
  ALEATORIO: { LITERAL: 48, CONCEPTUAL: 11, CLASIFICACION: 7, COMPARACION: 0, APLICACION_PRACTICA: 0, CALCULO: 0, DETALLE_DIFICIL: 4, RELACION_CONCEPTOS: 0 },
};

// Calculations and relations of several concepts only appear in Élite (F and D). Calculations go to F and D
// (the curated rule «Preguntas de cálculo»); relations of concepts, to D only (QTH guide, level D).
const RESTRICTED = { CALCULO: ["FACIL", "DIFICIL"], RELACION_CONCEPTOS: ["DIFICIL"] };
const ONLY_DIFFICULT = Object.keys(RESTRICTED);
export const typeFitsDifficulty = (type, difficulty) => !RESTRICTED[type] || RESTRICTED[type].includes(difficulty);

// The question difficulties of each test level (server/src/utils/testLevels.js uses the short keys).
const LEVEL_DIFFICULTIES = { PRINCIPIANTE: ["PRINCIPIANTE"], ELITE: ["FACIL", "DIFICIL"], ALEATORIO: ["PRINCIPIANTE", "FACIL", "DIFICIL"] };

// Questions of each type for a number of questions of one level: the teachers' shares, rounded so they add
// up to the total (largest remainder; ties go to the more frequent type).
export function typeCountsForLevel(level, total, allowed = QUESTION_TYPES) {
  const teacher = Object.fromEntries(QUESTION_TYPES.map((type) => [type, allowed.includes(type) ? TEACHER_TYPE_COUNTS[level][type] : 0]));
  // Selected types the teachers never use in this level: equal shares among those this level can have.
  const fitting = allowed.filter((type) => LEVEL_DIFFICULTIES[level].some((difficulty) => typeFitsDifficulty(type, difficulty)));
  const counts = Object.values(teacher).some(Boolean) ? teacher
    : Object.fromEntries(QUESTION_TYPES.map((type) => [type, fitting.includes(type) ? 1 : 0]));
  const sample = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const exact = QUESTION_TYPES.map((type) => ({ type, value: (total * counts[type]) / sample, share: counts[type] }));
  const result = Object.fromEntries(exact.map(({ type, value }) => [type, Math.floor(value)]));
  let left = total - Object.values(result).reduce((sum, count) => sum + count, 0);
  for (const { type } of [...exact].sort((a, b) => (b.value % 1) - (a.value % 1) || b.share - a.share)) {
    if (left <= 0) break;
    result[type] += 1;
    left -= 1;
  }
  return result;
}

// The whole test: the mix of each level, added up. With only some types selected, each level keeps the teachers'
// proportions among them; if the teachers never use the selected types in that level, they share it equally.
export function typeTargets(levelCounts, allowed = QUESTION_TYPES) {
  const targets = Object.fromEntries(QUESTION_TYPES.map((type) => [type, 0]));
  for (const [level, total] of Object.entries(levelCounts)) {
    if (!total || !TEACHER_TYPE_COUNTS[level]) continue;
    for (const [type, count] of Object.entries(typeCountsForLevel(level, total, allowed))) targets[type] += count;
  }
  return targets;
}

// Why a selection of types cannot be generated, or null: every question difficulty of the test needs at least one
// selected type it can have (a calculation is never a P question, a relation of concepts is always D).
export function typeSelectionError(allowed, difficultyCounts) {
  const names = { P: "PRINCIPIANTE", F: "FACIL", D: "DIFICIL" };
  const labels = { P: "principiante", F: "fáciles", D: "difíciles" };
  const missing = Object.entries(difficultyCounts)
    .filter(([level, count]) => count > 0 && !allowed.some((type) => typeFitsDifficulty(type, names[level])))
    .map(([level]) => labels[level]);
  return missing.length
    ? `Con los tipos elegidos no se pueden hacer las preguntas ${missing.join(" ni las ")} del test: el cálculo solo existe en preguntas fáciles y difíciles (Élite y Aleatorio), y la relación de conceptos solo en las difíciles. Añade otro tipo o cambia los niveles.`
    : null;
}

// Questions of each type still missing in the test.
export const typesLeft = (targets, typeCounts) =>
  Object.fromEntries(QUESTION_TYPES.map((type) => [type, Math.max((targets[type] || 0) - (typeCounts.get(type) || 0), 0)]));

// «relax» lets a type go over its share when the source cannot give the missing ones (a calculation
// without figures), so a test is never blocked; a type never goes to a level it does not belong to.
export function typeErrors({ type, difficulty, targets, typeCounts, relax = false, allowed = null }) {
  // A type the user did not select is never accepted, not even when the quotas are relaxed.
  if (allowed && allowed.length < QUESTION_TYPES.length && !allowed.includes(type)) return ["TIPO_NO_SELECCIONADO"];
  if (!targets || !type) return [];
  if (!typeFitsDifficulty(type, difficulty)) return ["TIPO_NO_ADECUADO_AL_NIVEL"];
  if (!relax && typesLeft(targets, typeCounts)[type] <= 0) return ["TIPO_EXCEDIDO"];
  return [];
}

// The types of the next batch, in proportion to what is still missing and fits this level; the types only D
// can do go first. A batch is larger than the questions missing (spares), so its plan can repeat types.
export function batchTypePlan({ targets, typeCounts, difficulty, count }) {
  const left = typesLeft(targets, typeCounts);
  const fitting = QUESTION_TYPES.filter((type) => left[type] > 0 && typeFitsDifficulty(type, difficulty));
  const missing = fitting.reduce((sum, type) => sum + left[type], 0);
  if (!missing) return [];
  // What is missing, scaled to the batch (largest remainder, as for the whole test).
  const exact = fitting.map((type) => ({ type, value: (count * left[type]) / missing }));
  const plan = Object.fromEntries(exact.map(({ type, value }) => [type, Math.floor(value)]));
  // Calculations and relations of concepts can only come from some levels: never leave them out of those batches.
  for (const type of fitting.filter((type) => ONLY_DIFFICULT.includes(type))) plan[type] = Math.max(plan[type], 1);
  let free = count - Object.values(plan).reduce((sum, n) => sum + n, 0);
  for (const { type } of [...exact].sort((x, y) => (y.value % 1) - (x.value % 1) || left[y.type] - left[x.type])) {
    if (free <= 0) break;
    if (ONLY_DIFFICULT.includes(type) && plan[type] > Math.floor(exact.find((item) => item.type === type).value)) continue;
    plan[type] += 1;
    free -= 1;
  }
  return Object.entries(plan).filter(([, n]) => n > 0);
}

// Deals the types of a batch to its parallel parts, one by one, so every part gets a mix.
export function splitTypePlan(plan, partSizes) {
  if (!plan) return partSizes.map(() => null);
  const queue = plan.flatMap(([type, n]) => Array(n).fill(type));
  const parts = partSizes.map(() => ({}));
  let part = 0;
  for (const type of queue) {
    while (Object.values(parts[part]).reduce((sum, n) => sum + n, 0) >= partSizes[part]) part = (part + 1) % parts.length;
    parts[part][type] = (parts[part][type] || 0) + 1;
    part = (part + 1) % parts.length;
  }
  return parts.map((counts) => Object.entries(counts));
}

// What the generator is told: exactly how many questions of each type its batch (or part) must have.
export function formatTypePlan(plan) {
  if (!plan?.length) return "Los tipos de pregunta del test ya están cubiertos: usa el tipo que mejor encaje con el fragmento.";
  return `TIPOS DE PREGUNTA DE ESTE LOTE (siguen el reparto de las preguntas de los profesores de QTH): genera exactamente ${plan.map(([type, n]) => `${n} ${type}`).join(", ")}. Elige para cada pregunta un fragmento que permita ese tipo y escribe el tipo en question_type. Una pregunta de otro tipo se descarta.`;
}

export function typeInstruction({ targets, typeCounts, difficulty, count }) {
  if (!targets) return "";
  return formatTypePlan(batchTypePlan({ targets, typeCounts, difficulty, count }));
}
