import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
// The generation prints its progress to the terminal. In tests that output shares the channel the
// runner uses to collect results and occasionally corrupted it («Unable to deserialize cloned data»).
for (const method of ['log', 'info', 'warn', 'error']) mock.method(console, method, () => {});
let active = 0;
let maxActive = 0;
let failures = [];
let calls = 0;
let lastParams = null;
let embeddingFailures = [];
mock.module('../src/config/env.js', { namedExports: { env: { openaiApiKey: 'key', openaiChatModel: 'model', openaiMaxConcurrentRequests: 2, openaiMaxRetries: 6, openaiUsageLogs: false, openaiTokensPerMinute: null } } });
mock.module('openai', { defaultExport: class {
  constructor(options) { assert.equal(options.maxRetries, 6); }
  // Results come back out of order on purpose: they must be matched by index.
  embeddings = { create: async ({ input }) => {
    const failure = embeddingFailures.shift();
    if (failure) throw failure;
    return { data: input.map((text, index) => ({ index, embedding: [text.length] })).reverse(), usage: { total_tokens: 10 } };
  } };
  chat = { completions: { create: (params) => ({ withResponse: async () => {
    lastParams = params;
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active -= 1;
    const failure = failures.shift();
    if (failure) throw failure;
    return {
      data: { choices: [{ message: { content: '{}' } }], usage: { total_tokens: 100 } },
      response: { headers: new Map([['x-ratelimit-limit-tokens', '10000000']]) },
    };
  } }) } };
} });
const { createChatJson, createEmbeddings, normalizeOpenAiError, reserveTokens, retryDelay } = await import('../src/services/openaiService.js');

test('never runs more chat requests at once than the configured limit', async () => {
  const results = await Promise.all(Array.from({ length: 7 }, () => createChatJson([])));
  assert.equal(results.length, 7);
  assert.equal(maxActive, 2);
  assert.equal(active, 0);
});

test('tells a per-minute rate limit apart from an exhausted quota', () => {
  assert.match(normalizeOpenAiError({ status: 429, code: 'insufficient_quota' }).message, /no tiene crédito/);
  // The same 429 without the code, only the message: still no credit, not a per-minute limit.
  assert.match(normalizeOpenAiError({ status: 429, message: '429 You have no credits remaining. Add credits to continue using the API' }).message, /no tiene crédito/);
  assert.match(normalizeOpenAiError({ status: 429, code: 'rate_limit_exceeded', message: 'Rate limit reached on tokens per min (TPM)' }).message, /tokens por minuto/);
  assert.match(normalizeOpenAiError({ status: 429, code: 'rate_limit_exceeded', message: 'Rate limit reached on requests per min (RPM)' }).message, /peticiones por minuto/);
  // Without OpenAI saying which, the message does not guess.
  assert.match(normalizeOpenAiError({ status: 429, code: 'rate_limit_exceeded' }).message, /el uso por minuto/);
});

test('waits and retries a per-minute limit instead of failing, but not an exhausted quota', async () => {
  calls = 0;
  failures = [{ status: 429, code: 'rate_limit_exceeded', headers: { 'retry-after': '0.05' } }];
  assert.equal(await createChatJson([]), '{}');
  assert.equal(calls, 2);
  failures = [{ status: 429, code: 'insufficient_quota' }];
  await assert.rejects(createChatJson([]), /no tiene crédito/);
  // No credits, said only in the message: it fails at once instead of retrying.
  calls = 0;
  failures = [{ status: 429, message: '429 You have no credits remaining. Add credits to continue using the API' }];
  await assert.rejects(createChatJson([]), /no tiene crédito/);
  assert.equal(calls, 1);
});

test('waits for the one-minute token window instead of exceeding the budget', async (t) => {
  // Start two minutes after the real clock so the reservations of the previous tests have expired.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() + 120_000 });
  // The limit read from OpenAI (10M) * 0.8 is the budget: fill it, then a new call must wait.
  await reserveTokens(8_000_000);
  let done = false;
  const pending = reserveTokens(10).then(() => { done = true; });
  await Promise.resolve();
  t.mock.timers.tick(30_000);
  await Promise.resolve();
  assert.equal(done, false);
  t.mock.timers.tick(31_000);
  await pending;
  assert.equal(done, true);
});

test('explains each OpenAI failure in plain words and keeps errors already explained', async () => {
  const { HttpError } = await import('../src/utils/errors.js');
  assert.match(normalizeOpenAiError({ status: 401 }).message, /clave de OpenAI no es valida/);
  assert.match(normalizeOpenAiError({ status: 403 }).message, /no tiene permisos/);
  assert.match(normalizeOpenAiError(new Error('socket hang up'), 'crear embeddings').message, /No se ha podido crear embeddings/);
  const explained = new HttpError(422, 'Ya explicado');
  assert.equal(normalizeOpenAiError(explained), explained);
});

test('returns embeddings in the order of the texts and reports no cost when usage logs are off', async () => {
  const { createEmbeddings, estimatedCost } = await import('../src/services/openaiService.js');
  assert.deepEqual(await createEmbeddings(['a', 'bbb', 'cc']), [[1], [3], [2]]);
  assert.equal(estimatedCost(), null);
});

test('waits as long as OpenAI asks after a rate limit, not a fixed 20-40 s', () => {
  assert.equal(retryDelay({ headers: { 'retry-after-ms': '450' } }), 450);
  assert.equal(retryDelay({ headers: { 'retry-after': '2' } }), 2000);
  assert.equal(retryDelay({ message: 'Rate limit reached for gpt-4.1-mini on tokens per min (TPM). Please try again in 1.2s.' }), 1200);
  assert.equal(retryDelay({ message: 'Please try again in 340ms.' }), 340);
  assert.equal(retryDelay({}), 3000);
});

test('each call caps its answer so OpenAI does not count the largest possible one', async () => {
  await createChatJson([], 0.1, { maxTokens: 1500 });
  assert.equal(lastParams.max_completion_tokens, 1500);
  await createChatJson([]);
  assert.equal('max_completion_tokens' in lastParams, false);
});

test('embeddings also wait what OpenAI asks after a rate limit and try again', async () => {
  embeddingFailures = [{ status: 429, code: 'rate_limit_exceeded', headers: { 'retry-after-ms': '20' }, message: 'Rate limit reached on requests per min (RPM)' }];
  assert.deepEqual(await createEmbeddings(['abc']), [[3]]);
  assert.equal(embeddingFailures.length, 0);
});
