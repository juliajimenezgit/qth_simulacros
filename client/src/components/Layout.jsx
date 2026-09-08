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
import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import AppFooter from "./AppFooter.jsx";

export default function Layout({ auth }) {
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

  if (auth.user.role === "ADMIN") {
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
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip" title={auth.user.name}>
            <Gauge size={18} />
            <div>
              <strong>{auth.user.name}</strong>
              <span>{auth.user.role === "ADMIN" ? "Administrador" : "Profesor"}</span>
            </div>
          </div>
          <button className="ghost-button logout-button" onClick={auth.logout} type="button" aria-label="Salir" title={collapsed ? "Salir" : undefined}>
            <LogOut size={18} />
            <span>Salir</span>
          </button>
        </div>
      </aside>

      <main className="content">
        <div className="content-body"><Outlet /></div>
        <AppFooter />
      </main>
    </div>
  );
}
