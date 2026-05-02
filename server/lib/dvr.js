// DVR (HikVision ISAPI) integration.
//
// Today this module runs in DEMO mode only - we have no controller on the
// network yet. Demo mode returns the same placeholder image for every
// frame in the strip; the timestamps are real (centred on the swipe), so
// the UI can be exercised end-to-end. When the DVR comes online we'll
// implement `live` mode against the HikVision ISAPI image-by-time
// endpoint, e.g.:
//
//   GET http://<host>/ISAPI/Streaming/channels/<chan>01/picture
//       ?starttime=YYYYMMDDTHHMMSSZ&endtime=YYYYMMDDTHHMMSSZ
//
// Until then, calling buildFilmStrip with mode = "live" throws on
// purpose so we notice the missing wiring rather than silently doing
// something half-right.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(here, "..", "..", "config", "client.json");

const DEFAULTS = {
  mode: "demo",
  demo_image_url: "",
  frame_count: 5,
  frame_interval_seconds: 4,
  // Demo-only artificial latency window so the spinner in the UI has
  // something to do - real DVRs aren't instantaneous.
  demo_min_latency_ms: 500,
  demo_max_latency_ms: 2500,
};

// Read on every call so a sysadmin can edit config/client.json without
// restarting. The config file is tiny; no point caching.
function readDvrConfig() {
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    return { ...DEFAULTS, ...(raw.dvr ?? {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Build a film strip of evenly-spaced frames around a swipe timestamp.
 * Frames are centred on the swipe: with count=5 and interval=4s, the
 * offsets are -8s, -4s, 0s, +4s, +8s.
 *
 * In demo mode the function awaits a random delay between
 * demo_min_latency_ms and demo_max_latency_ms so the UI spinner has
 * something to do. Real ISAPI fetches will provide their own latency.
 *
 * @param {string} swipeIso  ISO 8601 timestamp of the access_log row.
 * @returns {Promise<{ mode: string, frames: Array<{ts: string, url: string}> }>}
 */
export async function buildFilmStrip(swipeIso) {
  const dvr = readDvrConfig();
  const count    = Math.max(1, Number(dvr.frame_count) || 5);
  const interval = Math.max(1, Number(dvr.frame_interval_seconds) || 4);
  const halfBefore = Math.floor(count / 2);

  const swipeMs = Date.parse(swipeIso);
  if (!Number.isFinite(swipeMs)) {
    throw new Error(`buildFilmStrip: invalid swipe timestamp: ${swipeIso}`);
  }

  if (dvr.mode === "demo") {
    const lo = Math.max(0, Number(dvr.demo_min_latency_ms) || 0);
    const hi = Math.max(lo, Number(dvr.demo_max_latency_ms) || lo);
    const delay = lo + Math.random() * (hi - lo);
    await new Promise((r) => setTimeout(r, delay));
  }

  const frames = [];
  for (let i = 0; i < count; i++) {
    const offsetMs = (i - halfBefore) * interval * 1000;
    const ts = new Date(swipeMs + offsetMs).toISOString();
    frames.push({ ts, url: frameUrl(dvr, ts, i) });
  }

  return { mode: dvr.mode, frames };
}

function frameUrl(dvr, _isoTs, frameIndex) {
  if (dvr.mode === "demo") {
    // demo_image_url may contain a "{i}" placeholder so each frame in the
    // strip can map to a distinct file (e.g. /media/gym-demo-1.jpg through
    // /media/gym-demo-5.jpg). When no placeholder is present, all frames
    // share the same URL.
    const tmpl = dvr.demo_image_url || "";
    return tmpl.replace("{i}", String(frameIndex + 1));
  }
  // The live integration goes here. Build a HikVision ISAPI URL from
  // dvr.host / dvr.channel / credentials and the timestamp - then either
  // return that URL (and let the browser fetch it directly with auth) or
  // proxy through this server. Throw for now so silent misconfiguration
  // can't leak production-shaped responses for a demo install.
  throw new Error(`live DVR mode not implemented yet (got mode=${dvr.mode})`);
}
