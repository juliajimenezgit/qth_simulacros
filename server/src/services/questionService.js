import { CALCULATION_RULE, CONTESTABLE_CASES, DIFFICULTY_PRINCIPLE, DISTRACTOR_GUIDE, FORMAT_DEFINITIONS, LEVEL_GUIDE, POSITION_POLICY, QUESTION_ANATOMY, TEACHER_GENERAL_STYLE, TEACHER_STYLE } from "../utils/questionPolicy.js";
import { formatTeacherExamples, loadTeacherExamples, pickTeacherExamples } from "./teacherExamplesService.js";
import { auditCandidates } from "./questionAuditService.js";
import { overlappingDocuments } from "../utils/documentHierarchy.js";
import { batchTypePlan, formatTypePlan, QUESTION_TYPES, QUESTION_TYPE_DEFINITIONS, splitTypePlan, typeErrors, typeSelectionError, typeTargets } from "../utils/questionTypes.js";
import { rebalanceOptionLengths } from "./questionRepairService.js";
import {
  createProgress, logAttempt, logQuestionSaved, logRejectionDetail, logTestCompleted, logTestFailed, logTestStarted,
  logVerbose, recordRejection,
} from "../utils/generationLog.js";
import { balanceAnswers, validateCandidate, distributionErrors, coverageKey, enrichChapters, spreadSections, sourceReference, positionalReference, replaceLetterReferences, alignExplanationPages, FORMATS, questionFormat, invertedQuota, formatCap, optionWordCounts, MAX_FORMAT_SHARE, withNoneOption, stripExplanationReference, hasGlobalAnswer, maxGlobalAnswers, GLOBAL_ANSWER_KEY } from "../utils/questionValidation.js";
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
  estimatedCost,
  isOpenAiConfigured,
} from "./openaiService.js";
import { normalizeFilename, normalizeUnicode } from "../utils/unicode.js";
import { retrieveQualityInstructions } from "./qualityInstructionService.js";
import {
  formatPrivateQualityKnowledge,
  retrievePrivateQualityKnowledge,
} from "./qualityKnowledgeService.js";
import { isAdmin } from "../utils/roles.js";

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

// What the generator needs to avoid a rejection again: the reasons, the word counts and the reviewer's reason
// for the options that failed. The full review (quotes of every option) made each retry thousands of tokens longer.
export function compactFeedback({ question, errors, details = [] }) {
  const failed = new Set(errors.map(error => error.match(/_([A-D])$/)?.[1]).filter(Boolean));
  const compact = details.flatMap(detail => {
    if (detail.letter) return failed.has(detail.letter) ? [{ opcion: detail.letter, motivo: detail.reason }] : [];
    return [detail];
  });
  return compact.length ? { question, errors, details: compact } : { question, errors };
}

// The model writes in the teacher's order: idea, stem, correct answer, then distractors. The correct
// answer goes to A; the options are shuffled when the test is saved (balanceAnswers).
export function fromTeacherOrder(candidate) {
  if (!candidate || typeof candidate !== "object" || !("correct_option" in candidate) || !Array.isArray(candidate.distractors)) return candidate;
  const { correct_option: correct, distractors, idea, ...rest } = candidate;
  const [b, c, d] = distractors;
  return { ...rest, option_a: correct, option_b: b, option_c: c, option_d: d, correct_answer: "A" };
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
  question_type: z.enum(QUESTION_TYPES).optional().catch(undefined),
});

