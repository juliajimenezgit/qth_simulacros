import { readFile } from "node:fs/promises";
import { z } from "zod";

const fileUrl = new URL("../../../quality_sources/instrucciones/instrucciones_generadas.json", import.meta.url);
const levels = { P: "PRINCIPIANTE", F: "FACIL", D: "DIFICIL" };
const schema = z.object({
  version: z.literal(1),
  instructions: z.array(z.object({
    id: z.string().min(1), title: z.string().min(3), content: z.string().min(10),
    difficulty: z.enum(["P", "F", "D"]).nullable(), active: z.boolean(),
  })),
});

export function selectCuratedInstructions(document, difficulty) {
  return schema.parse(document).instructions
    .filter(rule => rule.active && (rule.difficulty === null || levels[rule.difficulty] === difficulty))
    .map(rule => ({ ...rule, difficulty: levels[rule.difficulty] || null, origin: "CURATED" }));
}

export async function loadCuratedInstructions(difficulty) {
  let raw;
  try {
    raw = await readFile(fileUrl, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  // Invalid edits must fail visibly, never silently reactivate the old rules.
  return selectCuratedInstructions(JSON.parse(raw), difficulty);
}
