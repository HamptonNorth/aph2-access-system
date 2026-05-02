// Periodic UHPPOTE controller reachability check. The server pings the
// board every N seconds via the get-status command (function 0x20) and
// keeps the result in a small in-memory ring buffer. The /api/controller/
// status endpoint reads this buffer so the UI can show "online / offline /
// unknown" alongside the sync-queue counts.
//
// Today this runs in DEMO mode only - we have no controller on the network
// yet. Demo pings randomly succeed (95%) with 5-50 ms latency, or fail
// outright. When real hardware comes online, swap pingDemo() for the
// real UDP round-trip.

import config from "../config.js";
import { Temporal } from "../lib/temporal.js";

// Cap recent[]: we keep ~50 in memory so a small sparkline can show the
// last few hours of activity without unbounded growth on long-running
// processes.
const RECENT_CAP = 50;

const state = {
  // 'up'      - last ping returned a response within the timeout
  // 'down'    - last ping did not return a response
  // 'unknown' - no pings completed yet (boot before first tick)
  status: "unknown",
  last_pinged_at:        null,   // ISO 8601 of the last ping ATTEMPT
  last_response_at:      null,   // ISO 8601 of the last successful response
  last_latency_ms:       null,   // round-trip ms on the last successful ping
  consecutive_failures:  0,
  ping_count:            0,
  recent:                [],     // newest first; each entry { ts, ok, latency_ms, error }
};

let intervalHandle = null;

// ---- demo / live ping implementations ----

async function pingDemo() {
  const ts = Temporal.Now.instant().toString();
  const ok = Math.random() < 0.95;
  if (ok) {
    const latency = 5 + Math.random() * 45;
    // Sleep so the response timestamp meaningfully follows the ping.
    await new Promise((r) => setTimeout(r, latency));
    return { ts, ok: true, latency_ms: Math.round(latency), error: null };
  }
  return { ts, ok: false, latency_ms: null, error: "no response within 3s" };
}

async function pingLive() {
  // Real UHPPOTE 0x20 (get-status) round-trip goes here. Until then,
  // throw on misconfiguration so we notice rather than silently drifting
  // into a fake-up state.
  throw new Error("live controller health check not implemented yet");
}

// ---- public surface ----

function recordResult(r) {
  state.last_pinged_at = r.ts;
  state.ping_count += 1;
  if (r.ok) {
    state.status = "up";
    state.last_response_at = r.ts;
    state.last_latency_ms = r.latency_ms;
    state.consecutive_failures = 0;
  } else {
    state.status = "down";
    state.consecutive_failures += 1;
  }
  state.recent.unshift(r);
  if (state.recent.length > RECENT_CAP) state.recent.length = RECENT_CAP;
}

/**
 * Run a single ping NOW and update state. Resolves with the ping result.
 * Errors from the ping function are turned into a `down` record - the
 * health check should never bring down the server even if hardware
 * misbehaves.
 */
export async function pingNow() {
  const isDemo =
    !config.controller || !config.controller.host || config.controller.host === "demo";
  let r;
  try {
    r = isDemo ? await pingDemo() : await pingLive();
  } catch (e) {
    r = {
      ts: Temporal.Now.instant().toString(),
      ok: false,
      latency_ms: null,
      error: e.message ?? String(e),
    };
  }
  recordResult(r);
  return r;
}

/**
 * Schedule a ping every `intervalSeconds` seconds. Idempotent - calling
 * a second time is a no-op. Fires the first ping immediately so the UI
 * has something to show on its first request.
 */
export function startHealthCheck({ intervalSeconds = 60 } = {}) {
  if (intervalHandle) return;
  pingNow().catch((e) => console.error("[health] initial ping error:", e));
  intervalHandle = setInterval(() => {
    pingNow().catch((e) => console.error("[health] ping error:", e));
  }, intervalSeconds * 1000);
  console.log(`[health] controller ping every ${intervalSeconds}s`);
}

export function stopHealthCheck() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * Snapshot for the /api/controller/status endpoint. We slice recent[] to
 * the most recent 20 to keep the JSON payload small.
 */
export function getHealth() {
  return {
    status:               state.status,
    last_pinged_at:       state.last_pinged_at,
    last_response_at:     state.last_response_at,
    last_latency_ms:      state.last_latency_ms,
    consecutive_failures: state.consecutive_failures,
    ping_count:           state.ping_count,
    recent:               state.recent.slice(0, 20),
  };
}