export async function listQuestions(user, filters = {}) {
  const params = [];
  const clauses = [];

  if (!isAdmin(user)) {
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

// A generation runs inside the server process: if the server restarts (nodemon does on every saved
// file), its test would stay GENERATING forever and the app would keep showing it as in progress.
export async function markInterruptedQuestionSets() {
  const { rowCount } = await query(
    `update question_sets
     set status = 'ERROR',
         generated_count = (select count(*) from questions where question_set_id = question_sets.id),
         error_message = 'La generación se interrumpió porque el servidor se reinició. Las preguntas ya validadas se conservan.'
     where status = 'GENERATING'`,
  );
  return rowCount;
}

export async function listQuestionSets(user) {
  const params = [];
  let ownerClause = "";
  if (!isAdmin(user)) {
    params.push(user.id);
    ownerClause = "where qs.user_id = $1";
  }
  const { rows } = await query(
    `select qs.*, count(q.id)::int as question_count
     from question_sets qs
     left join questions q on q.question_set_id = qs.id
     where not qs.is_demo ${ownerClause.replace("where", "and")}
     group by qs.id
     order by qs.created_at desc`,
    params,
  );
  return rows;
}

function applyDocumentHierarchy(row) {
  // Keep the teacher's wording and source fields intact in review and exports.
  if (row.is_manual) return row;
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
    // Questions saved before the reference was shown apart still start their explanation with it.
    explanation: stripExplanationReference(row.explanation),
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

// typeState/typeTargets: questions of each type saved in the test and the teachers' mix it must reach (null: no mix).
export async function generateQuestions({ user, documentId, count, difficulty, testId, coverageState = new Map(), formatState = new Map(), typeState = new Map(), typeTargets: targets = null, allowedTypes = null, totalCount = count, progress }) {
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
  const documentLabel = document.display_title || document.original_filename;
  progress ||= createProgress({ name: documentLabel, requested: normalizedCount });
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
    // The batch is written in parallel parts of up to 4 questions, each on its own fragments: one call writing 8
    // questions took ~20 s of output alone, and the attempts are what a test waits for.
    const partCount = Math.ceil(batchSize / (env.generationPartSize || 4));
    const partSizes = Array.from({ length: partCount }, (_, index) =>
      Math.floor(batchSize / partCount) + (index < batchSize % partCount ? 1 : 0));
    const partChunks = partSizes.map((size) => {
      const chunks = pickContextChunks({ orderedRows: orderedChunks, count: size, offset: contextOffset });
      contextOffset += chunks.length;
      return chunks;
    });
    const contextChunks = [...new Map(partChunks.flat().map(chunk => [chunk.id, chunk])).values()];
    const [previousTexts, qualityInstructions, privateQualityKnowledge, teacherExamples] = await Promise.all([
      getPreviousQuestionTexts(documentId, user.id, contextChunks.map(chunk => chunk.id), testId),
      retrieveQualityInstructions({ difficulty, contextChunks }),
      retrievePrivateQualityKnowledge({ difficulty, contextChunks }),
      loadTeacherExamples(difficulty),
    ]);
    const previousQuestions = [...new Set([...previousTexts, ...saved.map(row => row.question), ...rejectedQuestionTexts.slice(-24)])];
    // The types of the whole batch, dealt to the parts so they do not all ask for the same ones.
    const partPlans = splitTypePlan(targets ? batchTypePlan({ targets, typeCounts: typeState, difficulty, count: batchSize }) : null, partSizes);
    const temperature = Math.min((difficulty === "DIFICIL" ? 0.35 : 0.2) + attempt * 0.04, 0.55);
    const responses = await Promise.all(partSizes.map((size, part) => {
      const messages = buildPrompt({
        document,
        testId,
        contextChunks: partChunks[part],
        count: size,
        difficulty,
        previousQuestions,
        duplicateFeedback: duplicateFeedback.slice(-16),
        qualityInstructions,
        privateQualityKnowledge,
        // Different teachers' examples in every part and attempt, so the model sees more of their variety.
        teacherExamples: pickTeacherExamples(teacherExamples, difficulty),
        validationFeedback: validationFeedback.slice(-8).map(compactFeedback),
        coverageSummary: Object.fromEntries(sectionCounts),
        formatSummary: Object.fromEntries(formatCounts),
        formatLimitCount,
        invertedTarget: invertedQuota(formatCounts, formatLimitCount),
        typeGuide: targets ? formatTypePlan(partPlans[part]) : "",
      });
      logVerbose(`[Generación contexto] documento=${documentId} nivel=${difficulty} parte=${part + 1}/${partSizes.length} reglas=${qualityInstructions.length} fragmentos=${partChunks[part].length} caracteres=${messages.reduce((sum, message) => sum + message.content.length, 0)}`);
      return createChatJson(messages, temperature).then((raw) => {
        try {
          return z.object({ questions: z.array(z.unknown()) }).parse(parseModelJson(raw)).questions;
        } catch (error) {
          console.warn(`  ⚠ ${documentLabel}: el modelo devolvió una respuesta no válida en el intento ${attempt + 1} (${error.message})`);
          return null;
        }
      });
    }));
    if (responses.every((questions) => questions === null)) {
      attempt += 1;
      continue;
    }
    const parsed = { questions: responses.flatMap((questions) => questions || []) };

    // Spreading across sections is a preference: in the second half of the attempts it no longer rejects.
    const relaxCoverage = attempt >= Math.floor(maxAttempts / 2);
    let invalidCount = 0;
    let rejectedCount = 0;
    let similarCount = 0;
    let structuralCount = 0;
    const savedBefore = saved.length;
    const candidates = [];
    const attemptReasons = new Map();
    const reject = (question, errors, details = []) => {
      rejectedCount += 1;
      const item = { question: question?.question || "Candidata sin enunciado", errors, details };
      validationFeedback.push(item);
      recordRejection(progress, attemptReasons, errors);
      logRejectionDetail({ documentLabel, attempt: attempt + 1, question: item.question, errors, details });
    };
    const parsedQuestions = [];
    for (const candidate of parsed.questions.slice(0, batchSize)) {
      const result = generatedQuestionSchema.safeParse(fromTeacherOrder(candidate));
      if (!result.success) {
        invalidCount += 1;
        reject(candidate, result.error.issues.map(issue => `ESQUEMA_${issue.path.join(".")}`));
        continue;
      }
      const question = result.data;
      // Repair presentation details that do not change the content before validating.
      question.explanation = alignExplanationPages(
        stripExplanationReference(replaceLetterReferences(question.explanation, question)),
        contextChunks.find(chunk => chunk.id === question.source_chunk_id),
      );
      parsedQuestions.push(question);
    }
    // Unequal option lengths were the most frequent rejection: reword those options (in parallel)
    // instead of discarding questions that are otherwise valid.
    let repairedCount = 0;
    const validQuestions = await Promise.all(parsedQuestions.map(async (question) => {
      const { errors, chunk } = validateCandidate(question, { difficulty, document, contextChunks });
      if (errors.length !== 1 || errors[0] !== "OPCIONES_LONGITUD_DESIGUAL") return question;
      const repaired = await rebalanceOptionLengths(question, chunk);
      if (repaired !== question) repairedCount += 1;
      return repaired;
    }));
    for (const question of validQuestions) {
      const { errors, chunk: sourceChunk } = validateCandidate(question, { difficulty, document, contextChunks });
      if (errors.length) {
        const positional = ["question", "explanation", "option_a", "option_b", "option_c", "option_d"]
          .map(field => [field, positionalReference(question[field])]).find(([, match]) => match);
        const details = positional ? [{ field: positional[0], match: positional[1] }] : [];
        // The model cannot fix a length it does not see: report the words of each option.
        if (errors.includes("OPCIONES_LONGITUD_DESIGUAL")) details.push({ palabras_por_opcion: optionWordCounts(question), maximo_diferencia: 5 });
        reject(question, errors, details);
        continue;
      }
      // Distribution depends only on the fragment and the declared format: check it before paying for embeddings and audit.
      const earlyDistribution = distributionErrors({
        chunk: sourceChunk, format: questionFormat(question, question.format), sectionCounts, formatCounts, availableSections, count: formatLimitCount, relaxCoverage,
        globalAnswer: hasGlobalAnswer(question),
      });
      // A pending INCORRECTA/Todas/Ninguna quota is resolved after the review (see withNoneOption), unless
      // the Todas/Ninguna cap is already full: then the question would be reviewed only to be thrown away.
      const noneFits = (formatCounts.get("TODAS_NINGUNA") || 0) < formatCap("TODAS_NINGUNA", formatLimitCount);
      const blocking = earlyDistribution.filter(error => error !== "CUOTA_NEGATIVAS_PENDIENTE" || !noneFits);
      // The type the model declares: a question outside the teachers' mix is not worth a review.
      blocking.push(...typeErrors({ type: question.question_type, difficulty, targets, typeCounts: typeState, relax: relaxCoverage, allowed: allowedTypes }));
      if (blocking.length) { reject(question, blocking); continue; }
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
      recordRejection(progress, attemptReasons, ["REPETIDA"]);
      logVerbose(`[Generación similitud] pregunta=${match.id} distancia=${Number(match.distance).toFixed(4)} umbral=${env.questionSimilarityThreshold}`);
    };
    for (const [index, candidate] of candidates.entries()) {
      const embedding = embeddings[index];
      const match = await findSimilarQuestion(embedding, { documentId, userId: user.id, testId });
      if (match) {
        onDuplicate(candidate.question, match);
        rejectedCount += 1;
        rejectedQuestionTexts.push(candidate.question.question);
      } else novel.push({ ...candidate, embedding });
    }
    // Review only as many candidates as questions are still missing, and the next ones only after a
    // rejection: each review sends ~10.000 tokens and reviewing the whole batch filled the OpenAI
    // per-minute quota with questions that were approved and then thrown away.
    const pending = [...novel];
    while (pending.length && saved.length < normalizedCount) {
      const round = pending.splice(0, normalizedCount - saved.length);
      const audits = await auditCandidates(round, difficulty, contextChunks);
      for (const [index, novelCandidate] of round.entries()) {
        const { embedding } = novelCandidate;
        let { question, prepared, sourceChunk } = novelCandidate;
        const audit = audits[index];
        // The reference points to the fragment where the reviewer found the answer, not to the one the model named.
        const answerChunk = audit?.sourceChunkId && contextChunks.find(chunk => chunk.id === audit.sourceChunkId);
        if (answerChunk && answerChunk.id !== sourceChunk.id) {
          const located = { ...question, source_chunk_id: answerChunk.id, reference: sourceReference(document, answerChunk),
            chapter: document.content_type === "CAPITULO" ? document.original_filename : answerChunk.chapter };
          const relocated = prepareQuestion({ question: located, document, sourceChunk: answerChunk });
          if (relocated) {
            logVerbose(`[Generación referencia] «${question.question}»: página ${sourceChunk.page} → ${answerChunk.page}`);
            question = located;
            prepared = relocated;
            sourceChunk = answerChunk;
          }
        }
        let format = questionFormat(question, audit?.format);
        // The type is decided when generating (the batch plan) and checked before the review, for free.
        const questionType = question.question_type || null;
        const distribution = () => distributionErrors({
          chunk: sourceChunk, format, sectionCounts, formatCounts, availableSections, count: formatLimitCount, relaxCoverage,
          globalAnswer: hasGlobalAnswer(question),
        });
        const errors = [...(audit?.errors || ["AUDITORIA_INCOMPLETA"])];
        // Another document of the test may have filled this type while this one was being reviewed.
        if (!errors.length) errors.push(...distribution(), ...typeErrors({ type: questionType, difficulty, targets, typeCounts: typeState, relax: relaxCoverage, allowed: allowedTypes }));
        // Only the minimum of INCORRECTA/Todas/Ninguna is missing: turn this approved question into one.
        if (errors.length === 1 && errors[0] === "CUOTA_NEGATIVAS_PENDIENTE" && format !== "INCORRECTA") {
          question = withNoneOption(question);
          format = "TODAS_NINGUNA";
          errors.splice(0, 1, ...distribution());
          logVerbose(`[Generación cuota] se añade «Ninguna es correcta» a «${question.question}»`);
        }
        if (errors.length) { reject(question, errors, audit?.details); continue; }
        // Reserve the slot before awaiting: other documents generate in parallel and share the format caps.
        const section = coverageKey(sourceChunk);
        const adjust = (map, key, delta) => map.set(key, (map.get(key) || 0) + delta);
        const globalAnswer = hasGlobalAnswer(question);
        adjust(sectionCounts, section, 1);
        adjust(formatCounts, format, 1);
        if (globalAnswer) adjust(formatCounts, GLOBAL_ANSWER_KEY, 1);
        if (questionType) adjust(typeState, questionType, 1);
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
          progress.saved += 1;
          // Without the manual prefix (even if the model wrote it): the document is already in the line.
          logQuestionSaved(progress, { question: { ...stored, question: prepared.cleanQuestion }, difficulty, documentLabel });
        } else {
          adjust(sectionCounts, section, -1);
          adjust(formatCounts, format, -1);
          if (globalAnswer) adjust(formatCounts, GLOBAL_ANSWER_KEY, -1);
          if (questionType) adjust(typeState, questionType, -1);
          rejectedCount += 1;
          rejectedQuestionTexts.push(question.question);
        }
        if (saved.length === normalizedCount) break;
      }
    }
    logAttempt({
      documentLabel, difficulty, attempt: attempt + 1, generated: parsed.questions.length, accepted: saved.length - savedBefore, repaired: repairedCount,
      attemptReasons, documentSaved: saved.length, documentRequested: normalizedCount,
      seconds: ((Date.now() - attemptStartedAt) / 1000).toFixed(0),
    });
    logVerbose(`[Generación] intento=${attempt + 1} inválidas=${invalidCount} rechazadas=${rejectedCount} similitud=${similarCount} estructura=${structuralCount}`);
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
  levelCounts = null,
  questionTypes = QUESTION_TYPES,
  testDifficulty = null,
  testName,
}) {
  const uniqueDocumentIds = [...new Set(selectedDocumentIds)];
  const params = [uniqueDocumentIds];
  let ownerClause = "";
  if (!isAdmin(user)) {
    params.push(user.id);
    ownerClause = `and user_id = $${params.length}`;
  }

  const { rows: documents } = await query(
    `select id, content_type, original_filename
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
  // Questions come from exactly the selected PDFs (manual, theme or chapter), but never from a PDF and another
  // one that contains it: they share content and generating from both gave the same questions twice.
  if (overlappingDocuments(documents).length) {
    throw new HttpError(400, "Has elegido un PDF que ya está incluido en otro de la selección (un tema dentro de su manual o un capítulo dentro de su tema)");
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
    `insert into question_sets (user_id, name, requested_count, difficulty_counts, document_ids, test_difficulty, level_counts)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [user.id, normalizeUnicode(testName || automaticName), requestedCount, JSON.stringify(difficultyCounts), uniqueDocumentIds, testDifficulty, levelCounts && JSON.stringify(levelCounts)],
  );
  const test = testRows[0];
  const progress = createProgress({ name: test.name, requested: requestedCount });
  const costBefore = estimatedCost();
  const spent = () => (costBefore == null ? null : estimatedCost() - costBefore);
  logTestStarted(progress, { documents: uniqueDocumentIds.length, difficultyCounts });
  const coverageState = new Map();
  const formatState = new Map();
  // The teachers' mix of question types for the levels of this test (Élite = F and D, so older calls
  // without level counts take their F and D questions as Élite).
  const allowedTypes = [...new Set(questionTypes)];
  const selectionError = typeSelectionError(allowedTypes, difficultyCounts);
  if (selectionError) throw new HttpError(400, selectionError);
  const targets = typeTargets(levelCounts || {
    PRINCIPIANTE: difficultyCounts.P || 0, ELITE: (difficultyCounts.F || 0) + (difficultyCounts.D || 0),
  }, allowedTypes);
  const typeState = new Map();
  const saved = [];
  try {
    const tasksByDocument = new Map();
    for (const job of jobs) {
      const matchingDocuments = job.documentId ? documents.filter((document) => document.id === job.documentId) : documentsByType[job.contentType];
      const baseCount = Math.floor(job.count / matchingDocuments.length);
      const extra = job.count % matchingDocuments.length;

      for (const [index, document] of matchingDocuments.entries()) {
        const count = baseCount + (index < extra ? 1 : 0);
        if (count === 0) continue;
        if (!tasksByDocument.has(document.id)) tasksByDocument.set(document.id, []);
        tasksByDocument.get(document.id).push({ documentId: document.id, difficulty: job.difficulty, count });
      }
    }
    // Documents are independent, so several are generated at once. Levels of the same document stay
    // sequential because they share its coverage and duplicate history.
    const results = await mapWithConcurrency([...tasksByDocument.values()], GENERATION_CONCURRENCY, async (tasks) => {
      const questions = [];
      for (const task of tasks) {
        questions.push(...(await generateQuestions({
          user,
          ...task,
          testId: test.id,
          coverageState,
          formatState,
          typeState,
          typeTargets: targets,
          allowedTypes,
          totalCount: requestedCount,
          progress,
        })));
      }
      return questions;
    });
    // Wait for every document before failing, so no generation keeps writing after the test is marked as failed.
    const failure = results.find((result) => result.error);
    if (failure) throw failure.error;
    saved.push(...results.flatMap((result) => result.value));
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
      logTestCompleted(progress, spent());
      return { questions: balanced, test: rows[0] };
    });
  } catch (error) {
    logTestFailed(progress, error, spent());
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

const GENERATION_CONCURRENCY = 3;
// The longest valid answer the generator may write: in the teachers' questions half the options have 4 words or
// fewer in P, and about 10 in D. A longer answer was the most frequent rejection (19-28 words vs 6-12).
const MAX_ANSWER_WORDS = { PRINCIPIANTE: 12, FACIL: 12, DIFICIL: 16 };

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]).then((value) => ({ value }), (error) => ({ error }));
    }
  }));
  return results;
}

