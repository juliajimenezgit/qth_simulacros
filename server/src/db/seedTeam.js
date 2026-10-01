import { pool } from "./pool.js";
import { createUser } from "../services/authService.js";

// Demo team for the presentation: Julia (developer), Jon (administrator) and five test teachers.
// The shared password comes from TEAM_DEMO_PASSWORD in server/.env, never from the code.
const JULIA = { name: "Julia", email: "julia@qthsutan.es", role: "DESARROLLADOR" };
const TEAM = [
  { name: "Jon", email: "jon@qthsutan.es", role: "ADMIN" },
  { name: "Laura Martín", email: "laura.martin@qthsutan.es", role: "PROFESOR" },
  { name: "Carlos Ruiz", email: "carlos.ruiz@qthsutan.es", role: "PROFESOR" },
  { name: "Marta Gómez", email: "marta.gomez@qthsutan.es", role: "PROFESOR" },
  { name: "David Sánchez", email: "david.sanchez@qthsutan.es", role: "PROFESOR" },
  { name: "Elena Torres", email: "elena.torres@qthsutan.es", role: "PROFESOR" },
];
// The original account owns every document, question and test: it becomes Julia and keeps them.
const ORIGINAL_ADMIN_EMAIL = "admin@qthsutan.es";

async function main() {
  const password = process.env.TEAM_DEMO_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("Define TEAM_DEMO_PASSWORD (mínimo 8 caracteres) en server/.env antes de crear el equipo de prueba");
  }

  const { rows: julia } = await pool.query("select id from users where email = $1", [JULIA.email]);
  if (julia.length) {
    await pool.query("update users set name = $2, role = $3 where email = $1", [JULIA.email, JULIA.name, JULIA.role]);
    console.log(`Julia ya existía: rol ${JULIA.role}`);
  } else {
    // Keeps the password and all the data of the original account.
    const { rowCount } = await pool.query(
      "update users set name = $2, email = $3, role = $4 where email = $1",
      [ORIGINAL_ADMIN_EMAIL, JULIA.name, JULIA.email, JULIA.role],
    );
    if (rowCount) console.log(`${ORIGINAL_ADMIN_EMAIL} → ${JULIA.email} (${JULIA.role}), con sus datos y su contraseña`);
    else console.log(`No existe ${ORIGINAL_ADMIN_EMAIL}; crea a Julia desde el panel de administración`);
  }

  for (const member of TEAM) {
    const user = await createUser({ ...member, password });
    console.log(`${user.role.padEnd(13)} ${user.name} <${user.email}>`);
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
