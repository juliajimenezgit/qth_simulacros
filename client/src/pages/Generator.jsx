import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QuestionReview from "../components/QuestionReview.jsx";
import { api } from "../services/api.js";
import { toggleDocumentSelection } from "../utils/documentSelection.js";

export default function Generator() {
  const [searchParams] = useSearchParams();
  const requestedDocument = searchParams.get("documento");
  const [step, setStep] = useState(1);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [questionTotal, setQuestionTotal] = useState(10);
  const [contentMode, setContentMode] = useState("complete");
  const [documentCounts, setDocumentCounts] = useState({});
  const [difficultyCounts, setDifficultyCounts] = useState({ P: 4, F: 3, D: 3 });
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
  const selectedDocuments = useMemo(
    () => availableDocuments.filter((document) => selectedDocumentIds.includes(document.id)),
    [availableDocuments, selectedDocumentIds],
  );
  const hasComplete = selectedDocuments.some((document) => document.content_type !== "CAPITULO");
  const hasChapters = selectedDocuments.some((document) => document.content_type === "CAPITULO");
  const effectiveMode = !hasComplete ? "chapters" : !hasChapters ? "complete" : contentMode;
  const targetDocuments = useMemo(() => selectedDocuments.filter((document) =>
    effectiveMode === "mixed" || (effectiveMode === "chapters" ? document.content_type === "CAPITULO" : document.content_type !== "CAPITULO"),
  ), [selectedDocuments, effectiveMode]);
  const contentCounts = targetDocuments.reduce((counts, document) => {
    counts[document.content_type] += documentCounts[document.id] || 0;
    return counts;
  }, { MANUAL: 0, TEMA: 0, CAPITULO: 0 });
  const contentTotal = Object.values(contentCounts).reduce((sum, count) => sum + count, 0);
  const difficultyTotal = Object.values(difficultyCounts).reduce((sum, count) => sum + count, 0);
  const totalsMatch = questionTotal >= 1 && questionTotal <= 120 && contentTotal === questionTotal && difficultyTotal === questionTotal;

  function distribute(total, keys) {
    return Object.fromEntries(keys.map((key, index) => [key, Math.floor(total / keys.length) + (index < total % keys.length ? 1 : 0)]));
  }

  useEffect(() => {
    setDocumentCounts(distribute(questionTotal, targetDocuments.map((document) => document.id)));
  }, [questionTotal, targetDocuments]);

  function remainingText(count) {
    const remaining = questionTotal - count;
    return remaining === 0 ? "Todas las preguntas están asignadas." : remaining > 0 ? `Faltan ${remaining} preguntas por asignar.` : `Sobran ${-remaining} preguntas. Reduce el reparto.`;
  }

  useEffect(() => {
    api.documents().then((data) => {
      setDocuments(data.documents);
      const requested = data.documents.find((document) => document.status === "AVAILABLE" && document.id === requestedDocument);
      setSelectedDocumentIds(requested ? toggleDocumentSelection(data.documents, [], requested) : []);
    }).catch((err) => setError(err.message)).finally(() => setSourcesLoading(false));
  }, [requestedDocument]);

  function updateCount(setter, key, value) {
    setter((current) => ({ ...current, [key]: Math.min(120, Math.max(0, Math.floor(Number(value) || 0))) }));
  }

  function toggleDocument(document) {
    setSelectedDocumentIds((current) => toggleDocumentSelection(availableDocuments, current, document));
  }

  function applyDifficultyPreset(levels) {
    const nextCounts = { P: 0, F: 0, D: 0 };
    levels.forEach((level, index) => {
      nextCounts[level] =
        Math.floor(questionTotal / levels.length) +
        (index < questionTotal % levels.length ? 1 : 0);
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
        selectedDocumentIds: targetDocuments.map((document) => document.id),
        documentCounts: Object.fromEntries(targetDocuments.map((document) => [document.id, documentCounts[document.id] || 0])),
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
    <section className="page generator-page">
      <header className="page-header">
        <div>
          <p>Espacio del profesor</p>
          <h1>Generar preguntas</h1>
          <span className="page-description">Elige tus temarios, configura las preguntas y revisa el resultado.</span>
        </div>
      </header>

      <nav className="creation-steps" aria-label="Pasos de generación">
        <button type="button" aria-current={generatorOpen && step === 1 ? "step" : undefined} onClick={() => { setStep(1); setGeneratorOpen(true); }} disabled={loading}><span>1</span> Elegir temarios</button>
        <button type="button" aria-current={generatorOpen && step === 2 ? "step" : undefined} onClick={() => { setStep(2); setGeneratorOpen(true); }} disabled={loading || selectedDocumentIds.length === 0}><span>2</span> Configurar preguntas</button>
        <span aria-current={!generatorOpen && currentTest ? "step" : undefined}><span>3</span> Revisar y exportar</span>
      </nav>
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
                if (step === 1) {
                  if (selectedDocumentIds.length > 0) setStep(2);
                  return;
                }
                if (totalsMatch && !loading) setShowNameDialog(true);
              }}
            >
              <section className="distribution-section" hidden={step !== 1}>
                <div className="distribution-heading">
                  <div>
                    <h2>¿Sobre qué quieres preguntar?</h2>
                    <p>Al seleccionar un manual se incluyen sus temas y capítulos disponibles. Al seleccionar un tema se incluyen sus capítulos.</p>
                  </div>
                  <strong>{selectedDocumentIds.length}</strong>
                </div>
                <label className="source-search">Buscar temario
                  <input type="search" value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="Escribe el nombre…" />
                </label>
                {sourcesLoading && <p role="status">Cargando tu biblioteca…</p>}
                {!sourcesLoading && availableDocuments.length === 0 && <p className="empty-state">Todavía no hay temarios listos para usar. <Link to="/temarios">Ir a la biblioteca</Link></p>}
                <div className="document-selection-groups">
                  {[
                    ["MANUAL", "Manuales"],
                    ["TEMA", "Temas"],
                    ["CAPITULO", "Capítulos"],
                  ].map(([type, label]) => {
                    const typeDocuments = availableDocuments.filter(
                      (document) => document.content_type === type && `${document.original_filename} ${document.display_title || ""}`.toLocaleLowerCase("es").includes(sourceSearch.toLocaleLowerCase("es")),
                    );
                    return (
                      <fieldset disabled={typeDocuments.length === 0} key={type}>
                        <legend>{label}</legend>
                        {typeDocuments.length === 0 ? (
                          <p>{sourceSearch ? "Sin coincidencias." : "Sin temarios de este tipo."}</p>
                        ) : (
                          typeDocuments.map((document) => (
                            <label key={document.id}>
                              <input
                                checked={selectedDocumentIds.includes(document.id)}
                                onChange={() => toggleDocument(document)}
                                type="checkbox"
                              />
                              <span>{document.display_title || document.original_filename}</span>
                            </label>
                          ))
                        )}
                      </fieldset>
                    );
                  })}
                </div>
                <div className="source-footer">
                  <button className="primary-button" type="button" disabled={selectedDocumentIds.length === 0} onClick={() => setStep(2)}>Continuar <ChevronRight size={18} /></button>
                </div>
              </section>

              <div className="generation-configuration" hidden={step !== 2}>
                <section className="distribution-section">
                  <div className="distribution-heading"><div>
                    <h2>1. ¿Cuántas preguntas quieres generar?</h2>
                    <p>Elige el total del test. Después podrás repartirlo a tu gusto.</p>
                  </div></div>
                  <label className="question-total-input">Número de preguntas
                    <input type="number" min="1" max="120" value={questionTotal} onChange={(event) => {
                      const total = Math.min(120, Math.max(0, Math.floor(Number(event.target.value) || 0)));
                      setQuestionTotal(total);
                      setDifficultyCounts(distribute(total, ["P", "F", "D"]));
                    }} />
                    <small>Entre 1 y 120. Si cambias el total, los repartos se recalculan por igual.</small>
                  </label>
                </section>

                <section className="distribution-section">
                  <div className="distribution-heading"><div>
                    <h2>2. ¿Cómo quieres repartirlas?</h2>
                    <p>Indica cuántas preguntas quieres de cada contenido. Un 0 lo deja fuera del test.</p>
                  </div></div>
                  <div className="content-mode-options" role="radiogroup" aria-label="Contenido de las preguntas">
                    {hasComplete && <label className={effectiveMode === "complete" ? "selected" : ""}>
                      <input type="radio" name="content-mode" checked={effectiveMode === "complete"} onChange={() => setContentMode("complete")} />
                      <span><strong>Manual o tema completo</strong><small>Preguntas sobre el conjunto de cada manual o tema seleccionado.</small></span>
                    </label>}
                    {hasChapters && <label className={effectiveMode === "chapters" ? "selected" : ""}>
                      <input type="radio" name="content-mode" checked={effectiveMode === "chapters"} onChange={() => setContentMode("chapters")} />
                      <span><strong>Por capítulos</strong><small>Elige cuántas preguntas dedicar a cada capítulo seleccionado.</small></span>
                    </label>}
                    {hasComplete && hasChapters && <label className={effectiveMode === "mixed" ? "selected" : ""}>
                      <input type="radio" name="content-mode" checked={effectiveMode === "mixed"} onChange={() => setContentMode("mixed")} />
                      <span><strong>Combinar ambos</strong><small>Reparte entre contenidos completos y capítulos concretos.</small></span>
                    </label>}
                  </div>
                  {!hasChapters && <p className="allocation-help">Para repartir por capítulos, selecciónalos en el paso anterior.</p>}
                  <div className="allocation-toolbar">
                    <strong>{contentTotal} de {questionTotal} preguntas asignadas</strong>
                    <button type="button" className="secondary-button" onClick={() => setDocumentCounts(distribute(questionTotal, targetDocuments.map((document) => document.id)))}>Repartir por igual</button>
                  </div>
                  <div className="document-allocations">
                    {targetDocuments.map((document) => <label className="document-allocation" key={document.id}>
                      <span><small>{{ MANUAL: "Manual completo", TEMA: "Tema completo", CAPITULO: "Capítulo" }[document.content_type]}</small><strong>{document.display_title || document.original_filename}</strong></span>
                      <span className="allocation-input"><input aria-label={`Preguntas de ${document.display_title || document.original_filename}`} type="number" min="0" max={questionTotal} value={documentCounts[document.id] || 0} onChange={(event) => updateCount(setDocumentCounts, document.id, event.target.value)} /><small>preguntas</small></span>
                    </label>)}
                  </div>
                  <p className={`allocation-status ${contentTotal === questionTotal ? "complete" : ""}`} role="status">{remainingText(contentTotal)}</p>
                  <button type="button" className="secondary-button" onClick={() => setStep(1)}>Cambiar contenidos seleccionados</button>
                </section>

                <section className="distribution-section">
                  <div className="distribution-heading"><div>
                    <h2>3. Elige la dificultad</h2>
                    <p>Reparte las {questionTotal} preguntas entre estos niveles. Puedes combinar varios o usar solo uno.</p>
                  </div></div>
                  <div className="count-grid difficulty-counts">
                    {[["P", "Principiante"], ["F", "Fácil"], ["D", "Difícil"]].map(([key, label]) => <label key={key}>
                      <span>{label}</span>
                      <input type="number" min="0" max={questionTotal} value={difficultyCounts[key]} onChange={(event) => updateCount(setDifficultyCounts, key, event.target.value)} />
                      <small>preguntas</small>
                    </label>)}
                  </div>
                  <div className="difficulty-presets"><span>Repartir automáticamente</span><div>
                    <button type="button" onClick={() => applyDifficultyPreset(["P", "F"])}>Conseguir Principiante<small>P + F</small></button>
                    <button type="button" onClick={() => applyDifficultyPreset(["F", "D"])}>Conseguir Fácil<small>F + D</small></button>
                    <button type="button" onClick={() => applyDifficultyPreset(["P", "F", "D"])}>Conseguir Difícil<small>P + F + D</small></button>
                  </div></div>
                  <p className={`allocation-status ${difficultyTotal === questionTotal ? "complete" : ""}`} role="status">{difficultyTotal} de {questionTotal} preguntas con dificultad asignada. {remainingText(difficultyTotal)}</p>
                </section>

                <div className="generation-summary" aria-live="polite">
                  <h2>Resumen de las preguntas</h2>
                  <p className="summary-total">Cantidad total: <strong>{questionTotal} {questionTotal === 1 ? "pregunta" : "preguntas"}</strong></p>
                  <div className="summary-columns">
                    <div>
                      <h3>Sobre qué vas a preguntar</h3>
                      <p className="summary-content-count">{[["MANUAL", "manual", "manuales"], ["TEMA", "tema", "temas"], ["CAPITULO", "capítulo", "capítulos"]].map(([type, singular, plural]) => {
                        const count = targetDocuments.filter((document) => document.content_type === type && documentCounts[document.id] > 0).length;
                        return count ? `${count} ${count === 1 ? singular : plural}` : null;
                      }).filter(Boolean).join(" · ")}</p>
                      {contentTotal > 0 && <details className="summary-content-details">
                      <summary>Ver contenidos y cantidades</summary>
                      <dl className="summary-breakdown summary-content-list">
                        {targetDocuments.filter((document) => documentCounts[document.id] > 0).map((document) => (
                          <div key={document.id}>
                            <dt><small>{{ MANUAL: "Manual completo", TEMA: "Tema completo", CAPITULO: "Capítulo" }[document.content_type]}</small>{document.display_title || document.original_filename}</dt>
                            <dd>{documentCounts[document.id]} {documentCounts[document.id] === 1 ? "pregunta" : "preguntas"}</dd>
                          </div>
                        ))}
                      </dl>
                      </details>}
                      {contentTotal === 0 && <p>Aún no has asignado preguntas al contenido.</p>}
                    </div>
                    <div>
                      <h3>Cómo será la dificultad</h3>
                      <dl className="summary-breakdown">
                        {[["P", "Principiante"], ["F", "Fácil"], ["D", "Difícil"]].map(([key, label]) => (
                          <div key={key}><dt>{label}</dt><dd>{difficultyCounts[key]} {difficultyCounts[key] === 1 ? "pregunta" : "preguntas"}</dd></div>
                        ))}
                      </dl>
                    </div>
                  </div>
                  {!totalsMatch && <p className="summary-pending">Revisa el reparto antes de generar: {contentTotal !== questionTotal && `Contenido: ${remainingText(contentTotal)} `}{difficultyTotal !== questionTotal && `Dificultad: ${remainingText(difficultyTotal)} `}{questionTotal < 1 && "Elige al menos 1 pregunta."}</p>}
                </div>

              <button
                className="primary-button large-button"
                disabled={loading || !totalsMatch}
                type="submit"
              >
                <Play size={20} />
                {loading ? "Generando..." : "Generar preguntas"}
              </button>
              </div>
              {error && <p className="form-error" role="alert">{error}</p>}
            </form>
          )}
        </section>

        {message && (
          <div className="generation-success">
            <strong>{message}</strong>
          </div>
        )}

        {currentTest && <section className="flow-panel">
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
        </section>}
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
