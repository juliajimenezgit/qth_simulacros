import { query } from "../db/pool.js";
import { HttpError } from "../utils/errors.js";

// Questions of a person or of the whole app: the real ones plus those of demo tests, which have no
// questions of their own (seed:demo-activity only creates tests and usage).
const QUESTIONS_SQL = (filter = "true") => `(
  (select count(*) from questions q where ${filter.replaceAll("{t}", "q")})
  + (select coalesce(sum(generated_count), 0) from question_sets s where s.is_demo and ${filter.replaceAll("{t}", "s")})
)::int`;

const LEVEL_KEYS = { PRINCIPIANTE: "P", FACIL: "F", DIFICIL: "D" };

// Real questions by level, plus the levels stored in demo tests.
async function levelsFor(userId = null) {
  const params = userId ? [userId] : [];
  const owner = (alias) => (userId ? `and ${alias}.user_id = $1` : "");
  const [real, demo] = await Promise.all([
    query(`select difficulty, count(*)::int as total from questions q where true ${owner("q")} group by difficulty`, params),
    query(`select difficulty_counts from question_sets s where s.is_demo and s.difficulty_counts is not null ${owner("s")}`, params),
  ]);
  const levels = { PRINCIPIANTE: 0, FACIL: 0, DIFICIL: 0 };
  for (const row of real.rows) levels[row.difficulty] = (levels[row.difficulty] || 0) + row.total;
  for (const { difficulty_counts: counts } of demo.rows) {
    for (const [level, short] of Object.entries(LEVEL_KEYS)) levels[level] += Number(counts[short] || 0);
  }
  return levels;
}

// Indicators for the admin panel, all from data the app stores.
export async function getAdminStats() {
  const [totals, levels, team] = await Promise.all([
    query(
      `select
         ${QUESTIONS_SQL()} as preguntas_total,
         ${QUESTIONS_SQL("{t}.created_at >= now() - interval '30 days'")} as preguntas_30d,
         (select count(*)::int from question_sets) as tests_total,
         (select count(*)::int from question_sets where status = 'COMPLETED') as tests_completados,
         (select count(*)::int from question_sets where status = 'ERROR') as tests_error,
         (select count(*)::int from question_sets where status = 'GENERATING') as tests_generando,
         (select round(avg(extract(epoch from completed_at - created_at)))::int
            from question_sets where status = 'COMPLETED' and completed_at is not null) as segundos_medios_test,
         (select round(avg(extract(epoch from completed_at - created_at) / nullif(generated_count, 0)))::int
            from question_sets where status = 'COMPLETED' and completed_at is not null) as segundos_medios_pregunta,
         (select count(*)::int from users where role = 'PROFESOR' and deleted_at is null) as profesores_total,
         (select count(distinct qs.user_id)::int from question_sets qs join users u on u.id = qs.user_id
            where u.role = 'PROFESOR' and u.deleted_at is null and qs.created_at >= now() - interval '30 days') as profesores_activos_30d,
         (select coalesce(sum(minutes), 0)::int from user_usage_days where day >= current_date - 29) as minutos_30d,
         (select count(*)::int from documents where status = 'AVAILABLE') as temarios_disponibles,
         (select count(*)::int from documents where status = 'PROCESSING') as temarios_procesando,
         (select count(*)::int from documents where status = 'ERROR') as temarios_error`,
    ),
    levelsFor(),
    query(
      `select u.id, u.name, u.email, u.role, u.created_at,
              (select count(*)::int from question_sets s where s.user_id = u.id) as tests,
              (select count(*)::int from question_sets s where s.user_id = u.id and s.status = 'COMPLETED') as tests_completados,
              ${QUESTIONS_SQL("{t}.user_id = u.id")} as preguntas,
              (select coalesce(sum(minutes), 0)::int from user_usage_days d where d.user_id = u.id and d.day >= current_date - 29) as minutos_30d,
              greatest(u.last_seen_at, (select max(day)::timestamptz from user_usage_days d where d.user_id = u.id and d.is_demo)) as ultimo_acceso
       from users u
       where u.deleted_at is null
       order by case u.role when 'ADMIN' then 0 when 'DESARROLLADOR' then 1 else 2 end, u.name`,
    ),
  ]);

  return {
    totals: totals.rows[0],
    levels,
    team: team.rows,
  };
}

