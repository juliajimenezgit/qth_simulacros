import { normalizeFilename, normalizeUnicode } from "./unicode.js";

export function containsCategoryReference(text) {
  return /\b(?:cap[ií]tulo|tema|manual)\s+(?:\d+|[IVXLCDM]+)\b|\bM\d+[-_]\S+\.pdf\b/iu.test(text);
}

export function formatCeisSourceLabel(displayTitle, originalFilename) {
  const title = normalizeUnicode(displayTitle || "")
    .trim()
    .replace(/[.;:]+$/u, "")
    .replace(/^(?:(?:cap[ií]tulo|tema|manual)\s+(?:\d+|[IVXLCDM]+)\s*[.·:–-]?\s*)+/iu, "");
  const fallback = normalizeFilename(originalFilename)
    .replace(/[-_ ]cap(?:[ií]tulo)?[-_ ]*\d+(?=\.pdf$)/i, "")
    .replace(/\.pdf$/i, "")
    .replace(/^.*-\d{2}-/, "")
    .replace(/([a-záéíóúüñ])([A-ZÁÉÍÓÚÜÑ])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  const readable = title || fallback;
  const normalized = readable
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/g, " ")
    .trim();
  const canonicalTitles = [
    [/urgencias traumaticas|\btrauma\b/, "Urgencias Traumáticas"],
    [/mecanica.*conduccion.*4x4|vehiculos.*mecanica/, "Mecánica y Conducción 4x4"],
    [/incendios de vegetacion|vegetacion/, "Incendios de Vegetación"],
    [/soporte vital/, "Soporte Vital"],
    [/teoria del fuego|teoriafuego/, "Teoría del Fuego"],
    [/riesgo electrico/, "Riesgo Eléctrico"],
    [/\bnrbq\b/, "NRBQ"],
    [/hidraulica/, "Hidráulica"],
    [/incendios estructurales/, "Incendios Estructurales"],
    [/proteccion respiratoria|epis.*vias respiratorias/, "EPIs Vías Respiratorias"],
    [/bombas centrifugas/, "Bombas Centrífugas"],
    [/edificaciones/, "Edificaciones"],
    [/urgencias medicas/, "Urgencias Médicas"],
  ];
  const canonical = canonicalTitles.find(([pattern]) => pattern.test(normalized));
  const baseTitle = canonical?.[1] || readable
    .replace(/\s+(?:del\s+)?CEIS(?:\s+(?:de\s+)?Guadalajara)?$/i, "")
    .trim();
  return `${baseTitle} del CEIS Guadalajara`;
}

export function stripSourcePrefix(question, previousTitle) {
  const title = normalizeUnicode(previousTitle || "").trim().replace(/[.?!:;]+$/u, "");
  if (!title || !question.toLocaleLowerCase("es-ES").startsWith(title.toLocaleLowerCase("es-ES"))) {
    return question;
  }
  return question.slice(title.length).replace(/^[.?!:;\s-]+/u, "").trim();
}

export function stripLegacyCeisPrefix(question) {
  return question
    .replace(
      /^[^?\n]{2,100}\s+(?:del\s+CEIS\s+Guadalajara|CEIS)[.;]\s+/iu,
      "",
    )
    .trim();
}

// The section («2.3.1. Especificaciones», «Según el apartado 3.2 El proceso,») belongs to the
// explanation and the reference, never to the question text.
const SECTION_NUMBER = String.raw`\d+(?:\.\d+)*\.?`;
const LEADING_SECTION_REFERENCE = new RegExp(
  String.raw`^(?:(?:seg[uú]n|conforme\s+a|de\s+acuerdo\s+con)\s+(?:el\s+)?(?:manual\b[^,¿?]{0,160},\s*)?(?:el\s+)?|en\s+el\s+)?apartado\s+${SECTION_NUMBER}(?:\s*[^,¿?]{0,120}?)?,\s*`,
  "iu",
);
const LEADING_SECTION_HEADING = new RegExp(String.raw`^${SECTION_NUMBER}\s+[^.?¿!:]{1,120}?[.:]\s+`, "u");

const comparable = value => normalizeUnicode(String(value || ""))
  .normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("es-ES")
  .replace(new RegExp(`^${SECTION_NUMBER}\\s*`, "u"), "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// A bare heading before the question («Gases. ¿…?»): at most four words and no verb, so a
// real statement («Un incendio se declara en un sótano. ¿…?») is never removed.
const SENTENCE_VERB = /\b(?:es|son|era|fue|se|esta|estan|hay|ha|han|tiene|tienen|debe|deben|puede|pueden|llega|llegan|produce|declara|encuentra|observa|recibe|dispone|realiza|actua|trabaja)\b/u;
const LEADING_HEADING = /^([^.?¿!:\d]{1,80})\.\s+(?=¿)/u;

export function stripSectionReference(question, sectionTitle = "") {
  const original = String(question || "").trim();
  let text = original;
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(LEADING_SECTION_REFERENCE, "").replace(LEADING_SECTION_HEADING, "").trim();
    const heading = text.match(LEADING_HEADING)?.[1];
    if (heading) {
      const words = comparable(heading);
      const isSection = words && words === comparable(sectionTitle);
      const isShortHeading = words.split(" ").length <= 4 && !SENTENCE_VERB.test(words);
      if (isSection || isShortHeading) text = text.slice(text.match(LEADING_HEADING)[0].length).trim();
    }
  }
  if (text === original) return original;
  return text.replace(/^(¿?\s*)(\p{Ll})/u, (_, lead, letter) => `${lead}${letter.toLocaleUpperCase("es-ES")}`);
}
