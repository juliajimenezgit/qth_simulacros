import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import {
  deleteQuestion,
  exportQuestionsRows,
  generateConfiguredQuestions,
  listQuestions,
  updateQuestion,
} from "../services/questionService.js";
import { getExportFormat, listExportFormats } from "../services/exportService.js";
import { asyncHandler, HttpError } from "../utils/errors.js";

const router = Router();

router.use(requireAuth);

const generateSchema = z.object({
  selectedDocumentIds: z.array(z.string().uuid()).min(1).max(200),
  contentCounts: z.object({
    MANUAL: z.number().int().min(0).max(120),
    TEMA: z.number().int().min(0).max(120),
    CAPITULO: z.number().int().min(0).max(120),
  }),
  difficultyCounts: z.object({
    P: z.number().int().min(0).max(120),
    F: z.number().int().min(0).max(120),
    D: z.number().int().min(0).max(120),
  }),
}).superRefine((data, context) => {
  const contentTotal = Object.values(data.contentCounts).reduce((sum, value) => sum + value, 0);
  const difficultyTotal = Object.values(data.difficultyCounts).reduce((sum, value) => sum + value, 0);
  if (contentTotal < 1 || contentTotal > 120 || contentTotal !== difficultyTotal) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Los repartos deben sumar la misma cantidad, entre 1 y 120 preguntas",
    });
  }
});

const updateSchema = z.object({
  question: z.string().min(10).optional(),
  option_a: z.string().min(1).optional(),
  option_b: z.string().min(1).optional(),
  option_c: z.string().min(1).optional(),
  option_d: z.string().min(1).optional(),
  correct_answer: z.enum(["A", "B", "C", "D"]).optional(),
  explanation: z.string().min(5).optional(),
  reference: z.string().min(3).optional(),
  difficulty: z.enum(["PRINCIPIANTE", "ELITE", "ALEATORIO"]).optional(),
});

router.get(
  "/",
  asyncHandler(async (req, res) => {
    if (req.query.documentId) {
      const parsed = z.string().uuid().safeParse(req.query.documentId);
      if (!parsed.success) {
        throw new HttpError(400, "Temario no valido");
      }
    }

    res.json({
      questions: await listQuestions(req.user, {
        documentId: req.query.documentId,
      }),
    });
  }),
);

router.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(
        400,
        "Parametros de generacion no validos",
        parsed.error.flatten(),
      );
    }

    const questions = await generateConfiguredQuestions({
      user: req.user,
      ...parsed.data,
    });

    res.status(201).json({ questions });
  }),
);

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Pregunta no valida", parsed.error.flatten());
    }

    res.json({ question: await updateQuestion(req.params.id, req.user, parsed.data) });
  }),
);

router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteQuestion(req.params.id, req.user);
    res.status(204).end();
  }),
);

router.get(
  "/export",
  asyncHandler(async (req, res) => {
    await sendQuestionsExport(req, res);
  }),
);

router.get(
  "/export/:documentId",
  asyncHandler(async (req, res) => {
    const parsedDocumentId = z.string().uuid().safeParse(req.params.documentId);
    if (!parsedDocumentId.success) {
      throw new HttpError(400, "Temario no valido");
    }

    await sendQuestionsExport(req, res, parsedDocumentId.data);
  }),
);

async function sendQuestionsExport(req, res, documentId = "") {
  const formatName = String(req.query.format || "xlsx").toLowerCase();
  if (!listExportFormats().includes(formatName)) {
    throw new HttpError(400, "Formato de exportacion no valido");
  }

  const format = getExportFormat(formatName);
  const rows = await exportQuestionsRows(req.user, documentId);
  const buffer = await format.build(rows);
  const filename = documentId
    ? `qth-simulacro-${documentId}.${format.extension}`
    : `qth-simulacro-preguntas.${format.extension}`;

  res.setHeader("Content-Type", format.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

export default router;