// Everything the administrator may want to know about one person.
export async function getUserStats(userId) {
  const { rows: users } = await query(
    `select id, name, email, role, created_at, last_seen_at from users where id = $1 and deleted_at is null`,
    [userId],
  );
  if (!users[0]) throw new HttpError(404, "Usuario no encontrado");

  const [usage, daily, tests, levels, documents, recentTests] = await Promise.all([
    query(
      `select
         coalesce(sum(minutes), 0)::int as minutos_total,
         coalesce(sum(minutes) filter (where day >= current_date - 29), 0)::int as minutos_30d,
         count(distinct day) filter (where day >= current_date - 29 and minutes > 0)::int as dias_activos_30d,
         max(day) as ultimo_dia,
         (select count(*)::int from activity_logs where user_id = $1 and action = 'LOGIN') as accesos_total,
         (select count(*)::int from activity_logs where user_id = $1 and action = 'LOGIN'
            and created_at >= now() - interval '30 days') as accesos_30d
       from user_usage_days where user_id = $1`,
      [userId],
    ),
    query(
      `select to_char(days.day, 'YYYY-MM-DD') as day, coalesce(sum(u.minutes), 0)::int as minutes
       from generate_series(current_date - 13, current_date, interval '1 day') as days(day)
       left join user_usage_days u on u.user_id = $1 and u.day = days.day::date
       group by days.day
       order by days.day`,
      [userId],
    ),
    query(
      `select
         count(*)::int as total,
         count(*) filter (where status = 'COMPLETED')::int as completados,
         count(*) filter (where status = 'ERROR')::int as con_error,
         count(*) filter (where created_at >= now() - interval '30 days')::int as ultimos_30d,
         round(avg(extract(epoch from completed_at - created_at)) filter (where status = 'COMPLETED'))::int as segundos_medios,
         round(avg(requested_count))::int as preguntas_medias_por_test,
         ${QUESTIONS_SQL("{t}.user_id = $1")} as preguntas
       from question_sets where user_id = $1`,
      [userId],
    ),
    levelsFor(userId),
    query(
      // Documents of each test: from its questions for real tests, from document_ids for demo tests.
      `select d.id, coalesce(d.display_title, d.original_filename) as title, count(distinct used.set_id)::int as tests
       from (
         select distinct q.question_set_id as set_id, q.document_id from questions q
           where q.user_id = $1 and q.question_set_id is not null
         union all
         select s.id, unnest(s.document_ids) from question_sets s where s.user_id = $1 and s.is_demo
       ) used
       join documents d on d.id = used.document_id
       group by d.id
       order by tests desc, title
       limit 5`,
      [userId],
    ),
    query(
      `select s.id, s.name, s.status, s.requested_count, s.created_at,
              round(extract(epoch from s.completed_at - s.created_at))::int as segundos,
              case when s.is_demo then s.generated_count
                   else (select count(*)::int from questions q where q.question_set_id = s.id) end as preguntas
       from question_sets s
       where s.user_id = $1
       order by s.created_at desc
       limit 8`,
      [userId],
    ),
  ]);

  const usageRow = usage.rows[0];
  const lastDay = usageRow.ultimo_dia ? new Date(usageRow.ultimo_dia) : null;
  const lastSeen = users[0].last_seen_at ? new Date(users[0].last_seen_at) : null;
  return {
    user: { ...users[0], ultimo_acceso: [lastSeen, lastDay].filter(Boolean).sort((a, b) => b - a)[0] || null },
    usage: usageRow,
    daily: daily.rows,
    tests: tests.rows[0],
    levels,
    documents: documents.rows,
    recentTests: recentTests.rows,
  };
}

export async function listUsers() {
  const { rows } = await query(
    `select id, name, email, role, created_at
     from users
     where deleted_at is null
     order by role asc, name asc`,
  );

  return rows;
}
