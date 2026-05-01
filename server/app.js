// Builds the Hono app: global middleware, route groups, fallbacks. New
// resource route files are mounted here as they land.

import { Hono } from "hono";

import { auth } from "./middleware/auth.js";
import { logging } from "./middleware/logging.js";

import authRoutes from "./routes/auth.js";
import adminUserRoutes from "./routes/admin-users.js";
import userRoutes from "./routes/users.js";
import groupRoutes from "./routes/groups.js";
import accessLogRoutes from "./routes/access-log.js";

const app = new Hono();

// Cross-cutting middleware runs for every request.
app.use("*", logging());
app.use("*", auth());

// Health check - used by smoke tests and uptime probes.
app.get("/api/health", (c) => c.text("ok"));

app.route("/api/auth",         authRoutes);
app.route("/api/admin-users",  adminUserRoutes);
app.route("/api/users",        userRoutes);
app.route("/api/groups",       groupRoutes);
app.route("/api/access-log",   accessLogRoutes);

// Phase 3 will land the Lit client bundle here. For now, anything outside
// /api/ gets a friendly stub so curl_tests's require_server check passes.
app.get("/", (c) => {
  c.header("Cache-Control", "no-cache");
  return c.text("aph2-access-system server running. Client UI ships in Phase 3.");
});

// Fallbacks: always JSON for API paths so the client never has to parse HTML.
app.notFound((c) => c.json({ error: "not found" }, 404));

app.onError((err, c) => {
  console.error("unhandled error:", err);
  return c.json({ error: err.message || "server error" }, 500);
});

export default app;
