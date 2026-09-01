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
import { normalizeFilename, normalizeUnicode } from "../utils/unicode.js";
import { retrieveQualityInstructions } from "./qualityInstructionService.js";
import {
  formatPrivateQualityKnowledge,
  retrievePrivateQualityKnowledge,
} from "./qualityKnowledgeService.js";

const EMBEDDING_BATCH_SIZE = 64;

function normalizeDifficulty(value) {
  const normalized = String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toUpperCase();
  return {
    P: "PRINCIPIANTE",
    PRINCIPIANTE: "PRINCIPIANTE",
    F: "FACIL",
    FACIL: "FACIL",
    ELITE: "FACIL",
    D: "DIFICIL",
    DIFICIL: "DIFICIL",
    ALEATORIO: "DIFICIL",
  }[normalized] || normalized;
}

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
      source_title: z.string().min(3),
      topic: z.string().min(1),
      chapter: z.string().min(1),
      reference: z.string().min(3),
      difficulty: z.preprocess(
        normalizeDifficulty,
        z.enum(["PRINCIPIANTE", "FACIL", "DIFICIL"]),
      ),
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
  if (filters.testId) {
    params.push(filters.testId);
    clauses.push(`q.question_set_id = $${params.length}`);
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const { rows } = await query(
    `select
       q.*,
       d.original_filename,
       d.display_title,
       d.content_type,
       qs.name as test_name,
       u.name as owner_name
     from questions q
     join documents d on d.id = q.document_id
     left join question_sets qs on qs.id = q.question_set_id
     join users u on u.id = q.user_id
     ${where}
     order by q.created_at desc`,
    params,
  );

  return rows.map(applyDocumentHierarchy);
}

export async function listQuestionSets(user) {
  const params = [];
  let ownerClause = "";
  if (user.role !== "ADMIN") {
    params.push(user.id);
    ownerClause = "where qs.user_id = $1";
  }
  const { rows } = await query(
    `select qs.*, count(q.id)::int as question_count
     from question_sets qs
     left join questions q on q.question_set_id = qs.id
     ${ownerClause}
     group by qs.id
     order by qs.created_at desc`,
    params,
  );
  return rows;
}

function applyDocumentHierarchy(row) {
  const originalFilename = normalizeFilename(row.original_filename);
  const manualFilename = resolveManualFilename(originalFilename);
  const sourceLabel = formatCeisSourceLabel(row.display_title, originalFilename);
  let topic = row.topic || "No identificado";
  let chapter = row.chapter || "No identificado";

  if (row.content_type === "TEMA") {
    topic = originalFilename;
    chapter = "No identificado";
  } else if (row.content_type === "CAPITULO") {
    chapter = originalFilename;
  }

  const normalizedQuestion = stripSourcePrefix(
    stripSourcePrefix(normalizeUnicode(row.question).trim(), row.source_title),
    manualFilename,
  );
  const cleanQuestion = stripLegacyCeisPrefix(
    stripSourcePrefix(normalizedQuestion, row.source_title),
  );
  const question = cleanQuestion
    .toLocaleLowerCase("es-ES")
    .startsWith(sourceLabel.toLocaleLowerCase("es-ES"))
    ? cleanQuestion
    : `${sourceLabel}. ${cleanQuestion}`;

  return {
    ...row,
    question,
    source_title: manualFilename,
    topic,
    chapter,
  };
}

