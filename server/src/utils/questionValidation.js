import { randomInt } from 'node:crypto';

export const LETTERS = ['A', 'B', 'C', 'D'];
export const optionKey = letter => `option_${letter.toLowerCase()}`;
export const normalizedText = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const coverageKey = chunk => {
  const section = normalizedText(chunk.section) || 'apartado no identificado';
  const chapter = normalizedText(chunk.chapter);
  return chapter && chapter !== 'no identificado' ? `${chapter} / ${section}` : section;
};
export const FORMATS = ['DIRECTA', 'CORRECTA', 'INCORRECTA', 'CLASIFICACION', 'CIFRA', 'FORMULA', 'COMPARACION', 'TODAS_NINGUNA'];

// «Todas son correctas» / «Ninguna es correcta»: short by nature, so they are left out of the length check.
const GLOBAL_OPTION = /^\s*[«"']?\s*(?:todas|ninguna)\b/iu;
export const isGlobalOption = text => GLOBAL_OPTION.test(String(text || ''));
export const hasGlobalOption = question => LETTERS.some(letter => isGlobalOption(question[optionKey(letter)]));

// Teachers' reference: options of similar length so the answer is not given away by its size.
export const MAX_OPTION_WORD_GAP = 5;
const wordCount = text => String(text || '').trim().split(/\s+/u).filter(Boolean).length;
export const optionWordCounts = question => Object.fromEntries(LETTERS.map(letter => [letter, wordCount(question[optionKey(letter)])]));
export function optionWordGap(question) {
  const counts = LETTERS.map(letter => question[optionKey(letter)]).filter(option => !isGlobalOption(option)).map(wordCount);
  return counts.length ? Math.max(...counts) - Math.min(...counts) : 0;
}

// At least this share of each test asks for the INCORRECTA or offers Todas/Ninguna.
export const INVERTED_FORMATS = ['INCORRECTA', 'TODAS_NINGUNA'];
export const MIN_INVERTED_SHARE = 0.3;
// Negative stems are written in capitals («Señala la INCORRECTA», «¿Cuál NO es…?»); «incorrecta/falsa» in any case.
const NEGATIVE_STEM = /\bincorrect[ao]s?\b|\bfals[ao]s?\b/iu;
const NEGATIVE_CAPS = /\b(?:NO|EXCEPTO|SALVO)\b/u;
export const isNegativeQuestion = question => NEGATIVE_STEM.test(question.question || '') || NEGATIVE_CAPS.test(question.question || '');
// Detected from the text when possible, so the model's own classification cannot hide a format from the caps.
export const questionFormat = (question, format) => {
  if (isNegativeQuestion(question)) return 'INCORRECTA';
  return hasGlobalOption(question) ? 'TODAS_NINGUNA' : format;
};

// Teachers' tests mix formats; INCORRECTA stays around 20% (capped at 25%) and Todas/Ninguna at 15%.
// Only these two caps are enforced, because they are detected from the text: the other formats are
// labelled by the model itself, and capping them blocked ordinary questions once a label was exhausted.
// For those, the 40% share is guidance in the prompt.
export const MAX_FORMAT_SHARE = 0.4;
const ENFORCED_CAPS = { INCORRECTA: 0.25, TODAS_NINGUNA: 0.15 };
export function formatCap(format, count) {
  if (count < 4 || !ENFORCED_CAPS[format]) return Infinity;
  return Math.max(1, Math.floor(count * ENFORCED_CAPS[format]));
}

// About a third of the Todas/Ninguna questions have that option as the valid answer. Tracked apart from
// the formats, which sum to the saved questions.
export const GLOBAL_ANSWER_KEY = 'TODAS_NINGUNA_CORRECTA';
export const hasGlobalAnswer = question => isGlobalOption(question[optionKey(question.correct_answer)]);
export const maxGlobalAnswers = count => (count < 4 ? Infinity : Math.ceil(formatCap('TODAS_NINGUNA', count) / 3));

// Guarantees the INCORRECTA/Todas/Ninguna minimum without another generation: in an approved question the
// valid answer is among the options, so replacing one distractor with «Ninguna es correcta.» keeps it valid.
// Prefer a distractor the explanation does not mention, then the one that best balances the lengths.
export function withNoneOption(question) {
  const explanation = normalizedText(question.explanation);
  const mentioned = letter => explanation.includes(normalizedText(question[optionKey(letter)]).replace(/[.;:]+$/u, ''));
  const [letter] = LETTERS.filter(candidate => candidate !== question.correct_answer)
    .map(candidate => ({ candidate, gap: optionWordGap({ ...question, [optionKey(candidate)]: 'Ninguna es correcta.' }) }))
    .sort((a, b) => Number(mentioned(a.candidate)) - Number(mentioned(b.candidate)) || a.gap - b.gap)
    .map(({ candidate }) => candidate);
  return {
    ...question,
    [optionKey(letter)]: 'Ninguna es correcta.',
    explanation: `${question.explanation.trim()} «Ninguna es correcta» no es válida porque la respuesta correcta figura entre las opciones.`,
  };
}

export function invertedQuota(formatCounts, count) {
  const saved = FORMATS.reduce((sum, format) => sum + (formatCounts.get(format) || 0), 0);
  const inverted = INVERTED_FORMATS.reduce((sum, format) => sum + (formatCounts.get(format) || 0), 0);
  // Same threshold as the format cap: very short tests are not forced into a format. With 7 or 11
  // questions both caps together fall short of 30%: the explicit maxima win.
  const capped = INVERTED_FORMATS.reduce((sum, format) => sum + formatCap(format, count), 0);
  const required = count >= 4 ? Math.min(Math.ceil(count * MIN_INVERTED_SHARE), capped) : 0;
  return { missing: Math.max(required - inverted, 0), remaining: Math.max(count - saved, 0), required, inverted };
}

// References to option positions would change meaning when options are shuffled.
// Letters after a category noun («fuegos de clase A y B», «tipo C») are content, not positions.
const NOT_CATEGORY = String.raw`(?<!\b(?:[Cc]lases?|[Tt]ipos?|[Gg]rupos?|[Cc]ategor[ií]as?|[Nn]iveles?|[Zz]onas?|[Ff]ases?|[Ff]uegos?|[Aa]nexos?|[Vv]itaminas?)\s+(?:de\s+)?)`;
const LETTER_LIST = String.raw`[ABCD](?:\s*(?:,|y|e|o|u)\s*[ABCD])*`;
const LETTER_REFERENCE = new RegExp([
  String.raw`\b(?:[Oo]pci[oó]n(?:es)?|[Rr]espuestas?|[Aa]lternativas?)\s+["'«(]?\s*${LETTER_LIST}\b`,
  String.raw`${NOT_CATEGORY}\b[ABCD](?:\s*(?:,|y|e|o|u)\s*[ABCD])+\b`,
  String.raw`${NOT_CATEGORY}\b[ABCD]\b(?=\s*(?:es|son)\s+(?:correct|incorrect|verdader|fals))`,
].join('|'), 'u');
const GLOBAL_REFERENCE = /\b(?:todas|ninguna|ambas|las|los)\s+(?:las\s+|los\s+)?anteriores\b|\b(?:primera|segunda|tercera|cuarta|[uú]ltima)\s+(?:opci[oó]n|alternativa)/iu;

export function positionalReference(text) {
  const value = String(text || '');
  return value.match(LETTER_REFERENCE)?.[0] || value.match(GLOBAL_REFERENCE)?.[0] || null;
}

export function hasPositionalReferences(text) {
  return positionalReference(text) !== null;
}

// Explanations may name options by letter («la opción B», «B, C y D son incorrectas»).
// Replace each letter with the option's content so the explanation survives shuffling.
export function replaceLetterReferences(text, question) {
  const label = letter => `«${String(question[optionKey(letter)] || '').trim().replace(/[.;:]+$/u, '')}»`;
  return String(text || '').replace(new RegExp(LETTER_REFERENCE.source, 'gu'),
    match => match.replace(/\b[ABCD]\b/gu, label));
}

// The reference is shown apart from the explanation, so a leading location is removed:
// «Pág. 54, 2.4.1. Nitrógeno n2: Es un gas…», «Página 43 7. Evolución de incendios. Se definen…»,
// «Pág. 87, 1.1. Desarrollo genérico\nEl incendio…», «Apartado 1.2. Densidad: …».
const LEADING_LOCATION = /^\s*(?:p[aá]g(?:ina|\.)?\s*\d+|apartado\b)/iu;
export function stripExplanationReference(text) {
  const value = String(text || '');
  if (!LEADING_LOCATION.test(value)) return value;
  const [firstLine] = value.split('\n');
  const colon = firstLine.indexOf(':');
  let rest;
  // A colon ends the location only if no sentence ended before it («incendios. Se definen cuatro fases:»).
  if (colon > 0 && colon <= 160 && !/\p{L}\.\s+\p{Lu}/u.test(firstLine.slice(0, colon))) rest = value.slice(colon + 1);
  else if (firstLine.length <= 160 && value.length > firstLine.length) rest = value.slice(firstLine.length + 1);
  else {
    // «Página 43 7. Evolución de incendios. Se definen…»: drop the page, the section number and its title.
    rest = value.replace(/^\s*(?:p[aá]g(?:ina|\.)?\s*\d+\s*[,.;-]?\s*)?(?:apartado\s*)?/iu, '')
      .replace(/^\d+(?:\.\d+)*\.?\s+[^.\n]{0,100}\.\s*/u, '');
  }
  rest = rest.trim();
  return rest ? rest[0].toLocaleUpperCase('es-ES') + rest.slice(1) : value;
}

// The model often cites the page printed in the manual; the verified fragment knows the PDF page.
export function alignExplanationPages(text, chunk) {
  const pagePattern = /\b(p[aá]g(?:ina|\.)?\s*)(\d+)/giu;
  if (chunk?.page) return String(text || '').replace(pagePattern, (_, prefix) => `${prefix}${chunk.page}`);
  return String(text || '').replace(/[,;]?\s*\(?\bp[aá]g(?:ina|\.)?\s*\d+\)?/giu, '');
}

export function sourceReference(document, chunk) {
  return `${document.original_filename} - página ${chunk.page || 'No identificada'} - apartado ${chunk.section || 'No identificado'}`;
}

export function enrichChapters(chunks) {
  const chapters = new Map();
  let chapter = 'No identificado';
  for (const chunk of [...chunks].sort((a, b) => (a.page || Infinity) - (b.page || Infinity) || (new Date(a.created_at || 0) - new Date(b.created_at || 0)) || a.id.localeCompare(b.id))) {
    if (/^tema\s+(?:\d+|[IVXLCDM]+)\b/iu.test(String(chunk.section || ''))) chapter = 'No identificado';
    const heading = [chunk.section, ...chunk.text.split('\n')].filter(line => String(line || '').length < 160).find(line => /^cap[ií]tulo\s+(?:\d+|[IVXLCDM]+)\b/iu.test(String(line || '').trim()));
    if (heading) chapter = heading.trim();
    chapters.set(chunk.id, chapter);
  }
  return chunks.map(chunk => ({ ...chunk, chapter: chapters.get(chunk.id) }));
}

export function spreadSections(chunks) {
  const groups = new Map();
  for (const chunk of chunks) {
    const key = coverageKey(chunk);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chunk);
  }
  const result = [];
  while (result.length < chunks.length) {
    for (const group of groups.values()) if (group.length) result.push(group.shift());
  }
  return result;
}

