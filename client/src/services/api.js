const API_URL = import.meta.env.VITE_API_URL || "";
const TOKEN_KEY = "qth_simulacros_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();

  if (!(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = "No se ha podido completar la operacion";
    try {
      const data = await response.json();
      message = data.message || message;
    } catch {
      // Ignore non-JSON responses.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export const api = {
  login: (payload) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  me: () => request("/api/auth/me"),
  documents: () => request("/api/documents"),
  uploadDocument: (file, contentType) => {
    const body = new FormData();
    body.append("pdf", file);
    body.append("contentType", contentType);
    return request("/api/documents", { method: "POST", body });
  },
  reprocessDocument: (id) =>
    request(`/api/documents/${encodeURIComponent(id)}/reprocess`, {
      method: "POST",
    }),
  deleteDocuments: ({ ids = [], all = false }) =>
    request("/api/documents", {
      method: "DELETE",
      body: JSON.stringify({ ids, all }),
    }),
  questions: (documentId = "", testId = "") => {
    const params = new URLSearchParams();
    if (documentId) params.set("documentId", documentId);
    if (testId) params.set("testId", testId);
    return request(`/api/questions${params.size ? `?${params}` : ""}`);
  },
  generateQuestions: (payload) =>
    request("/api/questions/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateQuestion: (id, payload) =>
    request(`/api/questions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteQuestion: (id) =>
    request(`/api/questions/${id}`, {
      method: "DELETE",
    }),
  adminStats: () => request("/api/admin/stats"),
  users: () => request("/api/admin/users"),
  createUser: (payload) =>
    request("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  qualityInstructions: () => request("/api/admin/quality-instructions"),
  createQualityInstruction: (payload) =>
    request("/api/admin/quality-instructions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateQualityInstruction: (id, payload) =>
    request(`/api/admin/quality-instructions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteQualityInstruction: (id) =>
    request(`/api/admin/quality-instructions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  exportUrl: (documentId = "", format = "xlsx") => {
    const exportPath = documentId
      ? `/api/questions/export/${encodeURIComponent(documentId)}`
      : "/api/questions/export";
    return `${API_URL}${exportPath}?format=${encodeURIComponent(format)}`;
  },
};
