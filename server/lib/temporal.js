// Temporal re-export. Until Bun ships the Temporal API natively (or we move
// to a runtime that does), we use the official polyfill. Centralising the
// import means the rest of the codebase looks like the future:
//
//   import { Temporal } from "../lib/temporal.js";
//   const now = Temporal.Now.instant().toString();   // ISO 8601 with Z
//
// When the global lands, this file becomes a one-line shim and nothing else
// has to change.

export { Temporal } from "@js-temporal/polyfill";