export function validateCandidate(question, { difficulty, contextChunks }) {
  const errors = [];
  if (question.difficulty !== difficulty) errors.push('DIFICULTAD_INCORRECTA');
  const options = LETTERS.map(letter => question[optionKey(letter)]);
  if (new Set(options.map(normalizedText)).size !== 4 || options.some(option => !option.trim())) errors.push('OPCIONES_REPETIDAS_O_VACIAS');
  if (optionWordGap(question) > MAX_OPTION_WORD_GAP) errors.push('OPCIONES_LONGITUD_DESIGUAL');
  // Todas/Ninguna always goes in D, so a question can only have one.
  if (options.filter(isGlobalOption).length > 1) errors.push('VARIAS_OPCIONES_DE_CONJUNTO');
  if ([question.question, question.explanation, ...options].some(hasPositionalReferences)) errors.push('OPCIONES_DEPENDIENTES_DE_POSICION');
  const chunk = contextChunks.find(item => item.id === question.source_chunk_id);
  if (!chunk) errors.push('FRAGMENTO_NO_AUTORIZADO');
  else {
    const pages = [...question.explanation.matchAll(/p[aá]g(?:ina|\.)?\s*(\d+)/giu)].map(match => Number(match[1]));
    if (pages.some(page => page !== Number(chunk.page))) errors.push('PAGINA_EXPLICACION_INCORRECTA');
  }
  return { errors, chunk };
}

