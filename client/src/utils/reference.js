// The question already names the manual, so the review only shows the page and the section number
// before the explanation: «M1-Incendios-…-cap2.pdf - página 49 - apartado 1.4. Inhibición…» → «Página 49 - apartado 1.4».
export function shortReference(reference) {
  const text = String(reference || "");
  const page = text.match(/p[aá]gina\s*(\d+)/iu)?.[1];
  const section = text.match(/apartado\s+(\d+(?:\.\d+)*)/iu)?.[1];
  if (page || section) return [page && `Página ${page}`, section && `apartado ${section}`].filter(Boolean).join(" - ");
  // Anything else (a manual question with its own wording) is shown without the file name.
  return text.replace(/^.*?\.pdf\s*-\s*/iu, "").trim();
}

// Older explanations start with their own location («Pág. 23, apartado 3.2.3. Procesamiento…: La prioridad…»),
// which would repeat the reference shown just before.
export function explanationWithoutReference(explanation) {
  return String(explanation || "").replace(/^P[aá]g(?:ina|\.)?\s*\d+[^:]{0,140}:\s*/iu, "");
}
