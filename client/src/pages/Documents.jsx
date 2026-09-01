import { BookOpen, FileText, FileUp, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { api } from "../services/api.js";

const contentTypeLabels = {
  MANUAL: "Manual completo",
  TEMA: "Tema",
  CAPITULO: "Capítulo",
};

export default function Documents() {
  const [documents, setDocuments] = useState([]);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const selectedContentTypeRef = useRef("");

  const stats = useMemo(
    () => ({
      total: documents.length,
      available: documents.filter((doc) => doc.status === "AVAILABLE").length,
      questions: documents.reduce((sum, doc) => sum + doc.question_count, 0),
    }),
    [documents],
  );
  const selectedCount = selectedIds.size;
  const allSelected =
    documents.length > 0 && documents.every((doc) => selectedIds.has(doc.id));
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

  async function upload(file) {
    const contentType = selectedContentTypeRef.current;
    if (!file || !contentType) return;
    setUploading(true);
    setError("");
    try {
      await api.uploadDocument(file, contentType);
      await loadDocuments();
    } catch (err) {
      setError(err.message);
      await loadDocuments();
    } finally {
      setUploading(false);
      selectedContentTypeRef.current = "";
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
      if (documents.length > 0 && documents.every((doc) => current.has(doc.id))) {
        return new Set();
      }

      return new Set(documents.map((doc) => doc.id));
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

  async function deleteAllDocuments() {
    if (documents.length === 0) return;

    const confirmed = window.confirm(
      `¿Eliminar todos los temarios visibles (${documents.length}) y sus preguntas?`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError("");
    try {
      await api.deleteDocuments({ all: true });
      setSelectedIds(new Set());
      await loadDocuments();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p>Panel profesor</p>
          <h1>Mis temarios</h1>
        </div>
        <button className="secondary-button" onClick={loadDocuments} type="button">
          <RefreshCw size={18} />
          Actualizar
        </button>
      </header>

      <div className="stats-grid">
        <StatCard icon={FileUp} label="Temarios" value={stats.total} />
        <StatCard label="Disponibles" value={stats.available} />
        <StatCard label="Preguntas" value={stats.questions} />
      </div>

      <div className="upload-action">
        <button
          className="primary-button upload-button"
          disabled={uploading}
          onClick={() => setShowUploadDialog(true)}
          type="button"
        >
          <FileUp size={19} />
          {uploading ? "Subiendo PDF..." : "Subir PDF"}
        </button>
        <input
          accept="application/pdf"
          className="visually-hidden-file"
          onChange={(event) => upload(event.target.files[0] || null)}
          ref={fileInputRef}
          tabIndex="-1"
          type="file"
        />
      </div>

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
                <p>Selecciona una categoría para continuar con el PDF.</p>
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

      <div className="bulk-actions">
        <span>
          {selectedCount > 0
            ? `${selectedCount} seleccionado${selectedCount === 1 ? "" : "s"}`
            : "Selecciona temarios para acciones en lote"}
        </span>
        <div>
          <button
            className="danger-button compact"
            disabled={selectedCount === 0 || deleting}
            onClick={() => deleteDocuments([...selectedIds])}
            type="button"
          >
            <Trash2 size={16} />
            Eliminar seleccionados
          </button>
          <button
            className="danger-button compact"
            disabled={documents.length === 0 || deleting}
            onClick={deleteAllDocuments}
            type="button"
          >
            <Trash2 size={16} />
            Eliminar todos
          </button>
        </div>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="selection-cell">
                <input
                  aria-label="Seleccionar todos los temarios"
                  checked={allSelected}
                  disabled={documents.length === 0}
                  onChange={toggleAllDocuments}
                  type="checkbox"
                />
              </th>
              <th>Nombre del temario</th>
              <th>Tipo</th>
              <th>Fecha de subida</th>
              <th>Preguntas</th>
              <th>Estado</th>
              <th>Profesor</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="8">Cargando temarios...</td>
              </tr>
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan="8">No hay temarios subidos.</td>
              </tr>
            ) : (
              documents.map((doc) => (
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
                    <strong>{doc.original_filename}</strong>
                    {doc.error_message && <small>{doc.error_message}</small>}
                  </td>
                  <td>{contentTypeLabels[doc.content_type] || doc.content_type}</td>
                  <td>{new Date(doc.created_at).toLocaleDateString("es-ES")}</td>
                  <td>{doc.question_count}</td>
                  <td>
                    <StatusBadge status={doc.status} />
                  </td>
                  <td>{doc.owner_name}</td>
                  <td>
                    <div className="row-actions">
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
