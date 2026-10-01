import { env } from "../config/env.js";

// Terminal output of a generation: one line per saved question, one summary per attempt and a
// visible banner when the test fails. Full rejection details only with GENERATION_VERBOSE_LOGS=true.
const useColor = !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const green = (text) => paint("32", text);
const red = (text) => paint("31", text);
const yellow = (text) => paint("33", text);
const cyan = (text) => paint("36", text);
const dim = (text) => paint("2", text);
const bold = (text) => paint("1", text);

const LEVELS = { PRINCIPIANTE: "P", FACIL: "F", DIFICIL: "D" };
const shorten = (text, length) => {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
};

// Readable names for the rejection codes; codes with an option letter share the label.
const REASONS = [
  [/^OPCIONES_LONGITUD_DESIGUAL$/, "longitud de opciones"],
  [/^FORMATO_EXCEDIDO$/, "cupo de formato lleno"],
  [/^CUOTA_NEGATIVAS_PENDIENTE$/, "faltan negativas/Todas-Ninguna"],
  [/^TODAS_NINGUNA_CORRECTA_EXCEDIDA$/, "cupo Todas/Ninguna correcta"],
  [/^VARIAS_OPCIONES_DE_CONJUNTO$/, "varias Todas/Ninguna"],
  [/^COBERTURA_REPETIDA$/, "apartado ya muy usado"],
  [/^EVIDENCIA_NO_DOCUMENTADA_/, "cita no encontrada en el manual"],
  [/^AFIRMACION_NO_LITERAL_/, "afirmación verdadera no literal"],
  [/^DESCARTABLE_SIN_SABER_/, "descartable sin saber"],
  [/^OPCION_NO_PLAUSIBLE_/, "distractor poco creíble"],
  [/^ABSOLUTO_NO_JUSTIFICADO_/, "absoluto injustificado"],
  [/^RESPUESTA_NO_UNICA_O_INCORRECTA$/, "respuesta no única o errónea"],
  [/^EXPLICACION_INSUFICIENTE$/, "explicación incompleta"],
  [/^ENUNCIADO_CONFUSO$/, "enunciado confuso o con errores"],
  [/^ENUNCIADO_VARIAS_COSAS$/, "enunciado que pregunta varias cosas"],
  [/^(NIVEL_NO_ADECUADO|DIFICULTAD_INCORRECTA)$/, "nivel no adecuado"],
  [/^DISTRACTORES_OTRA_CATEGORIA$/, "distractores de otra categoría"],
  [/^OPCIONES_EQUIVALENTES$/, "dos opciones equivalentes"],
  [/^PREGUNTA_IMPUGNABLE$/, "pregunta impugnable"],
  [/^CALCULO_INCORRECTO$/, "cálculo incorrecto"],
  [/^TIPO_EXCEDIDO$/, "tipo de pregunta ya cubierto"],
  [/^TIPO_NO_SELECCIONADO$/, "tipo de pregunta no elegido"],
  [/^TIPO_NO_ADECUADO_AL_NIVEL$/, "tipo de pregunta impropio del nivel"],
  [/^RESPUESTA_SE_DELATA$/, "la correcta se delata"],
  [/^AUDITORIA_/, "revisión fallida"],
  [/^FRAGMENTO_NO_AUTORIZADO$/, "fragmento inexistente"],
  [/^OPCIONES_DEPENDIENTES_DE_POSICION$/, "referencias a letras"],
  [/^OPCIONES_REPETIDAS_O_VACIAS$/, "opciones repetidas o vacías"],
  [/^REFERENCIA_ESTRUCTURAL_EN_OPCIONES$/, "menciona capítulo/tema"],
  [/^ESQUEMA_/, "respuesta incompleta del modelo"],
  [/^REPETIDA$/, "repetida en el test"],
];
export function reasonLabel(code) {
  return REASONS.find(([pattern]) => pattern.test(code))?.[1] || code;
}

const formatReasons = (reasons, limit = 4) => [...reasons]
  .sort((a, b) => b[1] - a[1])
  .slice(0, limit)
  .map(([label, count]) => `${count} ${label}`)
  .join(", ");

