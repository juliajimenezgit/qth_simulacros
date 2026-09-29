import { DISTRACTOR_POLICY, POSITION_POLICY } from "../utils/questionPolicy.js";
import { auditCandidates } from "./questionAuditService.js";
import { balanceAnswers, validateCandidate, distributionErrors, coverageKey, enrichChapters, spreadSections, sourceReference, positionalReference, replaceLetterReferences, alignExplanationPages, FORMATS } from "../utils/questionValidation.js";
import { buildDocumentJobs } from "../utils/questionAllocation.js";
import { containsCategoryReference, formatCeisSourceLabel, stripSourcePrefix, stripLegacyCeisPrefix, stripSectionReference } from "../utils/questionSource.js";
import { z } from "zod";
import { env } from "../config/env.js";
import { query, withTransaction } from "../db/pool.js";
import { HttpError } from "../utils/errors.js";
import { parseModelJson } from "../utils/json.js";
import { toVectorLiteral } from "../utils/vector.js";
import { assertDocumentAccess } from "./documentService.js";
import {
  createChatJson,
  createEmbeddings,
  isOpenAiConfigured,
} from "./openaiService.js";
import { normalizeFilename, normalizeUnicode } from "../utils/unicode.js";
import { retrieveQualityInstructions } from "./qualityInstructionService.js";
import {
  formatPrivateQualityKnowledge,
  retrievePrivateQualityKnowledge,
} from "./qualityKnowledgeService.js";

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
    D: "DIFICIL",
    DIFICIL: "DIFICIL",
  }[normalized] || normalized;
}

