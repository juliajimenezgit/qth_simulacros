import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
const calls = [];
mock.module('../src/db/pool.js', { namedExports: { query: async (sql, params = []) => {
  calls.push({ sql, params });
  if (sql.startsWith('select id, email, role from users')) return { rows: params[0] === 'missing' ? [] : [{ id: params[0], email: 'carlos.ruiz@qthsutan.es', role: 'PROFESOR' }] };
  if (sql.includes('and id <> $2')) return { rows: params[0] === 'laura.martin@qthsutan.es' ? [{ id: 'laura' }] : [] };
  if (sql.includes('update users')) return { rows: [{ id: params[0], name: params[1] || 'Carlos Ruiz', email: params[2] || 'carlos.ruiz@qthsutan.es', role: params[3] || 'PROFESOR' }] };
  return { rows: [] };
} } });
const { updateUser } = await import('../src/services/authService.js');
const actor = { id: 'julia', role: 'DESARROLLADOR' };

test('changes the role and keeps the password when none is sent', async () => {
  calls.length = 0;
  const user = await updateUser('carlos', { role: 'ADMIN', password: '' }, actor);
  assert.equal(user.role, 'ADMIN');
  const update = calls.find(call => call.sql.includes('update users'));
  assert.equal(update.params[4], null);
});

test('rejects an email that belongs to someone else', async () => {
  await assert.rejects(updateUser('carlos', { email: 'Laura.Martin@qthsutan.es' }, actor), { status: 409 });
});

test('an administrator cannot remove their own admin role', async () => {
  await assert.rejects(updateUser('julia', { role: 'PROFESOR' }, actor), { status: 400 });
  await assert.rejects(updateUser('missing', { name: 'X' }, actor), { status: 404 });
});
