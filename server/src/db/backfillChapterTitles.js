import { pool, withTransaction } from './pool.js';
import { chapterTitleFromFilename } from '../services/pdfService.js';

try {
  await withTransaction(async (client) => {
    const { rows } = await client.query('select id, original_filename, display_title from documents for update');
    let updated = 0;
    for (const document of rows) {
      const title = chapterTitleFromFilename(document.original_filename);
      if (!title || title === document.display_title) continue;
      await client.query('update documents set display_title = $2 where id = $1', [document.id, title]);
      console.log(`${document.original_filename} -> ${title}`);
      updated += 1;
    }
    console.log(`Capítulos actualizados: ${updated}`);
  });
} finally {
  await pool.end();
}
