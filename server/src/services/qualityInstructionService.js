import { query } from "../db/pool.js";
import { HttpError } from "../utils/errors.js";
import { toVectorLiteral } from "../utils/vector.js";
import { normalizeUnicode } from "../utils/unicode.js";
import { createEmbedding } from "./openaiService.js";

function instructionEmbeddingText({ title, content, difficulty }) {
  return [
    `Regla de calidad: ${title}`,
    `Nivel: ${difficulty || "TODOS"}`,
    content,
  ].join("\n");
}

export async function listQualityInstructions() {
  const { rows } = await query(
    `select qi.id, qi.title, qi.content, qi.difficulty, qi.active,
            qi.created_at, qi.updated_at, u.name as created_by_name
     from quality_instructions qi
     left join users u on u.id = qi.created_by
     order by qi.active desc, qi.updated_at desc`,
  );
  return rows;
}

export async function createQualityInstruction(payload, userId) {
  const normalized = {
    title: normalizeUnicode(payload.title.trim()),
    content: normalizeUnicode(payload.content.trim()),
    difficulty: payload.difficulty || null,
  };
  const embedding = await createEmbedding(instructionEmbeddingText(normalized));
  const { rows } = await query(
    `insert into quality_instructions
       (title, content, difficulty, active, embedding, created_by)
     values ($1, $2, $3, $4, $5::vector, $6)
     returning *`,
    [
      normalized.title,
      normalized.content,
      normalized.difficulty,
      payload.active,
      toVectorLiteral(embedding),
      userId,
    ],
  );
  return rows[0];
}

export async function updateQualityInstruction(id, payload) {
  const { rows: currentRows } = await query(
    `select * from quality_instructions where id = $1`,
    [id],
  );
  if (!currentRows[0]) throw new HttpError(404, "Instruccion no encontrada");

  const next = {
    ...currentRows[0],
    ...payload,
    title: normalizeUnicode((payload.title ?? currentRows[0].title).trim()),
    content: normalizeUnicode((payload.content ?? currentRows[0].content).trim()),
    difficulty:
      payload.difficulty === undefined
        ? currentRows[0].difficulty
        : payload.difficulty || null,
  };
  const embedding = await createEmbedding(instructionEmbeddingText(next));
  const { rows } = await query(
    `update quality_instructions
     set title = $2, content = $3, difficulty = $4, active = $5,
         embedding = $6::vector, updated_at = now()
     where id = $1
     returning *`,
    [id, next.title, next.content, next.difficulty, next.active, toVectorLiteral(embedding)],
  );
  return rows[0];
}

export async function deleteQualityInstruction(id) {
  const { rowCount } = await query(
    `delete from quality_instructions where id = $1`,
    [id],
  );
  if (!rowCount) throw new HttpError(404, "Instruccion no encontrada");
}

export async function retrieveQualityInstructions({ difficulty, contextChunks, limit = 6 }) {
  const contextPreview = contextChunks
    .slice(0, 4)
    .map((chunk) => `${chunk.section || "Contenido"}: ${chunk.text.slice(0, 500)}`)
    .join("\n");
  const embedding = await createEmbedding(
    `Crear preguntas tipo test de nivel ${difficulty}.\n${contextPreview}`,
  );
  const { rows } = await query(
    `select id, title, content, difficulty,
            embedding <=> $1::vector as distance
     from quality_instructions
     where active = true
       and embedding is not null
       and (difficulty is null or difficulty = $2)
     order by embedding <=> $1::vector
     limit $3`,
    [toVectorLiteral(embedding), difficulty, limit],
  );
  return rows;
}
