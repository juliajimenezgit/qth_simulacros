import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../services/api.js";
import { ROLE_LABELS } from "../utils/roles.js";

const LEVELS = [["PRINCIPIANTE", "Principiante"], ["FACIL", "Fácil"], ["DIFICIL", "Difícil"]];
const percent = (part, total) => (total ? Math.round((100 * part) / total) : 0);
const formatMinutes = (minutes) => {
  if (!minutes) return "0 min";
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};
const formatSeconds = (seconds) => {
  if (!seconds) return "—";
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
};
const formatDate = (value, withTime = true) => (value
  ? new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(value))
  : "Nunca");
const dayLabel = (day) => new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00`));

// Minutes in the app per day: a single series, so one hue and no legend; the title names it.
function DailyMinutesChart({ days }) {
  const [hovered, setHovered] = useState(null);
  const max = Math.max(...days.map((day) => day.minutes), 1);
  const total = days.reduce((sum, day) => sum + day.minutes, 0);
  return (
    <figure className="daily-chart">
      <figcaption>
        <strong>Minutos en la app</strong>
        <span>Últimos 14 días · {formatMinutes(total)} en total</span>
      </figcaption>
      <div className="daily-chart-plot" onMouseLeave={() => setHovered(null)}>
        <span className="daily-chart-max" aria-hidden="true">{max} min</span>
        {days.map((day, index) => (
          <div
            aria-label={`${dayLabel(day.day)}: ${day.minutes} minutos`}
            className="daily-chart-column"
            key={day.day}
            onFocus={() => setHovered(index)}
            onMouseEnter={() => setHovered(index)}
            role="img"
            tabIndex={0}
          >
            <span className="daily-chart-bar" style={{ height: `${(day.minutes / max) * 100}%` }} />
            {hovered === index && (
              <span className="daily-chart-tooltip" role="tooltip">
                <strong>{day.minutes} min</strong>
                {dayLabel(day.day)}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="daily-chart-axis" aria-hidden="true">
        <span>{dayLabel(days[0].day)}</span>
        <span>Hoy</span>
      </div>
    </figure>
  );
}

export default function UserDetail({ userId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.userStats(userId).then(setData).catch((err) => setError(err.message));
  }, [userId]);

  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const levelTotal = data ? LEVELS.reduce((sum, [key]) => sum + (data.levels[key] || 0), 0) : 0;
  const finished = data ? data.tests.completados + data.tests.con_error : 0;

  return (
    <div aria-labelledby="user-detail-title" aria-modal="true" className="modal-backdrop" onClick={onClose} role="dialog">
      <div className="user-detail" onClick={(event) => event.stopPropagation()}>
        <button aria-label="Cerrar ficha" className="ghost-button user-detail-close" onClick={onClose} type="button">
          <X size={20} />
        </button>

        {error && <p className="form-error" role="alert">{error}</p>}
        {!data && !error && <p className="muted-text">Cargando la ficha…</p>}

        {data && (
          <>
            <header className="user-detail-header">
              <div>
                <h2 id="user-detail-title">{data.user.name}</h2>
                <span>{data.user.email}</span>
              </div>
              <span className={`role-badge role-${data.user.role.toLowerCase()}`}>{ROLE_LABELS[data.user.role]}</span>
              <p>Alta: {formatDate(data.user.created_at, false)} · Último acceso: {formatDate(data.user.ultimo_acceso)}</p>
            </header>

            <div className="user-detail-kpis">
              <div><span>Tiempo en la app</span><strong>{formatMinutes(data.usage.minutos_30d)}</strong><small>últimos 30 días · {formatMinutes(data.usage.minutos_total)} en total</small></div>
              <div><span>Días activos</span><strong>{data.usage.dias_activos_30d} de 30</strong><small>{data.usage.dias_activos_30d ? `unos ${Math.round(data.usage.minutos_30d / data.usage.dias_activos_30d)} min por día activo` : "sin actividad reciente"}</small></div>
              <div><span>Accesos</span><strong>{data.usage.accesos_30d}</strong><small>en 30 días · {data.usage.accesos_total} en total</small></div>
              <div><span>Tests</span><strong>{data.tests.total}</strong><small>{data.tests.ultimos_30d} en 30 días · {percent(data.tests.completados, finished)} % completados</small></div>
              <div><span>Preguntas generadas</span><strong>{data.tests.preguntas}</strong><small>{data.tests.preguntas_medias_por_test ? `unas ${data.tests.preguntas_medias_por_test} por test` : "sin tests"}</small></div>
              <div><span>Tiempo medio por test</span><strong>{formatSeconds(data.tests.segundos_medios)}</strong><small>{data.tests.con_error} test(s) con error</small></div>
            </div>

            <DailyMinutesChart days={data.daily} />

            <div className="user-detail-grid">
              <section>
                <h3>Reparto por nivel</h3>
                {levelTotal === 0 && <p className="muted-text">Sin preguntas todavía.</p>}
                {levelTotal > 0 && LEVELS.map(([key, label]) => (
                  <div className="level-row" key={key}>
                    <span>{label}</span>
                    <span className="level-track"><span style={{ width: `${percent(data.levels[key], levelTotal)}%` }} /></span>
                    <strong>{data.levels[key]} · {percent(data.levels[key], levelTotal)} %</strong>
                  </div>
                ))}
              </section>
              <section>
                <h3>Temarios con los que más trabaja</h3>
                {data.documents.length === 0 && <p className="muted-text">Todavía no ha generado tests.</p>}
                <div className="ranking">
                  {data.documents.map((document) => (
                    <div key={document.id}>
                      <span>{document.title}</span>
                      <strong>{document.tests} {document.tests === 1 ? "test" : "tests"}</strong>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section>
              <h3>Últimos tests</h3>
              {data.recentTests.length === 0 && <p className="muted-text">Todavía no ha generado tests.</p>}
              {data.recentTests.length > 0 && (
                <div className="team-table-wrapper">
                  <table className="team-table">
                    <thead>
                      <tr><th>Test</th><th>Fecha</th><th>Estado</th><th>Preguntas</th><th>Duración</th></tr>
                    </thead>
                    <tbody>
                      {data.recentTests.map((test) => (
                        <tr key={test.id}>
                          <td><strong>{test.name}</strong></td>
                          <td>{formatDate(test.created_at)}</td>
                          <td>
                            <span className={`status-pill status-${test.status.toLowerCase()}`}>
                              {{ COMPLETED: "✓ Completado", ERROR: "✕ Con error", GENERATING: "… Generando" }[test.status]}
                            </span>
                          </td>
                          <td>{test.preguntas}/{test.requested_count}</td>
                          <td>{formatSeconds(test.segundos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
