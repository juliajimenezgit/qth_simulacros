import { query } from "../db/pool.js";

export async function getAdminStats() {
  const [totals, questionsByTeacher, activity] = await Promise.all([
    query(
      `select
         (select count(*)::int from users where role = 'PROFESOR') as total_profesores,
         (select count(*)::int from documents) as total_temarios,
         (select count(*)::int from questions) as total_preguntas,
         (select count(*)::int from documents where status = 'PROCESSING') as temarios_procesando`,
    ),
    query(
      `select u.id, u.name, u.email, count(q.id)::int as total
       from users u
       left join questions q on q.user_id = u.id
       where u.role = 'PROFESOR'
       group by u.id
       order by total desc, u.name asc`,
    ),
    query(
      `select al.*, u.name as user_name
       from activity_logs al
       left join users u on u.id = al.user_id
       order by al.created_at desc
       limit 20`,
    ),
  ]);

  return {
    totals: totals.rows[0],
    questionsByTeacher: questionsByTeacher.rows,
    activity: activity.rows,
  };
}

export async function listUsers() {
  const { rows } = await query(
    `select id, name, email, role, created_at
     from users
     order by role asc, name asc`,
  );

  return rows;
}
