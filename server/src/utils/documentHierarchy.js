// The syllabus is split into manual → theme → chapter, named «M1-Incendios-v6-00-completo.pdf»,
// «M1-Incendios-v6-01-teoriaFuego.pdf», «M1-Incendios-v6-01-teoriaFuego-cap1.pdf» (same rule as the client).
function hierarchy(document) {
  const match = (document.original_filename || "").normalize("NFC").match(/^(M\d+)[-_].+?[-_]v\d+(?:\.\d+)*[-_](\d+)[-_]/i);
  return match ? { manual: match[1].toUpperCase(), topic: Number(match[2]) } : null;
}

// Whether «child» is part of «parent»: a theme or chapter of a manual, or a chapter of a theme.
export function isDescendant(parent, child) {
  const a = hierarchy(parent);
  const b = hierarchy(child);
  if (!a || !b || a.manual !== b.manual) return false;
  return parent.content_type === "MANUAL"
    ? ["TEMA", "CAPITULO"].includes(child.content_type)
    : parent.content_type === "TEMA" && child.content_type === "CAPITULO" && a.topic === b.topic;
}

// A selected PDF that is part of another selected one: they share content and would repeat questions.
export const overlappingDocuments = (documents) =>
  documents.filter((child) => documents.some((parent) => parent !== child && isDescendant(parent, child)));
