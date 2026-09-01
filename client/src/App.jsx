import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { api, clearToken, getToken, setToken } from "./services/api.js";
import Layout from "./components/Layout.jsx";
import Login from "./pages/Login.jsx";
import Documents from "./pages/Documents.jsx";
import Generator from "./pages/Generator.jsx";
import Questions from "./pages/Questions.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setBooting(false);
      return;
    }

    api
      .me()
      .then((data) => setUser(data.user))
      .catch(() => clearToken())
      .finally(() => setBooting(false));
  }, []);

  const auth = useMemo(
    () => ({
      user,
      login: async (credentials) => {
        const data = await api.login(credentials);
        setToken(data.token);
        setUser(data.user);
      },
      logout: () => {
        clearToken();
        setUser(null);
      },
    }),
    [user],
  );

  if (booting) {
    return <div className="boot-screen">QTH Simulacros</div>;
  }

  if (!user) {
    return <Login onLogin={auth.login} />;
  }

  return (
    <Routes>
      <Route element={<Layout auth={auth} />}>
        <Route index element={<Navigate to="/temarios" replace />} />
        <Route path="/temarios" element={<Documents user={user} />} />
        <Route path="/crear" element={<Generator />} />
        <Route path="/preguntas" element={<Questions user={user} />} />
        {user.role === "ADMIN" && (
          <Route path="/admin" element={<AdminDashboard />} />
        )}
        <Route path="*" element={<Navigate to="/temarios" replace />} />
      </Route>
    </Routes>
  );
}
