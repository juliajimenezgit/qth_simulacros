import { Download, Plus, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { QUESTION_TYPE_LABELS } from "../utils/questionTypes.js";
import { explanationWithoutReference, shortReference } from "../utils/reference.js";
import { QUESTION_LEVELS, testDifficultyLabel } from "../utils/testDifficulty.js";
import { api, getToken } from "../services/api.js";

const emptyEdit = {
  documentId: "",
  question: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  correct_answer: "A",
  explanation: "",
  source_title: "",
  topic: "",
  chapter: "",
  reference: "",
  difficulty: "PRINCIPIANTE",
};

const exportFormats = [
  ["xlsx", "Excel (.xlsx)"],
  ["docx", "Word (.docx)"],
  ["pdf", "PDF (.pdf)"],
  ["csv", "CSV (.csv)"],
  ["json", "JSON (.json)"],
];


export default function QuestionReview({
  initialDocumentId = "",
  initialTestId = "",
  refreshKey = 0,
  showHeader = true,
}) {
  const [documents, setDocuments] = useState([]);
  const [tests, setTests] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [testId, setTestId] = useState(initialTestId);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorError, setEditorError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyEdit);
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [error, setError] = useState("");

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === documentId),
    [documents, documentId],
  );
  const selectedTest = useMemo(
    () => tests.find((test) => test.id === testId),
    [tests, testId],
  );

  useEffect(() => {
    setDocumentId(initialDocumentId);
  }, [initialDocumentId]);

  useEffect(() => {
    setTestId(initialTestId);
  }, [initialTestId]);

  async function load() {
    setError("");
    try {
      const [docData, testData, questionData] = await Promise.all([
        api.documents(),
        api.questionSets(),
        testId ? api.questions(documentId, testId) : Promise.resolve({ questions: [] }),
      ]);
      setDocuments(docData.documents);
      setTests(testData.tests);
      setQuestions(questionData.questions);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [documentId, testId, refreshKey]);

  function startCreate() {
    const document = documents.find(item => item.id === documentId)
      || documents.find(item => selectedTest?.document_ids?.includes(item.id));
    // A new question starts with a difficulty that fits its test: an Élite test has no P questions.
    const difficulty = selectedTest?.test_difficulty === "ELITE" ? "FACIL" : emptyEdit.difficulty;
    setDraft({ ...emptyEdit, difficulty, documentId: document?.id || "", source_title: document?.display_title || document?.original_filename || "" });
    setEditingId(null);
    setEditorError("");
    setNotice("");
    setCreating(true);
  }

  async function saveNewQuestion() {
    if (saving) return;
    setSaving(true);
    setEditorError("");
    try {
      await api.createQuestion({ ...draft, testId });
      setCreating(false);
      setNotice("Pregunta añadida al test.");
      if (documentId && documentId !== draft.documentId) setDocumentId("");
      else await load();
    } catch (err) {
      setEditorError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(question) {
    setCreating(false);
    setEditorError("");
    setEditingId(question.id);
    setDraft({
      is_manual: question.is_manual,
      question: question.question,
      option_a: question.option_a,
      option_b: question.option_b,
      option_c: question.option_c,
      option_d: question.option_d,
      correct_answer: question.correct_answer,
      explanation: question.explanation,
      source_title: question.source_title || question.original_filename,
      topic: question.topic || "",
      chapter: question.chapter || "",
      reference: question.reference,
      difficulty: question.difficulty,
    });
  }

  async function saveEdit() {
    if (saving) return;
    setSaving(true);
    setEditorError("");
    try {
      await api.updateQuestion(editingId, draft);
      setEditingId(null);
      await load();
    } catch (err) {
      setEditorError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeQuestion(id) {
    try {
      await api.deleteQuestion(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function exportQuestions() {
    if (!testId) {
      setError("Selecciona un test para exportar sus preguntas");
      return;
    }
    const url = api.exportUrl(documentId, exportFormat, testId);
    fetch(url, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((response) => {
        if (!response.ok) throw new Error("No se ha podido exportar");
        return response.blob();
      })
      .then((blob) => {
        const href = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = href;
        const testName = selectedTest?.name || "test-generado";
        const documentName = selectedDocument?.original_filename;
        anchor.download = `${documentName ? `${testName}-${documentName}` : testName}.${exportFormat}`;
        anchor.click();
        URL.revokeObjectURL(href);
      })
      .catch((err) => setError(err.message));
  }

  return (
    <>
      {showHeader && (
        <header className="page-header">
          <div>
            <p>Banco de preguntas</p>
            <h1>Revisión de preguntas</h1>
          </div>
          <div className="panel-actions">
            <ExportControls
              disabled={!testId || questions.length === 0}
              format={exportFormat}
              onExport={exportQuestions}
              onFormatChange={setExportFormat}
            />
          </div>
        </header>
      )}

      {!showHeader && (
        <div className="panel-actions">
          <ExportControls
            disabled={!testId || questions.length === 0}
            format={exportFormat}
            onExport={exportQuestions}
            onFormatChange={setExportFormat}
          />
        </div>
      )}

      <div className="filters">
        <label>
          <Search size={18} />
          <select
            disabled={Boolean(initialTestId) || creating || saving}
            onChange={(event) => {
              setEditingId(null);
              setNotice("");
              setTestId(event.target.value);
              setDocumentId("");
            }}
            value={testId}
          >
            <option value="">Selecciona un test</option>
            {tests.map((test) => (
              <option key={test.id} value={test.id}>
                {test.name} ({test.question_count} preguntas)
              </option>
            ))}
          </select>
        </label>
        <label>
          <Search size={18} />
          <select
            disabled={creating || saving}
            onChange={(event) => setDocumentId(event.target.value)}
            value={documentId}
          >
            <option value="">Todos los temarios</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.original_filename}
              </option>
            ))}
          </select>
        </label>
      </div>

      {selectedTest && (
        <section className="test-difficulty-summary" aria-label="Dificultad seleccionada del test">
          <strong>Dificultad del test: {testDifficultyLabel(selectedTest)}</strong>
        </section>
      )}

      <div className="panel-actions">
        <button className="primary-button" type="button" onClick={startCreate}
          disabled={!selectedTest || selectedTest.status === "GENERATING" || creating || saving}>
          <Plus size={18} /> Añadir pregunta manualmente
        </button>
      </div>
      {notice && <p role="status" className="generation-success">{notice}</p>}
      {creating && (
        <section className="question-card">
          <h2>Nueva pregunta para «{selectedTest?.name}»</h2>
          <QuestionEditor draft={draft} onChange={setDraft} onCancel={() => setCreating(false)}
            onSave={saveNewQuestion} creating documents={documents} saving={saving} error={editorError} />
        </section>
      )}

      {error && <p className="form-error">{error}</p>}

      <div className="question-list">
        {questions.length === 0 ? (
          <div className="empty-state">
            {testId
              ? "Este test no contiene preguntas con los filtros seleccionados."
              : "Selecciona un test para ver y exportar sus preguntas."}
          </div>
        ) : (
          questions.map((item) => (
            <article className="question-card" key={item.id}>
              {editingId === item.id ? (
                <QuestionEditor
                  draft={draft}
                  onCancel={() => setEditingId(null)}
                  onChange={setDraft}
                  saving={saving}
                  error={editorError}
                  onSave={saveEdit}
                />
              ) : (
                <>
                  <div className="question-card-header">
                    <div>
                      <span className={`question-level difficulty-${QUESTION_LEVELS[item.difficulty]?.short}`}>{QUESTION_LEVELS[item.difficulty]?.label || item.difficulty}</span>
                      {QUESTION_TYPE_LABELS[item.question_type] && <span className="question-type">{QUESTION_TYPE_LABELS[item.question_type]}</span>}
                      <strong className="test-name">{item.test_name || "Sin test asignado"}</strong>
                    </div>
                    <small>{new Date(item.created_at).toLocaleString("es-ES")}</small>
                  </div>
                  <h2>{item.question}</h2>
                  <ol className="answers" type="A">
                    <li className={item.correct_answer === "A" ? "correct" : ""}>
                      {item.option_a}
                    </li>
                    <li className={item.correct_answer === "B" ? "correct" : ""}>
                      {item.option_b}
                    </li>
                    <li className={item.correct_answer === "C" ? "correct" : ""}>
                      {item.option_c}
                    </li>
                    <li className={item.correct_answer === "D" ? "correct" : ""}>
                      {item.option_d}
                    </li>
                  </ol>
                  <div className="answer-summary">
                    <strong>Respuesta correcta: {item.correct_answer}</strong>
                    <p>
                      {item.reference && <span className="answer-reference">{shortReference(item.reference)} - </span>}
                      {item.reference ? explanationWithoutReference(item.explanation) : item.explanation}
                    </p>
                  </div>
                  {item.is_manual && <p className="muted-text">Manual: {item.source_title} · Tema: {item.topic} · Capítulo: {item.chapter}</p>}
                  <footer>
                    <div>
                      <button
                        className="secondary-button compact"
                        disabled={saving || creating}
                        onClick={() => startEdit(item)}
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="danger-button compact"
                        disabled={saving || creating}
                        onClick={() => removeQuestion(item.id)}
                        type="button"
                        title="Eliminar pregunta"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </footer>
                </>
              )}
            </article>
          ))
        )}
      </div>
    </>
  );
}

function ExportControls({ disabled, format, onExport, onFormatChange }) {
  return (
    <>
      <label className="inline-control">
        Formato
        <select
          onChange={(event) => onFormatChange(event.target.value)}
          value={format}
        >
          {exportFormats.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary-button"
        disabled={disabled}
        onClick={onExport}
        type="button"
      >
        <Download size={18} />
        Exportar simulacro
      </button>
    </>
  );
}

function QuestionEditor({ draft, onCancel, onChange, onSave, creating = false, documents = [], saving = false, error = "" }) {
  const update = (field, value) => onChange({ ...draft, [field]: value });

  return (
    <form className="question-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      {creating && <label>
        Temario asociado
        <select autoFocus required disabled={saving} value={draft.documentId} onChange={(event) => {
          const document = documents.find(item => item.id === event.target.value);
          onChange({ ...draft, documentId: event.target.value, source_title: document?.display_title || document?.original_filename || "" });
        }}>
          <option value="">Selecciona un temario</option>
          {documents.map(document => <option key={document.id} value={document.id}>{document.display_title || document.original_filename}</option>)}
        </select>
      </label>}
      {creating && documents.length === 0 && <p className="form-error">Necesitas un temario disponible para asociar la pregunta.</p>}
      <label>
        Enunciado
        <textarea
          onChange={(event) => update("question", event.target.value)}
          required minLength={10} disabled={saving}
          value={draft.question}
        />
      </label>
      {["option_a", "option_b", "option_c", "option_d"].map((field, index) => (
        <label key={field}>
          Respuesta {String.fromCharCode(65 + index)}
          <input
            onChange={(event) => update(field, event.target.value)}
            required disabled={saving}
            value={draft[field]}
          />
        </label>
      ))}
      <div className="field-row">
        <label>
          Correcta
          <select
            onChange={(event) => update("correct_answer", event.target.value)}
            disabled={saving}
            value={draft.correct_answer}
          >
            {["A", "B", "C", "D"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nivel
          <select
            onChange={(event) => update("difficulty", event.target.value)}
            disabled={saving}
            value={draft.difficulty}
          >
            {Object.entries(QUESTION_LEVELS).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <label>
        Explicación
        <textarea
          onChange={(event) => update("explanation", event.target.value)}
          required minLength={5} disabled={saving}
          value={draft.explanation}
        />
      </label>
      {(creating || draft.is_manual) && (
        <div className="field-row">
          {[["source_title", "Manual / fuente"], ["topic", "Tema"], ["chapter", "Capítulo"]].map(([field, label]) => (
            <label key={field}>{label}
              <input required disabled={saving} value={draft[field]} onChange={(event) => update(field, event.target.value)} />
            </label>
          ))}
        </div>
      )}
      <label>
        Referencia concreta del apartado
        <input
          onChange={(event) => update("reference", event.target.value)}
          required minLength={3} disabled={saving}
          value={draft.reference}
        />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-actions">
        <button className="secondary-button compact" onClick={onCancel} disabled={saving} type="button">
          Cancelar
        </button>
        <button className="primary-button compact" disabled={saving} type="submit">
          <Save size={17} />
          {saving ? "Guardando…" : creating ? "Añadir pregunta" : "Guardar"}
        </button>
      </div>
    </form>
  );
}
