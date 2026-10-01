export const ROLES = ["ADMIN", "DESARROLLADOR", "PROFESOR"];
// The developer has the same permissions as the administrator; the role only tells them apart.
export const ADMIN_ROLES = ["ADMIN", "DESARROLLADOR"];
export const isAdmin = (user) => ADMIN_ROLES.includes(user?.role);
