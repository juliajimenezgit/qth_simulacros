import { query } from "../db/pool.js";

// The app pings once a minute while its tab is visible. A ping counts one minute only if the previous one
// is at least 50 s old, so several open tabs do not multiply the time.
export async function recordHeartbeat(userId) {
  const { rowCount } = await query(
    `with touched as (
       update users set last_seen_at = now()
       where id = $1 and deleted_at is null and (last_seen_at is null or last_seen_at < now() - interval '50 seconds')
       returning id
     )
     insert into user_usage_days (user_id, day, minutes)
     select id, current_date, 1 from touched
     on conflict (user_id, day, is_demo) do update set minutes = user_usage_days.minutes + 1`,
    [userId],
  );
  return rowCount > 0;
}

export async function recordLogin(userId) {
  await query(
    `insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
     values ($1, 'LOGIN', 'user', $1, '{}')`,
    [userId],
  );
}
