// What each question measures, as the reviewer classified it (server/src/utils/questionTypes.js).
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

// What each type measures (QTH guide), shown when choosing the types of a test.
export const QUESTION_TYPE_DESCRIPTIONS = {
  LITERAL: "Pregunta directamente por un dato, definición o frase del temario. Es especialmente habitual en niveles P y F.",
  CONCEPTUAL: "Mide si el alumno entiende una idea o concepto, no solo si lo ha memorizado.",
  CLASIFICACION: "Pregunta por categorías, tipos, grupos, fases, niveles o partes de un procedimiento.",
  COMPARACION: "Obliga al alumno a diferenciar entre dos o más conceptos parecidos.",
  APLICACION_PRACTICA: "Plantea una situación concreta y exige aplicar el temario para resolverla. Especialmente útil para la actuación de bomberos.",
  CALCULO: "Requiere resolver un problema, realizar cálculos, cambiar unidades o aplicar una fórmula. Solo en preguntas fáciles y difíciles (Élite y Aleatorio).",
  DETALLE_DIFICIL: "Pregunta por información muy específica: un dato de una tabla, nota, excepción o apartado poco visible.",
  RELACION_CONCEPTOS: "Combina varias partes del temario y exige relacionarlas para llegar a la respuesta. Solo en preguntas difíciles (Élite y Aleatorio).",
};

// Why the selected types cannot fill the selected levels, or "" (the server checks the exact split).
export function typeSelectionWarning(types, levelCounts) {
  const onlyRestricted = types.every((type) => ["CALCULO", "RELACION_CONCEPTOS"].includes(type));
  const onlyRelation = types.every((type) => type === "RELACION_CONCEPTOS");
  if (!types.length) return "Elige al menos un tipo de pregunta.";
  if (onlyRestricted && (levelCounts.PRINCIPIANTE > 0 || levelCounts.ALEATORIO > 0)) {
    return "Las preguntas de Principiante (y las de nivel principiante de Aleatorio) no pueden ser de cálculo ni de relación de conceptos: añade otro tipo.";
  }
  if (onlyRelation && (levelCounts.ELITE > 0 || levelCounts.ALEATORIO > 0)) {
    return "La relación de conceptos solo existe en preguntas difíciles: Élite y Aleatorio también tienen preguntas fáciles. Añade otro tipo.";
  }
  return "";
}

// The question difficulties of each test level, and the ones each restricted type needs.
const LEVEL_DIFFICULTIES = { PRINCIPIANTE: ["P"], ELITE: ["F", "D"], ALEATORIO: ["P", "F", "D"] };
const TYPE_DIFFICULTIES = { CALCULO: ["F", "D"], RELACION_CONCEPTOS: ["D"] };

// The types the selected levels can have: with only Principiante, no calculations or relations of concepts.
export function availableTypes(levelCounts) {
  const present = new Set(Object.entries(levelCounts).filter(([, count]) => count > 0).flatMap(([level]) => LEVEL_DIFFICULTIES[level] || []));
  return Object.keys(QUESTION_TYPE_LABELS).filter((type) => !TYPE_DIFFICULTIES[type] || TYPE_DIFFICULTIES[type].some((level) => present.has(level)));
}