// Distribution is a preference, not a content defect: only block a section that is already clearly
// over-represented, a format that already reached its cap, or a non-inverted question once the remaining
// slots are all needed for the INCORRECTA/Todas/Ninguna minimum.
// relaxCoverage: in the last attempts spreading across sections must not make the test fail.
export function distributionErrors({ chunk, format, sectionCounts, formatCounts, availableSections, count, relaxCoverage = false, globalAnswer = false }) {
  const errors = [];
  const minimum = Math.min(...availableSections.map(section => sectionCounts.get(section) || 0));
  if (!relaxCoverage && (sectionCounts.get(coverageKey(chunk)) || 0) > minimum + 1) errors.push('COBERTURA_REPETIDA');
  if (format && (formatCounts.get(format) || 0) >= formatCap(format, count)) errors.push('FORMATO_EXCEDIDO');
  if (globalAnswer && (formatCounts.get(GLOBAL_ANSWER_KEY) || 0) >= maxGlobalAnswers(count)) errors.push('TODAS_NINGUNA_CORRECTA_EXCEDIDA');
  const { missing, remaining } = invertedQuota(formatCounts, count);
  if (missing > 0 && missing >= remaining && !INVERTED_FORMATS.includes(format)) errors.push('CUOTA_NEGATIVAS_PENDIENTE');
  return errors;
}

