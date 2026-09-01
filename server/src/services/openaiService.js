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
    client = new OpenAI({ apiKey: env.openaiApiKey });
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

export async function createChatJson(messages, temperature = 0.2) {
  try {
    const response = await getClient().chat.completions.create({
      model: env.openaiChatModel,
      temperature,
      response_format: { type: "json_object" },
      messages,
    });

    logOpenAiUsage({
      kind: "chat",
      model: env.openaiChatModel,
      usage: response.usage,
    });

    return response.choices[0]?.message?.content || "{}";
  } catch (error) {
    throw normalizeOpenAiError(error, "generar preguntas");
  }
}

export function normalizeOpenAiError(error, action = "usar OpenAI") {
  if (error instanceof HttpError) {
    return error;
  }

  if (error?.status === 429 || error?.code === "insufficient_quota") {
    return new HttpError(
      503,
      `La cuenta de OpenAI no tiene cuota disponible para ${action}. Revisa el plan y la facturacion en OpenAI.`,
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

function logOpenAiUsage({ kind, model, usage, itemCount = 1 }) {
  if (!env.openaiUsageLogs || !usage) return;

  if (kind === "chat") {
    const inputTokens = Number(usage.prompt_tokens || 0);
    const outputTokens = Number(usage.completion_tokens || 0);
    const cost =
      (inputTokens / 1_000_000) * env.openaiChatInputUsdPerMillion +
      (outputTokens / 1_000_000) * env.openaiChatOutputUsdPerMillion;

    usageTotals.chatInputTokens += inputTokens;
    usageTotals.chatOutputTokens += outputTokens;
    usageTotals.estimatedCost += cost;

    console.log(
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

  console.log(
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
