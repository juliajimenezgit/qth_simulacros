import { pool } from "./pool.js";
import { extractPdfPages, manualPageNumbers } from "../services/pdfService.js";

// Chunks processed before manual_page existed: only the printed page is filled in; text and embeddings are kept.
try {
  const { rows: documents } = await pool.query(
    "select id, original_filename, storage_path from documents order by original_filename",
  );
  for (const document of documents) {
    try {
      const manualPages = manualPageNumbers(await extractPdfPages(document.storage_path));
      const { rowCount } = await pool.query(
        `update document_chunks dc set manual_page = m.manual_page
         from unnest($2::int[], $3::int[]) as m(page, manual_page)
         where dc.document_id = $1 and dc.page = m.page`,
        [document.id, [...manualPages.keys()], [...manualPages.values()]],
      );
      const [first] = manualPages;
      console.log(`${document.original_filename} -> ${first ? `pág. PDF ${first[0]} = pág. manual ${first[1]}` : "sin numeración detectada"} (${rowCount} fragmentos)`);
    } catch (error) {
      console.warn(`No se pudo actualizar ${document.original_filename}: ${error.message}`);
    }
  }
} finally {
  await pool.end();
}
