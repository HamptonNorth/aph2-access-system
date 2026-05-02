// Tiny hash-based router. URLs look like http://.../#/users/5/edit . The
// browser never re-requests the server on a hash change, so this is purely
// client-side.
//
// Usage:
//   import { route, start, go } from "./router.js";
//   route("/",                () => render(<home>));
//   route("/users",           () => render(<list>));
//   route("/users/:id/edit",  ({ id }) => render(<form id=id>));
//   start();
//
// Patterns are simple: ":name" captures a path segment. No wildcards,
// no optional groups. Enough for a small admin app.

const routes = [];
let defaultHandler = null;

export function route(pattern, handler) {
  const regex = new RegExp(
    "^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"
  );
  routes.push({ regex, handler });
}

export function setDefault(handler) {
  defaultHandler = handler;
}

export function go(path) {
  const target = "#" + path;
  if (location.hash === target) {
    // Same hash -> no hashchange event -> resolve manually.
    resolve();
  } else {
    location.hash = target;
  }
}

export function start() {
  window.addEventListener("hashchange", resolve);
  resolve();
}

function resolve() {
  const path = location.hash.slice(1) || "/";
  for (const { regex, handler } of routes) {
    const m = path.match(regex);
    if (m) {
      handler(m.groups ?? {});
      return;
    }
  }
  if (defaultHandler) defaultHandler();
}
