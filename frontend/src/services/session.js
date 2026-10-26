// Signed-in portal session (bearer token + user), kept in localStorage alongside the existing
// fawnix_* keys the layout reads for the profile menu.

const TOKEN_KEY = "acs_portal_token";
const EXPIRES_KEY = "acs_portal_token_expires";
const USER_KEY = "fawnix_user";
const LOGGED_IN_KEY = "fawnix_logged_in";

export const SESSION_EXPIRED_EVENT = "portal-session-expired";

export function getSessionToken() {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiresAt = Date.parse(localStorage.getItem(EXPIRES_KEY) || "");
  if (!token || (expiresAt && expiresAt <= Date.now())) return null;
  return token;
}

export function getSessionUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export function saveSession({ token, expiresAt, user }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EXPIRES_KEY, expiresAt);
  storeUser(user);
  localStorage.setItem(LOGGED_IN_KEY, "true");
}

export function storeUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  localStorage.removeItem("fawnix_user_name");
  localStorage.removeItem("fawnix_user_email");
  window.dispatchEvent(new Event("fawnix-user-updated"));
}

export function clearSession() {
  [TOKEN_KEY, EXPIRES_KEY, USER_KEY, LOGGED_IN_KEY, "fawnix_user_name", "fawnix_user_email"].forEach((key) => localStorage.removeItem(key));
  window.dispatchEvent(new Event("fawnix-user-updated"));
}

export const canPublish = (user) => user?.role === "admin" || user?.role === "publisher";
export const isAdmin = (user) => user?.role === "admin";
