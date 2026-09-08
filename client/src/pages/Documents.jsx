import { BookOpen, FileText, FileUp, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import StatusBadge from "../components/StatusBadge.jsx";
import { api } from "../services/api.js";

const contentTypeLabels = {
  MANUAL: "Manual completo",
  TEMA: "Tema",
  CAPITULO: "Capítulo",
};

const emptyFilters = { name: "", type: "", from: "", to: "", status: "", professor: "" };
const normalizeSearch = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function Documents() {
  const [documents, setDocuments] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState(emptyFilters);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 });
  const [uploadResult, setUploadResult] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const selectedContentTypeRef = useRef("");

  const stats = useMemo(
    () => [
      { type: "TEMA", label: "Temas subidos", icon: FileText },
      { type: "CAPITULO", label: "Capítulos subidos", icon: FileUp },
      { type: "MANUAL", label: "Manuales completos subidos", icon: BookOpen },
    ].map((category) => {
      const matching = documents.filter((doc) => doc.content_type === category.type);
      return {
        ...category,
        total: matching.length,
      };
    }),
    [documents],
  );
  const filteredDocuments = useMemo(() => documents.filter((doc) => {
    const date = new Date(doc.created_at);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return normalizeSearch(`${doc.original_filename} ${doc.display_title || ""}`).includes(normalizeSearch(filters.name.trim()))
      && (!filters.type || doc.content_type === filters.type)
      && (!filters.from || day >= filters.from)
      && (!filters.to || day <= filters.to)
      && (!filters.status || doc.status === filters.status)
      && (!filters.professor || doc.owner_name === filters.professor);
  }), [documents, filters]);
  const professors = [...new Set(documents.map((doc) => doc.owner_name))].sort((a, b) => a.localeCompare(b, "es"));
  const visibleSelectedIds = filteredDocuments.filter((doc) => selectedIds.has(doc.id)).map((doc) => doc.id);
  const selectedCount = visibleSelectedIds.length;
  const allSelected = filteredDocuments.length > 0 && selectedCount === filteredDocuments.length;

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelectedIds(new Set());
  }
  const hasProcessing = documents.some((doc) => doc.status === "PROCESSING");

  async function loadDocuments({ silent = false } = {}) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const data = await api.documents();
      setDocuments(data.documents);
      setSelectedIds((current) => {
        const availableIds = new Set(data.documents.map((doc) => doc.id));
        return new Set([...current].filter((id) => availableIds.has(id)));
      });
    } catch (err) {
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadDocuments();
  }, []);

  useEffect(() => {
    if (!hasProcessing) return undefined;
    const timer = window.setInterval(() => {
      loadDocuments({ silent: true });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [hasProcessing]);

  function chooseContentType(contentType) {
    selectedContentTypeRef.current = contentType;
    setShowUploadDialog(false);
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  }

  async function upload(fileList) {
    const files = Array.from(fileList || []);
    const contentType = selectedContentTypeRef.current;
    if (files.length === 0 || !contentType || uploading) return;
    setUploading(true);
    setUploadProgress({ completed: 0, total: files.length });
    setUploadResult(null);
    setError("");
    const failures = [];
    let succeeded = 0;
    try {
      for (const [index, file] of files.entries()) {
        try {
          await api.uploadDocument(file, contentType);
          succeeded += 1;
        } catch (err) {
          failures.push({ name: file.name, message: err.message });
        }
        setUploadProgress({ completed: index + 1, total: files.length });
      }
      setUploadResult({ succeeded, total: files.length, failures });
      await loadDocuments();
    } finally {
      setUploading(false);
      selectedContentTypeRef.current = "";
      fileInputRef.current.value = "";
    }
  }

  async function reprocessDocument(id) {
    setError("");
    try {
      await api.reprocessDocument(id);
      await loadDocuments();
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleDocument(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAllDocuments() {
    setSelectedIds((current) => {
      if (filteredDocuments.length > 0 && filteredDocuments.every((doc) => current.has(doc.id))) {
        return new Set();
      }

      return new Set(filteredDocuments.map((doc) => doc.id));
    });
  }

  async function deleteDocuments(ids) {
    const count = ids.length;
    if (count === 0) return;

    const confirmed = window.confirm(
      count === 1
        ? "¿Eliminar este temario y sus preguntas?"
        : `¿Eliminar ${count} temarios y sus preguntas?`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError("");
    try {
      const result = await api.deleteDocuments({ ids });
      setSelectedIds(new Set());
      await loadDocuments();
      if (result.deletedCount === 0) {
        setError("No se ha eliminado ningun temario disponible para tu usuario.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }


  return (
    <section className="page library-page">
      <header className="page-header">
        <div>
          <p>Biblioteca</p>
          <h1>Temarios</h1>
          <span className="page-description">Reutiliza el material que ya tienes para crear nuevas preguntas.</span>
        </div>
        <button className="secondary-button" onClick={loadDocuments} type="button">
          <RefreshCw size={18} />
          Actualizar
        </button>
      </header>

      <div className="library-actions">
        <Link className="primary-button" to="/crear">Generar preguntas</Link>
        <button
          className="secondary-button upload-button"
          disabled={uploading}
          onClick={() => setShowUploadDialog(true)}
          type="button"
        >
          <FileUp size={19} />
          {uploading ? "Subiendo PDFs..." : "Subir PDFs"}
        </button>
        <input
          accept="application/pdf"
          className="visually-hidden-file"
          multiple
          onChange={(event) => upload(event.target.files)}
          ref={fileInputRef}
          tabIndex="-1"
          type="file"
        />
      </div>

      {uploading && (
        <p role="status">
          Subida en curso: {uploadProgress.completed} de {uploadProgress.total} archivos completados.
        </p>
      )}
      {uploadResult && (
        <div role="status">
          <p>Se han subido {uploadResult.succeeded} de {uploadResult.total} PDFs.</p>
          {uploadResult.failures.length > 0 && (
            <>
              <p className="form-error">No se han podido subir los siguientes archivos. Puedes volver a seleccionarlos para reintentarlo:</p>
              <ul>
                {uploadResult.failures.map((failure, index) => (
                  <li key={index}>{failure.name}: {failure.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {showUploadDialog && (
        <div
          aria-labelledby="upload-dialog-title"
          aria-modal="true"
          className="modal-backdrop"
          onClick={() => setShowUploadDialog(false)}
          role="dialog"
        >
          <div className="upload-dialog" onClick={(event) => event.stopPropagation()}>
            <button
              aria-label="Cerrar"
              className="dialog-close"
              onClick={() => setShowUploadDialog(false)}
              type="button"
            >
              <X size={20} />
            </button>
            <div className="dialog-heading">
              <span className="dialog-icon"><FileUp size={22} /></span>
              <div>
                <h2 id="upload-dialog-title">¿Qué tipo de contenido vas a subir?</h2>
                <p>Puedes seleccionar varios PDFs a la vez. La categoría elegida se aplicará a todos ellos.</p>
              </div>
            </div>
            <div className="content-type-options">
              <button onClick={() => chooseContentType("MANUAL")} type="button">
                <BookOpen size={24} />
                <span><strong>Manual completo</strong><small>El manual íntegro en un único PDF</small></span>
              </button>
              <button onClick={() => chooseContentType("TEMA")} type="button">
                <FileText size={24} />
                <span><strong>Tema</strong><small>Un tema independiente del temario</small></span>
              </button>
              <button onClick={() => chooseContentType("CAPITULO")} type="button">
                <FileText size={24} />
                <span><strong>Capítulo</strong><small>Un capítulo concreto de un manual</small></span>
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="library-search">
        <label>Buscar en la biblioteca
          <input type="search" placeholder="Nombre del temario…" value={filters.name} onChange={(event) => updateFilter("name", event.target.value)} />
        </label>
        <button className="secondary-button" type="button" aria-expanded={showFilters} aria-controls="library-filters" onClick={() => setShowFilters((value) => !value)}>Filtros{[filters.from, filters.to, filters.status, filters.professor].filter(Boolean).length > 0 ? ` (${[filters.from, filters.to, filters.status, filters.professor].filter(Boolean).length})` : ""}</button>
      </div>
      <div className="library-tabs" aria-label="Tipo de temario">
        {[{ type: "", label: "Todos", total: documents.length }, ...stats].map((category) => (
          <button key={category.type} type="button" aria-pressed={filters.type === category.type} onClick={() => updateFilter("type", category.type)}>
            {category.label.replace(" subidos", "")} <span>{loading ? "…" : category.total}</span>
          </button>
        ))}
      </div>
      <div className="document-filters" id="library-filters" hidden={!showFilters}>
        <label>Tipo
          <select value={filters.type} onChange={(event) => updateFilter("type", event.target.value)}>
            <option value="">Todos los tipos</option>
            {Object.entries(contentTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>Subido desde
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => updateFilter("from", event.target.value)} />
        </label>
        <label>Subido hasta
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => updateFilter("to", event.target.value)} />
        </label>
        <label>Estado
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}>
            <option value="">Todos los estados</option>
            <option value="AVAILABLE">Disponible</option>
            <option value="PROCESSING">Procesando</option>
            <option value="ERROR">Error</option>
          </select>
        </label>
        <label>Profesor
          <select value={filters.professor} onChange={(event) => updateFilter("professor", event.target.value)}>
            <option value="">Todos los profesores</option>
            {professors.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <div className="document-filters-footer">
          <span role="status">{loading ? "Cargando..." : `${filteredDocuments.length} de ${documents.length} temarios`}</span>
          <button className="secondary-button compact" type="button" onClick={() => { setFilters(emptyFilters); setSelectedIds(new Set()); }} disabled={!Object.values(filters).some(Boolean)}>Limpiar filtros</button>
        </div>
      </div>

      {selectedCount > 0 && <div className="bulk-actions">
        <span>
          {selectedCount > 0
            ? `${selectedCount} seleccionado${selectedCount === 1 ? "" : "s"}`
            : "Selecciona temarios para acciones en lote"}
        </span>
        <div>
          <button
            className="danger-button compact"
            disabled={selectedCount === 0 || deleting}
            onClick={() => deleteDocuments(visibleSelectedIds)}
            type="button"
          >
            <Trash2 size={16} />
            Eliminar seleccionados
          </button>
        </div>
      </div>}
      <div className="library-result-count" role="status">
        {loading ? "Cargando temarios…" : `${filteredDocuments.length} temarios`}
        {Object.values(filters).some(Boolean) && <button className="ghost-button" type="button" onClick={() => { setFilters(emptyFilters); setSelectedIds(new Set()); }}>Limpiar filtros</button>}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="selection-cell">
                <input
                  aria-label="Seleccionar todos los resultados"
                  checked={allSelected}
                  disabled={filteredDocuments.length === 0}
                  onChange={toggleAllDocuments}
                  type="checkbox"
                />
              </th>
              <th>Nombre del temario</th>
              <th>Tipo</th>
              <th>Fecha de subida</th>
              <th>Estado</th>
              <th>Profesor</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="7">Cargando temarios...</td>
              </tr>
            ) : filteredDocuments.length === 0 ? (
              <tr>
                <td colSpan="7">{documents.length === 0 ? "No hay temarios subidos." : "No hay temarios que coincidan con los filtros."}</td>
              </tr>
            ) : (
              filteredDocuments.map((doc) => (
                <tr key={doc.id}>
                  <td className="selection-cell">
                    <input
                      aria-label={`Seleccionar ${doc.original_filename}`}
                      checked={selectedIds.has(doc.id)}
                      onChange={() => toggleDocument(doc.id)}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <strong>{doc.display_title || doc.original_filename}</strong>
                    {doc.display_title && <small className="document-filename">{doc.original_filename}</small>}
                    {doc.error_message && <small>{doc.error_message}</small>}
                  </td>
                  <td>{contentTypeLabels[doc.content_type] || doc.content_type}</td>
                  <td>{new Date(doc.created_at).toLocaleDateString("es-ES")}</td>
                  <td>
                    <StatusBadge status={doc.status} />
                  </td>
                  <td>{doc.owner_name}</td>
                  <td>
                    <div className="row-actions">
                      {doc.status === "AVAILABLE" && <Link className="secondary-button compact" to={`/crear?documento=${encodeURIComponent(doc.id)}`}>Usar temario</Link>}
                      {doc.status === "ERROR" && (
                        <button
                          className="secondary-button compact"
                          onClick={() => reprocessDocument(doc.id)}
                          type="button"
                        >
                          Reprocesar
                        </button>
                      )}
                      <button
                        aria-label={`Eliminar ${doc.original_filename}`}
                        className="danger-button compact icon-button"
                        disabled={deleting}
                        onClick={() => deleteDocuments([doc.id])}
                        title="Eliminar temario"
                        type="button"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
