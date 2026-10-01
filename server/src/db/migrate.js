import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const migrationsUrl = new URL("../../../database/migrations/", import.meta.url);

try {
  const migrationDirectory = fileURLToPath(migrationsUrl);
  const migrationFiles = (await readdir(migrationDirectory))
    // Skip hidden files such as the "._*" metadata macOS writes on external drives.
    .filter((filename) => filename.endsWith(".sql") && !filename.startsWith("."))
    .sort();

  const migrations = await Promise.all(
    migrationFiles.map((filename) => readFile(new URL(filename, migrationsUrl), "utf8")),
  );
  await pool.query(migrations.join("\n"));
  console.log("Migraciones aplicadas correctamente");
} finally {
  await pool.end();
}
