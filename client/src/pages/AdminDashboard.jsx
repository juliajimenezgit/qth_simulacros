import { BookOpen, CheckCircle2, FileQuestion, Layers, Pencil, Save, Timer, Trash2, UserPlus, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import StatCard from "../components/StatCard.jsx";
import UserDetail from "../components/UserDetail.jsx";
import { api } from "../services/api.js";
import { ROLE_LABELS } from "../utils/roles.js";

const LEVELS = ["PRINCIPIANTE", "FACIL", "DIFICIL"];
const EMPTY_USER = { name: "", email: "", password: "", role: "PROFESOR" };

// What each role can do, as the server enforces it (utils/roles.js and the owner checks in the services).
const ROLE_PERMISSIONS = [
  {
    role: "PROFESOR",
    summary: "Trabaja solo con lo suyo.",
    items: [
      "Sube, renombra y borra sus propios temarios; no ve los de otros profesores.",
      "Genera tests a partir de sus temarios.",
      "Revisa, edita, borra y exporta solo sus preguntas y tests.",
      "No ve la pestaña Admin.",
    ],
  },
  {
    role: "ADMIN",
    summary: "Gestiona la aplicación y al equipo.",
    items: [
      "Ve y gestiona los temarios, preguntas y tests de todos los usuarios.",
      "Genera tests con cualquier temario de la biblioteca.",
      "Accede a la pestaña Admin: indicadores, equipo y gestión de usuarios.",
      "Puede eliminar otras cuentas del equipo conservando sus contenidos.",
      "Si da de alta un correo que ya existe, actualiza su nombre, contraseña y rol.",
    ],
  },
  {
    role: "DESARROLLADOR",
    summary: "Mismos permisos que el administrador.",
    items: [
      "Puede hacer todo lo que hace el administrador.",
      "El rol solo sirve para distinguir al equipo técnico en el panel.",
    ],
  },
];

const formatMinutes = (minutes) => (minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes || 0} min`);
const percent = (part, total) => (total ? Math.round((100 * part) / total) : 0);
const formatDate = (value) => (value
  ? new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
  : "Nunca");

export default function AdminDashboard({ user }) {
  const [deletingId, setDeletingId] = useState(null);
  const [stats, setStats] = useState(null);
  const [form, setForm] = useState(EMPTY_USER);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedUserId, setSelectedUserId] = useState(null);
  // Id of the user being edited; null while the form creates a new one.
  const [editingId, setEditingId] = useState(null);
  const formRef = useRef(null);

  async function load() {
    setError("");
    try {
      setStats(await api.adminStats());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveUser(event) {
    event.preventDefault();
    setNotice("");
    setError("");
    try {
      if (editingId) {
        const { user } = await api.updateUser(editingId, form);
        setNotice(`Datos de ${user.name} guardados${form.password ? ", con la nueva contraseña" : ""}.`);
      } else {
        const { user } = await api.createUser(form);
        setNotice(`${user.name} ya puede entrar como ${ROLE_LABELS[user.role]?.toLowerCase() || user.role}.`);
      }
      setForm(EMPTY_USER);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeUser(member) {
    if (deletingId) return;
    if (!window.confirm(`¿Eliminar a ${member.name} (${member.email}) del equipo? Perderá el acceso a la aplicación. Sus temarios, preguntas y tests se conservarán.`)) return;
    setDeletingId(member.id);
    setError("");
    setNotice("");
    try {
      await api.deleteUser(member.id);
      if (editingId === member.id) cancelEditing();
      if (selectedUserId === member.id) setSelectedUserId(null);
      setNotice(`${member.name} ya no forma parte del equipo. Sus contenidos se han conservado.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  }

  function startEditing(member) {
    setEditingId(member.id);
    setForm({ name: member.name, email: member.email, password: "", role: member.role });
    setNotice("");
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function cancelEditing() {
    setEditingId(null);
    setForm(EMPTY_USER);
  }

  const totals = stats?.totals || {};
  const levels = stats?.levels || {};
  const levelTotal = LEVELS.reduce((sum, key) => sum + (levels[key] || 0), 0);
  const finishedTests = (totals.tests_completados || 0) + (totals.tests_error || 0);

  return (
    <section className="page admin-page">
      <header className="page-header">
        <div>
          <p>Administración</p>
          <h1>Panel de control</h1>
          <span className="page-description">Uso de la aplicación, calidad de la generación y equipo.</span>
        </div>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="generation-success" role="status">{notice}</p>}

      <div className="stats-grid admin-kpis">
        <StatCard
          icon={FileQuestion}
          label="Preguntas generadas"
          value={totals.preguntas_total ?? "—"}
          detail={`${totals.preguntas_30d || 0} en los últimos 30 días`}
        />
        <StatCard
          icon={CheckCircle2}
          label="Tests completados"
          value={`${percent(totals.tests_completados, finishedTests)} %`}
          detail={`${totals.tests_completados || 0} de ${finishedTests} tests terminados${totals.tests_generando ? ` · ${totals.tests_generando} en curso` : ""}`}
        />
        <StatCard
          icon={Timer}
          label="Tiempo medio por pregunta"
          value={totals.segundos_medios_pregunta ? `${totals.segundos_medios_pregunta} s` : "—"}
          detail={totals.tests_completados ? `en ${totals.tests_completados} tests completados` : "Sin tests completados"}
        />
        <StatCard
          icon={Users}
          label="Profesores activos"
          value={`${totals.profesores_activos_30d || 0} de ${totals.profesores_total || 0}`}
          detail="con algún test en los últimos 30 días"
        />
        <StatCard
          icon={BookOpen}
          label="Temarios disponibles"
          value={totals.temarios_disponibles ?? "—"}
          detail={`${totals.temarios_procesando || 0} procesando · ${totals.temarios_error || 0} con error`}
        />
        <StatCard
          icon={Layers}
          label="Reparto por nivel"
          value={`${percent(levels.PRINCIPIANTE || 0, levelTotal)} % Principiante`}
          detail={`${percent((levels.FACIL || 0) + (levels.DIFICIL || 0), levelTotal)} % Élite`}
        />
      </div>

      <section className="tool-panel">
          <h2>Equipo</h2>
          <p className="muted-text">Pincha en una persona para ver su ficha completa.</p>
          <div className="team-table-wrapper">
            <table className="team-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>En la app (30 d)</th>
                  <th>Tests</th>
                  <th>Preguntas</th>
                  <th>Último acceso</th>
                  <th><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {(stats?.team || []).map((member) => (
                  <tr className="team-row" key={member.id} onClick={() => setSelectedUserId(member.id)}>
                    <td>
                      {/* A real button keeps the row reachable with the keyboard. */}
                      <button className="team-member-button" onClick={(event) => { event.stopPropagation(); setSelectedUserId(member.id); }} type="button">
                        <strong>{member.name}</strong>
                        <small>{member.email}</small>
                      </button>
                    </td>
                    <td><span className={`role-badge role-${member.role.toLowerCase()}`}>{ROLE_LABELS[member.role] || member.role}</span></td>
                    <td>{formatMinutes(member.minutos_30d)}</td>
                    <td title={`${member.tests_completados} completados de ${member.tests}`}>
                      {member.tests_completados}/{member.tests}
                    </td>
                    <td>{member.preguntas}</td>
                    <td>{formatDate(member.ultimo_acceso)}</td>
                    <td>
                      <button disabled={Boolean(deletingId)} aria-label={`Editar a ${member.name}`} className="ghost-button" onClick={(event) => { event.stopPropagation(); startEditing(member); }} title="Editar" type="button">
                        <Pencil size={16} />
                      </button>
                      <button className="danger-button compact icon-button" type="button"
                        aria-label={`Eliminar a ${member.name}`}
                        title={member.id === user?.id ? "No puedes eliminar tu propia cuenta" : "Eliminar del equipo"}
                        disabled={Boolean(deletingId) || member.id === user?.id}
                        onClick={(event) => { event.stopPropagation(); removeUser(member); }}>
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      </section>

      <form className="tool-panel admin-user-form" onSubmit={saveUser} ref={formRef}>
        <h2>{editingId ? `Editar a ${stats?.team?.find((member) => member.id === editingId)?.name || "usuario"}` : "Añadir usuario"}</h2>
        <p className="muted-text">No hay registro público: solo pueden entrar los usuarios que se den de alta aquí. El correo identifica a cada usuario y no se puede repetir.</p>
        <div className="admin-user-fields">
          <label className="field-name">
            Nombre y apellidos
            <input autoComplete="off" onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej. Laura Martín López" required value={form.name} />
          </label>
          <label className="field-email">
            Email
            <input autoComplete="off" onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="nombre.apellido@qthsutan.es" required type="email" value={form.email} />
          </label>
          <label className="field-password">
            Contraseña
            <input autoComplete="new-password" minLength="8" onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editingId ? "Sin cambios" : ""} required={!editingId} type="password" value={form.password} />
            <small>{editingId ? "Déjala vacía para mantener la actual" : "Mínimo 8 caracteres"}</small>
          </label>
          <label className="field-role">
            Rol
            <select onChange={(event) => setForm({ ...form, role: event.target.value })} value={form.role}>
              <option value="PROFESOR">Profesor</option>
              <option value="ADMIN">Administrador</option>
              <option value="DESARROLLADOR">Desarrolladora</option>
            </select>
          </label>
        </div>

        <div className="role-permissions" aria-label="Permisos de cada rol">
          {ROLE_PERMISSIONS.map(({ role, summary, items }) => (
            <article className={form.role === role ? "selected" : ""} key={role}>
              <header>
                <span className={`role-badge role-${role.toLowerCase()}`}>{ROLE_LABELS[role]}</span>
                <strong>{summary}</strong>
              </header>
              <ul>
                {items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>

        <div className="admin-user-actions">
          <button className="primary-button" disabled={Boolean(deletingId)} type="submit">
            {editingId ? <Save size={18} /> : <UserPlus size={18} />}
            {editingId ? "Guardar cambios" : "Crear usuario"}
          </button>
          {editingId && <button className="secondary-button" onClick={cancelEditing} type="button">Cancelar</button>}
        </div>
      </form>
      {selectedUserId && <UserDetail onClose={() => setSelectedUserId(null)} userId={selectedUserId} />}
    </section>
  );
}
