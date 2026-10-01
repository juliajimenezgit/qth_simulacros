import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { HttpError } from "../utils/errors.js";
import { isAdmin } from "../utils/roles.js";
import { recordLogin } from "./usageService.js";

export async function login(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const { rows } = await query(
    "select id, name, email, password_hash, role from users where email = $1 and deleted_at is null",
    [normalizedEmail],
  );
  const user = rows[0];

  if (!user) {
    throw new HttpError(401, "Email o contrasena incorrectos");
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    throw new HttpError(401, "Email o contrasena incorrectos");
  }

  await recordLogin(user.id);
  const token = jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

export async function createUser({ name, email, password, role }, actorId = null) {
  const passwordHash = await bcrypt.hash(password, 12);
  const normalizedEmail = email.trim().toLowerCase();

  const { rows } = await query(
    `insert into users (name, email, password_hash, role)
     values ($1, $2, $3, $4)
     on conflict (email) do update set
       name = excluded.name,
       password_hash = excluded.password_hash,
       role = excluded.role
     where users.deleted_at is null
     returning id, name, email, role`,
    [name.trim(), normalizedEmail, passwordHash, role],
  );

  if (!rows[0]) throw new HttpError(409, "Ese email pertenece a una cuenta eliminada. Utiliza otro email.");

  if (actorId) {
    await query(
      `insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
       values ($1, $2, $3, $4, $5)`,
      [
        actorId,
        "USER_UPSERTED",
        "user",
        rows[0].id,
        JSON.stringify({ email: normalizedEmail, role }),
      ],
    );
  }

  return rows[0];
}

// Edits an existing user. The password only changes when a new one is sent, and an administrator
// cannot take away their own admin role (nobody could give it back from the panel).
export async function updateUser(id, { name, email, password, role }, actor) {
  const { rows: current } = await query("select id, email, role from users where id = $1 and deleted_at is null", [id]);
  if (!current[0]) throw new HttpError(404, "Usuario no encontrado");
  if (actor?.id === id && role && !isAdmin({ role })) {
    throw new HttpError(400, "No puedes quitarte tu propio rol de administración");
  }

  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail && normalizedEmail !== current[0].email) {
    const { rows: taken } = await query("select id from users where email = $1 and id <> $2", [normalizedEmail, id]);
    if (taken[0]) throw new HttpError(409, "Ya existe otro usuario con ese email");
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  const { rows } = await query(
    `update users set
       name = coalesce($2, name),
       email = coalesce($3, email),
       role = coalesce($4, role),
       password_hash = coalesce($5, password_hash)
     where id = $1 and deleted_at is null
     returning id, name, email, role`,
    [id, name?.trim() || null, normalizedEmail || null, role || null, passwordHash],
  );

  if (!rows[0]) throw new HttpError(404, "Usuario no encontrado");

  if (actor?.id) {
    await query(
      `insert into activity_logs (user_id, action, entity_type, entity_id, metadata)
       values ($1, 'USER_UPDATED', 'user', $2, $3)`,
      [actor.id, id, JSON.stringify({ email: rows[0].email, role: rows[0].role, password_changed: Boolean(password) })],
    );
  }
  return rows[0];
}