async function getContextChunks(documentId, userId) {
  const { rows: orderedRows } = await query(
    // Questions cite the printed manual page, which students can look up, not the page inside a chapter PDF.
    `select dc.id, dc.text, coalesce(dc.manual_page, dc.page) as page, dc.section, dc.created_at
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
  // Twice the questions of the batch, at most 10: each fragment is ~300 tokens and every batch pays for them.
  const windowSize = Math.max(4, Math.min(count * 2, 10));
  const start = offset % orderedRows.length;
  const sequentialRows = [
    ...orderedRows.slice(start),
    ...orderedRows.slice(0, start),
  ].slice(0, windowSize);

  return sequentialRows;
}

// The questions of this test (any document) come first: those are the ones that cannot be repeated.
// Earlier tests of the same document follow only as guidance for variety.
async function getPreviousQuestionTexts(documentId, userId, chunkIds, testId = null) {
  const { rows } = await query(
    `select question
     from questions
     where user_id = $2 and (document_id = $1 or question_set_id = $4)
     order by case when question_set_id = $4 then 0 else 1 end,
              case when source_chunk_id = any($3::uuid[]) then 0 else 1 end,
              created_at desc, id
     limit 30`,
    [documentId, userId, chunkIds, testId],
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
  teacherExamples = [],
  validationFeedback,
  coverageSummary,
  formatSummary,
  formatLimitCount,
  invertedTarget,
  typeGuide = "",
}) {

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
PROCESO PARA CREAR CADA PREGUNTA (el mismo que siguen los profesores de QTH; el formato de respuesta sigue este orden):
1. Lee el apartado del fragmento y localiza una idea preguntable (idea), con su fragmento (source_chunk_id).
2. Decide qué quieres medir (question_type): literal, conceptual, clasificación, comparación, aplicación práctica, cálculo, detalle difícil o relación de conceptos.
3. El nivel ya está decidido: ${difficulty}.
4. Redacta un enunciado claro que indique exactamente qué se pide (question).
5. Escribe primero la respuesta correcta (correct_option). Sale literalmente del temario (en las preguntas que piden la INCORRECTA, y con «Todas son correctas», lo que sale literalmente son las tres afirmaciones verdaderas), pero solo el núcleo que responde a lo pedido: las palabras clave del manual, sin oraciones subordinadas, ejemplos ni enumeraciones accesorias. Como máximo ${MAX_ANSWER_WORDS[difficulty]} palabras. Cuenta sus palabras y escribe el número en correct_option_words.
6. Crea después los tres distractores (distractors), siguiendo estas reglas:
- Longitud: cada distractor tiene entre correct_option_words − 2 y correct_option_words + 2 palabras, con la misma plantilla gramatical y el mismo estilo que la correcta.
- Origen: los inventas tú con sentido común y criterio; no tienen que aparecer en el temario. También sirve un dato que el temario da para otro contexto (en una pregunta sobre el nitrógeno, una propiedad del CO₂). En las preguntas de cálculo, resultados de errores típicos con los datos del enunciado (unidad equivocada, fórmula inversa, paso omitido).
- Parecido con la correcta según el nivel: en P, fáciles de descartar si se conoce el dato, pero nunca sin conocerlo; en F, relativamente parecidos; en D, muy parecidos.
- ${DISTRACTOR_GUIDE}
${difficulty === "PRINCIPIANTE" ? "" : `- ${CALCULATION_RULE}\n`}- Prohibido: opciones que contradigan el propósito del concepto (acelerar la combustión en un mecanismo de extinción), que se contradigan a sí mismas o que pertenezcan a otra categoría (polvos en una pregunta de espumas).
7. Antes de responder, comprueba las cuatro opciones. Cuenta las palabras de cada una y escríbelas en option_words (la correcta y los tres distractores, en ese orden). Si entre la más larga y la más corta hay más de 5 palabras («Todas son correctas.» y «Ninguna es correcta.» no cuentan), reescríbelas ya: acorta la más larga hasta su núcleo o alarga las cortas, y vuelve a contar. Comprueba también que solo una opción responde a lo pedido y que ningún distractor puede defenderse como correcto. Una pregunta es impugnable, y no debe generarse, si tiene ${CONTESTABLE_CASES}. Si hay riesgo, elige otra idea preguntable o cambia el formato. La aplicación descarta las preguntas que no lo cumplan.
8. Añade una explicación breve, útil y fundamentada (explanation).
9. Comprueba que la pregunta no sea ambigua ni impugnable; si lo es, corrígela o descártala.
10. Clasifícala por tema (topic), capítulo (chapter), dificultad (difficulty) y formato (format).
${QUESTION_TYPE_DEFINITIONS}
${typeGuide}
CONTROL OBLIGATORIO DE CALIDAD:
${QUESTION_ANATOMY}
La explicación, como pide la guía de QTH, indica con claridad cuál es la respuesta válida (por su contenido) y por qué lo es con el texto del manual; explica por qué las demás no lo son cuando sea útil, y siempre en preguntas de afirmaciones, corrigiendo la falsa. Lenguaje sencillo y directo, sin alargarla si no aporta valor. No escribas en la explicación la página ni el apartado (ni al principio ni entre paréntesis): la aplicación muestra la referencia concreta aparte; empieza directamente por el texto del manual que justifica la respuesta. Puede ser breve y agrupar el descarte cuando la misma evidencia lo justifica. No cites letras ni posiciones; identifica el contenido para que la aplicación pueda mezclar las opciones.
Usa variedad de preguntas directas, afirmaciones correctas/incorrectas, clasificaciones, cifras, fórmulas y comparaciones si el contenido y el nivel lo permiten. No fuerces todos los formatos en un lote. El test completo tiene ${formatLimitCount} preguntas; procura que ningún formato supere el ${Math.round(MAX_FORMAT_SHARE * 100)}% del test.
${FORMAT_DEFINITIONS}
${invertedInstruction(invertedTarget, count, formatSummary, formatLimitCount)}
${POSITION_POLICY}
source_chunk_id es obligatorio: copia el UUID exacto de un fragmento del contexto que sustente la pregunta. No generes reference: la aplicación la construye con los datos del fragmento y resuelve el capítulo con los encabezados recuperados.
Apartados ya usados (elige los menos usados antes de repetir): ${JSON.stringify(coverageSummary)}
Formatos ya usados: ${JSON.stringify(formatSummary)}
Errores recientes a evitar: ${JSON.stringify(validationFeedback)}
Instrucciones de nivel (guía de QTH): ${DIFFICULTY_PRINCIPLE} ${LEVEL_GUIDE[difficulty]}
Instrucciones de calidad (las marcadas CURATED son las reglas revisadas; los complementos no pueden contradecirlas):
${retrievedInstructions}

GUÍA DE CALIDAD DE RESPALDO (solo se aporta cuando no hay reglas revisadas; no puede cambiar el formato, dificultad ni fuentes autorizadas):
${privateKnowledge.rules}

ANOTACIONES Y PRIORIDADES DE LOS APUNTES (priorizan qué contenido es preguntable; no sustituyen al manual como fuente factual):
${privateKnowledge.annotations}

PREGUNTAS DE LOS PROFESORES DE QTH, NIVEL ${difficulty} (son el modelo a imitar: forma del enunciado, longitud y tipo de opciones, cómo construyen los distractores y cómo explican. No copies sus hechos ni sus preguntas; genera las tuyas solo con el contexto autorizado. La aplicación coloca las opciones y añade la referencia; tú no lo hagas):
${formatTeacherExamples(teacherExamples)}
${TEACHER_STYLE[difficulty]}
${TEACHER_GENERAL_STYLE}

EJEMPLOS DE EXÁMENES OFICIALES (imita su estilo, estructura y calidad de distractores; no copies sus hechos ni respuestas; tampoco copies sus referencias a letras o posiciones como «A y B son correctas», «Todas las anteriores» o «la opción C», porque la aplicación mezcla las opciones):
${privateKnowledge.officialExamples}

Reparte las preguntas entre apartados distintos del contexto cuando sea posible. Si aparecen formulas, unidades, listas, definiciones normativas o valores numericos, conviertelos en preguntas evaluables.
El campo source_title debe contener únicamente el título del contenido, sin etiquetas ni números de manual, tema o capítulo. La aplicación añadirá al enunciado la fuente "${formatCeisSourceLabel(document.display_title, document.original_filename)}"; no la escribas en question ni en las respuestas.
Los campos topic y chapter son metadatos de clasificación. Nunca incluyas etiquetas como "Capítulo 5", "Tema 2", nombres de archivos o referencias a la estructura del PDF en question, correct_option ni distractors. Pregunta por el contenido, no por su ubicación en el documento. No inventes tema, capitulo ni apartado: extraelos del contexto; si no se identifican, indica "No identificado".

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
      "source_chunk_id": "uuid del fragmento usado",
      "idea": "Idea preguntable del apartado, en una frase",
      "question_type": "${QUESTION_TYPES.join("|")}",
      "difficulty": "PRINCIPIANTE|FACIL|DIFICIL (sin tildes)",
      "question": "Enunciado",
      "correct_option": "Respuesta correcta: núcleo literal del temario",
      "correct_option_words": 0,
      "distractors": ["Distractor con correct_option_words ± 2 palabras", "Distractor 2", "Distractor 3"],
      "option_words": [0, 0, 0, 0],
      "explanation": "Explicacion basada en el contexto",
      "source_title": "Titulo legible del manual o documento de origen, sin extension PDF",
      "topic": "Tema exacto al que pertenece el contenido",
      "chapter": "Capitulo exacto al que pertenece el contenido",
      "format": "${FORMATS.join("|")} (objetivo principal de la pregunta)"
    }
  ]
}`,
    },
  ];
}

