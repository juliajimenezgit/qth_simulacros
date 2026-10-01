import { Router } from "express";
import { z } from "zod";
import { login } from "../services/authService.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { recordHeartbeat } from "../services/usageService.js";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, "Datos de login no validos", parsed.error.flatten());
    }

    res.json(await login(parsed.data.email, parsed.data.password));
  }),
);

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

// Time in the app: the client calls this once a minute while its tab is visible.
router.post(
  "/heartbeat",
  requireAuth,
  asyncHandler(async (req, res) => {
    await recordHeartbeat(req.user.id);
    res.status(204).end();
  }),
);

export default router;
