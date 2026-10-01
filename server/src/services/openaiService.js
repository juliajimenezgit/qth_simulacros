import OpenAI from "openai";
import { env } from "../config/env.js";
import { HttpError } from "../utils/errors.js";

let client;
const usageTotals = {
  chatInputTokens: 0,
  chatOutputTokens: 0,
  embeddingTokens: 0,
  estimatedCost: 0,
};

export function isOpenAiConfigured() {
  return Boolean(env.openaiApiKey);
}

function getClient() {
  if (!env.openaiApiKey) {
    throw new HttpError(
      503,
      "La IA no esta configurada. Anade OPENAI_API_KEY en server/.env para generar preguntas.",
    );
  }

  if (!client) {
    // The SDK waits for the delay OpenAI suggests before retrying a rate-limited request.
    client = new OpenAI({ apiKey: env.openaiApiKey, maxRetries: env.openaiMaxRetries });
  }

  return client;
}

export async function createEmbedding(input) {
  const embeddings = await createEmbeddings([input]);
  return embeddings[0];
}

export async function createEmbeddings(inputs) {
  try {
    const response = await getClient().embeddings.create({
      model: env.openaiEmbeddingModel,
      input: inputs,
    });

    logOpenAiUsage({
      kind: "embeddings",
      model: env.openaiEmbeddingModel,
      usage: response.usage,
      itemCount: inputs.length,
    });

    return [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  } catch (error) {
    throw normalizeOpenAiError(error, "crear embeddings");
  }
}

// Generation and audits of several documents run in parallel; without a cap the bursts exceed the
// account's tokens per minute.
let activeChatRequests = 0;
const waitingChatRequests = [];

async function withChatSlot(task) {
  if (activeChatRequests >= env.openaiMaxConcurrentRequests) {
    await new Promise((resolve) => waitingChatRequests.push(resolve));
  } else {
    activeChatRequests += 1;
  }
  try {
    return await task();
  } finally {
    // Hand the slot directly to the next waiting request, or release it.
    const next = waitingChatRequests.shift();
    if (next) next();
    else activeChatRequests -= 1;
  }
}

// Limiting simultaneous calls is not enough: a few generations and their reviews sent ~500.000 tokens in
// 80 s. Every call reserves its estimated tokens in a one-minute window and waits if the budget is spent.
const WINDOW_MS = 60_000;
const DEFAULT_TOKENS_PER_MINUTE = 150_000;
const tokenWindow = [];
let detectedTokensPerMinute = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tokenBudget = () => env.openaiTokensPerMinute || detectedTokensPerMinute || DEFAULT_TOKENS_PER_MINUTE;

// Spanish prompts average ~3.5 characters per token; count 3 to stay on the safe side, plus the answer.
export const estimateTokens = (messages) => Math.ceil(JSON.stringify(messages).length / 3) + 1_000;

export async function reserveTokens(estimate, now = Date.now) {
  for (;;) {
    const time = now();
    while (tokenWindow.length && time - tokenWindow[0].at >= WINDOW_MS) tokenWindow.shift();
    const used = tokenWindow.reduce((sum, entry) => sum + entry.tokens, 0);
    // A single request larger than the budget still goes through when the window is empty.
    if (!tokenWindow.length || used + estimate <= tokenBudget()) {
      const entry = { at: time, tokens: estimate };
      tokenWindow.push(entry);
      return entry;
    }
    const wait = WINDOW_MS - (time - tokenWindow[0].at) + 100;
    if (wait > 5_000) console.info(`\x1b[2m    ⏳ Esperando ${Math.ceil(wait / 1000)} s al cupo de OpenAI (${used.toLocaleString("es-ES")} de ${tokenBudget().toLocaleString("es-ES")} tokens en el último minuto)\x1b[0m`);
    await sleep(wait);
  }
}

export async function createChatJson(messages, temperature = 0.2) {
  return withChatSlot(() => requestChatJson(messages, temperature));
}

async function requestChatJson(messages, temperature, attempt = 0) {
  const reservation = await reserveTokens(estimateTokens(messages));
  try {
    const { data: response, response: raw } = await getClient().chat.completions.create({
      model: env.openaiChatModel,
      temperature,
      response_format: { type: "json_object" },
      messages,
    }).withResponse();

    // Learn the account's real limit and count the tokens actually used.
    const limit = Number(raw?.headers?.get?.("x-ratelimit-limit-tokens"));
    if (limit > 0) detectedTokensPerMinute = Math.floor(limit * 0.8);
    if (response.usage?.total_tokens) reservation.tokens = response.usage.total_tokens;

    logOpenAiUsage({
      kind: "chat",
      model: env.openaiChatModel,
      usage: response.usage,
    });

    return response.choices[0]?.message?.content || "{}";
  } catch (error) {
    // The SDK already retried; a per-minute limit still clears by waiting, so wait and try again
    // instead of failing the whole test. An exhausted quota does not clear.
    if (error?.status === 429 && error?.code !== "insufficient_quota" && attempt < 3) {
      const retryAfter = Number(error?.headers?.["retry-after"] || error?.headers?.get?.("retry-after"));
      const wait = (retryAfter > 0 ? retryAfter * 1000 : 20_000) + attempt * 10_000;
      console.warn(`\x1b[33m    ⚠ OpenAI limitó las peticiones por minuto; se reintenta en ${Math.ceil(wait / 1000)} s\x1b[0m`);
      await sleep(wait);
      return requestChatJson(messages, temperature, attempt + 1);
    }
    throw normalizeOpenAiError(error, "generar preguntas");
  }
}

export function normalizeOpenAiError(error, action = "usar OpenAI") {
  if (error instanceof HttpError) {
    return error;
  }

  if (error?.code === "insufficient_quota") {
    return new HttpError(
      503,
      `La cuenta de OpenAI no tiene cuota disponible para ${action}. Revisa el plan y la facturacion en OpenAI.`,
    );
  }

  // Any other 429 is a per-minute limit: it clears by itself after a short wait.
  if (error?.status === 429) {
    return new HttpError(
      503,
      `OpenAI ha limitado temporalmente las peticiones por minuto al ${action}. Espera un minuto e inténtalo de nuevo; si se repite, reduce OPENAI_MAX_CONCURRENT_REQUESTS en server/.env.`,
    );
  }

  if (error?.status === 401) {
    return new HttpError(
      503,
      "La clave de OpenAI no es valida. Revisa OPENAI_API_KEY en server/.env.",
    );
  }

  if (error?.status === 403) {
    return new HttpError(
      503,
      "La clave de OpenAI no tiene permisos suficientes para esta operacion.",
    );
  }

  return new HttpError(
    503,
    `No se ha podido ${action} con OpenAI. Intentalo de nuevo mas tarde.`,
  );
}

// Estimated spend so far; the generation reports the difference for each test.
export function estimatedCost() {
  return env.openaiUsageLogs ? usageTotals.estimatedCost : null;
}

function logOpenAiUsage({ kind, model, usage, itemCount = 1 }) {
  if (!usage) return;
  // Totals are always kept; each call is printed only in verbose mode.
  const print = env.openaiUsageLogs && env.generationVerboseLogs;

  if (kind === "chat") {
    const inputTokens = Number(usage.prompt_tokens || 0);
    const outputTokens = Number(usage.completion_tokens || 0);
    const cost =
      (inputTokens / 1_000_000) * env.openaiChatInputUsdPerMillion +
      (outputTokens / 1_000_000) * env.openaiChatOutputUsdPerMillion;

    usageTotals.chatInputTokens += inputTokens;
    usageTotals.chatOutputTokens += outputTokens;
    usageTotals.estimatedCost += cost;

    if (print) console.log(
      [
        "[OpenAI gasto]",
        `chat model=${model}`,
        `input=${formatNumber(inputTokens)} tok`,
        `output=${formatNumber(outputTokens)} tok`,
        `coste~${formatMoney(cost)}`,
        `total~${formatMoney(usageTotals.estimatedCost)}`,
      ].join(" | "),
    );
    return;
  }

  const tokens = Number(usage.total_tokens || usage.prompt_tokens || 0);
  const cost = (tokens / 1_000_000) * env.openaiEmbeddingUsdPerMillion;

  usageTotals.embeddingTokens += tokens;
  usageTotals.estimatedCost += cost;

  if (print) console.log(
    [
      "[OpenAI gasto]",
      `embeddings model=${model}`,
      `items=${formatNumber(itemCount)}`,
      `tokens=${formatNumber(tokens)}`,
      `coste~${formatMoney(cost)}`,
      `total~${formatMoney(usageTotals.estimatedCost)}`,
    ].join(" | "),
  );
}

function formatMoney(value) {
  return `${value.toFixed(6)} ${env.openaiUsageCurrency}`;
}

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(value);
}
