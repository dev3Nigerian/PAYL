// Server-side login transport. Never import this module into a client component.
type JsonObject = Record<string, unknown>;
type LoginFailure = { ok: false; status: number; body: { error: { code: string; message: string; retryable: boolean } }; headers: Record<string, string> };
type LoginResult =
  | { ok: true; status: number; body: JsonObject & { sessionToken: string } }
  | LoginFailure;

const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 15_000;
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

// Check the API before skipping a form: an expired cookie must not cause a
// login -> dashboard -> login redirect loop. Failures leave sign-in available.
export async function hasActiveWebSession(apiUrl: string, token: string | undefined, role: "consumer" | "merchant_admin"): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetch(new URL("/api/auth/session", apiUrl), {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const session: unknown = await response.json();
    return isObject(session) && typeof session.userId === "string" && session.userId.length > 0 && session.role === role;
  } catch {
    return false;
  }
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function failure(status: number, code: string, message: string, retryable: boolean, retryAfter?: string): LoginFailure {
  return { ok: false, status, body: { error: { code, message, retryable } }, headers: {
    "cache-control": "no-store",
    ...(retryAfter ? { "retry-after": retryAfter } : {}),
  } };
}

export function loginUnavailable(): LoginFailure {
  return failure(503, "API_UNAVAILABLE", "Antspace is waking up or temporarily unavailable. Wait a moment, then try signing in again.", true, "15");
}

export async function requestLogin(apiUrl: string, input: { email: unknown; password: unknown; role: "consumer" | "merchant_admin" }): Promise<LoginResult> {
  // A trailing slash in Render's base URL must not turn this into //api/auth/login.
  const endpoint = new URL("/api/auth/login", apiUrl);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429) {
        await response.body?.cancel().catch(() => undefined);
        return failure(429, "RATE_LIMITED", "Too many sign-in attempts. Please wait before trying again.", true, response.headers.get("retry-after") ?? "60");
      }
      let text: string;
      try { text = await response.text(); }
      catch (error) {
        // The status is already conclusive for a rejected login even if its
        // error body is interrupted. Do not consume more authentication attempts.
        if (!response.ok && !TRANSIENT_STATUSES.has(response.status)) return failure(response.status, "SIGN_IN_FAILED", "Sign-in failed. Please check your details and try again.", false);
        throw error;
      }
      let body: unknown;
      try { body = JSON.parse(text); } catch { body = null; }

      // Render can return an HTML startup/error page even with a 200 status.
      // Retry only transient provider failures, never rejected credentials.
      if (TRANSIENT_STATUSES.has(response.status) || (response.ok && !isObject(body))) {
        console.warn("Antspace login upstream unavailable", { attempt: attempt + 1, status: response.status, contentType: response.headers.get("content-type")?.split(";", 1)[0] ?? "unknown" });
      } else if (!response.ok) {
        if (isObject(body) && isObject(body.error)) {
          return failure(response.status, typeof body.error.code === "string" ? body.error.code : "SIGN_IN_FAILED", typeof body.error.message === "string" ? body.error.message : "Sign-in failed. Please try again.", body.error.retryable === true);
        }
        return failure(502, "AUTH_UPSTREAM_ERROR", "The sign-in service returned an unexpected response. Please contact the sandbox owner if this continues.", false);
      } else if (isObject(body) && typeof body.sessionToken === "string" && body.sessionToken.length > 0) {
        return { ok: true, status: response.status, body: { ...body, sessionToken: body.sessionToken } };
      } else {
        return failure(502, "AUTH_UPSTREAM_ERROR", "The sign-in service did not return a valid session. Please try again.", false);
      }
    } catch {
      // Do not log credentials, response bodies, or provider error text.
      console.warn("Antspace login upstream unavailable", { attempt: attempt + 1, status: "network_error" });
    }
    if (attempt + 1 < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return loginUnavailable();
}