const generatedQuestionSchema = z.object({
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
  difficulty: z.preprocess(
    normalizeDifficulty,
    z.enum(["PRINCIPIANTE", "FACIL", "DIFICIL"]),
  ),
  source_chunk_id: z.string().uuid(),
  format: z.enum(FORMATS).optional().catch(undefined),
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
       u.name as owner_name,
       dc.section as source_section
     from questions q
     join documents d on d.id = q.document_id
     left join document_chunks dc on dc.id = q.source_chunk_id
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
  } else if (row.content_type === "CAPITULO") {
    topic = originalFilename.replace(/[-_ ]cap(?:[ií]tulo)?[-_ ]*\d+(?=\.pdf$)/i, "");
    chapter = originalFilename;
  }

  const normalizedQuestion = stripSourcePrefix(
    stripSourcePrefix(normalizeUnicode(row.question).trim(), row.source_title),
    manualFilename,
  );
  const cleanQuestion = stripSectionReference(stripLegacyCeisPrefix(
    stripSourcePrefix(normalizedQuestion, row.source_title),
  ), row.source_section);
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

export async function generateQuestions({ user, documentId, count, difficulty, testId, coverageState = new Map(), formatState = new Map(), totalCount = count }) {
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

  difficulty = normalizeDifficulty(difficulty);
  if (!["PRINCIPIANTE", "FACIL", "DIFICIL"].includes(difficulty)) throw new HttpError(400, "Nivel no válido");
  const normalizedCount = Math.min(Math.max(Number(count), 1), 120);
  const saved = [];
  const rejectedQuestionTexts = [];
  const duplicateFeedback = [];
  const validationFeedback = [];
  const maxAttempts = Math.ceil(normalizedCount / 8) + 8;
  let attempt = 0;
  let contextOffset = 0;
  const orderedChunks = await getContextChunks(documentId, user.id);
  if (!coverageState.has(documentId)) coverageState.set(documentId, new Map());
  const sectionCounts = coverageState.get(documentId);
  const formatCounts = formatState;
  const formatLimitCount = Math.min(Math.max(Number(totalCount), 1), 120);
  const availableSections = [...new Set(orderedChunks.map(coverageKey))];

  while (saved.length < normalizedCount && attempt < maxAttempts) {
    const attemptStartedAt = Date.now();
    // Keep alternatives available when the final candidates are rejected.
    const batchSize = Math.min(Math.max((normalizedCount - saved.length) * 2, 4), 8);
    const contextChunks = pickContextChunks({
      orderedRows: orderedChunks,
      count: batchSize,
      offset: contextOffset,
    });
    contextOffset += contextChunks.length;
    const [previousTexts, qualityInstructions, privateQualityKnowledge] = await Promise.all([
      getPreviousQuestionTexts(documentId, user.id, contextChunks.map(chunk => chunk.id)),
      retrieveQualityInstructions({ difficulty, contextChunks }),
      retrievePrivateQualityKnowledge({ difficulty, contextChunks }),
    ]);
    const previousQuestions = [...new Set([...previousTexts, ...saved.map(row => row.question), ...rejectedQuestionTexts.slice(-24)])];
    const messages = buildPrompt({
      document,
      testId,
      contextChunks,
      count: batchSize,
      difficulty,
      previousQuestions,
      duplicateFeedback: duplicateFeedback.slice(-16),
      qualityInstructions,
      privateQualityKnowledge,
      validationFeedback: validationFeedback.slice(-12),
      coverageSummary: Object.fromEntries(sectionCounts),
      formatSummary: Object.fromEntries(formatCounts),
      formatLimitCount,
    });
    console.info(`[Generación contexto] documento=${documentId} nivel=${difficulty} reglas=${qualityInstructions.length} fragmentos=${contextChunks.length} caracteres=${messages.reduce((sum, message) => sum + message.content.length, 0)}`);
    const raw = await createChatJson(
      messages,
      Math.min((difficulty === "DIFICIL" ? 0.35 : 0.2) + attempt * 0.04, 0.55),
    );
    let parsed;
    try {
      parsed = z.object({ questions: z.array(z.unknown()) }).parse(parseModelJson(raw));
    } catch (error) {
      console.warn(`Intento ${attempt + 1}: respuesta de preguntas no válida`, error.message);
      attempt += 1;
      continue;
    }

    let invalidCount = 0;
    let rejectedCount = 0;
    let similarCount = 0;
    let structuralCount = 0;
    const savedBefore = saved.length;
    const candidates = [];
    const reject = (question, errors, details = []) => {
      rejectedCount += 1;
      const item = { question: question?.question || "Candidata sin enunciado", errors, details };
      validationFeedback.push(item);
      console.warn(`[Generación validación] documento=${documentId} intento=${attempt + 1} errores=${errors.join(",")} detalle=${JSON.stringify(item)}`);
    };
    for (const candidate of parsed.questions.slice(0, batchSize)) {
      const result = generatedQuestionSchema.safeParse(candidate);
      if (!result.success) {
        invalidCount += 1;
        reject(candidate, result.error.issues.map(issue => `ESQUEMA_${issue.path.join(".")}`));
        continue;
      }
      const question = result.data;
      // Repair presentation details that do not change the content before validating.
      question.explanation = alignExplanationPages(
        replaceLetterReferences(question.explanation, question),
        contextChunks.find(chunk => chunk.id === question.source_chunk_id),
      );
      const { errors, chunk: sourceChunk } = validateCandidate(question, { difficulty, document, contextChunks });
      if (errors.length) {
        const positional = ["question", "explanation", "option_a", "option_b", "option_c", "option_d"]
          .map(field => [field, positionalReference(question[field])]).find(([, match]) => match);
        reject(question, errors, positional ? [{ field: positional[0], match: positional[1] }] : []);
        continue;
      }
      // Distribution depends only on the fragment and the declared format: check it before paying for embeddings and audit.
      const earlyDistribution = distributionErrors({
        chunk: sourceChunk, format: question.format, sectionCounts, formatCounts, availableSections, count: formatLimitCount,
      });
      if (earlyDistribution.length) { reject(question, earlyDistribution); continue; }
      // Metadata comes from the actual source, never from a guessed LLM location.
      question.chapter = document.content_type === "CAPITULO" ? document.original_filename : sourceChunk.chapter;
      question.reference = sourceReference(document, sourceChunk);
      const prepared = prepareQuestion({ question, document, sourceChunk });
      if (!prepared) {
        structuralCount += 1;
        reject(question, ["REFERENCIA_ESTRUCTURAL_EN_OPCIONES"]);
        continue;
      }
      candidates.push({ question, prepared, sourceChunk });
    }
    // Embed the batch in one request, then check/save sequentially so duplicates
    // within this same batch see questions that have just been inserted.
    const embeddings = candidates.length
      ? await createEmbeddings(candidates.map(({ prepared }) => prepared.embeddingText))
      : [];
    if (embeddings.length !== candidates.length) {
      throw new HttpError(503, "No se pudieron comprobar todas las preguntas generadas");
    }
    const novel = [];
    const onDuplicate = (question, match) => {
      similarCount += 1;
      duplicateFeedback.push({ candidate: question.question, existing: match.question });
      console.info(`[Generación similitud] pregunta=${match.id} distancia=${Number(match.distance).toFixed(4)} umbral=${env.questionSimilarityThreshold}`);
    };
    for (const [index, candidate] of candidates.entries()) {
      const embedding = embeddings[index];
      const match = await findSimilarQuestion(embedding, documentId, user.id);
      if (match) {
        onDuplicate(candidate.question, match);
        rejectedCount += 1;
        rejectedQuestionTexts.push(candidate.question.question);
      } else novel.push({ ...candidate, embedding });
    }
    // One documentary review per novel batch; no extra AI calls for known duplicates.
    const audits = await auditCandidates(novel, difficulty, qualityInstructions, contextChunks);
    for (const [index, { question, prepared, sourceChunk, embedding }] of novel.entries()) {
      const audit = audits[index];
      const errors = [...(audit?.errors || ["AUDITORIA_INCOMPLETA"])];
      if (!errors.length) errors.push(...distributionErrors({
        chunk: sourceChunk, format: audit.format, sectionCounts, formatCounts, availableSections, count: formatLimitCount,
      }));
      if (errors.length) { reject(question, errors, audit?.details); continue; }
      const stored = await saveIfUnique({
        question,
        prepared,
        embedding,
        onDuplicate: (match) => onDuplicate(question, match),
        sourceChunk,
        document,
        testId,
        userId: user.id,
        documentId,
      });

      if (stored) {
        saved.push(stored);
        const section = coverageKey(sourceChunk);
        sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1);
        formatCounts.set(audit.format, (formatCounts.get(audit.format) || 0) + 1);
      } else {
        rejectedCount += 1;
        rejectedQuestionTexts.push(question.question);
      }
      if (saved.length === normalizedCount) break;
    }
    console.info(
      `[Generación] intento=${attempt + 1} aceptadas=${saved.length - savedBefore} inválidas=${invalidCount} rechazadas=${rejectedCount} similitud=${similarCount} estructura=${structuralCount} total=${saved.length}/${normalizedCount} segundos=${((Date.now() - attemptStartedAt) / 1000).toFixed(1)}`,
    );
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
      `Solo se pudieron validar ${saved.length} de ${normalizedCount} preguntas después de ${attempt} intentos`,
    );
  }

  return testId ? saved : persistBalancedQuestions(saved);
}

