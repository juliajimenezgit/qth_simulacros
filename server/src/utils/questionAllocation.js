import { HttpError } from "./errors.js";

export function buildDocumentJobs(documents, documentCounts, contentCounts, difficultyCounts) {
  const totals = { MANUAL: 0, TEMA: 0, CAPITULO: 0 };
  if (Object.keys(documentCounts).some((id) => !documents.some((document) => document.id === id))) {
    throw new HttpError(400, "El reparto incluye documentos no seleccionados");
  }
  for (const document of documents) totals[document.content_type] += documentCounts[document.id] || 0;
  if (Object.keys(totals).some((type) => totals[type] !== contentCounts[type])) {
    throw new HttpError(400, "El reparto por documento no coincide con el reparto por contenido");
  }
  const levels = { P: "PRINCIPIANTE", F: "FACIL", D: "DIFICIL" };
  const remaining = { ...difficultyCounts };
  const jobs = [];
  for (const document of documents) {
    let pending = documentCounts[document.id] || 0;
    for (const [level, difficulty] of Object.entries(levels)) {
      const count = Math.min(pending, remaining[level]);
      if (count > 0) jobs.push({ documentId: document.id, difficulty, count });
      pending -= count;
      remaining[level] -= count;
    }
    if (pending) throw new HttpError(400, "Faltan preguntas por asignar a una dificultad");
  }
  if (Object.values(remaining).some((count) => count !== 0)) {
    throw new HttpError(400, "El reparto de dificultad supera el total de preguntas");
  }
  return jobs;
}
