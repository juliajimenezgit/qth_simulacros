import { BarChart3, BookOpen, FileQuestion, Shield, Sparkles, Trash2, UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import StatCard from "../components/StatCard.jsx";
import { api } from "../services/api.js";

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [instructions, setInstructions] = useState([]);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "PROFESOR",
  });
  const [error, setError] = useState("");
  const [instructionForm, setInstructionForm] = useState({
    title: "",
    content: "",
    difficulty: null,
    active: true,
  });

  async function load() {
    setError("");
    try {
      const [statsData, usersData, instructionsData] = await Promise.all([
        api.adminStats(),
        api.users(),
        api.qualityInstructions(),
      ]);
      setStats(statsData);
      setUsers(usersData.users);
      setInstructions(instructionsData.instructions);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser(event) {
    event.preventDefault();
    try {
      await api.createUser(form);
      setForm({ name: "", email: "", password: "", role: "PROFESOR" });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createInstruction(event) {
    event.preventDefault();
    setError("");
    try {
      await api.createQualityInstruction(instructionForm);
      setInstructionForm({ title: "", content: "", difficulty: null, active: true });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleInstruction(instruction) {
    try {
      await api.updateQualityInstruction(instruction.id, {
        active: !instruction.active,
      });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeInstruction(id) {
    try {
      await api.deleteQualityInstruction(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const totals = stats?.totals || {};

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <p>Administración</p>
          <h1>Dashboard global</h1>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}

      <div className="stats-grid">
        <StatCard
          icon={Users}
          label="Profesores"
          value={totals.total_profesores || 0}
        />
        <StatCard icon={BookOpen} label="Temarios" value={totals.total_temarios || 0} />
        <StatCard
          icon={FileQuestion}
          label="Preguntas"
          value={totals.total_preguntas || 0}
        />
        <StatCard
          icon={Shield}
          label="Procesando"
          value={totals.temarios_procesando || 0}
        />
      </div>

      <div className="admin-grid">
        <section className="tool-panel">
          <h2>Profesores</h2>
          <div className="ranking">
            {(stats?.questionsByTeacher || []).map((teacher) => (
              <div key={teacher.id}>
                <span>{teacher.name}</span>
                <strong>{teacher.total}</strong>
              </div>
            ))}
          </div>
        </section>

        <form className="tool-panel" onSubmit={createUser}>
          <h2>Usuario autorizado</h2>
          <label>
            Nombre
            <input
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
              value={form.name}
            />
          </label>
          <label>
            Email
            <input
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              required
              type="email"
              value={form.email}
            />
          </label>
          <div className="field-row">
            <label>
              Contraseña
              <input
                minLength="8"
                onChange={(event) =>
                  setForm({ ...form, password: event.target.value })
                }
                required
                type="password"
                value={form.password}
              />
            </label>
            <label>
              Rol
              <select
                onChange={(event) => setForm({ ...form, role: event.target.value })}
                value={form.role}
              >
                <option value="PROFESOR">Profesor</option>
                <option value="ADMIN">Admin</option>
              </select>
            </label>
          </div>
          <button className="primary-button" type="submit">
            <UserPlus size={18} />
            Crear usuario
          </button>
        </form>
      </div>

      <div className="admin-grid">
        <section className="tool-panel">
          <h2>Última actividad</h2>
          <div className="activity-list">
            {(stats?.activity || []).map((item) => (
              <div key={item.id}>
                <BarChart3 size={17} />
                <span>{item.action}</span>
                <small>{item.user_name || "Sistema"}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="tool-panel">
          <h2>Usuarios</h2>
          <div className="user-list">
            {users.map((user) => (
              <div key={user.id}>
                <span>{user.name}</span>
                <small>{user.email}</small>
                <strong>{user.role}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="admin-grid quality-instructions-grid">
        <form className="tool-panel" onSubmit={createInstruction}>
          <h2><Sparkles size={20} /> Instrucciones de calidad</h2>
          <p className="muted-text">
            Se vectorizan y se añaden al prompt solo cuando son relevantes para el lote.
          </p>
          <label>
            Título
            <input
              maxLength="120"
              onChange={(event) =>
                setInstructionForm({ ...instructionForm, title: event.target.value })
              }
              placeholder="Ej. Distractores numéricos"
              required
              value={instructionForm.title}
            />
          </label>
          <label>
            Instrucción
            <textarea
              maxLength="4000"
              minLength="20"
              onChange={(event) =>
                setInstructionForm({ ...instructionForm, content: event.target.value })
              }
              placeholder="Describe una regla concreta y verificable para redactar preguntas..."
              required
              rows="6"
              value={instructionForm.content}
            />
          </label>
          <label>
            Nivel al que se aplica
            <select
              onChange={(event) =>
                setInstructionForm({
                  ...instructionForm,
                  difficulty: event.target.value || null,
                })
              }
              value={instructionForm.difficulty || ""}
            >
              <option value="">Todos los niveles</option>
              <option value="PRINCIPIANTE">Principiante</option>
              <option value="ELITE">Élite</option>
              <option value="ALEATORIO">Aleatorio</option>
            </select>
          </label>
          <button className="primary-button" type="submit">
            <Sparkles size={18} /> Añadir y vectorizar
          </button>
        </form>

        <section className="tool-panel">
          <h2>Reglas disponibles</h2>
          <div className="instruction-list">
            {instructions.length === 0 && (
              <p className="muted-text">Todavía no hay instrucciones adicionales.</p>
            )}
            {instructions.map((instruction) => (
              <article className={instruction.active ? "" : "inactive"} key={instruction.id}>
                <div>
                  <strong>{instruction.title}</strong>
                  <small>{instruction.difficulty || "TODOS"}</small>
                </div>
                <p>{instruction.content}</p>
                <div className="instruction-actions">
                  <button
                    className="secondary-button compact"
                    onClick={() => toggleInstruction(instruction)}
                    type="button"
                  >
                    {instruction.active ? "Desactivar" : "Activar"}
                  </button>
                  <button
                    aria-label={`Eliminar ${instruction.title}`}
                    className="danger-button compact"
                    onClick={() => removeInstruction(instruction.id)}
                    type="button"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