export async function generateConfiguredQuestions({
  user,
  selectedDocumentIds,
  contentCounts,
  documentCounts,
  difficultyCounts,
  testName,
}) {
  const generationStartedAt = performance.now();
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
  const jobs = documentCounts ? buildDocumentJobs(documents, documentCounts, contentCounts, difficultyCounts) : [];

  for (const [contentType, requestedCount] of Object.entries(documentCounts ? {} : contentCounts)) {
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
  const coverageState = new Map();
  const formatState = new Map();
  const saved = [];
  try {
    for (const job of jobs) {
      const matchingDocuments = job.documentId ? documents.filter((document) => document.id === job.documentId) : documentsByType[job.contentType];
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
            coverageState,
            formatState,
            totalCount: requestedCount,
          })),
        );
      }
    }
    if (saved.length !== requestedCount || Object.entries(difficultyCounts).some(([level, count]) =>
      saved.filter(question => question.difficulty === difficultyMap[level]).length !== count)) {
      throw new HttpError(422, "El test no cumple el reparto solicitado de preguntas y niveles");
    }
    // Balance across the complete test, not independently within each level/job.
    return await withTransaction(async client => {
      const balanced = await persistBalancedQuestions(saved, client);
      const { rows } = await client.query(
        `update question_sets set status = 'COMPLETED', generated_count = $2, completed_at = now()
         where id = $1 returning *`, [test.id, balanced.length],
      );
      const elapsedSeconds = ((performance.now() - generationStartedAt) / 1000).toFixed(1);
      console.info(`[Generación completada] test=${test.id} | ${balanced.length} preguntas generadas | tiempo total: ${elapsedSeconds} segundos`);
      return { questions: balanced, test: rows[0] };
    });
  } catch (error) {
    // Keep individually validated questions available even if the remaining ones fail.
    await query(
      `update question_sets
       set status = 'ERROR', generated_count = (select count(*) from questions where question_set_id = $1), error_message = $2
       where id = $1`,
      [test.id, normalizeUnicode(error.message || "Error generando el test")],
    );
    throw error;
  }
}

