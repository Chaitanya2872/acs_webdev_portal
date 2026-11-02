import { apiRequest } from "./apiClient";
import { clearSession, getRefreshToken, saveSession } from "./session";

const deviceInfo = () => ({
  device_name: navigator.userAgent,
  os: navigator.platform || "Web",
  app_version: "acs-webdev-portal",
});

export function requestOtp({ employeeCode }) {
  return apiRequest("/auth/otp/request", {
    method: "POST",
    body: JSON.stringify({ employeeCode }),
  });
}

export async function verifyOtp({ employeeCode, otp }) {
  const session = await apiRequest("/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ employeeCode, otp, deviceInfo: deviceInfo() }),
  });
  saveSession({
    token: session.token,
    expiresAt: session.expiresAt,
    attendAccessToken: session.attend.access_token,
    refreshToken: session.attend.refresh_token,
    user: session.user,
  });
  return session;
}

export async function logout() {
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) {
      await apiRequest("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refreshToken }),
      });
    }
  } catch {
    // Attend treats an unknown or revoked token as logged out; clear the browser session on network errors too.
  } finally {
    clearSession();
  }
}

