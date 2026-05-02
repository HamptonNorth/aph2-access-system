// Client entry point. Fetches the current session, picks the top-level view
// based on it, and (if signed in) wires the hash router to the outlet inside
// <app-shell>.

import "./components/app-shell.js";
import "./components/auth-login.js";
import "./components/home-view.js";

import "./components/users-list.js";
import "./components/users-form.js";

import "./components/groups-list.js";
import "./components/groups-form.js";

import "./components/admin-users-list.js";
import "./components/admin-users-form.js";

import "./components/access-log-page.js";
import "./components/controller-status.js";
import "./components/film-strip-dialog.js";

import { checkSession, getAdmin, loadClientConfig } from "./store.js";
import { route, setDefault, start as startRouter } from "./router.js";

async function boot() {
  const app = document.getElementById("app");
  await checkSession();
  const admin = getAdmin();

  // Runtime-tunable client config (passback minutes, app name, ...). Loaded
  // after the session check so logged-out users skip the needless fetch.
  if (admin) await loadClientConfig();

  app.innerHTML = "";

  if (!admin) {
    app.appendChild(document.createElement("auth-login"));
    return;
  }

  const shell = document.createElement("app-shell");
  app.appendChild(shell);

  // Shell renders asynchronously; wait a tick so the outlet exists.
  await Promise.resolve();

  defineRoutes();
  startRouter();
}

// The router resolves a hash to a DOM element and drops it into the outlet
// inside <app-shell>. Each route creates a fresh element so component state
// never leaks between views.
function mount(tag, props = {}) {
  const outlet = document.getElementById("outlet");
  if (!outlet) return;
  const el = document.createElement(tag);
  Object.assign(el, props);
  outlet.replaceChildren(el);
}

function defineRoutes() {
  route("/", () => mount("home-view"));

  route("/users",          () => mount("users-list"));
  route("/users/new",      () => mount("users-form"));
  route("/users/:id/edit", ({ id }) => mount("users-form", { userId: Number(id) }));

  route("/groups",          () => mount("groups-list"));
  route("/groups/new",      () => mount("groups-form"));
  route("/groups/:id/edit", ({ id }) => mount("groups-form", { groupId: Number(id) }));

  route("/admin-users",          () => mount("admin-users-list"));
  route("/admin-users/new",      () => mount("admin-users-form"));
  route("/admin-users/:id/edit", ({ id }) => mount("admin-users-form", { adminUserId: Number(id) }));

  route("/access-log",  () => mount("access-log-page"));
  route("/controller",  () => mount("controller-status"));

  setDefault(() => mount("home-view"));
}

// Listen for a custom event fired after successful login/logout so we can
// re-boot without a full page reload. Falls back to location.reload() when
// anything weird happens.
window.addEventListener("aph-auth-changed", () => boot());

boot();