async function getContextChunks(documentId, userId) {
  const { rows: orderedRows } = await query(
    `select dc.id, dc.text, dc.page, dc.section, dc.created_at
     from document_chunks dc
     left join (
       select source_chunk_id, count(*) as question_count
       from questions where document_id = $1 and user_id = $2
       group by source_chunk_id
     ) usage on usage.source_chunk_id = dc.id
     where dc.document_id = $1
     order by coalesce(usage.question_count, 0),
              coalesce(dc.page, 2147483647), dc.created_at, dc.id
     `,
    [documentId, userId],
  );

  if (orderedRows.length === 0) {
    throw new HttpError(409, "El temario no tiene fragmentos procesados");
  }

  return spreadSections(enrichChapters(orderedRows));
}

function pickContextChunks({ orderedRows, count, offset }) {
  const windowSize = Math.max(4, Math.min(count * 3, 18));
  const start = offset % orderedRows.length;
  const sequentialRows = [
    ...orderedRows.slice(start),
    ...orderedRows.slice(0, start),
  ].slice(0, windowSize);

  return sequentialRows;
}

async function getPreviousQuestionTexts(documentId, userId, chunkIds) {
  const { rows } = await query(
    `select question
     from questions
     where document_id = $1 and user_id = $2
     order by case when source_chunk_id = any($3::uuid[]) then 0 else 1 end,
              created_at desc, id
     limit 60`,
    [documentId, userId, chunkIds],
  );

  return rows.map((row) => row.question);
}

