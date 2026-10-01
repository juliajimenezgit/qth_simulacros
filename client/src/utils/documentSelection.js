function hierarchy(document) {
  const match = (document.original_filename || '').normalize('NFC').match(/^(M\d+)[-_].+?[-_]v\d+(?:\.\d+)*[-_](\d+)[-_]/i);
  return match ? { manual: match[1].toUpperCase(), topic: Number(match[2]) } : null;
}

export function isDescendant(parent, child) {
  const a = hierarchy(parent);
  const b = hierarchy(child);
  if (!a || !b || a.manual !== b.manual) return false;
  return parent.content_type === 'MANUAL'
    ? ['TEMA', 'CAPITULO'].includes(child.content_type)
    : parent.content_type === 'TEMA' && child.content_type === 'CAPITULO' && a.topic === b.topic;
}

// Questions come from exactly what the user selects: a complete manual, a theme or a chapter. A PDF and another
// one that contains it (its theme or its manual) are never selected together: they share content, and generating
// from both gave duplicated questions.
export function selectedAncestor(documents, selectedIds, document) {
  return documents.find((item) => selectedIds.includes(item.id) && isDescendant(item, document)) || null;
}

// Selecting a PDF unselects the ones it contains; a PDF inside a selected one cannot be selected.
export function toggleSource(documents, selectedIds, document) {
  if (selectedIds.includes(document.id)) return selectedIds.filter((id) => id !== document.id);
  if (selectedAncestor(documents, selectedIds, document)) return selectedIds;
  const contained = new Set(documents.filter((item) => isDescendant(document, item)).map((item) => item.id));
  return [...selectedIds.filter((id) => !contained.has(id)), document.id];
}
