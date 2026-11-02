// Fawnix Attend session, kept alongside the existing fawnix_* keys the layout reads.

const TOKEN_KEY = "acs_portal_token";
const EXPIRES_KEY = "acs_portal_token_expires";
const REFRESH_TOKEN_KEY = "acs_portal_refresh_token";
const ATTEND_ACCESS_TOKEN_KEY = "fawnix_attend_access_token";
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

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function saveSession({ token, expiresAt, attendAccessToken, refreshToken, user }) {
  if (!token || !refreshToken) {
    throw new Error("The sign-in service did not return both session tokens.");
  }

  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  if (attendAccessToken) localStorage.setItem(ATTEND_ACCESS_TOKEN_KEY, attendAccessToken);
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
  [TOKEN_KEY, REFRESH_TOKEN_KEY, ATTEND_ACCESS_TOKEN_KEY, EXPIRES_KEY, USER_KEY, LOGGED_IN_KEY, "fawnix_user_name", "fawnix_user_email"].forEach((key) => localStorage.removeItem(key));
  window.dispatchEvent(new Event("fawnix-user-updated"));
}

export const canPublish = (user) => user?.role === "admin" || user?.role === "publisher";
export const isAdmin = (user) => user?.role === "admin";