function buildPrompt({
  document,
  contextChunks,
  count,
  difficulty,
  previousQuestions,
  duplicateFeedback,
  qualityInstructions,
  privateQualityKnowledge,
  validationFeedback,
  coverageSummary,
  formatSummary,
  formatLimitCount,
}) {
  const levelInstructions = {
    PRINCIPIANTE:
      "Nivel P (Principiante): preguntas directas, claras y centradas en conceptos fundamentales, definiciones básicas o contenido literal.",
    FACIL:
      "Nivel F (Fácil/intermedio): exige mayor dominio, comprensión y memorización precisa, con distractores plausibles y relativamente parecidos.",
    DIFICIL:
      "Nivel D (Difícil): exige detalles, relaciones entre conceptos, aplicación práctica o cálculos, con distractores muy plausibles sin ambigüedad.",
  };

  const context = contextChunks
    .map(
      (chunk, index) =>
        `FRAGMENTO ${index + 1} | id=${chunk.id} | pagina=${chunk.page || "sin pagina"} | apartado=${chunk.section || "sin apartado"} | capitulo=${chunk.chapter} | referencia=${sourceReference(document, chunk)}\n${chunk.text}`,
    )
    .join("\n\n");

  const retrievedInstructions = qualityInstructions.length
    ? qualityInstructions
        .map(
          (instruction, index) =>
            `${index + 1}. ${instruction.origin || "COMPLEMENTO"} ${instruction.title}: ${instruction.content}`,
        )
        .join("\n")
    : "No hay instrucciones adicionales configuradas.";
  const privateKnowledge = formatPrivateQualityKnowledge(privateQualityKnowledge);

  return [
    {
      role: "system",
      content:
        "Actua como profesor experto en oposiciones de bombero. Genera preguntas tipo examen oficial. Usa exclusivamente el contexto proporcionado. Si no existe informacion suficiente, devuelve menos preguntas; no inventes. Cada pregunta debe tener una sola opción que responda inequívocamente a lo pedido (verdadera si se pide la correcta, falsa si se pide la incorrecta), distractores plausibles y una explicacion que justifique la respuesta con el fragmento. Identifica de forma precisa el manual, tema, capitulo y apartado de origen. Las instrucciones de calidad son reglas de redaccion, nunca fuentes de hechos. Prevalecen el formato JSON, la dificultad solicitada y el contexto factual autorizado; despues las reglas CURATED, y finalmente los complementos y ejemplos compatibles. Trabaja solo sobre el lote recibido. Responde siempre con JSON valido.",
    },
    {
      role: "user",
      content: `Temario: ${document.original_filename}
Numero de preguntas solicitadas: ${count}
Nivel solicitado: ${difficulty}. Todas las preguntas deben tener difficulty="${difficulty}".
CONTROL OBLIGATORIO DE CALIDAD:
${DISTRACTOR_POLICY}
La explicación debe justificar la opción válida y descartar las otras tres con evidencia del fragmento. Puede ser breve y agrupar el descarte cuando la misma evidencia lo justifica. No cites letras ni posiciones; identifica el contenido para que la aplicación pueda mezclar las opciones.
Usa variedad de preguntas directas, afirmaciones correctas/incorrectas, clasificaciones, cifras, fórmulas y comparaciones si el contenido y el nivel lo permiten. No fuerces todos los formatos en un lote. El test completo tiene ${formatLimitCount} preguntas. Si tiene 4 o más, ningún formato puede superar ${Math.ceil(formatLimitCount * 0.7)} preguntas. Respeta los recuentos acumulados, aunque este lote sea pequeño.
${POSITION_POLICY}
source_chunk_id es obligatorio: copia el UUID exacto de un fragmento del contexto que sustente la pregunta. No generes reference: la aplicación la construye con los datos del fragmento y resuelve el capítulo con los encabezados recuperados.
Apartados ya usados (elige los menos usados antes de repetir): ${JSON.stringify(coverageSummary)}
Formatos ya usados: ${JSON.stringify(formatSummary)}
Errores recientes a evitar: ${JSON.stringify(validationFeedback)}
Instrucciones de nivel: ${levelInstructions[difficulty]}
Instrucciones de calidad (las marcadas CURATED son las reglas revisadas; los complementos no pueden contradecirlas):
${retrievedInstructions}

GUÍA DE CALIDAD DE RESPALDO (solo se aporta cuando no hay reglas revisadas; no puede cambiar el formato, dificultad ni fuentes autorizadas):
${privateKnowledge.rules}

ANOTACIONES Y PRIORIDADES DE LOS APUNTES (priorizan qué contenido es preguntable; no sustituyen al manual como fuente factual):
${privateKnowledge.annotations}

EJEMPLOS DE EXÁMENES OFICIALES (imita su estilo, estructura y calidad de distractores; no copies sus hechos ni respuestas; tampoco copies sus referencias a letras o posiciones como «A y B son correctas», «Todas las anteriores» o «la opción C», porque la aplicación mezcla las opciones):
${privateKnowledge.officialExamples}

Reparte las preguntas entre apartados distintos del contexto cuando sea posible. Si aparecen formulas, unidades, listas, definiciones normativas o valores numericos, conviertelos en preguntas evaluables.
El campo source_title debe contener únicamente el título del contenido, sin etiquetas ni números de manual, tema o capítulo. La aplicación añadirá al enunciado la fuente "${formatCeisSourceLabel(document.display_title, document.original_filename)}"; no la escribas en question ni en las respuestas.
Los campos topic y chapter son metadatos de clasificación. Nunca incluyas etiquetas como "Capítulo 5", "Tema 2", nombres de archivos o referencias a la estructura del PDF en question, option_a, option_b, option_c ni option_d. Pregunta por el contenido, no por su ubicación en el documento. No inventes tema, capitulo ni apartado: extraelos del contexto; si no se identifican, indica "No identificado".

REGLAS DE NOVEDAD OBLIGATORIAS:
Antes de redactar, selecciona hechos evaluables distintos del contexto y descarta los que ya evalúan las preguntas excluidas. Cada pregunta del lote debe evaluar un hecho diferente: una condición, un valor, una excepción, una relación o un paso concreto. Reparte esos hechos entre fragmentos cuando haya material suficiente.
Cambiar palabras, invertir el enunciado, cambiar distractores o convertir la misma definición en un caso práctico NO crea una pregunta nueva. Si un hecho ya está evaluado, elige otro hecho respaldado por el contexto. No fuerces una dificultad distinta de la solicitada para conseguir novedad.
Comprueba la novedad frente al historial y dentro del propio lote antes de responder. Si no hay suficientes hechos nuevos, devuelve menos preguntas; no inventes ni rellenes con paráfrasis. No incluyas tu planificación en la respuesta.

Preguntas excluidas (priorizadas por los fragmentos de este lote; son ejemplos que evitar, no fuentes de hechos):
${previousQuestions.length ? previousQuestions.map((q) => `- ${q}`).join("\n") : "- Ninguna"}

RECHAZOS POR SIMILITUD DEL INTENTO ANTERIOR O RECIENTES:
${duplicateFeedback.length ? duplicateFeedback.map(({ candidate, existing }) => `- Candidata descartada: ${candidate}\n  Coincide con: ${existing || "una pregunta del historial"}. Evita volver a evaluar ese hecho; selecciona otro.`).join("\n") : "- Ninguno"}

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
      "difficulty": "PRINCIPIANTE|FACIL|DIFICIL (sin tildes)",
      "source_chunk_id": "uuid del fragmento usado",
      "format": "${FORMATS.join("|")} (objetivo principal de la pregunta)"
    }
  ]
}`,
    },
  ];
}

