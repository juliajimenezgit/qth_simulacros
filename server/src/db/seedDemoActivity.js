import { pool } from "./pool.js";
import { TEST_LEVELS } from "../utils/testLevels.js";

// Fictitious activity for the demo team (everyone except Julia, whose data is real): minutes in the
// app, logins and tests over the last 60 days. Everything is marked as demo, so it never appears in
// the content views and «--remove» deletes it without touching real usage.
const DAYS = 60;
const PROFILES = [
  // activeRate: share of days with activity; minutes: per active day; testRate: tests per active day;
  // levels: share of tests at Principiante, Élite and Aleatorio.
  { email: "jon@qthsutan.es", joined: 58, activeRate: 0.3, minutes: [8, 25], testRate: 0.3, levels: [0.4, 0.4, 0.2], sizes: [10, 20], failRate: 0.1 },
  { email: "laura.martin@qthsutan.es", joined: 57, activeRate: 0.75, minutes: [40, 95], testRate: 0.45, levels: [0.5, 0.4, 0.1], sizes: [10, 20, 30], failRate: 0.05 },
  { email: "carlos.ruiz@qthsutan.es", joined: 50, activeRate: 0.5, minutes: [25, 60], testRate: 0.35, levels: [0.3, 0.5, 0.2], sizes: [10, 15, 20], failRate: 0.15 },
  { email: "marta.gomez@qthsutan.es", joined: 45, activeRate: 0.18, minutes: [15, 40], testRate: 0.3, levels: [0.6, 0.4, 0], sizes: [10], failRate: 0.1 },
  { email: "david.sanchez@qthsutan.es", joined: 9, activeRate: 0.35, minutes: [10, 30], testRate: 0.4, levels: [0.7, 0.3, 0], sizes: [5, 10], failRate: 0.3 },
  { email: "elena.torres@qthsutan.es", joined: 52, activeRate: 0.45, minutes: [45, 80], testRate: 0.4, levels: [0.1, 0.3, 0.6], sizes: [15, 20, 25], failRate: 0.2 },
];

// Deterministic pseudo-random numbers: the same demo every time the script runs.
function seededRandom(text) {
  let seed = [...text].reduce((hash, char) => Math.imul(hash ^ char.codePointAt(0), 2654435761), 2166136261) >>> 0;
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const slug = (text) => String(text).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
  .replace(/^cap[ií]tulo \d+\s*/u, "").replace(/[^a-z0-9]+/g, "").slice(0, 24);

async function removeDemo(client) {
  const sets = await client.query("delete from question_sets where is_demo");
  const usage = await client.query("delete from user_usage_days where is_demo");
  const logins = await client.query("delete from activity_logs where action = 'LOGIN' and metadata->>'demo' = 'true'");
  return { tests: sets.rowCount, days: usage.rowCount, logins: logins.rowCount };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const removed = await removeDemo(client);
    if (process.argv.includes("--remove")) {
      await client.query("commit");
      console.log(`Actividad de demostración eliminada: ${removed.tests} tests, ${removed.days} días de uso, ${removed.logins} accesos`);
      return;
    }

    const { rows: documents } = await client.query(
      `select id, coalesce(display_title, original_filename) as title
       from documents where status = 'AVAILABLE' order by created_at, id`,
    );
    if (!documents.length) throw new Error("No hay temarios disponibles para los tests de demostración");

    for (const profile of PROFILES) {
      const { rows } = await client.query("select id, name from users where email = $1", [profile.email]);
      if (!rows[0]) {
        console.log(`No existe ${profile.email}; ejecuta antes seed:team`);
        continue;
      }
      const user = rows[0];
      const random = seededRandom(profile.email);
      const pick = (items) => items[Math.floor(random() * items.length)];
      const between = ([min, max]) => Math.round(min + random() * (max - min));
      // Each person works with a few documents of the library.
      const favourites = Array.from({ length: 4 }, () => pick(documents));
      const joinedAt = new Date(Date.now() - profile.joined * 86_400_000);
      await client.query("update users set created_at = $2 where id = $1", [user.id, joinedAt]);

      let minutes = 0;
      let tests = 0;
      let lastSeen = null;
      for (let daysAgo = Math.min(profile.joined, DAYS); daysAgo >= 0; daysAgo--) {
        const day = new Date(Date.now() - daysAgo * 86_400_000);
        const weekend = [0, 6].includes(day.getDay());
        if (random() > profile.activeRate * (weekend ? 0.3 : 1)) continue;

        const dayMinutes = between(profile.minutes);
        minutes += dayMinutes;
        const start = new Date(day);
        start.setHours(between([8, 19]), between([0, 59]), 0, 0);
        if (start > new Date()) start.setTime(Date.now() - dayMinutes * 60_000);
        lastSeen = new Date(start.getTime() + dayMinutes * 60_000);
        await client.query(
          `insert into user_usage_days (user_id, day, minutes, is_demo) values ($1, $2, $3, true)`,
          [user.id, start.toISOString().slice(0, 10), dayMinutes],
        );
        await client.query(
          `insert into activity_logs (user_id, action, entity_type, entity_id, metadata, created_at)
           values ($1, 'LOGIN', 'user', $1, '{"demo": true}', $2)`,
          [user.id, start],
        );

        let testTime = new Date(start.getTime() + between([3, 15]) * 60_000);
        while (random() < profile.testRate) {
          const size = pick(profile.sizes);
          // One test level per test, chosen with the person's usual preference.
          const roll = random();
          const testLevel = roll < profile.levels[0] ? "PRINCIPIANTE" : roll < profile.levels[0] + profile.levels[1] ? "ELITE" : "ALEATORIO";
          const used = [...new Set(Array.from({ length: between([1, 2]) }, () => pick(favourites)))];
          const failed = random() < profile.failRate;
          const generated = failed ? Math.max(1, size - between([1, 3])) : size;
          // The questions it saved, split evenly among the difficulties of its level.
          const levels = { P: 0, F: 0, D: 0 };
          TEST_LEVELS[testLevel].forEach((level, index, all) => {
            levels[level] = Math.floor(generated / all.length) + (index < generated % all.length ? 1 : 0);
          });
          // About 9-12 s per question, longer for D questions.
          const seconds = Math.round(size * (8 + random() * 4) * (1 + levels.D / size * 0.5));
          const name = `${slug(used[0].title)}_${String(testTime.getHours()).padStart(2, "0")}${String(testTime.getMinutes()).padStart(2, "0")}`;
          await client.query(
            `insert into question_sets
               (user_id, name, requested_count, generated_count, status, error_message, created_at, completed_at,
                is_demo, difficulty_counts, document_ids, test_difficulty, level_counts)
             values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11, $12)`,
            [
              user.id, name, size, generated, failed ? "ERROR" : "COMPLETED",
              failed ? `Solo se pudieron validar ${generated} de ${size} preguntas después de 9 intentos` : null,
              testTime, failed ? null : new Date(testTime.getTime() + seconds * 1000),
              JSON.stringify(levels), used.map((document) => document.id),
              testLevel, JSON.stringify({ [testLevel]: size }),
            ],
          );
          tests += 1;
          testTime = new Date(testTime.getTime() + (seconds + between([5, 20]) * 60) * 1000);
        }
      }
      if (lastSeen) await client.query("update users set last_seen_at = greatest(last_seen_at, $2) where id = $1", [user.id, lastSeen]);
      console.log(`${user.name.padEnd(15)} ${String(Math.round(minutes / 60)).padStart(3)} h en la app · ${String(tests).padStart(2)} tests`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
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
