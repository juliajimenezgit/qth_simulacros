import app from "./app.js";
import { env } from "./config/env.js";
import { resumePendingDocumentProcessing } from "./services/documentService.js";
import { markInterruptedQuestionSets } from "./services/questionService.js";

app.listen(env.port, () => {
  console.log(`QTH Simulacros API listening on http://localhost:${env.port}`);
  markInterruptedQuestionSets()
    .then((count) => {
      if (count > 0) console.warn(`⚠ ${count} generación(es) interrumpida(s) por el reinicio del servidor; sus preguntas validadas se conservan`);
    })
    .catch((error) => console.error("No se pudieron revisar las generaciones interrumpidas", error));
  resumePendingDocumentProcessing()
    .then((count) => {
      if (count > 0) {
        console.log(`Reanudando ${count} temario(s) pendiente(s)`);
      }
    })
    .catch((error) => {
      console.error("No se pudieron reanudar temarios pendientes", error);
    });
});
