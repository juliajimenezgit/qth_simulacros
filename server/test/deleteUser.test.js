import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

const secret = 'test-only-user-deletion-secret';
let users;
let calls;
let failAudit;
const actor = { id: 'admin', name: 'Admin', role: 'ADMIN', deleted_at: null };
const target = { id: 'teacher', name: 'Profesor', role: 'PROFESOR', deleted_at: null };

async function query(sql, params) {
  calls.push({ sql, params });
  if (sql.includes('order by id for update')) return { rows: users.filter(user => params[0].includes(user.id)) };
  if (sql.includes('set deleted_at')) {
    users.find(user => user.id === params[0]).deleted_at = new Date();
    return { rows: [], rowCount: 1 };
  }
  if (sql.includes('insert into activity_logs')) {
    if (failAudit) throw new Error('Audit write failed');
    return { rows: [] };
  }
  if (sql.includes('from users')) {
    assert.match(sql, /deleted_at is null/);
    let rows = users.filter(user => !user.deleted_at);
    if (sql.includes('where id = $1')) rows = rows.filter(user => user.id === params[0]);
    if (sql.includes('where email = $1')) rows = rows.filter(user => user.email === params[0]);
    return { rows };
  }
  throw new Error(`Unexpected query: ${sql}`);
}
mock.module('../src/config/env.js', { namedExports: { env: { jwtSecret: secret } } });
mock.module('../src/db/pool.js', { namedExports: {
  query,
  withTransaction: async callback => {
    const snapshot = structuredClone(users);
    try { return await callback({ query }); }
    catch (error) { users = snapshot; throw error; }
  },
} });
const { deleteUser } = await import('../src/services/deleteUserService.js');
const { requireAuth } = await import('../src/middleware/auth.js');
const { login } = await import('../src/services/authService.js');
const { listUsers, getUserStats } = await import('../src/services/adminService.js');

test.beforeEach(() => {
  users = [{ ...actor }, { ...target, email: 'teacher@example.test' }];
  calls = []; failAudit = false;
});

for (const role of ['ADMIN', 'DESARROLLADOR']) {
  test(`${role} can remove another account while preserving academy content`, async () => {
    users[0].role = role;
    await deleteUser(target.id, { ...actor, role });
    assert.ok(users[1].deleted_at);
    assert.ok(calls.some(call => call.sql.includes('USER_DELETED')));
    assert.ok(!calls.some(call => /delete from|update documents|update questions/i.test(call.sql)));
    assert.equal((await listUsers()).length, 1);
  });
}

test('a teacher cannot remove anyone, including via a direct service call', async () => {
  await assert.rejects(deleteUser(actor.id, target), { status: 403 });
  assert.equal(calls.length, 0);
});

test('cannot remove own account, including the last administrator', async () => {
  await assert.rejects(deleteUser(actor.id, actor), { status: 400 });
  assert.equal(calls.length, 0);
});

test('rechecks current permissions and rejects a removed or demoted actor', async () => {
  users[0].role = 'PROFESOR';
  await assert.rejects(deleteUser(target.id, actor), { status: 403 });
  users[0].role = 'ADMIN'; users[0].deleted_at = new Date();
  await assert.rejects(deleteUser(target.id, actor), { status: 403 });
  assert.equal(users[1].deleted_at, null);
});

test('rejects missing or previously removed accounts', async () => {
  await assert.rejects(deleteUser('missing', actor), { status: 404 });
  users[1].deleted_at = new Date();
  await assert.rejects(deleteUser(target.id, actor), { status: 404 });
});

test('a removed administrator cannot subsequently remove the other administrator', async () => {
  users[1].role = 'DESARROLLADOR';
  await deleteUser(target.id, actor);
  await assert.rejects(deleteUser(actor.id, { ...target, role: 'DESARROLLADOR' }), { status: 403 });
  assert.equal(users[0].deleted_at, null);
});

test('removed accounts lose login, existing tokens and access to their team detail', async () => {
  const token = jwt.sign({ sub: target.id, role: target.role }, secret);
  await deleteUser(target.id, actor);
  await assert.rejects(login('teacher@example.test', 'password'), { status: 401 });
  let authError;
  await requireAuth({ headers: { authorization: `Bearer ${token}` } }, {}, error => { authError = error; });
  assert.equal(authError.status, 401);
  await assert.rejects(getUserStats(target.id), { status: 404 });
});

test('rolls back deletion if its audit entry cannot be saved', async () => {
  failAudit = true;
  await assert.rejects(deleteUser(target.id, actor), /Audit write failed/);
  assert.equal(users[1].deleted_at, null);
});
