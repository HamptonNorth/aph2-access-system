// Server-side runtime config. Reads config/client.json (the file the eventual
// client also gets via /api/config/client) plus a couple of env overrides
// that don't belong in a checked-in JSON file.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(
  readFileSync(resolve(here, "..", "config", "client.json"), "utf8"),
);

export default {
  http: {
    host: raw.http.host,
    port: Number(process.env.PORT) || raw.http.port,
  },
  udp: {
    host: raw.udp.host,
    port: Number(process.env.UDP_PORT) || raw.udp.port,
  },
  passbackMinutes: raw.passback_minutes,
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS) || raw.session_hours,

  // Cookie Secure flag. Off in dev (so cookies work over plain http://localhost),
  // on in production (set COOKIE_SECURE=1 in the systemd unit).
  cookieSecure: process.env.COOKIE_SECURE === "1",

  controller: raw.controller,
  app: raw.app,
};
