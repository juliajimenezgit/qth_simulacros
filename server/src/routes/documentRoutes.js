import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { uploadPdf } from "../middleware/upload.js";
import {
  createDocumentRecord,
  deleteDocuments,
  listDocuments,
  retryDocumentProcessing,
  scheduleDocumentProcessing,
} from "../services/documentService.js";
import { asyncHandler, HttpError } from "../utils/errors.js";

const router = Router();
const DOCUMENT_CONTENT_TYPES = new Set(["MANUAL", "TEMA", "CAPITULO"]);

router.use(requireAuth);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ documents: await listDocuments(req.user) });
  }),
);

router.post(
  "/",
  uploadPdf.single("pdf"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, "Debes subir un archivo PDF");
    }

    const contentType = String(req.body.contentType || "").toUpperCase();
    if (!DOCUMENT_CONTENT_TYPES.has(contentType)) {
      throw new HttpError(400, "Selecciona si el PDF es un manual, tema o capítulo");
    }

    const document = await createDocumentRecord({
      userId: req.user.id,
      file: req.file,
      contentType,
    });

    scheduleDocumentProcessing(document.id);

    res.status(201).json({ document });
  }),
);

router.delete(
  "/",
  asyncHandler(async (req, res) => {
    const result = await deleteDocuments({
      user: req.user,
      ids: Array.isArray(req.body?.ids) ? req.body.ids : [],
      all: Boolean(req.body?.all),
    });

    res.json(result);
  }),
);

router.post(
  "/:id/reprocess",
  asyncHandler(async (req, res) => {
    const document = await retryDocumentProcessing(req.params.id, req.user);

    if (!document) {
      throw new HttpError(404, "Temario no encontrado");
    }

    scheduleDocumentProcessing(req.params.id);

    res.status(202).json({ document: { ...document, status: "PROCESSING" } });
  }),
);

export default router;
