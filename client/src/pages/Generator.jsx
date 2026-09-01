import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QuestionReview from "../components/QuestionReview.jsx";
import { api } from "../services/api.js";

export default function Generator() {
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [contentCounts, setContentCounts] = useState({
    MANUAL: 0,
    TEMA: 0,
    CAPITULO: 0,
  });
  const [difficultyCounts, setDifficultyCounts] = useState({ P: 0, F: 0, D: 0 });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [generatorOpen, setGeneratorOpen] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [testName, setTestName] = useState("");
  const [currentTest, setCurrentTest] = useState(null);

  const availableDocuments = useMemo(
    () => documents.filter((document) => document.status === "AVAILABLE"),
    [documents],
  );
  const documentTotals = useMemo(
    () => Object.fromEntries(
      ["MANUAL", "TEMA", "CAPITULO"].map((type) => [
        type,
        availableDocuments.filter((document) => document.content_type === type).length,
      ]),
    ),
    [availableDocuments],
  );
  const selectedDocuments = useMemo(
    () => availableDocuments.filter((document) => selectedDocumentIds.includes(document.id)),
    [availableDocuments, selectedDocumentIds],
  );
  const selectedTotals = useMemo(
    () => Object.fromEntries(
      ["MANUAL", "TEMA", "CAPITULO"].map((type) => [
        type,
        selectedDocuments.filter((document) => document.content_type === type).length,
      ]),
    ),
    [selectedDocuments],
  );
  const contentTotal = Object.values(contentCounts).reduce(
    (sum, value) => sum + Number(value),
    0,
  );
  const difficultyTotal = Object.values(difficultyCounts).reduce(
    (sum, value) => sum + Number(value),
    0,
  );
  const totalsMatch =
    contentTotal > 0 && contentTotal === difficultyTotal && contentTotal <= 120;

  useEffect(() => {
    api.documents().then((data) => {
      setDocuments(data.documents);
      setSelectedDocumentIds(
        data.documents
          .filter((document) => document.status === "AVAILABLE")
          .map((document) => document.id),
      );
    });
  }, []);

  function updateCount(setter, key, value) {
    setter((current) => ({ ...current, [key]: Math.max(0, Number(value) || 0) }));
  }

  function toggleDocument(document) {
    setSelectedDocumentIds((current) => {
      const isSelected = current.includes(document.id);
      const next = isSelected
        ? current.filter((id) => id !== document.id)
        : [...current, document.id];

      if (isSelected) {
        const hasAnotherOfType = availableDocuments.some(
          (item) =>
            item.id !== document.id &&
            item.content_type === document.content_type &&
            next.includes(item.id),
        );
        if (!hasAnotherOfType) {
          setContentCounts((counts) => ({ ...counts, [document.content_type]: 0 }));
        }
      }
      return next;
    });
  }

  function configureFullExam() {
    const activeTypes = ["MANUAL", "TEMA", "CAPITULO"].filter(
      (type) => selectedTotals[type] > 0,
    );
    const nextContentCounts = { MANUAL: 0, TEMA: 0, CAPITULO: 0 };
    activeTypes.forEach((type, index) => {
      nextContentCounts[type] =
        Math.floor(88 / activeTypes.length) + (index < 88 % activeTypes.length ? 1 : 0);
    });
    setContentCounts(nextContentCounts);
    setDifficultyCounts({ P: 30, F: 29, D: 29 });
  }

  function applyDifficultyPreset(levels) {
    const nextCounts = { P: 0, F: 0, D: 0 };
    levels.forEach((level, index) => {
      nextCounts[level] =
        Math.floor(contentTotal / levels.length) +
        (index < contentTotal % levels.length ? 1 : 0);
    });
    setDifficultyCounts(nextCounts);
  }

  async function generate() {
    setShowNameDialog(false);
    setLoading(true);
    setError("");
    setMessage("");

    try {
      const data = await api.generateQuestions({
        selectedDocumentIds,
        contentCounts,
        difficultyCounts,
        testName: testName.trim() || undefined,
      });
      setCurrentTest(data.test);
      setMessage(
        `¡Enhorabuena! Se han generado ${data.questions.length} preguntas para “${data.test.name}”. Ya puedes revisarlas.`,
      );
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
              {message || (contentTotal ? `${contentTotal} preguntas configuradas` : "Pendiente")}
            </strong>
          </button>

          {generatorOpen && (
            <form
              className="tool-panel embedded-panel"
              onSubmit={(event) => {
                event.preventDefault();
                setShowNameDialog(true);
              }}
            >
              <section className="distribution-section">
                <div className="distribution-heading">
                  <div>
                    <h2>PDFs que se utilizarán</h2>
                    <p>Selecciona las fuentes concretas para generar las preguntas.</p>
                  </div>
                  <strong>{selectedDocumentIds.length}</strong>
                </div>
                <div className="document-selection-groups">
                  {[
                    ["MANUAL", "Manuales"],
                    ["TEMA", "Temas"],
                    ["CAPITULO", "Capítulos"],
                  ].map(([type, label]) => {
                    const typeDocuments = availableDocuments.filter(
                      (document) => document.content_type === type,
                    );
                    return (
                      <fieldset disabled={typeDocuments.length === 0} key={type}>
                        <legend>{label}</legend>
                        {typeDocuments.length === 0 ? (
                          <p>No hay PDFs disponibles.</p>
                        ) : (
                          typeDocuments.map((document) => (
                            <label key={document.id}>
                              <input
                                checked={selectedDocumentIds.includes(document.id)}
                                onChange={() => toggleDocument(document)}
                                type="checkbox"
                              />
                              <span>{document.original_filename}</span>
                            </label>
                          ))
                        )}
                      </fieldset>
                    );
                  })}
                </div>
              </section>

              <section className="distribution-section">
                <div className="distribution-heading">
                  <div>
                    <h2>Preguntas por contenido</h2>
                    <p>Se repartirán entre todos los PDFs disponibles de cada tipo.</p>
                  </div>
                  <strong>{contentTotal}</strong>
                </div>
                <div className="count-grid">
                  {[
                    ["MANUAL", "Manual", "manuales"],
                    ["TEMA", "Tema", "temas"],
                    ["CAPITULO", "Capítulo", "capítulos"],
                  ].map(([key, label, availableLabel]) => (
                    <label key={key}>
                      {label}
                      <input
                        disabled={selectedTotals[key] === 0}
                        max="120"
                        min="0"
                        onChange={(event) =>
                          updateCount(setContentCounts, key, event.target.value)
                        }
                        type="number"
                        value={contentCounts[key]}
                      />
                      <small>
                        {selectedTotals[key]} de {documentTotals[key]} {availableLabel}{" "}
                        seleccionados
                      </small>
                    </label>
                  ))}
                </div>
              </section>

              <section className="distribution-section">
                <div className="distribution-heading">
                  <div>
                    <h2>Preguntas por dificultad</h2>
                    <p>Indica cuántas preguntas quieres de cada nivel.</p>
                  </div>
                  <strong>{difficultyTotal}</strong>
                </div>
                <div className="count-grid difficulty-counts">
                  {[
                    ["P", "P", "Principiante"],
                    ["F", "F", "Fácil"],
                    ["D", "D", "Difícil"],
                  ].map(([key, label, detail]) => (
                    <label key={key}>
                      <span className={`difficulty-letter difficulty-${key}`}>{label}</span>
                      <input
                        max="120"
                        min="0"
                        onChange={(event) =>
                          updateCount(setDifficultyCounts, key, event.target.value)
                        }
                        type="number"
                        value={difficultyCounts[key]}
                      />
                      <small>{detail}</small>
                    </label>
                  ))}
                </div>
                <div className="difficulty-presets">
                  <span>Repartos predefinidos</span>
                  <div>
                    <button
                      disabled={contentTotal === 0}
                      onClick={() => applyDifficultyPreset(["P", "F"])}
                      type="button"
                    >
                      Conseguir P
                      <small>P + F</small>
                    </button>
                    <button
                      disabled={contentTotal === 0}
                      onClick={() => applyDifficultyPreset(["F", "D"])}
                      type="button"
                    >
                      Conseguir F
                      <small>F + D</small>
                    </button>
                    <button
                      disabled={contentTotal === 0}
                      onClick={() => applyDifficultyPreset(["P", "F", "D"])}
                      type="button"
                    >
                      Conseguir D
                      <small>P + F + D</small>
                    </button>
                  </div>
                </div>
              </section>

              <div className={`totals-check ${totalsMatch ? "valid" : "invalid"}`}>
                <span>Total por contenido: <strong>{contentTotal}</strong></span>
                <span>Total por dificultad: <strong>{difficultyTotal}</strong></span>
                <small>
                  {totalsMatch
                    ? "El reparto es correcto."
                    : "Ambos totales deben coincidir y estar entre 1 y 120."}
                </small>
              </div>

              <button
                className="secondary-button"
                disabled={selectedDocumentIds.length === 0}
                onClick={configureFullExam}
                type="button"
              >
                Configurar simulacro completo (88)
              </button>

              {error && <p className="form-error">{error}</p>}
              <button
                className="primary-button large-button"
                disabled={loading || !totalsMatch}
                type="submit"
              >
                <Play size={20} />
                {loading ? "Generando..." : "Generar preguntas"}
              </button>
            </form>
          )}
        </section>

        {message && (
          <div className="generation-success">
            <strong>{message}</strong>
          </div>
        )}

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
              {currentTest ? currentTest.name : "Genera un test para revisarlo"}
            </strong>
          </button>

          {reviewOpen && currentTest && (
            <div className="review-panel">
              <QuestionReview
                initialDocumentId=""
                initialTestId={currentTest.id}
                refreshKey={reviewRefreshKey}
                showHeader={false}
              />
            </div>
          )}
        </section>
      </div>

      {showNameDialog && (
        <div
          aria-labelledby="test-name-dialog-title"
          aria-modal="true"
          className="modal-backdrop"
          onClick={() => setShowNameDialog(false)}
          role="dialog"
        >
          <div className="upload-dialog test-name-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-heading">
              <span className="dialog-icon"><Play size={22} /></span>
              <div>
                <h2 id="test-name-dialog-title">Ponle un nombre al test</h2>
                <p>Así podrás localizar sus preguntas fácilmente más adelante.</p>
              </div>
            </div>
            <label>
              Nombre del test (opcional)
              <input
                autoFocus
                maxLength="120"
                onChange={(event) => setTestName(event.target.value)}
                placeholder="Ej. Simulacro hidráulica — septiembre"
                value={testName}
              />
              <small>Si lo dejas vacío, se asignará automáticamente la fecha y la hora.</small>
            </label>
            <div className="dialog-actions">
              <button
                className="secondary-button"
                onClick={() => setShowNameDialog(false)}
                type="button"
              >
                Cancelar
              </button>
              <button className="primary-button" onClick={generate} type="button">
                <Play size={18} />
                Generar preguntas
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
