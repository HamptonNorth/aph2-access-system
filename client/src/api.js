// Thin wrapper around fetch() for every /api/* call. Centralises:
//   * the /api prefix
//   * credentials: "same-origin" so the session cookie goes along
//   * JSON parsing and Content-Type headers
//   * a uniform ApiError thrown on non-2xx responses
//   * "session expired" handling: any 401 reloads the page, which boots us
//     back to the login screen via main.js
//
// Returns the parsed JSON body on success; throws ApiError on failure.

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, body) {
  const init = {
    method,
    credentials: "same-origin",
    headers: {},
    // Some browsers (notably Safari + iOS) will happily re-serve a
    // recent GET out of the bfcache or HTTP cache for an admin's
    // back-navigation, leading to "I just edited that, why is the
    // list stale?" reports. The API never emits cache-control
    // headers, so be explicit on the read side.
    cache: "no-store",
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, init);

  // Session expired or never existed -> reload to hit the login screen.
  if (res.status === 401 && path !== "/auth/login") {
    location.reload();
    throw new ApiError(401, "not authenticated");
  }

  const ctype = res.headers.get("content-type") ?? "";
  const data = ctype.includes("application/json") ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? res.statusText, data);
  }
  return data;
}

export const apiGet    = (path)       => request("GET",    path);
export const apiPost   = (path, body) => request("POST",   path, body);
export const apiPut    = (path, body) => request("PUT",    path, body);
export const apiDelete = (path)       => request("DELETE", path);
