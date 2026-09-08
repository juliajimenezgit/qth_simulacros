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

export function toggleDocumentSelection(documents, selectedIds, document) {
  const available = documents.filter((item) => item.status === 'AVAILABLE');
  const branch = available.filter((item) => item.id === document.id || isDescendant(document, item));
  const next = new Set(selectedIds);
  if (next.has(document.id)) {
    branch.forEach((item) => next.delete(item.id));
  } else {
    branch.forEach((item) => next.add(item.id));
  }
  return [...next];
}
