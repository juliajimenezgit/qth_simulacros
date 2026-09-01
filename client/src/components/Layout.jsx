import {
  BookOpen,
  ClipboardList,
  FileQuestion,
  Gauge,
  LogOut,
  Shield,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

export default function Layout({ auth }) {
  const links = [
    { to: "/temarios", label: "Mis temarios", icon: BookOpen },
    { to: "/crear", label: "Crear simulacro", icon: ClipboardList },
    { to: "/preguntas", label: "Preguntas", icon: FileQuestion },
  ];

  if (auth.user.role === "ADMIN") {
    links.push({ to: "/admin", label: "Admin", icon: Shield });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img
            alt="QTH Sutan"
            className="brand-logo brand-logo-sidebar"
            src="/brand/logo-qth-sutan.svg"
          />
        </div>

        <nav className="sidebar-nav" aria-label="Navegacion principal">
          {links.map((link) => {
            const Icon = link.icon;
            return (
              <NavLink key={link.to} to={link.to}>
                <Icon size={19} />
                <span>{link.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <Gauge size={18} />
            <div>
              <strong>{auth.user.name}</strong>
              <span>{auth.user.role}</span>
            </div>
          </div>
          <button className="ghost-button" onClick={auth.logout} type="button">
            <LogOut size={18} />
            Salir
          </button>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
