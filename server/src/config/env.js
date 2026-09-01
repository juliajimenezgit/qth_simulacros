import dotenv from "dotenv";

dotenv.config();

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "dev-only-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini",
  openaiEmbeddingModel:
    process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  openaiUsageLogs: process.env.OPENAI_USAGE_LOGS !== "false",
  openaiUsageCurrency: process.env.OPENAI_USAGE_CURRENCY || "USD",
  openaiChatInputUsdPerMillion: Number(
    process.env.OPENAI_CHAT_INPUT_USD_PER_1M || 0.4,
  ),
  openaiChatOutputUsdPerMillion: Number(
    process.env.OPENAI_CHAT_OUTPUT_USD_PER_1M || 1.6,
  ),
  openaiEmbeddingUsdPerMillion: Number(
    process.env.OPENAI_EMBEDDING_USD_PER_1M || 0.02,
  ),
  uploadDir: process.env.UPLOAD_DIR || "storage/pdfs",
  maxPdfMb: Number(process.env.MAX_PDF_MB || 40),
  questionSimilarityThreshold: Number(
    process.env.QUESTION_SIMILARITY_THRESHOLD || 0.13,
  ),
  authorizedUsers: process.env.AUTHORIZED_USERS || "[]",
};

if (!env.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}
