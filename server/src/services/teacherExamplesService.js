import { readdir, readFile } from "node:fs/promises";
import { isGlobalOption, isNegativeQuestion, MAX_OPTION_WORD_GAP, optionWordGap, stripExplanationReference } from "../utils/questionValidation.js";

// The teachers' questions (quality_sources/preguntas_testor, private and outside Git) are the model to
// imitate: each batch receives a few of the same level, of varied types, with their explanation.
const rootUrl = new URL("../../../quality_sources/preguntas_testor/", import.meta.url);
// «principiante» are P questions and «elite» are D. «aleatorio» mixes levels: each of its questions
// is assigned a level with the criteria of the QTH guide (see guideLevel).
const FOLDERS = { principiante: "PRINCIPIANTE", elite: "DIFICIL", aleatorio: null };
// Types per level, in the order they are offered, following the teachers' mix.
const MIX = {
  PRINCIPIANTE: ["CORTA", "CORTA", "CIFRA", "NEGATIVA", "TODAS_NINGUNA", "AFIRMACIONES"],
  FACIL: ["CORTA", "CIFRA", "NEGATIVA", "TODAS_NINGUNA", "AFIRMACIONES", "CORTA"],
  DIFICIL: ["AFIRMACIONES", "CALCULO", "NEGATIVA", "AFIRMACIONES", "TODAS_NINGUNA", "CIFRA"],
};
const LETTERS = ["A", "B", "C", "D"];
const words = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;

// «Teoría del Fuego del CEIS Guadalajara.», «Manual 1 de Incendios de los CEIS.», «Según el CEIS de
// Guadalajara (Hidráulica),»…: the app adds its own source label, so the examples go without it.
export function cleanStem(text) {
  let stem = String(text || "").trim();
  for (let round = 0; round < 3; round++) {
    const next = stem
      .replace(/^[^.?¿]{0,90}\b(?:CEIS|Manual|Gu[ií]a)\b[^.?¿]{0,60}\.\s+/u, "")
      .replace(/^Seg[uú]n (?:el|la) [^,?¿]{0,90},\s*/iu, "")
      // «De acuerdo con el manual de … del CEIS Guadalajara,»: only when it names the source.
      .replace(/^(?:De acuerdo con|Conforme a)l?\s[^,?¿]{0,140}\b(?:CEIS|[Mm]anual|Gu[ií]a)\b[^,?¿]{0,60},\s*/u, "");
    if (next === stem) break;
    stem = next;
  }
  // Capitalise the first letter, also after «¿» or «¡».
  return stem.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase("es-ES"));
}

// Explanations lose their page reference (shown apart in the app) and the closing «Respuesta correcta la b)».
export function cleanExplanation(text) {
  return stripExplanationReference(String(text || ""))
    // What remains of the location on the page: «Izquierda.», «Derecha arriba:», «Izq abajo.»
    .replace(/^(?:izquierda|derecha|izq|dcha)\.?(?:\s+(?:arriba|abajo|mitad))?\s*[.:,]?\s*/iu, "")
    .replace(/\s*(?:La\s+)?respuesta\s+corr?ecta\s+(?:es\s+)?la\s+[a-d]\)?\s*\.?/giu, "")
    .replace(/\s*\b(?:pg|p[aá]g)\.?\s*\d+[^.\n]*$/iu, "")
    .trim();
}

// Answers are shuffled by the app, so examples that depend on letters or positions teach the wrong thing.
const LETTER_REFERENCE = /\b[a-d]\)\s*y\s*[a-d]\)|\banteriores\b|\b[A-D] y [A-D]\b|(?:opci[oó]n|respuesta)\s+[a-d]\b|\b[a-d]\)\s*(?:correcta|incorrecta)/iu;

// Teachers often write the negation in lowercase («¿Cuál no es…?»).
const NEGATIVE_LOWERCASE = /\bno\s+(?:es|son|corresponde|entra|forma|se considera|se trata)\b/iu;
const isNegative = (question) => isNegativeQuestion(question) || NEGATIVE_LOWERCASE.test(question.question);

