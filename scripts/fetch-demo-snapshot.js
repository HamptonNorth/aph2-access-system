#!/usr/bin/env bun
// One-shot: fetch the demo gym snapshot from the public URL, resize it to a
// reasonable size, and save it to media/gym-demo.jpg. The DVR film-strip
// then serves frames from this local copy instead of hammering the external
// host on every demo session.
//
// Re-running the script overwrites the file. Safe to run multiple times.
//
// Usage:
//   bun run scripts/fetch-demo-snapshot.js
//
// The source URL is configurable via the SOURCE_URL env var if you ever
// want to point this at a different placeholder.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

const SOURCE_URL =
  process.env.SOURCE_URL ||
  "https://aphclient.redmug.dev/media/gym3_large.jpg";

const OUT_DIR = resolve(projectRoot, "media");
const OUT_FILE = resolve(OUT_DIR, "gym-demo.jpg");

console.log(`fetching ${SOURCE_URL}`);
const res = await fetch(SOURCE_URL);
if (!res.ok) {
  console.error(`fetch failed: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const buf = new Uint8Array(await res.arrayBuffer());
console.log(`downloaded ${buf.byteLength.toLocaleString()} bytes`);

mkdirSync(OUT_DIR, { recursive: true });

// Resize to 800px wide max, JPEG quality 75. `withoutEnlargement` means a
// source smaller than 800px is left alone instead of being scaled up.
const out = await sharp(buf)
  .resize({ width: 800, withoutEnlargement: true })
  .jpeg({ quality: 75 })
  .toBuffer();

writeFileSync(OUT_FILE, out);
console.log(`wrote ${OUT_FILE} (${out.byteLength.toLocaleString()} bytes)`);