// Shared by every document of the test: they are generated in parallel.
export function createProgress({ name, requested }) {
  return { name, requested, saved: 0, reasons: new Map(), startedAt: performance.now() };
}

// One label per rejected question, even if it has several codes for the same reason.
export function recordRejection(progress, attemptReasons, errors) {
  for (const label of new Set(errors.map(reasonLabel))) {
    attemptReasons.set(label, (attemptReasons.get(label) || 0) + 1);
    progress.reasons.set(label, (progress.reasons.get(label) || 0) + 1);
  }
}

export function logTestStarted(progress, { documents, difficultyCounts }) {
  const levels = Object.entries(difficultyCounts).filter(([, count]) => count > 0).map(([level, count]) => `${level} ${count}`).join(" · ");
  console.info(`\n${cyan(bold(`━━ Test «${progress.name}»`))} ${cyan(`· ${progress.requested} preguntas (${levels}) · ${documents} temario(s)`)}`);
}

export function logQuestionSaved(progress, { question, difficulty, documentLabel }) {
  // Logging must never break a generation: tolerate incomplete rows.
  const answer = question[`option_${String(question.correct_answer || '').toLowerCase()}`] || '';
  const position = `${String(progress.saved).padStart(String(progress.requested).length)}/${progress.requested}`;
  console.info(`  ${green("✓")} ${bold(position)} ${LEVELS[difficulty] || difficulty} ${dim(shorten(documentLabel, 22))}  ${shorten(question.question, 90)}${answer ? ` ${dim(`→ ${shorten(answer, 40)}`)}` : ""}`);
}

export function logAttempt({ documentLabel, difficulty, attempt, generated, accepted, repaired, attemptReasons, documentSaved, documentRequested, seconds }) {
  const parts = [generated ? `${generated} generadas → +${accepted} aceptada${accepted === 1 ? "" : "s"}` : "el modelo no devolvió preguntas"];
  if (repaired) parts.push(`${repaired} reparada${repaired === 1 ? "" : "s"}`);
  const rejected = formatReasons(attemptReasons);
  const line = `  ${dim("·")} ${shorten(documentLabel, 22)} ${LEVELS[difficulty] || difficulty} · intento ${attempt}: ${parts.join(", ")}${rejected ? ` · rechazos: ${rejected}` : ""} · ${documentSaved}/${documentRequested} de este temario · ${seconds}s`;
  console.info(accepted ? line : yellow(line));
}

export function logRejectionDetail({ documentLabel, attempt, question, errors, details }) {
  if (!env.generationVerboseLogs) return;
  console.warn(dim(`    ✗ ${shorten(documentLabel, 22)} intento ${attempt}: ${shorten(question, 100)} → ${errors.join(", ")} ${JSON.stringify(details)}`));
}

export function logVerbose(message) {
  if (env.generationVerboseLogs) console.info(dim(`    ${message}`));
}

export function logTestCompleted(progress, cost) {
  const seconds = ((performance.now() - progress.startedAt) / 1000).toFixed(0);
  const spent = cost == null ? "" : ` · coste ~${cost.toFixed(3)} ${env.openaiUsageCurrency}`;
  console.info(`${green(bold(`✔ Test «${progress.name}» completado:`))} ${green(`${progress.saved} preguntas en ${seconds} s${spent}`)}\n`);
}

export function logTestFailed(progress, error, cost) {
  const seconds = ((performance.now() - progress.startedAt) / 1000).toFixed(0);
  const spent = cost == null ? "" : ` · coste ~${cost.toFixed(3)} ${env.openaiUsageCurrency}`;
  const bar = red("━".repeat(70));
  console.error(`\n${bar}\n${red(bold(`✖ ERROR en el test «${progress.name}»`))}\n${red(`  ${error.message}`)}`);
  console.error(`  Guardadas ${progress.saved} de ${progress.requested} preguntas en ${seconds} s${spent}. Se conservan en el test, marcado con error.`);
  if (progress.reasons.size) console.error(`  Rechazos más frecuentes: ${formatReasons(progress.reasons, 6)}`);
  if (!error.status || error.status >= 500) console.error(dim(error.stack || String(error)));
  console.error(`${bar}\n`);
}
