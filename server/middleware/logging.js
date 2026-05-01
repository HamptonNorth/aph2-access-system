// One line per request: method, path, status, elapsed ms. Good enough for
// troubleshooting during the phased rollout; we can bolt on structured logs
// later if we ever need them.

export function logging() {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const ms = (performance.now() - start).toFixed(1);
    console.log(`${c.req.method} ${c.req.path} -> ${c.res.status} (${ms}ms)`);
  };
}
