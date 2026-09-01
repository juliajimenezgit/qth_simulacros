import { Download, Save, Search, Trash2 } from "lucide-react";
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
  ELITE: "F",
  ALEATORIO: "D",
};

export default function QuestionReview({
  initialDocumentId = "",
  refreshKey = 0,
  showHeader = true,
}) {
  const [documents, setDocuments] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyEdit);
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [error, setError] = useState("");

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === documentId),
    [documents, documentId],
  );

  useEffect(() => {
    setDocumentId(initialDocumentId);
  }, [initialDocumentId]);

  async function load() {
    setError("");
    try {
      const [docData, questionData] = await Promise.all([
        api.documents(),
        api.questions(documentId),
      ]);
      setDocuments(docData.documents);
      setQuestions(questionData.questions);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [documentId, refreshKey]);

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
    const url = api.exportUrl(documentId, exportFormat);
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
        anchor.download = `${
          selectedDocument?.original_filename || "simulacro-preguntas"
        }.${exportFormat}`;
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
              disabled={questions.length === 0}
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
            disabled={questions.length === 0}
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
          <div className="empty-state">No hay preguntas generadas.</div>
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
                    <span>{difficultyLabels[item.difficulty] || item.difficulty}</span>
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
                  <p>{item.explanation}</p>
                  <footer>
                    <span>{item.reference}</span>
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
            <option value="PRINCIPIANTE">P — Principiante + Fácil</option>
            <option value="ELITE">F — Fácil + Difícil</option>
            <option value="ALEATORIO">D — Mezcla de todos</option>
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
      <label>
        Referencia
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
