import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import slugify from "slugify";
import { z } from "zod";
import { pool, withTransaction } from "./pool.js";
import { createChatJson, createEmbeddings } from "../services/openaiService.js";
import { parseModelJson } from "../utils/json.js";
import { toVectorLiteral } from "../utils/vector.js";

const privateTitlePrefix = "[PRIVADA] ";
const outputDirectory = fileURLToPath(
  new URL("../../../quality_sources/instrucciones/", import.meta.url),
);
const jsonPath = path.join(outputDirectory, "instrucciones_generadas.json");
const markdownPath = path.join(outputDirectory, "informe_instrucciones.md");

const instructionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(3),
  content: z.string().min(10),
  difficulty: z.enum(["P", "F", "D"]).nullable(),
  source: z.object({
    document: z.string().min(1),
    page: z.number().int().positive().nullable(),
  }),
  active: z.boolean(),
});
const instructionFileSchema = z.object({
  version: z.literal(1),
  instructions: z.array(instructionSchema).min(1),
});

const command = process.argv[2];

async function main() {
  if (command === "export") return exportInstructions();
  if (command === "apply") return applyInstructions();
  throw new Error("Usa 'export' o 'apply'");
}

async function exportInstructions() {
  if (!process.argv.includes("--force")) {
    try {
      await access(jsonPath);
      throw new Error(
        `Ya existe ${jsonPath}. Usa --force solo si quieres reemplazar tus correcciones.`,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const { rows } = await pool.query(
    `select qkc.text, qkc.page, qsd.filename
     from quality_knowledge_chunks qkc
     join quality_source_documents qsd on qsd.id = qkc.source_document_id
     where qkc.source_type = 'QUALITY_GUIDE'
     order by qsd.filename, qkc.page, qkc.created_at`,
  );
  if (rows.length === 0) {
    throw new Error("No hay una guía de calidad indexada. Ejecuta primero npm run ingest-quality");
  }

  const sourceText = rows
    .map(
      (row, index) =>
        `FRAGMENTO ${index + 1} | documento=${row.filename} | pagina=${row.page || "desconocida"}\n${row.text}`,
    )
    .join("\n\n");
  const raw = await createChatJson([
    {
      role: "system",
      content:
        "Extrae reglas operativas para generar preguntas test de oposiciones. No inventes reglas. Divide las reglas por objetivo, dificultad, redacción, distractores, explicación, referencias y control de ambigüedad. Conserva la página de origen. Responde únicamente con JSON válido.",
    },
    {
      role: "user",
      content: `Convierte esta guía en instrucciones atómicas, claras y directamente aplicables por un generador de preguntas. Usa difficulty P, F, D o null cuando se aplique a todos. Devuelve entre 20 y 80 reglas sin duplicados.

Formato (difficulty debe ser "P", "F", "D" o el valor JSON null):
{"instructions":[{"title":"Título breve","content":"Instrucción completa","difficulty":null,"source":{"document":"archivo.pdf","page":1},"active":true}]}

GUÍA:
${sourceText}`,
    },
  ], 0.1);
  const parsed = z
    .object({
      instructions: z.array(instructionSchema.omit({ id: true })).min(1),
    })
    .parse(parseModelJson(raw));
  const usedIds = new Set();
  const instructions = parsed.instructions.map((instruction, index) => {
    const baseId = slugify(instruction.title, { lower: true, strict: true }) || `regla-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
    usedIds.add(id);
    return { id, ...instruction };
  });
  const document = { version: 1, instructions };

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, buildMarkdown(document), "utf8");
  console.log(`Exportadas ${instructions.length} instrucciones:`);
  console.log(jsonPath);
  console.log(markdownPath);
  console.log("Edita el JSON y después ejecuta: npm run quality:apply-instructions");
}

async function applyInstructions() {
  const parsed = instructionFileSchema.parse(
    JSON.parse(await readFile(jsonPath, "utf8")),
  );
  const active = parsed.instructions.filter((instruction) => instruction.active);
  const embeddings = await createEmbeddings(
    active.map(
      (instruction) =>
        `${instruction.title}\nNivel: ${instruction.difficulty || "TODOS"}\n${instruction.content}`,
    ),
  );
  const difficultyMap = { P: "PRINCIPIANTE", F: "ELITE", D: "ALEATORIO" };

  await withTransaction(async (client) => {
    await client.query("delete from quality_instructions where title like $1", [
      `${privateTitlePrefix}%`,
    ]);
    for (const [index, instruction] of active.entries()) {
      await client.query(
        `insert into quality_instructions
           (title, content, difficulty, active, embedding, created_by)
         values ($1, $2, $3, true, $4::vector, null)`,
        [
          `${privateTitlePrefix}${instruction.title}`,
          `${instruction.content}\nFuente: ${instruction.source.document}${instruction.source.page ? `, página ${instruction.source.page}` : ""}`,
          instruction.difficulty ? difficultyMap[instruction.difficulty] : null,
          toVectorLiteral(embeddings[index]),
        ],
      );
    }
  });
  console.log(`Aplicadas ${active.length} instrucciones activas (${parsed.instructions.length - active.length} desactivadas)`);
}

function buildMarkdown(document) {
  const sections = [
    "# Instrucciones privadas del generador",
    "",
    "> Este informe es de lectura. Para corregir reglas, edita `instrucciones_generadas.json` y ejecuta `npm run quality:apply-instructions`.",
    "",
  ];
  for (const instruction of document.instructions) {
    sections.push(
      `## ${instruction.active ? "✅" : "⛔"} ${instruction.title}`,
      "",
      `- ID: \`${instruction.id}\``,
      `- Dificultad: ${instruction.difficulty || "Todas"}`,
      `- Fuente: ${instruction.source.document}${instruction.source.page ? `, página ${instruction.source.page}` : ""}`,
      "",
      instruction.content,
      "",
    );
  }
  return sections.join("\n");
}

main()
  .catch((error) => {
    console.error(error instanceof z.ZodError ? error.format() : error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
