import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
let rows;
mock.module('../src/db/pool.js', { namedExports: { query: async (sql, params = []) => {
  if (sql.includes('group by difficulty')) return { rows: [{ difficulty: 'PRINCIPIANTE', total: 6 }, { difficulty: 'DIFICIL', total: 2 }] };
  // Demo tests store their levels: 3 more P questions.
  if (sql.includes('select difficulty_counts')) return { rows: [{ difficulty_counts: { P: 3, F: 0, D: 0 } }] };
  if (sql.includes('from users where id = $1')) return { rows: params[0] === 'missing' ? [] : [{ id: params[0], name: 'Carlos Ruiz', role: 'PROFESOR', last_seen_at: '2026-09-30T10:00:00Z' }] };
  if (sql.includes('from user_usage_days where user_id')) return { rows: [{ minutos_30d: 120, ultimo_dia: '2026-10-01' }] };
  if (sql.includes('generate_series')) return { rows: [{ day: '2026-10-01', minutes: 45 }] };
  if (sql.includes('from question_sets where user_id = $1')) return { rows: [{ total: 4, completados: 3, con_error: 1 }] };
  if (sql.includes('limit 8')) return { rows: [{ id: 't1', name: 'teoriafuego_1012', status: 'COMPLETED' }] };
  return { rows: rows[sql.includes('from users u') ? 'team' : sql.includes('join documents d') ? 'documents' : 'totals'] };
} } });
const { isAdmin, ADMIN_ROLES } = await import('../src/utils/roles.js');
const { requireRole } = await import('../src/middleware/auth.js');
const { getAdminStats, getUserStats } = await import('../src/services/adminService.js');

test('the developer has the administrator permissions and a teacher does not', () => {
  assert.equal(isAdmin({ role: 'ADMIN' }), true);
  assert.equal(isAdmin({ role: 'DESARROLLADOR' }), true);
  assert.equal(isAdmin({ role: 'PROFESOR' }), false);
  assert.equal(isAdmin(null), false);
  const guard = requireRole(...ADMIN_ROLES);
  const outcome = role => { let result; guard({ user: { role } }, {}, error => { result = error?.status || 'ok'; }); return result; };
  assert.equal(outcome('DESARROLLADOR'), 'ok');
  assert.equal(outcome('ADMIN'), 'ok');
  assert.equal(outcome('PROFESOR'), 403);
});

test('returns the admin indicators with the questions per level by name', async () => {
  rows = { totals: [{ preguntas_total: 8, tests_completados: 3 }], team: [{ name: 'Julia', role: 'DESARROLLADOR' }], documents: [{ title: 'Teoría del Fuego', preguntas: 8 }] };
  const stats = await getAdminStats();
  assert.equal(stats.totals.preguntas_total, 8);
  assert.deepEqual(stats.levels, { PRINCIPIANTE: 9, FACIL: 0, DIFICIL: 2 });
  assert.equal(stats.team[0].role, 'DESARROLLADOR');
  assert.equal(stats.topDocuments, undefined);
});

test('builds a person\'s detail and reports an unknown person', async () => {
  const detail = await getUserStats('carlos');
  assert.equal(detail.user.name, 'Carlos Ruiz');
  assert.equal(detail.usage.minutos_30d, 120);
  // The last access is the latest of the real ping and the last demo day.
  assert.equal(new Date(detail.user.ultimo_acceso).toISOString().slice(0, 10), '2026-10-01');
  assert.deepEqual(detail.daily, [{ day: '2026-10-01', minutes: 45 }]);
  assert.equal(detail.tests.total, 4);
  assert.equal(detail.recentTests[0].name, 'teoriafuego_1012');
  await assert.rejects(getUserStats('missing'), { status: 404 });
});
