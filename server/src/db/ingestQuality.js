import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withTransaction } from "./pool.js";
import { extractPdfPages, splitIntoChunks } from "../services/pdfService.js";
import { createEmbeddings, isOpenAiConfigured } from "../services/openaiService.js";
import { toVectorLiteral } from "../utils/vector.js";

const sourceDirectories = {
  examenes_oficiales: "OFFICIAL_EXAM",
  apuntes: "ANNOTATED_GUIDE",
  guia_mejorada: "QUALITY_GUIDE",
};
const embeddingBatchSize = 64;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !isOpenAiConfigured()) throw new Error("OPENAI_API_KEY no está configurada");
  const defaultRoot = fileURLToPath(new URL("../../../quality_sources", import.meta.url));
  const sourceArgument = process.argv.slice(2).find((argument) => !argument.startsWith("--"));
  const sourceRoot = path.resolve(sourceArgument || defaultRoot);
  const files = await discoverPdfs(sourceRoot);
  if (files.length === 0) throw new Error(`No se encontraron PDFs en ${sourceRoot}`);

  console.log(`Biblioteca privada: ${files.length} PDF(s)`);
  if (dryRun) {
    let totalPages = 0;
    let totalChunks = 0;
    for (const file of files) {
      const pages = await extractPdfPages(file.sourcePath);
      const chunks = buildChunks(file.sourceType, pages);
      totalPages += pages.length;
      totalChunks += chunks.length;
      console.log(`Validado: ${file.filename} (${pages.length} páginas, ${chunks.length} fragmentos)`);
    }
    console.log(`Validación local: ${totalPages} páginas, ${totalChunks} fragmentos; no se enviaron datos`);
    return;
  }
  let processed = 0;
  let skipped = 0;
  let chunksCreated = 0;

  for (const file of files) {
    const result = await ingestFile(file);
    if (result.skipped) {
      skipped += 1;
      console.log(`${result.reason || "Sin cambios"}: ${file.filename}`);
    } else {
      processed += 1;
      chunksCreated += result.chunkCount;
      console.log(`Procesado: ${file.filename} (${result.chunkCount} fragmentos)`);
    }
  }

  console.log(`Finalizado: ${processed} procesados, ${skipped} sin cambios, ${chunksCreated} fragmentos nuevos`);
}

async function discoverPdfs(sourceRoot) {
  const discovered = [];
  for (const [directory, sourceType] of Object.entries(sourceDirectories)) {
    const directoryPath = path.join(sourceRoot, directory);
    let entries = [];
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith("._") || !entry.name.toLowerCase().endsWith(".pdf")) continue;
      discovered.push({
        filename: entry.name,
        sourcePath: path.join(directoryPath, entry.name),
        relativePath: path.join(directory, entry.name),
        sourceType,
      });
    }
  }
  return discovered;
}

async function ingestFile(file) {
  const buffer = await readFile(file.sourcePath);
  const checksum = createHash("sha256").update(buffer).digest("hex");
  const existing = await pool.query(
    "select id, checksum, source_path from quality_source_documents where source_path = $1 or checksum = $2 order by source_path = $1 desc limit 1",
    [file.relativePath, checksum],
  );
  if (existing.rows[0]?.checksum === checksum) {
    return {
      skipped: true,
      reason: existing.rows[0].source_path === file.relativePath ? "Sin cambios" : "Duplicado",
    };
  }

  const pages = await extractPdfPages(file.sourcePath);
  const chunks = buildChunks(file.sourceType, pages);
  if (chunks.length === 0) {
    return { skipped: true, reason: "Requiere OCR" };
  }

  const embeddings = [];
  for (let start = 0; start < chunks.length; start += embeddingBatchSize) {
    embeddings.push(...(await createEmbeddings(chunks.slice(start, start + embeddingBatchSize).map((chunk) => chunk.text))));
  }

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `insert into quality_source_documents
         (source_type, filename, source_path, checksum, page_count, processed_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (source_path) do update set
         source_type = excluded.source_type,
         filename = excluded.filename,
         checksum = excluded.checksum,
         page_count = excluded.page_count,
         processed_at = now()
       returning id`,
      [file.sourceType, file.filename, file.relativePath, checksum, pages.length],
    );
    const sourceId = rows[0].id;
    await client.query("delete from quality_knowledge_chunks where source_document_id = $1", [sourceId]);
    for (const [index, chunk] of chunks.entries()) {
      await client.query(
        `insert into quality_knowledge_chunks
           (source_document_id, source_type, text, page, section, metadata, embedding)
         values ($1, $2, $3, $4, $5, $6, $7::vector)`,
        [sourceId, file.sourceType, chunk.text, chunk.page, chunk.section || null, JSON.stringify(chunk.metadata || {}), toVectorLiteral(embeddings[index])],
      );
    }
  });
  return { skipped: false, chunkCount: chunks.length };
}

function buildChunks(sourceType, pages) {
  return sourceType === "OFFICIAL_EXAM"
    ? extractOfficialQuestions(pages)
    : splitIntoChunks(pages, sourceType === "QUALITY_GUIDE" ? 1800 : 2200, 220);
}

function extractOfficialQuestions(pages) {
  const questions = [];
  for (const page of pages) {
    const matches = [...page.text.matchAll(/(?:^|\n)\s*(\d{1,3})[.)]\s+([\s\S]*?)(?=(?:\n\s*\d{1,3}[.)]\s+)|$)/g)];
    for (const match of matches) {
      const text = `${match[1]}. ${match[2]}`.trim();
      const optionCount = (text.match(/(?:^|\n)\s*[A-D][.)]\s+/g) || []).length;
      if (optionCount >= 3 && text.length >= 120 && text.length <= 4000) {
        questions.push({ page: page.page, section: `Pregunta ${match[1]}`, text, metadata: { questionNumber: Number(match[1]) } });
      }
    }
  }
  return questions.length ? questions : splitIntoChunks(pages, 2200, 180);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
