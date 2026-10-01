import { ChevronDown, ChevronRight, Info, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TEST_DIFFICULTIES } from "../utils/testDifficulty.js";
import { availableTypes, QUESTION_TYPE_DESCRIPTIONS, QUESTION_TYPE_LABELS, typeSelectionWarning } from "../utils/questionTypes.js";
import QuestionReview from "../components/QuestionReview.jsx";
import { api } from "../services/api.js";
import { selectedAncestor, toggleSource } from "../utils/documentSelection.js";
import { suggestTestName } from "../utils/testName.js";
import { useGeneration } from "../context/GenerationContext.jsx";

// What a teacher can expect from each level (QTH guide and the teachers' own questions).
const LEVEL_DESCRIPTIONS = {
  PRINCIPIANTE: "Preguntas básicas: estructura del tema, enunciados directos y opciones fáciles de descartar si conoces el dato.",
  ELITE: "Preguntas fáciles y difíciles: opciones que se parecen, cifras cercanas, detalles, supuestos prácticos y cálculos.",
  ALEATORIO: "Mezcla de todas: preguntas de principiante, fáciles y difíciles en el mismo test.",
};

export default function Generator() {
  const [searchParams] = useSearchParams();
  const requestedDocument = searchParams.get("documento");
  const [step, setStep] = useState(1);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [documents, setDocuments] = useState([]);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState([]);
  const [questionTotal, setQuestionTotal] = useState(10);
  const [documentCounts, setDocumentCounts] = useState({});
  // Questions per level as the app shows them; the server splits each level into P, F and D.
  const [levelCounts, setLevelCounts] = useState({ PRINCIPIANTE: 10, ELITE: 0, ALEATORIO: 0 });
  // All types selected: the teachers' mix of question types.
  const [questionTypes, setQuestionTypes] = useState(Object.keys(QUESTION_TYPE_LABELS));
  // Types the selected levels cannot have (calculations with only Principiante) are disabled and not sent.
  const enabledTypes = availableTypes(levelCounts);
  const selectedTypes = questionTypes.filter((type) => enabledTypes.includes(type));
  const typeWarning = typeSelectionWarning(selectedTypes, levelCounts);
  // The definitions of the types, behind the info icon next to the step title.
  const [typeInfoOpen, setTypeInfoOpen] = useState(false);
  const typeInfoRef = useRef(null);
  useEffect(() => {
    if (!typeInfoOpen) return undefined;
    const close = (event) => {
      if (event.type === "keydown" ? event.key === "Escape" : !typeInfoRef.current?.contains(event.target)) setTypeInfoOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [typeInfoOpen]);
  // The generation itself lives in GenerationContext so it survives leaving this page.
  const { generation, start, markSeen } = useGeneration();
  const loading = generation.status === "running";
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  // Coming back while it generates: the progress is what matters, not the form.
  const [generatorOpen, setGeneratorOpen] = useState(() => generation.status !== "running");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRefreshKey, setReviewRefreshKey] = useState(0);
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [testName, setTestName] = useState("");
  const [suggestedName, setSuggestedName] = useState("");
  const [currentTest, setCurrentTest] = useState(null);

  const availableDocuments = useMemo(
    () => documents.filter((document) => document.status === "AVAILABLE"),
    [documents],
  );
  const selectedDocuments = useMemo(
    () => availableDocuments.filter((document) => selectedDocumentIds.includes(document.id)),
    [availableDocuments, selectedDocumentIds],
  );
  // The questions come from exactly the PDFs the user selected (see toggleSource).
  const targetDocuments = selectedDocuments;
  const contentCounts = targetDocuments.reduce((counts, document) => {
    counts[document.content_type] += documentCounts[document.id] || 0;
    return counts;
  }, { MANUAL: 0, TEMA: 0, CAPITULO: 0 });
  const contentTotal = Object.values(contentCounts).reduce((sum, count) => sum + count, 0);
  const difficultyTotal = Object.values(levelCounts).reduce((sum, count) => sum + count, 0);
  const totalsMatch = questionTotal >= 1 && questionTotal <= 120 && contentTotal === questionTotal && difficultyTotal === questionTotal && !typeWarning;

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
      setSelectedDocumentIds(requested ? [requested.id] : []);
    }).catch((err) => setError(err.message)).finally(() => setSourcesLoading(false));
  }, [requestedDocument]);

  function updateCount(setter, key, value) {
    setter((current) => ({ ...current, [key]: Math.min(120, Math.max(0, Math.floor(Number(value) || 0))) }));
  }

  function toggleDocument(document) {
    setSelectedDocumentIds((current) => toggleSource(availableDocuments, current, document));
  }

  // Suggest «manual_hora» each time, unless the user typed a name of their own.
  function openNameDialog() {
    const suggestion = suggestTestName(targetDocuments);
    if (!testName.trim() || testName === suggestedName) setTestName(suggestion);
    setSuggestedName(suggestion);
    setShowNameDialog(true);
  }

  function generate() {
    setShowNameDialog(false);
    setError("");
    setMessage("");
    setCurrentTest(null);
    setGeneratorOpen(false);
    const name = testName.trim() || suggestedName;
    start({
      selectedDocumentIds: targetDocuments.map((document) => document.id),
      documentCounts: Object.fromEntries(targetDocuments.map((document) => [document.id, documentCounts[document.id] || 0])),
      contentCounts,
      levelCounts,
      questionTypes: selectedTypes,
      testName: name || undefined,
    }, { testName: name, requestedCount: questionTotal });
  }

  // Show the outcome when it arrives, also if it arrived while the user was in another section.
  useEffect(() => {
    if (generation.status === "done" && generation.test && currentTest?.id !== generation.test.id) {
      setCurrentTest(generation.test);
      setMessage(`¡Enhorabuena! Se han generado ${generation.saved} preguntas para “${generation.test.name}”. Ya puedes revisarlas.`);
      setReviewRefreshKey(Date.now());
      setGeneratorOpen(false);
      setReviewOpen(true);
      markSeen();
    } else if (generation.status === "error" && generation.seen === false) {
      setError(generation.error);
      markSeen();
    }
  }, [generation, currentTest, markSeen]);

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
                if (totalsMatch && !loading) openNameDialog();
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
                    ["MANUAL", "Manuales completos"],
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
                                checked={selectedDocumentIds.includes(document.id) || Boolean(selectedAncestor(availableDocuments, selectedDocumentIds, document))}
                                disabled={Boolean(selectedAncestor(availableDocuments, selectedDocumentIds, document))}
                                onChange={() => toggleDocument(document)}
                                type="checkbox"
                              />
                              <span>
                                {document.display_title || document.original_filename}
                                {selectedAncestor(availableDocuments, selectedDocumentIds, document) && (
                                  <small className="included-in"> · incluido en {selectedAncestor(availableDocuments, selectedDocumentIds, document).display_title || selectedAncestor(availableDocuments, selectedDocumentIds, document).original_filename}</small>
                                )}
                              </span>
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
                      // The new total goes to the levels in use, split evenly among them.
                      setLevelCounts((current) => {
                        const used = Object.keys(current).filter((name) => current[name] > 0);
                        return { PRINCIPIANTE: 0, ELITE: 0, ALEATORIO: 0, ...distribute(total, used.length ? used : ["PRINCIPIANTE"]) };
                      });
                    }} />
                    <small>Entre 1 y 120. Si cambias el total, los repartos se recalculan por igual.</small>
                  </label>
                </section>

                <section className="distribution-section">
                  <div className="distribution-heading"><div>
                    <h2>2. ¿Cómo quieres repartirlas?</h2>
                    <p>Indica cuántas preguntas quieres de cada contenido. Un 0 lo deja fuera del test.</p>
                  </div></div>
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
                    <p>Reparte las {questionTotal} preguntas entre los niveles. Puedes usar uno solo o combinarlos.</p>
                  </div></div>
                  <div className="level-choice">
                    {Object.entries(TEST_DIFFICULTIES).map(([value, preset]) => (
                      <label className={`level-option level-option-${value.toLowerCase()}`} key={value}>
                        <strong>{preset.label}</strong>
                        <small>{LEVEL_DESCRIPTIONS[value]}</small>
                        <span className="allocation-input">
                          <input aria-label={`Preguntas de nivel ${preset.label}`} type="number" min="0" max={questionTotal} value={levelCounts[value]} onChange={(event) => updateCount(setLevelCounts, value, event.target.value)} />
                          <small>preguntas</small>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className={`allocation-status ${difficultyTotal === questionTotal ? "complete" : ""}`} role="status">{difficultyTotal} de {questionTotal} preguntas con nivel asignado. {remainingText(difficultyTotal)}</p>
                </section>

                <section className="distribution-section">
                  <div className="distribution-heading"><div>
                    <div className="type-title" ref={typeInfoRef}>
                      <h2>4. Tipos de pregunta</h2>
                      <button aria-controls="type-definitions" aria-expanded={typeInfoOpen} aria-label="Qué mide cada tipo" className="info-button" onClick={() => setTypeInfoOpen((open) => !open)} type="button">
                        <Info size={18} />
                      </button>
                      {typeInfoOpen && (
                        <dl className="type-definitions" id="type-definitions">
                          {Object.entries(QUESTION_TYPE_LABELS).map(([type, label]) => (
                            <div key={type}><dt>{label}</dt><dd>{QUESTION_TYPE_DESCRIPTIONS[type]}</dd></div>
                          ))}
                        </dl>
                      )}
                    </div>
                    <p>Si los dejas todos marcados, el test mezcla los tipos en la misma proporción que las preguntas de los profesores de QTH. Desmarca los que no quieras incluir. Cálculo y Relación de conceptos solo están disponibles en Élite y en Aleatorio.</p>
                  </div></div>
                  <div className="type-checks" role="group" aria-label="Tipos de pregunta">
                    {Object.entries(QUESTION_TYPE_LABELS).map(([type, label]) => (
                      <label className={enabledTypes.includes(type) ? "" : "disabled"} key={type} title={enabledTypes.includes(type) ? undefined : "Solo con preguntas de Élite o Aleatorio"}>
                        <input
                          checked={selectedTypes.includes(type)}
                          disabled={!enabledTypes.includes(type)}
                          onChange={() => setQuestionTypes((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type]))}
                          type="checkbox"
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  {typeWarning && <p className="type-warning" role="alert">{typeWarning}</p>}
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
                        {Object.entries(TEST_DIFFICULTIES).filter(([value]) => levelCounts[value] > 0).map(([value, { label }]) => (
                          <div key={value}><dt>{label}</dt><dd>{levelCounts[value]} {levelCounts[value] === 1 ? "pregunta" : "preguntas"}</dd></div>
                        ))}
                      </dl>
                      <p className="summary-types">Tipos: {selectedTypes.length === enabledTypes.length
                        ? "todos, con el reparto de los profesores"
                        : Object.keys(QUESTION_TYPE_LABELS).filter((type) => selectedTypes.includes(type)).map((type) => QUESTION_TYPE_LABELS[type]).join(", ")}</p>
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

        {loading && (
          <div className="generation-progress" role="status">
            <span className="generation-spinner" aria-hidden="true" />
            <div>
              <strong>Generando «{generation.testName}»: {generation.saved || 0} de {generation.requestedCount} preguntas</strong>
              <span>Puedes seguir usando la aplicación; la generación continúa y te avisaremos al terminar.</span>
            </div>
          </div>
        )}

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
                placeholder="Ej. teoriafuego_1251"
                value={testName}
              />
              <small>Sugerencia: nombre del manual y hora. Si lo dejas vacío, se usará {suggestedName}.</small>
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
