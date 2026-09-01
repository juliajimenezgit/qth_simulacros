import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { HttpError } from "../utils/errors.js";

export async function login(email, password) {
  const normalizedEmail = email.trim().toLowerCase();
  const { rows } = await query(
    "select id, name, email, password_hash, role from users where email = $1",
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
     returning id, name, email, role`,
    [name.trim(), normalizedEmail, passwordHash, role],
  );

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
