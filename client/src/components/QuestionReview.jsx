import { BookOpen, Download, FileText, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, getToken } from "../services/api.js";

const emptyEdit = {
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

const difficultyLabels = {
  PRINCIPIANTE: "P",
  FACIL: "F",
  DIFICIL: "D",
};

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

  function startEdit(question) {
    setEditingId(question.id);
    setDraft({
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
    try {
      await api.updateQuestion(editingId, draft);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err.message);
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
            disabled={Boolean(initialTestId)}
            onChange={(event) => {
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
                  onSave={saveEdit}
                />
              ) : (
                <>
                  <div className="question-card-header">
                    <div>
                      <span>{difficultyLabels[item.difficulty] || item.difficulty}</span>
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
                    <p>{item.explanation}</p>
                  </div>
                  <aside className="question-source">
                    <div className="source-heading">
                      <BookOpen size={18} />
                      <div>
                        <small>Manual de origen</small>
                        <strong>{item.source_title || item.original_filename}</strong>
                      </div>
                    </div>
                    <div className="source-details">
                      <span><small>Tema</small><strong>{item.topic || "No identificado"}</strong></span>
                      <span><small>Capítulo</small><strong>{item.chapter || "No identificado"}</strong></span>
                    </div>
                    <div className="source-reference">
                      <FileText size={16} />
                      <span><small>Referencia concreta</small><strong>{item.reference}</strong></span>
                    </div>
                  </aside>
                  <footer>
                    <div>
                      <button
                        className="secondary-button compact"
                        onClick={() => startEdit(item)}
                        type="button"
                      >
                        Editar
                      </button>
                      <button
                        className="danger-button compact"
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

function QuestionEditor({ draft, onCancel, onChange, onSave }) {
  const update = (field, value) => onChange({ ...draft, [field]: value });

  return (
    <div className="question-editor">
      <label>
        Enunciado
        <textarea
          onChange={(event) => update("question", event.target.value)}
          value={draft.question}
        />
      </label>
      {["option_a", "option_b", "option_c", "option_d"].map((field, index) => (
        <label key={field}>
          Respuesta {String.fromCharCode(65 + index)}
          <input
            onChange={(event) => update(field, event.target.value)}
            value={draft[field]}
          />
        </label>
      ))}
      <div className="field-row">
        <label>
          Correcta
          <select
            onChange={(event) => update("correct_answer", event.target.value)}
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
            value={draft.difficulty}
          >
            <option value="PRINCIPIANTE">P — Principiante</option>
            <option value="FACIL">F — Fácil</option>
            <option value="DIFICIL">D — Difícil</option>
          </select>
        </label>
      </div>
      <label>
        Explicación
        <textarea
          onChange={(event) => update("explanation", event.target.value)}
          value={draft.explanation}
        />
      </label>
      <div className="field-row">
        <label>
          Manual de origen
          <input
            onChange={(event) => update("source_title", event.target.value)}
            value={draft.source_title}
          />
        </label>
        <label>
          Tema
          <input
            onChange={(event) => update("topic", event.target.value)}
            value={draft.topic}
          />
        </label>
      </div>
      <label>
        Capítulo
        <input
          onChange={(event) => update("chapter", event.target.value)}
          value={draft.chapter}
        />
      </label>
      <label>
        Referencia concreta del apartado
        <input
          onChange={(event) => update("reference", event.target.value)}
          value={draft.reference}
        />
      </label>
      <div className="editor-actions">
        <button className="secondary-button compact" onClick={onCancel} type="button">
          Cancelar
        </button>
        <button className="primary-button compact" onClick={onSave} type="button">
          <Save size={17} />
          Guardar
        </button>
      </div>
    </div>
  );
}
