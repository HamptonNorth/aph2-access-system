// Runtime-tunable client config, served from config/client.json. Read on
// every request (no in-process caching) so a sysadmin can edit the file
// on disk and the next page load picks it up - no rebuild or restart.
//
// We strip server-only knobs (controller IP/port, listener host) before
// returning the JSON so they aren't leaked to a curious browser.

import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const routes = new Hono();

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(here, "..", "..", "config", "client.json");

function readClient() {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    // Whitelist: only return knobs that are safe for the browser to know.
    return {
      app: raw.app ?? {},
      passback_minutes: raw.passback_minutes ?? 2,
      session_hours:    raw.session_hours ?? 12,
    };
  } catch {
    return { app: { name: "APH2 Access" }, passback_minutes: 2, session_hours: 12 };
  }
}

routes.get("/client", (c) => c.json(readClient()));

export default routes;
