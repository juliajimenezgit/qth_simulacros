import { Router } from "express";
import fs from "node:fs/promises";
import { requireAuth } from "../middleware/auth.js";
import { uploadPdf } from "../middleware/upload.js";
import {
  createDocumentRecord,
  deleteDocuments,
  listDocuments,
  renameDocument,
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

router.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json({ document: await renameDocument(req.params.id, req.user, req.body?.name) });
  }),
);

router.post(
  "/",
  uploadPdf.single("pdf"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, "Debes subir un archivo PDF");
    }

    let document;
    try {
      const contentType = String(req.body.contentType || "").toUpperCase();
      if (!DOCUMENT_CONTENT_TYPES.has(contentType)) {
        throw new HttpError(400, "Selecciona si el PDF es un manual, tema o capítulo");
      }

      document = await createDocumentRecord({
        userId: req.user.id,
        user: req.user,
        file: req.file,
        contentType,
        duplicateAction: req.body.duplicateAction,
        replaceId: req.body.replaceId,
      });
    } catch (error) {
      await fs.unlink(req.file.path).catch(() => {});
      throw error;
    }

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