// The quota is test-wide: ask each batch for its proportional share of what is still missing.
function invertedInstruction({ required, inverted, missing, remaining }, count, formatSummary, formatLimitCount) {
  if (!required) return "Puedes incluir preguntas que pidan la INCORRECTA o con «Todas son correctas.»/«Ninguna es correcta.» cuando el contenido lo permita.";
  // Tell the model how many INCORRECTA slots are left: asking for "negative or Todas/Ninguna" alone made it
  // fill the quota with INCORRECTA, which were then discarded for exceeding their cap.
  const incorrectaLeft = Math.max(formatCap("INCORRECTA", formatLimitCount) - (formatSummary.INCORRECTA || 0), 0);
  const globalLeft = Math.max(formatCap("TODAS_NINGUNA", formatLimitCount) - (formatSummary.TODAS_NINGUNA || 0), 0);
  // Never ask for more than the caps still allow: a 5-question test was asked for 4 of 8 while only
  // 1 INCORRECTA and 1 Todas/Ninguna fitted, and the model filled the batch with «Todas son correctas».
  // The last questions of the test must all be of this type: every candidate of the batch must be, so the
  // reserve is useful too (asking for «at least 1 of 4» gave batches of ordinary questions that were thrown away).
  if (missing >= remaining && incorrectaLeft + globalLeft > 0) {
    const kinds = [incorrectaLeft && "pedir la INCORRECTA o lo que NO es", globalLeft && "incluir «Todas son correctas.» o «Ninguna es correcta.»"].filter(Boolean).join(" o ");
    return `Las ${missing} preguntas que faltan del test deben ${kinds} para cumplir el mínimo del 30%: TODAS las preguntas de este lote deben ser de ese tipo (solo se guardarán ${missing}; las demás son reserva). Ninguna pregunta de este lote puede pedir simplemente la CORRECTA.`;
  }
  const proportional = missing ? Math.max(1, Math.ceil((missing / Math.max(remaining, 1)) * count)) : 0;
  const share = Math.min(proportional, missing, incorrectaLeft + globalLeft, count);
  const negatives = incorrectaLeft
    ? `Como máximo ${Math.min(incorrectaLeft, count)} preguntas de este lote pueden pedir la INCORRECTA o lo que NO es (quedan ${incorrectaLeft} en todo el test); las demás piden la CORRECTA.`
    : "El cupo de preguntas que piden la INCORRECTA o lo que NO es está agotado: NO generes ninguna; todas las preguntas de este lote piden la CORRECTA.";
  const answersLeft = Math.max(maxGlobalAnswers(formatLimitCount) - (formatSummary[GLOBAL_ANSWER_KEY] || 0), 0);
  const globals = globalLeft
    ? `Como máximo ${Math.min(globalLeft, count)} preguntas de este lote pueden incluir «Todas son correctas.» o «Ninguna es correcta.» (quedan ${globalLeft} en todo el test, máximo 15%); el resto de preguntas del lote no las incluyen. Aproximadamente en un tercio de ellas esa opción debe ser la respuesta válida (quedan ${answersLeft}); en las demás es un distractor. Para que sea la válida, las otras tres opciones deben ser todas verdaderas («Todas son correctas.») o todas falsas («Ninguna es correcta.»). La aplicación coloca siempre esa opción en la D.`
    : "El cupo de «Todas son correctas.»/«Ninguna es correcta.» está agotado: NO las uses en este lote.";
  return `Al menos ${required} preguntas del test (30%) deben pedir la INCORRECTA o incluir «Todas son correctas.» o «Ninguna es correcta.» como una de las opciones (correcta o distractor). Llevas ${inverted}. ${share ? `En este lote, al menos ${share} de las ${count} preguntas deben ser de este tipo.` : "El mínimo ya está cubierto."} ${negatives} ${globals} En las preguntas INCORRECTA, las tres opciones verdaderas se copian literalmente del temario (puedes recortar la frase para ajustar la longitud, pero no reescribirla) y la falsa es una de ellas con un dato cambiado o un dato de otro contexto del mismo tema.`;
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
    prefixedQuestion, cleanQuestion, sourceTitle, topic, chapter,
    embeddingText: `${prefixedQuestion}\n${question.option_a}\n${question.option_b}\n${question.option_c}\n${question.option_d}`,
  };
}

