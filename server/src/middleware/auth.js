import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { HttpError } from "../utils/errors.js";

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      throw new HttpError(401, "Sesion requerida");
    }

    const payload = jwt.verify(token, env.jwtSecret);
    const { rows } = await query(
      "select id, name, email, role from users where id = $1",
      [payload.sub],
    );

    if (!rows[0]) {
      throw new HttpError(401, "Usuario no autorizado");
    }

    req.user = rows[0];
    next();
  } catch (error) {
    next(error.status ? error : new HttpError(401, "Sesion no valida"));
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, "Permisos insuficientes"));
    }

    return next();
  };
}
