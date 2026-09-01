import { z } from "zod";
import { env } from "../config/env.js";
import { query, withTransaction } from "../db/pool.js";
import { HttpError } from "../utils/errors.js";
import { parseModelJson } from "../utils/json.js";
import { toVectorLiteral } from "../utils/vector.js";
import { assertDocumentAccess } from "./documentService.js";
import {
  createChatJson,
  createEmbedding,
  createEmbeddings,
  isOpenAiConfigured,
} from "./openaiService.js";
import { normalizeUnicode } from "../utils/unicode.js";
import { retrieveQualityInstructions } from "./qualityInstructionService.js";

const EMBEDDING_BATCH_SIZE = 64;

const generatedQuestionSchema = z.object({
  questions: z.array(
    z.object({
      question: z.string().min(10),
      option_a: z.string().min(1),
      option_b: z.string().min(1),
      option_c: z.string().min(1),
      option_d: z.string().min(1),
      correct_answer: z.enum(["A", "B", "C", "D"]),
      explanation: z.string().min(5),
      reference: z.string().min(3),
      difficulty: z.enum(["PRINCIPIANTE", "ELITE", "ALEATORIO"]),
      source_chunk_id: z.string().uuid().optional(),
    }),
  ),
});

export async function listQuestions(user, filters = {}) {
  const params = [];
  const clauses = [];

  if (user.role !== "ADMIN") {
    params.push(user.id);
    clauses.push(`q.user_id = $${params.length}`);
  }

  if (filters.documentId) {
    params.push(filters.documentId);
    clauses.push(`q.document_id = $${params.length}`);
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const { rows } = await query(
    `select
       q.*,
       d.original_filename,
       u.name as owner_name
     from questions q
     join documents d on d.id = q.document_id
     join users u on u.id = q.user_id
     ${where}
     order by q.created_at desc`,
    params,
  );

  return rows;
}

export async function generateQuestions({ user, documentId, count, difficulty }) {
  const document = await assertDocumentAccess(documentId, user);
  if (!document) {
    throw new HttpError(404, "Temario no encontrado");
  }

  if (document.status !== "AVAILABLE") {
    throw new HttpError(409, "El temario aun no esta disponible");
  }

  if (!isOpenAiConfigured()) {
    throw new HttpError(
      503,
      "La IA no esta configurada. Anade OPENAI_API_KEY en server/.env para generar preguntas.",
    );
  }

  await ensureDocumentChunkEmbeddings(documentId);

  const normalizedCount = Math.min(Math.max(Number(count), 1), 120);
  const batches = buildBatches(normalizedCount);
  const saved = [];

  for (const [batchIndex, batchSize] of batches.entries()) {
    const contextChunks = await pickContextChunks({
      documentId,
      count: batchSize,
      difficulty,
      batchIndex,
    });
    const previousQuestions = await getPreviousQuestionTexts(documentId, user.id);
    const qualityInstructions = await retrieveQualityInstructions({
      difficulty,
      contextChunks,
    });
    const raw = await createChatJson(
      buildPrompt({
        document,
        contextChunks,
        count: batchSize,
        difficulty,
        previousQuestions,
        qualityInstructions,
      }),
      difficulty === "ELITE" ? 0.35 : 0.2,
    );
    const parsed = generatedQuestionSchema.parse(parseModelJson(raw));

    for (const question of parsed.questions.slice(0, batchSize)) {
      const sourceChunk =
        contextChunks.find((chunk) => chunk.id === question.source_chunk_id) ||
        contextChunks[0];
      const stored = await saveIfUnique({
        question,
        sourceChunk,
        userId: user.id,
        documentId,
      });

      if (stored) {
        saved.push(stored);
      }
    }
  }

  await query(
    `insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
     values ($1, 'QUESTIONS_GENERATED', 'document', $2, $3)`,
    [
      user.id,
      documentId,
      JSON.stringify({ requested: normalizedCount, saved: saved.length }),
    ],
  );

  return saved;
}

function buildBatches(count) {
  const batches = [];
  let remaining = count;
  while (remaining > 0) {
    const size = Math.min(remaining, 8);
    batches.push(size);
    remaining -= size;
  }
  return batches;
}

async function pickContextChunks({ documentId, count, difficulty, batchIndex }) {
  const windowSize = Math.max(4, Math.min(count * 3, 18));
  const { rows: orderedRows } = await query(
    `select dc.id, dc.text, dc.page, dc.section
     from document_chunks dc
     where dc.document_id = $1
     order by coalesce(dc.page, 2147483647), dc.created_at, dc.id
     limit 500`,
    [documentId],
  );

  if (orderedRows.length === 0) {
    throw new HttpError(409, "El temario no tiene fragmentos procesados");
  }

  const semanticRows = await pickSemanticChunks({
    documentId,
    difficulty,
    limit: windowSize,
  });

  const start = (batchIndex * windowSize) % orderedRows.length;
  const sequentialRows = [
    ...orderedRows.slice(start),
    ...orderedRows.slice(0, start),
  ].slice(0, windowSize);

  return mergeUniqueChunks([...sequentialRows, ...semanticRows]).slice(
    0,
    windowSize,
  );
}

async function pickSemanticChunks({ documentId, difficulty, limit }) {
  try {
    const retrievalEmbedding = await createEmbedding(
      `preguntas tipo test oposicion bombero ${difficulty.toLowerCase()} conceptos evaluables normativa procedimientos definiciones formulas unidades detalles`,
    );
    const vector = toVectorLiteral(retrievalEmbedding);

    const { rows } = await query(
      `select dc.id, dc.text, dc.page, dc.section
       from document_chunks dc
       where dc.document_id = $1 and dc.embedding is not null
       order by dc.embedding <=> $2::vector
       limit $3`,
      [documentId, vector, limit],
    );

    return rows;
  } catch (error) {
    console.warn(
      "No se pudo recuperar contexto semantico; se usara orden de paginas.",
      error.message,
    );
    return [];
  }
}

function mergeUniqueChunks(chunks) {
  const seen = new Set();
  const merged = [];

  for (const chunk of chunks) {
    if (seen.has(chunk.id)) continue;
    seen.add(chunk.id);
    merged.push(chunk);
  }

  return merged;
}

async function ensureDocumentChunkEmbeddings(documentId) {
  if (!isOpenAiConfigured()) {
    return;
  }

  const { rows } = await query(
    `select id, text
     from document_chunks
     where document_id = $1 and embedding is null`,
    [documentId],
  );

  for (let start = 0; start < rows.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = rows.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = await createEmbeddings(batch.map((chunk) => chunk.text));

    for (const [index, chunk] of batch.entries()) {
      await query(
        `update document_chunks
         set embedding = $2::vector
         where id = $1`,
        [chunk.id, toVectorLiteral(embeddings[index])],
      );
    }
  }
}

async function getPreviousQuestionTexts(documentId, userId) {
  const { rows } = await query(
    `select question
     from questions
     where document_id = $1 and user_id = $2
     order by created_at desc
     limit 40`,
    [documentId, userId],
  );

  return rows.map((row) => row.question);
}

function buildPrompt({
  document,
  contextChunks,
  count,
  difficulty,
  previousQuestions,
  qualityInstructions,
}) {
  const levelInstructions = {
    PRINCIPIANTE:
      "Preguntas directas, conceptos basicos, orientadas a memorizar contenido literal del temario.",
    ELITE:
      "Preguntas avanzadas, con detalle exigente de oposicion y distractores plausibles y complejos.",
    ALEATORIO:
      "Mezcla preguntas directas y avanzadas. Asigna a cada pregunta el nivel que corresponda.",
  };

  const context = contextChunks
    .map(
      (chunk, index) =>
        `FRAGMENTO ${index + 1} | id=${chunk.id} | pagina=${chunk.page || "sin pagina"} | apartado=${chunk.section || "sin apartado"}\n${chunk.text}`,
    )
    .join("\n\n");

  const retrievedInstructions = qualityInstructions.length
    ? qualityInstructions
        .map(
          (instruction, index) =>
            `${index + 1}. ${instruction.title}: ${instruction.content}`,
        )
        .join("\n")
    : "No hay instrucciones adicionales configuradas.";

  return [
    {
      role: "system",
      content:
        "Actua como profesor experto en oposiciones de bombero. Genera preguntas tipo examen oficial. Usa exclusivamente el contexto proporcionado. Si no existe informacion suficiente, devuelve menos preguntas; no inventes. Cada pregunta debe tener una sola respuesta inequivocamente correcta, distractores plausibles y una explicacion que justifique la respuesta con el fragmento. Las instrucciones de calidad son reglas de redaccion, nunca fuentes de hechos. Responde siempre con JSON valido.",
    },
    {
      role: "user",
      content: `Temario: ${document.original_filename}
Numero de preguntas solicitadas: ${count}
Nivel solicitado: ${difficulty}
Instrucciones de nivel: ${levelInstructions[difficulty]}
Instrucciones de calidad recuperadas semanticamente:
${retrievedInstructions}

Reparte las preguntas entre apartados distintos del contexto cuando sea posible. Si aparecen formulas, unidades, listas, definiciones normativas o valores numericos, conviertelos en preguntas evaluables.

Evita repetir estas preguntas ya generadas:
${previousQuestions.length ? previousQuestions.map((q) => `- ${q}`).join("\n") : "- Ninguna"}

Contexto autorizado:
${context}

Devuelve exactamente este formato:
{
  "questions": [
    {
      "question": "Enunciado",
      "option_a": "Respuesta A",
      "option_b": "Respuesta B",
      "option_c": "Respuesta C",
      "option_d": "Respuesta D",
      "correct_answer": "A|B|C|D",
      "explanation": "Explicacion basada en el contexto",
      "reference": "Nombre PDF - pagina X - apartado Y si existe",
      "difficulty": "PRINCIPIANTE|ELITE|ALEATORIO",
      "source_chunk_id": "uuid del fragmento usado"
    }
  ]
}`,
    },
  ];
}

async function saveIfUnique({ question, sourceChunk, userId, documentId }) {
  const embedding = await createEmbedding(
    `${question.question}\n${question.option_a}\n${question.option_b}\n${question.option_c}\n${question.option_d}`,
  );
  const vector = toVectorLiteral(embedding);

  const { rows: similarRows } = await query(
    `select id, question, embedding <=> $1::vector as distance
     from questions
     where document_id = $2 and user_id = $3 and embedding is not null
     order by embedding <=> $1::vector
     limit 1`,
    [vector, documentId, userId],
  );

  if (
    similarRows[0] &&
    Number(similarRows[0].distance) <= env.questionSimilarityThreshold
  ) {
    return null;
  }

  const { rows } = await query(
    `insert into questions (
       user_id,
       document_id,
       source_chunk_id,
       question,
       option_a,
       option_b,
       option_c,
       option_d,
       correct_answer,
       explanation,
       reference,
       difficulty,
       embedding
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector)
     returning *`,
    [
      userId,
      documentId,
      sourceChunk?.id || null,
      normalizeUnicode(question.question),
      normalizeUnicode(question.option_a),
      normalizeUnicode(question.option_b),
      normalizeUnicode(question.option_c),
      normalizeUnicode(question.option_d),
      question.correct_answer,
      normalizeUnicode(question.explanation),
      normalizeUnicode(question.reference),
      question.difficulty,
      vector,
    ],
  );

  return rows[0];
}

export async function updateQuestion(questionId, user, payload) {
  const fields = [
    "question",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct_answer",
    "explanation",
    "reference",
    "difficulty",
  ];
  const updates = [];
  const params = [];

  for (const field of fields) {
    if (payload[field] !== undefined) {
      params.push(
        typeof payload[field] === "string"
          ? normalizeUnicode(payload[field])
          : payload[field],
      );
      updates.push(`${field} = $${params.length}`);
    }
  }

  if (updates.length === 0) {
    throw new HttpError(400, "No hay campos para actualizar");
  }

  params.push(questionId);
  const idParam = params.length;
  let ownerClause = "";
  if (user.role !== "ADMIN") {
    params.push(user.id);
    ownerClause = `and user_id = $${params.length}`;
  }

  const { rows } = await query(
    `update questions
     set ${updates.join(", ")}, updated_at = now()
     where id = $${idParam} ${ownerClause}
     returning *`,
    params,
  );

  if (!rows[0]) {
    throw new HttpError(404, "Pregunta no encontrada");
  }

  return rows[0];
}

export async function deleteQuestion(questionId, user) {
  const params = [questionId];
  let ownerClause = "";
  if (user.role !== "ADMIN") {
    params.push(user.id);
    ownerClause = "and user_id = $2";
  }

  const { rowCount } = await query(
    `delete from questions where id = $1 ${ownerClause}`,
    params,
  );

  if (rowCount === 0) {
    throw new HttpError(404, "Pregunta no encontrada");
  }
}

export async function exportQuestionsXlsx(user, documentId) {
  return exportQuestionsRows(user, documentId);
}

export async function exportQuestionsRows(user, documentId) {
  const questions = await listQuestions(user, { documentId });
  if (questions.length === 0) {
    throw new HttpError(404, "No hay preguntas para exportar");
  }

  return questions.map((item) => ({
    Pregunta: item.question,
    "Opcion A": item.option_a,
    "Opcion B": item.option_b,
    "Opcion C": item.option_c,
    "Opcion D": item.option_d,
    Correcta: item.correct_answer,
    Explicacion: item.explanation,
    Referencia: item.reference,
    Nivel: item.difficulty,
  }));
}
