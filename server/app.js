// Builds the Hono app: global middleware, route groups, static client
// serving, and fallbacks. New resource route files are mounted here as
// they land.

import { Hono } from "hono";
import { serveStatic } from "hono/bun";

import { auth } from "./middleware/auth.js";
import { logging } from "./middleware/logging.js";

import authRoutes from "./routes/auth.js";
import adminUserRoutes from "./routes/admin-users.js";
import userRoutes from "./routes/users.js";
import groupRoutes from "./routes/groups.js";
import accessLogRoutes from "./routes/access-log.js";
import configRoutes from "./routes/config.js";
import controllerRoutes from "./routes/controller.js";

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
app.route("/api/config",       configRoutes);
app.route("/api/controller",   controllerRoutes);

// Static client bundle. Serves client/dist/index.html for `/` and individual
// asset files below it. If the client hasn't been built yet, serveStatic
// falls through to the friendlier message at the bottom of this file.
//
// onFound sets Cache-Control: no-cache so the browser always revalidates
// after a `client:build`. Without this, Bun.serve sends no cache headers
// and over-caches stale JS/CSS in dev. Production will switch to hashed
// filenames + long caching.
app.use(
  "/*",
  serveStatic({
    root: "./client/dist",
    onFound: (_path, c) => c.header("Cache-Control", "no-cache"),
  }),
);

app.get("/", (c) => {
  c.header("Cache-Control", "no-cache");
  return c.text(
    "aph2-access-system server running. Client bundle not found - run `bun run client:build`.",
  );
});

// Fallbacks: always JSON for API paths so the client never has to parse HTML.
app.notFound((c) => c.json({ error: "not found" }, 404));

app.onError((err, c) => {
  console.error("unhandled error:", err);
  return c.json({ error: err.message || "server error" }, 500);
});

export default app;