export function classify(question) {
  const options = LETTERS.map((letter) => question[`option_${letter.toLowerCase()}`]);
  const content = options.filter((option) => !isGlobalOption(option));
  const medianWords = content.map(words).sort((a, b) => a - b)[content.length >> 1] || 0;
  if (options.some(isGlobalOption)) return "TODAS_NINGUNA";
  if (isNegative(question)) return "NEGATIVA";
  if (content.every((option) => /\d/u.test(option)) && /\d/u.test(question.question) && /calcul|cu[aá]nt|supong|ser[aá] (?:su|la|el)|convers|f[oó]rmula|presi[oó]n en bomba/iu.test(question.question)) return "CALCULO";
  if (content.every((option) => /\d/u.test(option))) return "CIFRA";
  return medianWords >= 8 ? "AFIRMACIONES" : "CORTA";
}

// QTH guide («Guia_mejorada_preguntas_test_QTH»): D asks for practical application, calculations,
// longer statements and very similar options; F for similar distractors, close figures and «ninguna es
// correcta»; P for direct questions on the basic structure with clearly discardable options.
const firstNumber = (text) => {
  const match = String(text || "").replace(/\.(?=\d{3}\b)/gu, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/u);
  return match ? Number(match[0]) : null;
};
export function guideLevel(example) {
  const options = LETTERS.map((letter) => example[`option_${letter.toLowerCase()}`]);
  const content = options.filter((option) => !isGlobalOption(option));
  const medianWords = content.map(words).sort((a, b) => a - b)[content.length >> 1] || 0;
  if (example.type === "CALCULO" || words(example.question) >= 28 || medianWords >= 10) return "DIFICIL";
  const correct = firstNumber(example[`option_${example.correct_answer.toLowerCase()}`]);
  const closeFigures = example.type === "CIFRA" && correct
    && content.every((option) => Math.abs(firstNumber(option) - correct) <= Math.abs(correct) * 0.5);
  if (closeFigures || similarOptions(content) || ["TODAS_NINGUNA", "NEGATIVA"].includes(example.type)) return "FACIL";
  return "PRINCIPIANTE";
}

// «Opciones demasiado parecidas» and «cambios mínimos de palabras» (guide, level P): two options that
// share most of their words, start the same way, or are single words with the same root.
function similarOptions(content) {
  const tokens = content.map((option) => String(option).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").split(/\s+/).filter(Boolean));
  const firstTwo = new Set(tokens.map((words) => words.slice(0, 2).join(" ")));
  if (firstTwo.size < content.length) return true;
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const [a, b] = [new Set(tokens[i]), new Set(tokens[j])];
      const shared = [...a].filter((word) => b.has(word)).length;
      if (Math.min(a.size, b.size) >= 3 && shared / new Set([...a, ...b]).size >= 0.6) return true;
      // Same root in the word that differs: «Aditivos/Adiciones», «Mezcla espumante/Mezcla espumosa».
      // A sibling list such as «Clase A/Clase B» is not similar: its differing words have no common root.
      const sameRoot = (x, y) => x.length >= 4 && y.length >= 4 && x.slice(0, 3) === y.slice(0, 3);
      if (a.size === 1 && b.size === 1 && sameRoot(tokens[i][0], tokens[j][0])) return true;
      if (tokens[i].length === 2 && tokens[j].length === 2 && tokens[i][0] === tokens[j][0] && sameRoot(tokens[i][1], tokens[j][1])) return true;
    }
  }
  return false;
}

// The «principiante» folder is P, except questions that the guide places in F (close figures or
// options that are too similar); «elite» is always D; «aleatorio» is classified entirely by the guide.
function levelFor(folderLevel, example) {
  if (folderLevel === "DIFICIL") return "DIFICIL";
  if (folderLevel === "PRINCIPIANTE") {
    const guide = guideLevel(example);
    const similar = guide === "FACIL" && !["TODAS_NINGUNA", "NEGATIVA"].includes(example.type);
    return similar ? "FACIL" : "PRINCIPIANTE";
  }
  return guideLevel(example);
}

