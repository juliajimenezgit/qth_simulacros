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