function formatCeisSourceLabel(displayTitle, originalFilename) {
  const title = normalizeUnicode(displayTitle || "")
    .trim()
    .replace(/[.;:]+$/u, "");
  const fallback = normalizeFilename(originalFilename)
    .replace(/\.pdf$/i, "")
    .replace(/^.*-\d{2}-/, "")
    .replace(/([a-záéíóúüñ])([A-ZÁÉÍÓÚÜÑ])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  const readable = title || fallback;
  const normalized = readable
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-ES")
    .replace(/\s+/g, " ")
    .trim();
  const canonicalTitles = [
    [/urgencias traumaticas/, "Urgencias Traumáticas"],
    [/mecanica.*conduccion.*4x4|vehiculos.*mecanica/, "Mecánica y Conducción 4x4"],
    [/incendios de vegetacion|vegetacion/, "Incendios de Vegetación"],
    [/soporte vital/, "Soporte Vital"],
    [/teoria del fuego|teoriafuego/, "Teoría del Fuego"],
    [/riesgo electrico/, "Riesgo Eléctrico"],
    [/\bnrbq\b/, "NRBQ"],
    [/hidraulica/, "Hidráulica"],
    [/incendios estructurales/, "Incendios Estructurales"],
    [/proteccion respiratoria|epis.*vias respiratorias/, "EPIs Vías Respiratorias"],
    [/bombas centrifugas/, "Bombas Centrífugas"],
    [/edificaciones/, "Edificaciones"],
    [/urgencias medicas/, "Urgencias Médicas"],
  ];
  const canonical = canonicalTitles.find(([pattern]) => pattern.test(normalized));
  const baseTitle = canonical?.[1] || readable
    .replace(/\s+(?:del\s+)?CEIS(?:\s+(?:de\s+)?Guadalajara)?$/i, "")
    .trim();
  return `${baseTitle} del CEIS Guadalajara`;
}

function stripSourcePrefix(question, previousTitle) {
  const title = normalizeUnicode(previousTitle || "").trim().replace(/[.?!:;]+$/u, "");
  if (!title || !question.toLocaleLowerCase("es-ES").startsWith(title.toLocaleLowerCase("es-ES"))) {
    return question;
  }
  return question.slice(title.length).replace(/^[.?!:;\s-]+/u, "").trim();
}

function stripLegacyCeisPrefix(question) {
  return question
    .replace(
      /^[^?\n]{2,100}\s+(?:del\s+CEIS\s+Guadalajara|CEIS)[.;]\s+/iu,
      "",
    )
    .trim();
}

function resolveManualFilename(originalFilename) {
  if (/-00-completo\.pdf$/i.test(originalFilename)) {
    return originalFilename;
  }

  const inferred = originalFilename.replace(
    /-\d{2}-[^/]+\.pdf$/i,
    "-00-completo.pdf",
  );
  return inferred === originalFilename ? originalFilename : inferred;
}

export async function generateQuestions({ user, documentId, count, difficulty, testId }) {
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
  const saved = [];
  const rejectedQuestionTexts = [];
  const maxAttempts = Math.ceil(normalizedCount / 8) + 8;
  let attempt = 0;

  while (saved.length < normalizedCount && attempt < maxAttempts) {
    const batchSize = Math.min(normalizedCount - saved.length, 8);
    const contextChunks = await pickContextChunks({
      documentId,
      count: batchSize,
      difficulty,
      batchIndex: attempt,
    });
    const previousQuestions = [
      ...(await getPreviousQuestionTexts(documentId, user.id)),
      ...rejectedQuestionTexts,
    ];
    const qualityInstructions = await retrieveQualityInstructions({
      difficulty,
      contextChunks,
    });
    const privateQualityKnowledge = await retrievePrivateQualityKnowledge({
      difficulty,
      contextChunks,
    });
    const raw = await createChatJson(
      buildPrompt({
        document,
        testId,
        contextChunks,
        count: batchSize,
        difficulty,
        previousQuestions,
        qualityInstructions,
        privateQualityKnowledge,
      }),
      Math.min((difficulty === "DIFICIL" ? 0.35 : 0.2) + attempt * 0.04, 0.55),
    );
    let parsed;
    try {
      parsed = generatedQuestionSchema.parse(parseModelJson(raw));
    } catch (error) {
      console.warn(`Intento ${attempt + 1}: respuesta de preguntas no válida`, error.message);
      attempt += 1;
      continue;
    }

    for (const question of parsed.questions.slice(0, batchSize)) {
      const sourceChunk =
        contextChunks.find((chunk) => chunk.id === question.source_chunk_id) ||
        contextChunks[0];
      const stored = await saveIfUnique({
        question,
        sourceChunk,
        document,
        testId,
        userId: user.id,
        documentId,
      });

      if (stored) {
        saved.push(stored);
      } else {
        rejectedQuestionTexts.push(question.question);
      }
      if (saved.length === normalizedCount) break;
    }
    attempt += 1;
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

  if (saved.length < normalizedCount) {
    throw new HttpError(
      422,
      `Solo se pudieron crear ${saved.length} de ${normalizedCount} preguntas únicas después de ${attempt} intentos`,
    );
  }

  return saved;
}

export async function generateConfiguredQuestions({
  user,
  selectedDocumentIds,
  contentCounts,
  difficultyCounts,
  testName,
}) {
  const uniqueDocumentIds = [...new Set(selectedDocumentIds)];
  const params = [uniqueDocumentIds];
  let ownerClause = "";
  if (user.role !== "ADMIN") {
    params.push(user.id);
    ownerClause = `and user_id = $${params.length}`;
  }

  const { rows: documents } = await query(
    `select id, content_type
     from documents
     where status = 'AVAILABLE'
       and id = any($1::uuid[])
       ${ownerClause}
     order by created_at, id`,
    params,
  );
  if (documents.length !== uniqueDocumentIds.length) {
    throw new HttpError(400, "Alguno de los PDFs seleccionados no está disponible");
  }
  const documentsByType = documents.reduce((grouped, document) => {
    grouped[document.content_type] ||= [];
    grouped[document.content_type].push(document);
    return grouped;
  }, {});

  for (const [contentType, count] of Object.entries(contentCounts)) {
    if (count > 0 && !documentsByType[contentType]?.length) {
      const labels = { MANUAL: "manuales", TEMA: "temas", CAPITULO: "capítulos" };
      throw new HttpError(
        409,
        `No hay ${labels[contentType]} disponibles para generar ${count} preguntas`,
      );
    }
  }

  const difficultyMap = {
    P: "PRINCIPIANTE",
    F: "FACIL",
    D: "DIFICIL",
  };
  const remainingDifficulty = Object.entries(difficultyCounts).map(
    ([difficulty, count]) => ({ difficulty: difficultyMap[difficulty], count }),
  );
  const jobs = [];

  for (const [contentType, requestedCount] of Object.entries(contentCounts)) {
    let remainingContent = requestedCount;
    for (const difficulty of remainingDifficulty) {
      const count = Math.min(remainingContent, difficulty.count);
      if (count > 0) jobs.push({ contentType, difficulty: difficulty.difficulty, count });
      remainingContent -= count;
      difficulty.count -= count;
      if (remainingContent === 0) break;
    }
  }

  const requestedCount = Object.values(contentCounts).reduce((sum, count) => sum + count, 0);
  const automaticName = `Simulacro ${new Intl.DateTimeFormat("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date())}`;
  const { rows: testRows } = await query(
    `insert into question_sets (user_id, name, requested_count)
     values ($1, $2, $3)
     returning *`,
    [user.id, normalizeUnicode(testName || automaticName), requestedCount],
  );
  const test = testRows[0];
  const saved = [];
  try {
    for (const job of jobs) {
      const matchingDocuments = documentsByType[job.contentType];
      const baseCount = Math.floor(job.count / matchingDocuments.length);
      const extra = job.count % matchingDocuments.length;

      for (const [index, document] of matchingDocuments.entries()) {
        const count = baseCount + (index < extra ? 1 : 0);
        if (count === 0) continue;
        saved.push(
          ...(await generateQuestions({
            user,
            documentId: document.id,
            count,
            difficulty: job.difficulty,
            testId: test.id,
          })),
        );
      }
    }
    const { rows } = await query(
      `update question_sets
       set status = 'COMPLETED', generated_count = $2, completed_at = now()
       where id = $1 returning *`,
      [test.id, saved.length],
    );
    return { questions: saved, test: rows[0] };
  } catch (error) {
    await query("delete from questions where question_set_id = $1", [test.id]);
    await query(
      `update question_sets
       set status = 'ERROR', generated_count = 0, error_message = $2
       where id = $1`,
      [test.id, normalizeUnicode(error.message || "Error generando el test")],
    );
    throw error;
  }
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
  privateQualityKnowledge,
}) {
  const levelInstructions = {
    PRINCIPIANTE:
      "Nivel P (Principiante): preguntas directas, claras y centradas en conceptos fundamentales, títulos, definiciones básicas o contenido literal.",
    FACIL:
      "Nivel F (Fácil/intermedio): exige mayor dominio, comprensión y memorización precisa, con distractores plausibles y relativamente parecidos.",
    DIFICIL:
      "Nivel D (Difícil): exige detalles, relaciones entre conceptos, aplicación práctica o cálculos, con distractores muy plausibles sin ambigüedad.",
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
  const privateKnowledge = formatPrivateQualityKnowledge(privateQualityKnowledge);

  return [
    {
      role: "system",
      content:
        "Actua como profesor experto en oposiciones de bombero. Genera preguntas tipo examen oficial. Usa exclusivamente el contexto proporcionado. Si no existe informacion suficiente, devuelve menos preguntas; no inventes. Cada pregunta debe tener una sola respuesta inequivocamente correcta, distractores plausibles y una explicacion que justifique la respuesta con el fragmento. Identifica de forma precisa el manual, tema, capitulo y apartado de origen. Las instrucciones de calidad son reglas de redaccion, nunca fuentes de hechos. Responde siempre con JSON valido.",
    },
    {
      role: "user",
      content: `Temario: ${document.original_filename}
Numero de preguntas solicitadas: ${count}
Nivel solicitado: ${difficulty}
Instrucciones de nivel: ${levelInstructions[difficulty]}
Instrucciones de calidad recuperadas semanticamente:
${retrievedInstructions}

REGLAS PRIVADAS DE CALIDAD (aplícalas como criterios obligatorios de redacción):
${privateKnowledge.rules}

ANOTACIONES Y PRIORIDADES DE LOS APUNTES (priorizan qué contenido es preguntable; no sustituyen al manual como fuente factual):
${privateKnowledge.annotations}

EJEMPLOS DE EXÁMENES OFICIALES (imita su estilo, estructura y calidad de distractores; no copies sus hechos ni respuestas):
${privateKnowledge.officialExamples}

Reparte las preguntas entre apartados distintos del contexto cuando sea posible. Si aparecen formulas, unidades, listas, definiciones normativas o valores numericos, conviertelos en preguntas evaluables.
El campo source_title debe ser un titulo legible para un profesor. El enunciado se mostrara precedido por ese titulo. No inventes tema, capitulo ni apartado: extraelos del contexto; si no se identifican, indica "No identificado".

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
      "source_title": "Titulo legible del manual o documento de origen, sin extension PDF",
      "topic": "Tema exacto al que pertenece el contenido",
      "chapter": "Capitulo exacto al que pertenece el contenido",
      "reference": "Nombre PDF - pagina X - apartado Y si existe",
      "difficulty": "PRINCIPIANTE|FACIL|DIFICIL (sin tildes)",
      "source_chunk_id": "uuid del fragmento usado"
    }
  ]
}`,
    },
  ];
}

async function saveIfUnique({ question, sourceChunk, document, testId, userId, documentId }) {
  const originalFilename = normalizeFilename(document.original_filename);
  const sourceTitle = resolveManualFilename(originalFilename);
  const sourceLabel = formatCeisSourceLabel(document.display_title, originalFilename);
  const topic =
    document.content_type === "TEMA"
      ? originalFilename
      : normalizeUnicode(question.topic || "No identificado");
  const chapter =
    document.content_type === "TEMA"
      ? "No identificado"
      : document.content_type === "CAPITULO"
        ? originalFilename
        : normalizeUnicode(question.chapter || "No identificado");
  const normalizedQuestion = stripSourcePrefix(
    stripSourcePrefix(normalizeUnicode(question.question).trim(), question.source_title),
    sourceTitle,
  );
  const cleanQuestion = stripLegacyCeisPrefix(
    stripSourcePrefix(normalizedQuestion, question.source_title),
  );
  const prefixedQuestion = cleanQuestion
    .toLocaleLowerCase("es-ES")
    .startsWith(sourceLabel.toLocaleLowerCase("es-ES"))
    ? cleanQuestion
    : `${sourceLabel}. ${cleanQuestion}`;
  const embedding = await createEmbedding(
    `${prefixedQuestion}\n${question.option_a}\n${question.option_b}\n${question.option_c}\n${question.option_d}`,
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
       question_set_id,
       source_chunk_id,
       question,
       option_a,
       option_b,
       option_c,
       option_d,
       correct_answer,
       explanation,
       source_title,
       topic,
       chapter,
       reference,
       difficulty,
       embedding
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::vector)
     returning *`,
    [
      userId,
      documentId,
      testId || null,
      sourceChunk?.id || null,
      prefixedQuestion,
      normalizeUnicode(question.option_a),
      normalizeUnicode(question.option_b),
      normalizeUnicode(question.option_c),
      normalizeUnicode(question.option_d),
      question.correct_answer,
      normalizeUnicode(question.explanation),
      sourceTitle,
      topic,
      chapter,
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
    "source_title",
    "topic",
    "chapter",
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

export async function exportQuestionsXlsx(user, documentId, testId) {
  return exportQuestionsRows(user, documentId, testId);
}

export async function exportQuestionsRows(user, documentId, testId = "") {
  if (!testId) {
    throw new HttpError(400, "Selecciona un test para exportar sus preguntas");
  }
  const questions = await listQuestions(user, { documentId, testId });
  if (questions.length === 0) {
    throw new HttpError(404, "No hay preguntas para exportar");
  }

  return questions.map((item) => ({
    Test: item.test_name || "Sin test asignado",
    Pregunta: item.question,
    "Opcion A": item.option_a,
    "Opcion B": item.option_b,
    "Opcion C": item.option_c,
    "Opcion D": item.option_d,
    Correcta: item.correct_answer,
    Explicacion: item.explanation,
    Manual: item.source_title || item.original_filename,
    Tema: item.topic || "No identificado",
    Capitulo: item.chapter || "No identificado",
    Referencia: item.reference,
    Nivel: {
      PRINCIPIANTE: "P",
      FACIL: "F",
      DIFICIL: "D",
    }[item.difficulty] || item.difficulty,
  }));
}
