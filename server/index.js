// Server entrypoint. Boots the UDP listener and the HTTP server side by side.
// Phase 1 had only the UDP listener; Phase 2 adds Hono via Bun.serve.

import app from "./app.js";
import config from "./config.js";
import { startUdpListener } from "./services/udp-listener.js";
import { startHealthCheck, stopHealthCheck } from "./services/controller-health.js";

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
// Print the URL in the click-through form most terminals (VS Code, iTerm,
// modern GNOME / Kitty, …) turn into a Ctrl/Cmd-click link. We always use
// `localhost` here even when bound to 0.0.0.0, because that's the host the
// dev clicking on the link is most likely to reach.
console.log(`[http] listening on http://localhost:${httpServer.port}`);

// Periodic controller reachability check. Demo-mode for now (see
// services/controller-health.js); the resulting state surfaces on the
// /api/controller/status endpoint.
startHealthCheck({
  intervalSeconds: config.controller?.health_check_interval_seconds ?? 60,
});

// Graceful shutdown: close both listeners so the OS releases the ports.
function shutdown(signal) {
  console.log(`[server] received ${signal}, closing`);
  stopHealthCheck();
  udpSocket.close();
  httpServer.stop();
  process.exit(0);
}
process.on("SIGINT",  () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
