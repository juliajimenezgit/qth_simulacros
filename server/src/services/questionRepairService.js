import { z } from "zod";
import { env } from "../config/env.js";
import { createChatJson } from "./openaiService.js";
import { parseModelJson } from "../utils/json.js";
import { LETTERS, MAX_OPTION_WORD_GAP, optionKey, optionWordCounts, optionWordGap } from "../utils/questionValidation.js";

const repairSchema = z.object({
  option_a: z.string().min(1), option_b: z.string().min(1), option_c: z.string().min(1), option_d: z.string().min(1),
  explanation: z.string().min(5),
});

// A question rejected only for unequal option lengths has already paid for its generation: rewording
// its options is a short call, instead of discarding it and generating a new batch. The documentary
// review still checks the repaired question afterwards.
export async function rebalanceOptionLengths(question, sourceChunk) {
  try {
    const raw = await createChatJson([
      { role: "system", content: "Eres corrector de preguntas tipo test. Solo reescribes la redacción de las opciones para igualar su longitud. Nunca cambias qué opción es la válida, ni los datos, cifras o conceptos de cada opción. Responde con JSON válido." },
      { role: "user", content: `Entre la opción más larga y la más corta no puede haber más de ${MAX_OPTION_WORD_GAP} palabras («Todas son correctas.» y «Ninguna es correcta.» no cuentan y no se modifican). Palabras actuales: ${JSON.stringify(optionWordCounts(question))}.
Acorta las opciones largas quitando palabras accesorias, sin perder el dato que las hace verdaderas o falsas; si hace falta, alarga las cortas con palabras del propio enunciado o del fragmento. Conserva la redacción literal del manual siempre que puedas. Mantén cada opción en su letra y la misma estructura gramatical en las cuatro. Termina cada opción en punto.
Si la explicación cita literalmente una opción que cambias, actualiza esa cita; no cambies nada más de la explicación.
Pregunta: ${question.question}
Opción válida: ${question.correct_answer}
${LETTERS.map((letter) => `${letter}: ${question[optionKey(letter)]}`).join("\n")}
Explicación: ${question.explanation}
Fragmento de referencia: ${sourceChunk?.text || ""}
Devuelve exactamente: {"option_a":"...","option_b":"...","option_c":"...","option_d":"...","explanation":"..."}` },
    ], 0);
    const repaired = { ...question, ...repairSchema.parse(parseModelJson(raw)) };
    return optionWordGap(repaired) <= MAX_OPTION_WORD_GAP ? repaired : question;
  } catch (error) {
    if (env.generationVerboseLogs) console.warn(`[Generación reparación] no se pudo reequilibrar «${question.question}»: ${error.message}`);
    return question;
  }
}
