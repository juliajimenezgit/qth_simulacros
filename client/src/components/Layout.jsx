import {
  BookOpen,
  ClipboardList,
  FileQuestion,
  Gauge,
  LogOut,
  Shield,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../services/api.js";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useGeneration } from "../context/GenerationContext.jsx";
import AppFooter from "./AppFooter.jsx";
import { isAdminRole, ROLE_LABELS } from "../utils/roles.js";

// Visible from every section: whether a generation is running, finished or failed.
function GenerationBadge({ generation }) {
  if (generation.status === "running") {
    return <em className="nav-badge running" title="Generando preguntas">{generation.saved || 0}/{generation.requestedCount}</em>;
  }
  if (generation.seen === false) {
    return <em className={`nav-badge ${generation.status === "error" ? "failed" : "ready"}`} title={generation.status === "error" ? "La generación ha fallado" : "Preguntas listas"}>{generation.status === "error" ? "!" : "✓"}</em>;
  }
  return null;
}

// Time in the app: one ping per minute while the tab is visible (the server ignores duplicates).
function useUsageHeartbeat() {
  useEffect(() => {
    const ping = () => {
      if (document.visibilityState === "visible") api.heartbeat().catch(() => {});
    };
    ping();
    const timer = setInterval(ping, 60_000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, []);
}

export default function Layout({ auth }) {
  useUsageHeartbeat();
  const { generation } = useGeneration();
  const location = useLocation();
  const onGenerator = location.pathname === "/crear";
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("qth_sidebar_collapsed") === "true"; }
    catch { return false; }
  });
  function toggleSidebar() {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("qth_sidebar_collapsed", String(next)); }
    catch { /* Keep navigation usable when browser storage is unavailable. */ }
  }
  const links = [
    { to: "/temarios", label: "Biblioteca de temarios", icon: BookOpen },
    { to: "/crear", label: "Generar preguntas", icon: ClipboardList },
    { to: "/preguntas", label: "Revisar preguntas", icon: FileQuestion },
  ];

  if (isAdminRole(auth.user.role)) {
    links.push({ to: "/admin", label: "Admin", icon: Shield });
  }

  return (
    <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-heading">
        <div className="brand">
          <img
            alt="QTH Sutan"
            className="brand-logo brand-logo-sidebar"
            src={collapsed ? "/brand/logo-qth-sutan-icon.svg" : "/brand/logo-qth-sutan.svg"}
          />
        </div>

        <button className="ghost-button sidebar-toggle" type="button" onClick={toggleSidebar}
          aria-label={collapsed ? "Desplegar menú lateral" : "Plegar menú lateral"}
          title={collapsed ? "Desplegar menú lateral" : "Plegar menú lateral"}
          aria-expanded={!collapsed} aria-controls="sidebar-navigation">
          {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
        </div>

        <nav id="sidebar-navigation" className="sidebar-nav" aria-label="Navegacion principal">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink key={link.to} to={link.to} aria-label={link.label} title={collapsed ? link.label : undefined}>
                <Icon size={19} />
                <span>{link.label}</span>
                {link.to === "/crear" && <GenerationBadge generation={generation} />}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip" title={auth.user.name}>
            <Gauge size={18} />
            <div>
              <strong>{auth.user.name}</strong>
              <span>{ROLE_LABELS[auth.user.role] || "Profesor"}</span>
            </div>
          </div>
          <button className="ghost-button logout-button" onClick={auth.logout} type="button" aria-label="Salir" title={collapsed ? "Salir" : undefined}>
            <LogOut size={18} />
            <span>Salir</span>
          </button>
        </div>
      </aside>

      <main className="content">
        {!onGenerator && generation.seen === false && (
          <div className={`generation-notice ${generation.status === "error" ? "failed" : "ready"}`} role="status">
            <span>
              {generation.status === "error"
                ? `La generación de «${generation.testName}» no se ha completado: ${generation.error}`
                : `El test «${generation.testName}» está listo: ${generation.saved} preguntas generadas.`}
            </span>
            <Link to="/crear">{generation.status === "error" ? "Ver detalles" : "Revisar preguntas"}</Link>
          </div>
        )}
        <div className="content-body"><Outlet /></div>
        <AppFooter />
      </main>
    </div>
  );
}