function prepareQuestion({ question, document, sourceChunk }) {
  const originalFilename = normalizeFilename(document.original_filename);
  const sourceTitle = resolveManualFilename(originalFilename);
  const sourceLabel = formatCeisSourceLabel(document.display_title, originalFilename);
  const topic =
    document.content_type === "TEMA"
      ? originalFilename
      : document.content_type === "CAPITULO"
        ? originalFilename.replace(/[-_ ]cap(?:[ií]tulo)?[-_ ]*\d+(?=\.pdf$)/i, "")
      : normalizeUnicode(question.topic || "No identificado");
  const chapter =
    document.content_type === "CAPITULO"
        ? originalFilename
        : normalizeUnicode(question.chapter || "No identificado");
  const normalizedQuestion = stripSourcePrefix(
    stripSourcePrefix(normalizeUnicode(question.question).trim(), question.source_title),
    sourceTitle,
  );
  const cleanQuestion = stripSectionReference(stripLegacyCeisPrefix(
    stripSourcePrefix(normalizedQuestion, question.source_title),
  ), sourceChunk?.section);
  const prefixedQuestion = cleanQuestion
    .toLocaleLowerCase("es-ES")
    .startsWith(sourceLabel.toLocaleLowerCase("es-ES"))
    ? cleanQuestion
    : `${sourceLabel}. ${cleanQuestion}`;
  // Reject structural labels instead of deleting words from potentially meaningful answers.
  if ([prefixedQuestion, question.option_a, question.option_b, question.option_c, question.option_d]
    .some(containsCategoryReference)) return null;
  return {
    prefixedQuestion, sourceTitle, topic, chapter,
    embeddingText: `${prefixedQuestion}\n${question.option_a}\n${question.option_b}\n${question.option_c}\n${question.option_d}`,
  };
}

async function findSimilarQuestion(embedding, documentId, userId) {
  const vector = toVectorLiteral(embedding);
  const { rows: similarRows } = await query(
    `select id, question, embedding <=> $1::vector as distance
     from questions
     where document_id = $2 and user_id = $3 and embedding is not null
     order by embedding <=> $1::vector
     limit 1`,
    [vector, documentId, userId],
  );

  return similarRows[0] && Number(similarRows[0].distance) <= env.questionSimilarityThreshold ? similarRows[0] : null;
}

async function saveIfUnique({ question, prepared, embedding, sourceChunk, testId, userId, documentId, onDuplicate }) {
  const { prefixedQuestion, sourceTitle, topic, chapter } = prepared;
  const vector = toVectorLiteral(embedding);

  const match = await findSimilarQuestion(embedding, documentId, userId);
  if (match) { onDuplicate(match); return null; }

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

async function persistBalancedQuestions(questions, client) {
  if (!client) return withTransaction(transaction => persistBalancedQuestions(questions, transaction));
  const balanced = balanceAnswers(questions);
  for (const question of balanced) {
    await client.query(
      `update questions set option_a = $2, option_b = $3, option_c = $4, option_d = $5, correct_answer = $6
       where id = $1`,
      [question.id, question.option_a, question.option_b, question.option_c, question.option_d, question.correct_answer],
    );
  }
  return balanced;
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
