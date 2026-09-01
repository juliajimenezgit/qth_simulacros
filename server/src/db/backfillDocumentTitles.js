import { pool } from "./pool.js";
import {
  extractDocumentDisplayTitle,
  extractPdfPages,
} from "../services/pdfService.js";

try {
  const { rows: documents } = await pool.query(
    "select id, original_filename, storage_path from documents order by created_at",
  );
  for (const document of documents) {
    try {
      const pages = await extractPdfPages(document.storage_path);
      const displayTitle = extractDocumentDisplayTitle(
        pages,
        document.original_filename,
      );
      await pool.query("update documents set display_title = $2 where id = $1", [
        document.id,
        displayTitle,
      ]);
      console.log(`${document.original_filename} -> ${displayTitle}`);
    } catch (error) {
      console.warn(`No se pudo actualizar ${document.original_filename}: ${error.message}`);
    }
  }
} finally {
  await pool.end();
}
