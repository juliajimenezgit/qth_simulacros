// «M1-Incendios-v6-01-teoriaFuego-cap2.pdf» → manual «incendios», topic «teoriafuego».
const FILENAME = /^m\d+[-_](.+?)[-_]v\d+(?:\.\d+)*[-_]\d+[-_](.+?)(?:[-_]cap(?:[ií]tulo)?[-_]*\d+)?\.pdf$/iu;
const slug = (value) => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function names(document) {
  const match = String(document.original_filename || '').normalize('NFC').match(FILENAME);
  if (!match) {
    const fallback = slug(document.display_title || document.original_filename?.replace(/\.pdf$/i, ''));
    return { manual: fallback, topic: fallback };
  }
  const manual = slug(match[1]);
  // The complete manual has no topic of its own.
  return { manual, topic: /^completo$/i.test(match[2]) ? manual : slug(match[2]) };
}

// Suggested test name: the manual (or topic) of the selected documents and the time, e.g. «teoriafuego_1251».
export function suggestTestName(documents, date = new Date()) {
  const parsed = documents.map(names);
  const topics = [...new Set(parsed.map(({ topic }) => topic).filter(Boolean))];
  const manuals = [...new Set(parsed.map(({ manual }) => manual).filter(Boolean))];
  // Several topics of one manual are named after the manual; different manuals are joined.
  const base = topics.length <= 1 ? topics[0] : manuals.join('-');
  const time = `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`;
  return base ? `${base}_${time}` : `test_${time}`;
}
