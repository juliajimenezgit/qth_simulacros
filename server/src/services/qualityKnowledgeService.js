import { query } from "../db/pool.js";
import { createEmbedding } from "./openaiService.js";
import { toVectorLiteral } from "../utils/vector.js";

const sourceLimits = {
  QUALITY_GUIDE: 5,
  ANNOTATED_GUIDE: 5,
  OFFICIAL_EXAM: 4,
};

export async function retrievePrivateQualityKnowledge({ difficulty, contextChunks }) {
  try {
    const preview = contextChunks.map((chunk) => chunk.text).join("\n").slice(0, 6000);
    const embedding = await createEmbedding(
      `Crear pregunta de dificultad ${difficulty} sobre:\n${preview}`,
    );
    const vector = toVectorLiteral(embedding);
    const grouped = {};

    for (const [sourceType, limit] of Object.entries(sourceLimits)) {
      const { rows } = await query(
        `select qkc.text, qkc.page, qkc.section, qsd.filename
         from quality_knowledge_chunks qkc
         join quality_source_documents qsd on qsd.id = qkc.source_document_id
         where qkc.source_type = $1 and qkc.embedding is not null
         order by qkc.embedding <=> $2::vector
         limit $3`,
        [sourceType, vector, limit],
      );
      grouped[sourceType] = rows;
    }

    return grouped;
  } catch (error) {
    if (error?.code === "42P01") return {};
    console.warn("No se pudo recuperar la biblioteca privada de calidad", error.message);
    return {};
  }
}

export function formatPrivateQualityKnowledge(knowledge = {}) {
  const format = (items = []) =>
    items.length
      ? items
          .map(
            (item, index) =>
              `${index + 1}. [${item.filename}, página ${item.page || "?"}] ${item.text}`,
          )
          .join("\n\n")
      : "Sin referencias disponibles.";

  return {
    rules: format(knowledge.QUALITY_GUIDE),
    annotations: format(knowledge.ANNOTATED_GUIDE),
    officialExamples: format(knowledge.OFFICIAL_EXAM),
  };
}
