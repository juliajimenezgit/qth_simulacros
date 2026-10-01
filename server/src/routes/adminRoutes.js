import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getAdminStats, getUserStats, listUsers } from "../services/adminService.js";
import { createUser, updateUser } from "../services/authService.js";
import { deleteUser } from "../services/deleteUserService.js";
import {
  createQualityInstruction,
  deleteQualityInstruction,
  listQualityInstructions,
  updateQualityInstruction,
} from "../services/qualityInstructionService.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { ADMIN_ROLES, ROLES } from "../utils/roles.js";

const router = Router();

router.use(requireAuth, requireRole(...ADMIN_ROLES));

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
});

// Editing: every field is optional and an empty password keeps the current one.
const updateUserSchema = createUserSchema.extend({
  password: z.union([z.literal(""), z.string().min(8)]).optional(),
}).partial();

const qualityInstructionSchema = z.object({
  title: z.string().trim().min(3).max(120),
  content: z.string().trim().min(20).max(4000),
  difficulty: z.enum(["PRINCIPIANTE", "FACIL", "DIFICIL"]).nullable(),
  active: z.boolean().default(true),
});

router.get(
  "/quality-instructions",
  asyncHandler(async (req, res) => {
    res.json({ instructions: await listQualityInstructions() });
  }),
);

router.post(
  "/quality-instructions",
  asyncHandler(async (req, res) => {
    const parsed = qualityInstructionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Instruccion no valida", parsed.error.flatten());
    }
    res.status(201).json({
      instruction: await createQualityInstruction(parsed.data, req.user.id),
    });
  }),
);

router.patch(
  "/quality-instructions/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const payload = qualityInstructionSchema.partial().safeParse(req.body);
    if (!id.success || !payload.success) {
      throw new HttpError(400, "Instruccion no valida");
    }
    res.json({ instruction: await updateQualityInstruction(id.data, payload.data) });
  }),
);

router.delete(
  "/quality-instructions/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, "Instruccion no valida");
    await deleteQualityInstruction(id.data);
    res.status(204).end();
  }),
);

router.get(
  "/stats",
  asyncHandler(async (req, res) => {
    res.json(await getAdminStats());
  }),
);

router.get(
  "/users",
  asyncHandler(async (req, res) => {
    res.json({ users: await listUsers() });
  }),
);

router.get(
  "/users/:id/stats",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, "Usuario no valido");
    res.json(await getUserStats(id.data));
  }),
);

router.post(
  "/users",
  asyncHandler(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Usuario no valido", parsed.error.flatten());
    }

    res.status(201).json({
      user: await createUser(parsed.data, req.user.id),
    });
  }),
);

router.patch(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    const parsed = updateUserSchema.safeParse(req.body);
    if (!id.success || !parsed.success) {
      throw new HttpError(400, "Usuario no valido", parsed.error?.flatten());
    }
    res.json({ user: await updateUser(id.data, parsed.data, req.user) });
  }),
);

router.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const id = z.string().uuid().safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, "Usuario no válido");
    await deleteUser(id.data, req.user);
    res.status(204).end();
  }),
);

export default router;
