// Session state. Intentionally tiny - one module-level variable plus two
// functions. Components that need the logged-in admin call getAdmin(); the
// initial boot sequence in main.js calls checkSession() to populate it.

let _admin = null;

// Runtime-tunable client config, fetched from /api/config/client at boot.
// Defaults mirror server/routes/config.js so the UI degrades gracefully
// even if the endpoint is unreachable.
const CONFIG_DEFAULTS = {
  app: { name: "APH2 Access", version: "" },
  passback_minutes: 2,
  session_hours: 12,
  access_log: { default_from_minutes_ago: 60, default_duration_minutes: 20 },
};
let _config = CONFIG_DEFAULTS;

// Fetches /api/auth/me and caches the admin row (or null). Returns what was
// fetched so callers can branch without reading from the store again.
export async function checkSession() {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (res.ok) {
      const data = await res.json();
      _admin = data.admin;
      return _admin;
    }
  } catch {
    // Network errors: treat as "not logged in" for the boot flow.
  }
  _admin = null;
  return null;
}

export function getAdmin() {
  return _admin;
}

export function clearAdmin() {
  _admin = null;
}

// Loaded once at boot after a successful session check. Swallows errors:
// the defaults above stay in place so the app still works if the server
// can't reach the config file for some reason.
export async function loadClientConfig() {
  try {
    const res = await fetch("/api/config/client", { credentials: "same-origin" });
    if (res.ok) _config = await res.json();
  } catch {
    // keep defaults
  }
  return _config;
}

export function getClientConfig() {
  return _config;
}
