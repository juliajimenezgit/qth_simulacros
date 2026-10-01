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
// its options is a short call (~1.500 tokens), instead of discarding it and generating a new batch
// (~20.000). A second attempt is told how far the first one fell short. The documentary review still
// checks the repaired question afterwards.
const REPAIR_ATTEMPTS = 2;

export async function rebalanceOptionLengths(question, sourceChunk) {
  let current = question;
  for (let attempt = 1; attempt <= REPAIR_ATTEMPTS; attempt++) {
    const repaired = await rewordOptions(question, current, sourceChunk);
    if (!repaired) return question;
    if (optionWordGap(repaired) <= MAX_OPTION_WORD_GAP) return repaired;
    current = repaired;
  }
  return question;
}

// «previous» is the last failed rewording (or the question itself on the first attempt).
async function rewordOptions(question, previous, sourceChunk) {
  const counts = optionWordCounts(previous);
  const retry = previous !== question
    ? `\nTu intento anterior seguía teniendo ${optionWordGap(previous)} palabras de diferencia (${JSON.stringify(counts)}). Parte de ese intento y acorta más la opción más larga o alarga la más corta hasta que la diferencia sea ${MAX_OPTION_WORD_GAP} o menos.`
    : "";
  try {
    const raw = await createChatJson([
      { role: "system", content: "Eres corrector de preguntas tipo test. Solo reescribes la redacción de las opciones para igualar su longitud. Nunca cambias qué opción es la válida, ni los datos, cifras o conceptos de cada opción. Responde con JSON válido." },
      { role: "user", content: `Entre la opción más larga y la más corta no puede haber más de ${MAX_OPTION_WORD_GAP} palabras («Todas son correctas.» y «Ninguna es correcta.» no cuentan y no se modifican). Palabras actuales: ${JSON.stringify(counts)}.
Lo habitual es que la opción válida sea la larga porque copia la frase entera del manual: acórtala hasta su núcleo (el dato o la idea que responde a lo pedido), conservando literales sus palabras clave y quitando oraciones subordinadas, ejemplos y enumeraciones accesorias. Acorta igual cualquier otra opción larga, sin perder el dato que la hace verdadera o falsa; si hace falta, alarga las cortas con palabras del propio enunciado o del fragmento. Mantén cada opción en su letra y la misma estructura gramatical en las cuatro. Termina cada opción en punto.
Si la explicación cita literalmente una opción que cambias, actualiza esa cita; no cambies nada más de la explicación.${retry}
Pregunta: ${question.question}
Opción válida: ${question.correct_answer}
${LETTERS.map((letter) => `${letter}: ${previous[optionKey(letter)]}`).join("\n")}
Explicación: ${previous.explanation}
Fragmento de referencia: ${sourceChunk?.text || ""}
Devuelve exactamente: {"option_a":"...","option_b":"...","option_c":"...","option_d":"...","explanation":"..."}` },
    ], 0, { maxTokens: 800 });
    return { ...question, ...repairSchema.parse(parseModelJson(raw)) };
  } catch (error) {
    if (env.generationVerboseLogs) console.warn(`[Generación reparación] no se pudo reequilibrar «${question.question}»: ${error.message}`);
    return null;
  }
}
