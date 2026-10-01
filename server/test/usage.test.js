import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
let statements = [];
let touched = 1;
mock.module('../src/db/pool.js', { namedExports: { query: async (sql, params) => { statements.push({ sql, params }); return { rows: [], rowCount: touched }; } } });
const { recordHeartbeat, recordLogin } = await import('../src/services/usageService.js');

test('counts one minute per ping, and only if the previous ping is at least 50 s old', async () => {
  statements = [];
  touched = 1;
  assert.equal(await recordHeartbeat('carlos'), true);
  const { sql, params } = statements[0];
  assert.deepEqual(params, ['carlos']);
  assert.match(sql, /last_seen_at < now\(\) - interval '50 seconds'/);
  assert.match(sql, /minutes = user_usage_days.minutes \+ 1/);
  // A second tab pinging within the same minute adds nothing.
  touched = 0;
  assert.equal(await recordHeartbeat('carlos'), false);
});

test('records every login for the access count', async () => {
  statements = [];
  await recordLogin('laura');
  assert.match(statements[0].sql, /'LOGIN'/);
  assert.deepEqual(statements[0].params, ['laura']);
});
