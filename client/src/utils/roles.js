// Same rule as the server: the developer has the administrator's permissions.
export const ADMIN_ROLES = ["ADMIN", "DESARROLLADOR"];
export const isAdminRole = (role) => ADMIN_ROLES.includes(role);
export const ROLE_LABELS = { ADMIN: "Administrador", DESARROLLADOR: "Desarrolladora", PROFESOR: "Profesor" };
