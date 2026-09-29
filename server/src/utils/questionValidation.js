import { randomInt } from 'node:crypto';

export const LETTERS = ['A', 'B', 'C', 'D'];
export const optionKey = letter => `option_${letter.toLowerCase()}`;
export const normalizedText = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const coverageKey = chunk => {
  const section = normalizedText(chunk.section) || 'apartado no identificado';
  const chapter = normalizedText(chunk.chapter);
  return chapter && chapter !== 'no identificado' ? `${chapter} / ${section}` : section;
};
export const FORMATS = ['DIRECTA', 'CORRECTA', 'INCORRECTA', 'CLASIFICACION', 'CIFRA', 'FORMULA', 'COMPARACION'];

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
// over-represented. Format variety is requested in the prompt but never rejects a valid question.
export function distributionErrors({ chunk, sectionCounts, availableSections }) {
  const errors = [];
  const minimum = Math.min(...availableSections.map(section => sectionCounts.get(section) || 0));
  if ((sectionCounts.get(coverageKey(chunk)) || 0) > minimum + 1) errors.push('COBERTURA_REPETIDA');
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

export function balanceAnswers(questions, random = randomInt) {
  const extras = shuffle(LETTERS, random);
  const slots = extras.flatMap((letter, index) => Array(Math.floor(questions.length / 4) + (index < questions.length % 4 ? 1 : 0)).fill(letter));
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
    if (!remaining.length) break;
    if (attempt === 999) throw new Error('No se encontró una distribución sin patrones');
  }
  return questions.map((question, index) => {
    if ([question.question, question.explanation, ...LETTERS.map(letter => question[optionKey(letter)])].some(hasPositionalReferences)) throw new Error('No se pueden mezclar opciones con referencias de posición');
    const correct = question[optionKey(question.correct_answer)];
    const others = shuffle(LETTERS.filter(letter => letter !== question.correct_answer).map(letter => question[optionKey(letter)]), random);
    const target = targets[index];
    const result = { ...question, correct_answer: target };
    for (const letter of LETTERS) result[optionKey(letter)] = letter === target ? correct : others.pop();
    if (result[optionKey(result.correct_answer)] !== correct) throw new Error('Respuesta desalineada');
    return result;
  });
}
