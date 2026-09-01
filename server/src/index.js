import app from "./app.js";
import { env } from "./config/env.js";
import { resumePendingDocumentProcessing } from "./services/documentService.js";

app.listen(env.port, () => {
  console.log(`QTH Simulacros API listening on http://localhost:${env.port}`);
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
