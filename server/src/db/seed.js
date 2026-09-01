import { env } from "../config/env.js";
import { pool } from "./pool.js";
import { createUser } from "../services/authService.js";

async function main() {
  const users = JSON.parse(env.authorizedUsers);

  if (!Array.isArray(users) || users.length === 0) {
    console.log("No users found in AUTHORIZED_USERS");
    return;
  }

  for (const user of users) {
    const created = await createUser(user);
    console.log(`Upserted ${created.role}: ${created.email}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
