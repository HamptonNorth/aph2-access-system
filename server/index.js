// Server entrypoint. Boots the UDP listener and the HTTP server side by side.
// Phase 1 had only the UDP listener; Phase 2 adds Hono via Bun.serve.

import app from "./app.js";
import config from "./config.js";
import { startUdpListener } from "./services/udp-listener.js";

const udpSocket = await startUdpListener({
  host: config.udp.host,
  port: config.udp.port,
  config: { passbackMinutes: config.passbackMinutes },
});

const httpServer = Bun.serve({
  hostname: config.http.host,
  port: config.http.port,
  fetch: app.fetch,
});
console.log(`[http] listening on ${httpServer.hostname}:${httpServer.port}`);

// Graceful shutdown: close both listeners so the OS releases the ports.
function shutdown(signal) {
  console.log(`[server] received ${signal}, closing`);
  udpSocket.close();
  httpServer.stop();
  process.exit(0);
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