function toExample(raw) {
  const question = {
    question: cleanStem(raw.pregunta),
    option_a: raw.opcionA, option_b: raw.opcionB, option_c: raw.opcionC, option_d: raw.opcionD,
    correct_answer: raw.respuestaCorrecta,
    explanation: cleanExplanation(raw.explicacion),
  };
  const options = LETTERS.map((letter) => question[`option_${letter.toLowerCase()}`]);
  if (!LETTERS.includes(question.correct_answer) || options.some((option) => !String(option || "").trim())) return null;
  // An explanation must explain: «Esparto (Stipa tenacísima).» teaches nothing.
  if (/p[aá]g(?:ina|\.)?\s*\d/iu.test(question.question) || words(question.explanation) < 8) return null;
  // Our rules forbid Todas/Ninguna in negative questions, and only accept those two wordings.
  if (options.some((option) => /^\s*(?:todos|ninguno)\b/iu.test(option))) return null;
  if (options.some(isGlobalOption) && isNegative(question)) return null;
  // Only examples that meet our own length rule, or they would teach the model to break it.
  if (optionWordGap(question) > MAX_OPTION_WORD_GAP) return null;
  if ([...options, question.explanation].some((text) => LETTER_REFERENCE.test(text))) return null;
  return { ...question, type: classify(question) };
}

let loading;
async function loadAll() {
  const examples = [];
  for (const [folderName, level] of Object.entries(FOLDERS)) {
    const folder = new URL(`${folderName}/json/`, rootUrl);
    try {
      const files = (await readdir(folder)).filter((name) => name.endsWith(".json") && !name.startsWith("."));
      for (const name of files) {
        const rows = JSON.parse(await readFile(new URL(name, folder), "utf8"));
        for (const example of rows.map(toExample).filter(Boolean)) {
          examples.push({ ...example, level: levelFor(level, example), folder: folderName });
        }
      }
    } catch (error) {
      // Without the private folder the generator still works, only without examples.
      if (error.code !== "ENOENT") console.warn(`No se pudieron leer las preguntas de los profesores (${folderName}): ${error.message}`);
    }
  }
  return examples;
}

export async function loadTeacherExamples(difficulty) {
  loading ||= loadAll();
  return (await loading).filter((example) => example.level === difficulty);
}

// Words of 5 letters or more, without accents: enough to tell a sanitary text from one on breathing apparatus.
const vocabulary = (text) => new Set(String(text || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
  .split(/[^a-z0-9]+/u).filter((word) => word.length >= 5));

// One example per slot of the level mix. Within each type, one of the three closest to the fragments of the batch
// (shared vocabulary), at random: examples on other subjects lent their facts (300-bar cylinders in a sanitary
// test) and those questions were rejected for having no support in the syllabus.
export function pickTeacherExamples(examples, difficulty, random = Math.random, contextText = "") {
  const context = vocabulary(contextText);
  const closeness = (example) => [...vocabulary(`${example.question} ${LETTERS.map((letter) => example[`option_${letter.toLowerCase()}`]).join(" ")}`)]
    .filter((word) => context.has(word)).length;
  const byType = new Map();
  for (const example of examples) {
    if (!byType.has(example.type)) byType.set(example.type, []);
    byType.get(example.type).push(example);
  }
  const chosen = [];
  for (const type of MIX[difficulty] || []) {
    const pool = (byType.get(type) || byType.get("CORTA") || []).filter((example) => !chosen.includes(example));
    if (!pool.length) continue;
    const ranked = context.size ? pool.map((example) => ({ example, score: closeness(example) })).sort((a, b) => b.score - a.score) : [];
    // Among those sharing some vocabulary; if none does, any of the type.
    const related = ranked.filter(({ score }) => score > 0).slice(0, 3).map(({ example }) => example);
    const closest = related.length ? related : pool;
    chosen.push(closest[Math.floor(random() * closest.length)]);
  }
  return chosen;
}

const TYPE_LABELS = {
  CORTA: "directa, opciones cortas", CIFRA: "cifra", NEGATIVA: "en negativo", TODAS_NINGUNA: "con Todas/Ninguna",
  AFIRMACIONES: "cuatro afirmaciones", CALCULO: "cálculo o supuesto",
};
export function formatTeacherExamples(examples) {
  if (!examples.length) return "Sin ejemplos disponibles.";
  return examples.map((example, index) => [
    `Ejemplo ${index + 1} (${TYPE_LABELS[example.type]}): ${example.question}`,
    ...LETTERS.map((letter) => `- ${example[`option_${letter.toLowerCase()}`]}${letter === example.correct_answer ? "   ← válida" : ""}`),
    `Explicación: ${example.explanation}`,
  ].join("\n")).join("\n\n");
}
