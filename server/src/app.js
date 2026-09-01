import cors from "cors";
import express from "express";
import helmet from "helmet";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { env } from "./config/env.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import questionRoutes from "./routes/questionRoutes.js";
import { errorHandler, notFound } from "./utils/errors.js";

const app = express();

const limiter = new RateLimiterMemory({
  points: 120,
  duration: 60,
});

app.use(helmet());
app.use(
  cors({
    origin: env.clientUrl,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(async (req, res, next) => {
  try {
    await limiter.consume(req.ip);
    next();
  } catch {
    res.status(429).json({ message: "Demasiadas peticiones" });
  }
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "qth-simulacros-api" });
});

app.use("/api/auth", authRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/questions", questionRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