// Within a test no question may repeat another, whatever document it comes from (a chapter PDF and its
// topic PDF share content). Questions from other tests may repeat. Outside a test, the document history applies.
async function findSimilarQuestion(embedding, { documentId, userId, testId }) {
  const vector = toVectorLiteral(embedding);
  const [scope, params] = testId
    ? ["question_set_id = $2", [vector, testId]]
    : ["document_id = $2 and user_id = $3", [vector, documentId, userId]];
  const { rows: similarRows } = await query(
    `select id, question, embedding <=> $1::vector as distance
     from questions
     where ${scope} and embedding is not null
     order by embedding <=> $1::vector
     limit 1`,
    params,
  );

  return similarRows[0] && Number(similarRows[0].distance) <= env.questionSimilarityThreshold ? similarRows[0] : null;
}

// Documents of the same test are generated in parallel: check and insert one question at a time per test,
// so two documents cannot save the same question simultaneously.
const saveQueues = new Map();
function inSaveQueue(key, task) {
  const previous = saveQueues.get(key) || Promise.resolve();
  const current = previous.then(task, task);
  const tail = current.catch(() => {});
  saveQueues.set(key, tail);
  tail.then(() => { if (saveQueues.get(key) === tail) saveQueues.delete(key); });
  return current;
}

async function saveIfUnique(input) {
  return inSaveQueue(input.testId || input.documentId, () => insertIfUnique(input));
}

async function insertIfUnique({ question, prepared, embedding, sourceChunk, testId, userId, documentId, onDuplicate }) {
  const { prefixedQuestion, sourceTitle, topic, chapter } = prepared;
  const vector = toVectorLiteral(embedding);

  const match = await findSimilarQuestion(embedding, { documentId, userId, testId });
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
       embedding,
       question_type
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::vector, $18)
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
      question.question_type || null,
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
  if (!isAdmin(user)) {
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
  if (!isAdmin(user)) {
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
