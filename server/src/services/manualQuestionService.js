import { z } from "zod";
import { withTransaction } from "../db/pool.js";
import { HttpError } from "../utils/errors.js";
import { isAdmin } from "../utils/roles.js";
import { normalizeUnicode } from "../utils/unicode.js";

const text = (minimum) => z.string().trim().min(minimum);
export const manualQuestionSchema = z.object({
  testId: z.string().uuid(),
  documentId: z.string().uuid(),
  question: text(10),
  option_a: text(1), option_b: text(1), option_c: text(1), option_d: text(1),
  correct_answer: z.enum(["A", "B", "C", "D"]),
  explanation: text(5),
  source_title: text(1), topic: text(1), chapter: text(1), reference: text(3),
  difficulty: z.enum(["PRINCIPIANTE", "FACIL", "DIFICIL"]),
});

export async function createManualQuestion(user, payload) {
  const parsed = manualQuestionSchema.safeParse(payload);
  if (!parsed.success) throw new HttpError(400, "Completa el enunciado, las cuatro respuestas, la explicación y los datos del temario", parsed.error.flatten());
  const data = Object.fromEntries(Object.entries(parsed.data).map(([key, value]) => [key, normalizeUnicode(value)]));
  return withTransaction(async (client) => {
    const { rows: tests } = await client.query(
      "select id, user_id, status from question_sets where id = $1 and not is_demo for update",
      [data.testId],
    );
    const test = tests[0];
    if (!test || (!isAdmin(user) && test.user_id !== user.id)) throw new HttpError(404, "Test no encontrado");
    if (test.status === "GENERATING") throw new HttpError(409, "Espera a que termine la generación antes de añadir preguntas");
    const { rows: documents } = await client.query(
      "select id from documents where id = $1 and (user_id = $2 or $3)",
      [data.documentId, user.id, isAdmin(user)],
    );
    if (!documents[0]) throw new HttpError(404, "Temario no encontrado");
    const fields = ["question", "option_a", "option_b", "option_c", "option_d", "correct_answer", "explanation", "source_title", "topic", "chapter", "reference", "difficulty"];
    const { rows } = await client.query(
      `insert into questions (user_id, document_id, question_set_id, is_manual, ${fields.join(", ")})
       values ($1, $2, $3, true, ${fields.map((_, i) => `$${i + 4}`).join(", ")}) returning *`,
      [test.user_id, data.documentId, test.id, ...fields.map(field => data[field])],
    );
    await client.query(
      "update question_sets set generated_count = (select count(*) from questions where question_set_id = $1) where id = $1",
      [test.id],
    );
    return rows[0];
  });
}
