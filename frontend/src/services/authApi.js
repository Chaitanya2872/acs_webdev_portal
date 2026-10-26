import { apiRequest } from "./apiClient";
import { clearSession, saveSession } from "./session";

export function requestOtp({ employeeCode }) {
  return apiRequest("/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ employeeCode }),
  });
}

export async function verifyOtp({ employeeCode, otp }) {
  const session = await apiRequest("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ employeeCode, otp }),
  });
  saveSession(session);
  return session;
}

export function fetchCurrentUser() {
  return apiRequest("/auth/me");
}

export async function logout() {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch {
    // The session is cleared locally either way.
  } finally {
    clearSession();
  }
}
