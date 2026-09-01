import { ChevronDown, ChevronRight, ClipboardList, Flame, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QuestionReview from "../components/QuestionReview.jsx";
import { api } from "../services/api.js";

export default function Generator() {
  const [documents, setDocuments] = useState([]);
  const [documentId, setDocumentId] = useState("");
  const [reviewDocumentId, setReviewDocumentId] = useState("");
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState("PRINCIPIANTE");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [generatorOpen, setGeneratorOpen] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);

  const availableDocuments = useMemo(
    () => documents.filter((document) => document.status === "AVAILABLE"),
    [documents],
  );
  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === documentId),
    [documents, documentId],
  );

  useEffect(() => {
    api.documents().then((data) => {
      setDocuments(data.documents);
      const firstAvailable = data.documents.find((doc) => doc.status === "AVAILABLE");
      if (firstAvailable) setDocumentId(firstAvailable.id);
    });
  }, []);

  async function generate(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const data = await api.generateQuestions({
        documentId,
        count: Number(count),
        difficulty,
      });
      setMessage(`${data.questions.length} preguntas guardadas.`);
      setReviewDocumentId(documentId);
      setReviewRefreshKey(Date.now());
      setGeneratorOpen(false);
      setReviewOpen(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p>Generador</p>
          <h1>Crear simulacro</h1>
        </div>
      </header>

      <div className="flow-stack">
        <section className="flow-panel">
          <button
            className="flow-panel-toggle"
            onClick={() => setGeneratorOpen((open) => !open)}
            type="button"
          >
            <span>
              {generatorOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              Configurar generación
            </span>
            <strong>
              {message || selectedDocument?.original_filename || "Pendiente"}
            </strong>
          </button>

          {generatorOpen && (
            <form className="tool-panel embedded-panel" onSubmit={generate}>
              <label>
                Seleccionar temario
                <select
                  onChange={(event) => setDocumentId(event.target.value)}
                  required
                  value={documentId}
                >
                  <option value="">Selecciona un temario</option>
                  {availableDocuments.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.original_filename}
                    </option>
                  ))}
                </select>
              </label>

              <div className="field-row">
                <label>
                  Número de preguntas
                  <input
                    min="1"
                    max="120"
                    onChange={(event) => setCount(event.target.value)}
                    required
                    type="number"
                    value={count}
                  />
                </label>
                <button
                  className="secondary-button quick"
                  onClick={() => setCount(88)}
                  type="button"
                >
                  <ClipboardList size={18} />
                  Simulacro completo (88)
                </button>
              </div>

              <fieldset className="segmented">
                <legend>Nivel</legend>
                {[
                  ["PRINCIPIANTE", "Principiante"],
                  ["ELITE", "Élite"],
                  ["ALEATORIO", "Aleatorio"],
                ].map(([value, label]) => (
                  <button
                    className={difficulty === value ? "active" : ""}
                    key={value}
                    onClick={() => setDifficulty(value)}
                    type="button"
                  >
                    {value === "ELITE" && <Flame size={16} />}
                    {label}
                  </button>
                ))}
              </fieldset>

              {error && <p className="form-error">{error}</p>}
              {message && <p className="form-success">{message}</p>}

              <button
                className="primary-button large-button"
                disabled={loading}
                type="submit"
              >
                <Play size={20} />
                {loading ? "Generando..." : "Generar preguntas"}
              </button>
            </form>
          )}
        </section>

        <section className="flow-panel">
          <button
            className="flow-panel-toggle"
            onClick={() => setReviewOpen((open) => !open)}
            type="button"
          >
            <span>
              {reviewOpen ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              Revisar preguntas
            </span>
            <strong>
              {reviewDocumentId ? "Listo para revisar" : "Banco completo disponible"}
            </strong>
          </button>

          {reviewOpen && (
            <div className="review-panel">
              <QuestionReview
                initialDocumentId={reviewDocumentId}
                refreshKey={reviewRefreshKey}
                showHeader={false}
              />
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
