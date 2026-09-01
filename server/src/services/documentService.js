import fs from "fs/promises";
import { query, withTransaction } from "../db/pool.js";
import { createEmbeddings, isOpenAiConfigured } from "./openaiService.js";
import { extractPdfPages, splitIntoChunks } from "./pdfService.js";
import { toVectorLiteral } from "../utils/vector.js";
import { HttpError } from "../utils/errors.js";
import { normalizeFilename, normalizeUnicode } from "../utils/unicode.js";

const EMBEDDING_BATCH_SIZE = 64;

export async function listDocuments(user) {
  const params = [];
  let ownerClause = "";

  if (user.role !== "ADMIN") {
    params.push(user.id);
    ownerClause = "where d.user_id = $1";
  }

  const { rows } = await query(
    `select
       d.id,
       d.filename,
       d.original_filename,
       d.content_type,
       d.status,
       d.error_message,
       d.created_at,
       d.processed_at,
       u.name as owner_name,
       count(q.id)::int as question_count
     from documents d
     join users u on u.id = d.user_id
     left join questions q on q.document_id = d.id
     ${ownerClause}
     group by d.id, u.name
     order by d.created_at desc`,
    params,
  );

  return rows.map((row) => ({
    ...row,
    original_filename: normalizeFilename(row.original_filename),
    owner_name: normalizeUnicode(row.owner_name),
    error_message: row.error_message ? normalizeUnicode(row.error_message) : null,
  }));
}

export async function createDocumentRecord({ userId, file, contentType }) {
  const originalFilename = normalizeFilename(file.originalname);
  const { rows } = await query(
    `insert into documents
       (user_id, filename, original_filename, storage_path, content_type, status)
     values ($1, $2, $3, $4, $5, 'PROCESSING')
     returning *`,
    [userId, file.filename, originalFilename, file.path, contentType],
  );

  await query(
    `insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
     values ($1, 'DOCUMENT_UPLOADED', 'document', $2, $3)`,
    [
      userId,
      rows[0].id,
      JSON.stringify({ filename: originalFilename, contentType }),
    ],
  );

  return rows[0];
}

export async function processDocument(documentId) {
  try {
    const { rows } = await query("select * from documents where id = $1", [
      documentId,
    ]);
    const document = rows[0];
    if (!document) return;

    const pages = await extractPdfPages(document.storage_path);
    const chunks = splitIntoChunks(pages);

    if (chunks.length === 0) {
      throw new Error("No se ha podido extraer texto util del PDF");
    }

    const embeddings = await buildChunkEmbeddings(chunks);

    await withTransaction(async (client) => {
      await client.query("delete from document_chunks where document_id = $1", [
        documentId,
      ]);

      for (const [index, chunk] of chunks.entries()) {
        const embedding = embeddings[index];
        await client.query(
          `insert into document_chunks (document_id, text, page, section, embedding)
           values ($1, $2, $3, $4, $5::vector)`,
          [
            documentId,
            normalizeUnicode(chunk.text),
            chunk.page,
            chunk.section ? normalizeUnicode(chunk.section) : null,
            embedding ? toVectorLiteral(embedding) : null,
          ],
        );
      }

      await client.query(
        `update documents
         set status = 'AVAILABLE', processed_at = now(), error_message = null
         where id = $1`,
        [documentId],
      );
    });
  } catch (error) {
    await query(
      `update documents
       set status = 'ERROR', error_message = $2
       where id = $1`,
      [documentId, normalizeUnicode(error.message || "Error procesando el PDF")],
    );
  }
}

export function scheduleDocumentProcessing(documentId) {
  setImmediate(() => {
    processDocument(documentId).catch((error) => {
      console.error(`Error scheduling document ${documentId}`, error);
    });
  });
}

export async function resumePendingDocumentProcessing() {
  const { rows } = await query(
    `select id
     from documents
     where status = 'PROCESSING'
        or (
          status = 'ERROR'
          and (
            error_message ilike '%OPENAI_API_KEY%'
            or error_message ilike '%exceeded your current quota%'
            or error_message ilike '%cuota%'
            or error_message ilike '%billing%'
          )
        )
     order by created_at asc`,
  );

  for (const document of rows) {
    scheduleDocumentProcessing(document.id);
  }

  return rows.length;
}

async function buildChunkEmbeddings(chunks) {
  if (!isOpenAiConfigured()) {
    return chunks.map(() => null);
  }

  try {
    const embeddings = [];
    for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
      embeddings.push(...(await createEmbeddings(batch.map((chunk) => chunk.text))));
    }

    return embeddings;
  } catch (error) {
    console.warn(
      "No se pudieron crear embeddings del temario; se procesara solo con texto.",
      error.message,
    );
    return chunks.map(() => null);
  }
}

export async function retryDocumentProcessing(documentId, user) {
  const document = await assertDocumentAccess(documentId, user);

  if (!document) {
    return null;
  }

  await withTransaction(async (client) => {
    await client.query("delete from document_chunks where document_id = $1", [
      documentId,
    ]);
    await client.query(
      `update documents
       set status = 'PROCESSING', error_message = null, processed_at = null
       where id = $1`,
      [documentId],
    );
    await client.query(
      `insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
       values ($1, 'DOCUMENT_REPROCESS_REQUESTED', 'document', $2, $3)`,
      [user.id, documentId, JSON.stringify({ filename: document.original_filename })],
    );
  });

  return document;
}

export async function deleteDocuments({ user, ids = [], all = false }) {
  const normalizedIds = [...new Set(ids)].map((id) => String(id));

  if (!all && normalizedIds.length === 0) {
    throw new HttpError(400, "Selecciona al menos un temario");
  }

  validateDocumentIds(normalizedIds);

  const deleted = await withTransaction(async (client) => {
    const params = [];
    const clauses = [];

    if (user.role !== "ADMIN") {
      params.push(user.id);
      clauses.push(`user_id = $${params.length}`);
    }

    if (!all) {
      params.push(normalizedIds);
      clauses.push(`id = any($${params.length}::uuid[])`);
    }

    const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const { rows } = await client.query(
      `delete from documents
       ${where}
       returning id, storage_path, original_filename`,
      params,
    );

    if (rows.length > 0) {
      await client.query(
        `insert into activity_logs (user_id, action, entity_type, metadata)
         values ($1, 'DOCUMENTS_DELETED', 'document', $2)`,
        [
          user.id,
          JSON.stringify({
            count: rows.length,
            all,
            filenames: rows.map((row) => normalizeFilename(row.original_filename)),
          }),
        ],
      );
    }

    return rows;
  });

  await removeStoredFiles(deleted.map((document) => document.storage_path));

  return {
    deletedCount: deleted.length,
    deletedIds: deleted.map((document) => document.id),
  };
}

function validateDocumentIds(ids) {
  const invalidId = ids.find(
    (id) =>
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      ),
  );

  if (invalidId) {
    throw new HttpError(400, "Identificador de temario no valido");
  }
}

async function removeStoredFiles(paths) {
  await Promise.all(
    paths.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          console.warn(`No se pudo borrar el archivo ${filePath}`, error.message);
        }
      }
    }),
  );
}

export async function assertDocumentAccess(documentId, user) {
  const { rows } = await query(
    `select d.*, u.name as owner_name
     from documents d
     join users u on u.id = d.user_id
     where d.id = $1`,
    [documentId],
  );
  const document = rows[0];

  if (!document) {
    return null;
  }

  if (user.role !== "ADMIN" && document.user_id !== user.id) {
    return null;
  }

  return document;
}
