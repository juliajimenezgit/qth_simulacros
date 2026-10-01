import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
let active = 0;
let maxActive = 0;
let failures = [];
let calls = 0;
mock.module('../src/config/env.js', { namedExports: { env: { openaiApiKey: 'key', openaiChatModel: 'model', openaiMaxConcurrentRequests: 2, openaiMaxRetries: 6, openaiUsageLogs: false, openaiTokensPerMinute: null } } });
mock.module('openai', { defaultExport: class {
  constructor(options) { assert.equal(options.maxRetries, 6); }
  chat = { completions: { create: () => ({ withResponse: async () => {
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
const { createChatJson, normalizeOpenAiError, reserveTokens } = await import('../src/services/openaiService.js');

test('never runs more chat requests at once than the configured limit', async () => {
  const results = await Promise.all(Array.from({ length: 7 }, () => createChatJson([])));
  assert.equal(results.length, 7);
  assert.equal(maxActive, 2);
  assert.equal(active, 0);
});

test('tells a per-minute rate limit apart from an exhausted quota', () => {
  assert.match(normalizeOpenAiError({ status: 429, code: 'insufficient_quota' }).message, /no tiene cuota/);
  assert.match(normalizeOpenAiError({ status: 429, code: 'rate_limit_exceeded' }).message, /peticiones por minuto/);
});

test('waits and retries a per-minute limit instead of failing, but not an exhausted quota', async () => {
  calls = 0;
  failures = [{ status: 429, code: 'rate_limit_exceeded', headers: { 'retry-after': '0.05' } }];
  assert.equal(await createChatJson([]), '{}');
  assert.equal(calls, 2);
  failures = [{ status: 429, code: 'insufficient_quota' }];
  await assert.rejects(createChatJson([]), /no tiene cuota/);
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
