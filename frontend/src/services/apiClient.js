const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api/v1"
).replace(/\/+$/, "");

export async function apiRequest(path, options = {}) {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;

  const headers = {
    Accept: "application/json",
    ...(options.body instanceof FormData
      ? {}
      : options.body
      ? { "Content-Type": "application/json" }
      : {}),
    ...options.headers,
  };

  let response;

  try {
    response = await fetch(url, { ...options, headers });
  } catch (error) {
    if (error.name === "AbortError") throw error;

    console.error("Fetch failed:", url, error);
    throw new Error(
      `Unable to connect to the backend at ${API_BASE_URL}. ` +
        "Check that the backend is running and CORS is configured."
    );
  }

  const raw = await response.text();
  let payload = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.message ||
      (typeof payload === "string" ? payload : null) ||
      `Request failed with status ${response.status}`;

    throw new Error(message);
  }

  // Backend response format: { success: true, data: ... }
  if (
    payload &&
    typeof payload === "object" &&
    Object.prototype.hasOwnProperty.call(payload, "data")
  ) {
    return payload.data;
  }

  return payload;
}

export { API_BASE_URL };