function shuffle(values, random = randomInt) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Todas/Ninguna always goes in D, as in the teachers' tests. A question whose valid answer is that option
// must get D; one where it is a distractor cannot get D.
function allowedTargets(question) {
  if (!LETTERS.some(letter => isGlobalOption(question[optionKey(letter)]))) return LETTERS;
  return hasGlobalAnswer(question) ? ['D'] : ['A', 'B', 'C'];
}

export function balanceAnswers(questions, random = randomInt) {
  const extras = shuffle(LETTERS, random);
  const slots = extras.flatMap((letter, index) => Array(Math.floor(questions.length / 4) + (index < questions.length % 4 ? 1 : 0)).fill(letter));
  const allowed = questions.map(allowedTargets);
  const fits = (targets, index) => allowed[index].includes(targets[index]);
  let targets;
  const patterned = sequence => /(.)\1\1|(..)\2\2|(.{4})\3/u.test(sequence);
  for (let attempt = 0; attempt < 1000; attempt++) {
    targets = [];
    let remaining = [...slots];
    while (remaining.length) {
      const choices = remaining.filter(letter => !patterned([...targets, letter].join('')));
      if (!choices.length) break;
      const letter = choices[random(choices.length)];
      targets.push(letter);
      remaining.splice(remaining.indexOf(letter), 1);
    }
    if (remaining.length) continue;
    // Keep the balance: swap letters between questions until the Todas/Ninguna constraints hold.
    for (let index = 0; index < targets.length; index++) {
      if (fits(targets, index)) continue;
      const swap = targets.findIndex((letter, other) => allowed[index].includes(letter) && allowed[other].includes(targets[index]));
      if (swap >= 0) [targets[index], targets[swap]] = [targets[swap], targets[index]];
    }
    if (targets.every((_, index) => fits(targets, index)) && !patterned(targets.join(''))) break;
    if (attempt === 999) {
      // Too many constrained questions for an even split: the D rule wins over the balance.
      targets = targets.map((letter, index) => (fits(targets, index) ? letter : allowed[index][random(allowed[index].length)]));
    }
  }
  if (targets.length !== questions.length) throw new Error('No se encontró una distribución sin patrones');
  return questions.map((question, index) => {
    if ([question.question, question.explanation, ...LETTERS.map(letter => question[optionKey(letter)])].some(hasPositionalReferences)) throw new Error('No se pueden mezclar opciones con referencias de posición');
    const correct = question[optionKey(question.correct_answer)];
    const distractors = LETTERS.filter(letter => letter !== question.correct_answer).map(letter => question[optionKey(letter)]);
    const global = distractors.find(isGlobalOption);
    const others = shuffle(distractors.filter(option => option !== global), random);
    const target = targets[index];
    const result = { ...question, correct_answer: target };
    for (const letter of LETTERS) {
      result[optionKey(letter)] = letter === target ? correct : global && letter === 'D' ? global : others.pop();
    }
    if (result[optionKey(result.correct_answer)] !== correct) throw new Error('Respuesta desalineada');
    return result;
  });
}
