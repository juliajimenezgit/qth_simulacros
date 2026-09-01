const labels = {
  PROCESSING: "Procesando",
  AVAILABLE: "Disponible",
  ERROR: "Error",
};

export default function StatusBadge({ status }) {
  return <span className={`status status-${status}`}>{labels[status] || status}</span>;
}
