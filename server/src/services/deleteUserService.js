import { withTransaction } from "../db/pool.js";
import { isAdmin } from "../utils/roles.js";
import { HttpError } from "../utils/errors.js";

export async function deleteUser(id, actor) {
  if (!isAdmin(actor)) throw new HttpError(403, "Permisos insuficientes");
  if (id === actor.id) throw new HttpError(400, "No puedes eliminar tu propia cuenta");

  return withTransaction(async (client) => {
    // Lock both accounts in a stable order: two administrators cannot remove each other concurrently.
    const { rows } = await client.query(
      "select id, name, role, deleted_at from users where id = any($1::uuid[]) order by id for update",
      [[id, actor.id]],
    );
    const currentActor = rows.find(user => user.id === actor.id);
    if (!currentActor || currentActor.deleted_at || !isAdmin(currentActor)) {
      throw new HttpError(403, "Permisos insuficientes");
    }
    const target = rows.find(user => user.id === id);
    if (!target || target.deleted_at) throw new HttpError(404, "Usuario no encontrado");
    await client.query("update users set deleted_at = now(), updated_at = now() where id = $1", [id]);
    await client.query(
      `insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
       values ($1, 'USER_DELETED', 'user', $2, $3)`,
      [actor.id, id, JSON.stringify({ name: target.name, role: target.role, content_preserved: true })],
    );
  });
}
