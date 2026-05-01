// Server entrypoint. Phase 1 only starts the UDP listener (no HTTP yet).
// Phase 2 will add `import app from "./app.js"; Bun.serve({ fetch: app.fetch })`
// alongside.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { startUdpListener } from "./services/udp-listener.js";

const here = dirname(fileURLToPath(import.meta.url));

// Runtime config lives in config/client.json (shared with the eventual
// client bundle). Edit + restart - no rebuild needed.
const configPath = resolve(here, "..", "config", "client.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

const udpSocket = await startUdpListener({
  host: config.udp.host,
  port: config.udp.port,
  config: { passbackMinutes: config.passback_minutes },
});

// Graceful shutdown: close the socket so the OS releases the port if the
// process exits cleanly. Bun delivers SIGINT on Ctrl-C.
function shutdown(signal) {
  console.log(`[server] received ${signal}, closing`);
  udpSocket.close();
  process.exit(0);
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
