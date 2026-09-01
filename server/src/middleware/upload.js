import fs from "fs";
import path from "path";
import multer from "multer";
import slugify from "slugify";
import { env } from "../config/env.js";
import { HttpError } from "../utils/errors.js";
import { normalizeFilename } from "../utils/unicode.js";

const uploadRoot = path.resolve(env.uploadDir);
fs.mkdirSync(uploadRoot, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadRoot),
  filename: (req, file, cb) => {
    file.originalname = normalizeFilename(file.originalname);
    const base = slugify(path.parse(file.originalname).name, {
      lower: true,
      strict: true,
    });
    cb(null, `${Date.now()}-${base || "temario"}.pdf`);
  },
});

export const uploadPdf = multer({
  storage,
  limits: {
    fileSize: env.maxPdfMb * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new HttpError(400, "Solo se permiten archivos PDF"));
    }

    return cb(null, true);
  },
});
