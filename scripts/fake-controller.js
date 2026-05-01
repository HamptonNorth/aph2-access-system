#!/usr/bin/env bun
// Mimic an UHPPOTE controller pushing a swipe event over UDP to the local
// listener. Used for manual testing during Phase 1 (no real hardware needed)
// and re-used inside the tier-2 test setup.
//
// Usage:
//   bun run scripts/fake-controller.js <fob_number> [--denied] [--door 1]
//                                                   [--direction in|out]
//                                                   [--host 127.0.0.1]
//                                                   [--port 60000]
//                                                   [--sn 423187757]
//
// Examples:
//   bun run scripts/fake-controller.js 0001234567
//   bun run scripts/fake-controller.js 0001234567 --denied
//   bun run scripts/fake-controller.js 0001234567 --door 2 --direction out

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { encodeSwipeEvent } from "../server/lib/uhppote-protocol.js";

const here = dirname(fileURLToPath(import.meta.url));

// Pull defaults from the same config the server reads.
const configPath = resolve(here, "..", "config", "client.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));

// Trivial CLI parser - keeps the script self-contained.
function parseArgs(argv) {
  const args = { granted: true };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--denied")    { args.granted = false; i += 1; continue; }
    if (a === "--door")      { args.door = Number(argv[++i]); i += 1; continue; }
    if (a === "--direction") { args.direction = argv[++i]; i += 1; continue; }
    if (a === "--host")      { args.host = argv[++i]; i += 1; continue; }
    if (a === "--port")      { args.port = Number(argv[++i]); i += 1; continue; }
    if (a === "--sn")        { args.sn = Number(argv[++i]); i += 1; continue; }
    if (a === "--event-index") { args.eventIndex = Number(argv[++i]); i += 1; continue; }
    if (a === "--at")        { args.at = argv[++i]; i += 1; continue; }
    if (!args.fob && /^\d+$/.test(a)) { args.fob = a; i += 1; continue; }
    console.error(`unknown argument: ${a}`);
    process.exit(2);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.fob) {
  console.error("usage: bun run scripts/fake-controller.js <fob_number> [--denied] [--door N] ...");
  process.exit(2);
}

const directionByte = args.direction === "out" ? 2 : 1;

const packet = encodeSwipeEvent({
  controllerSn: args.sn ?? config.controller.serial_number,
  eventIndex:   args.eventIndex ?? Math.floor(Math.random() * 1_000_000),
  cardNumber:   Number(args.fob),
  granted:      args.granted,
  door:         args.door ?? 1,
  direction:    directionByte,
  timestamp:    args.at ? new Date(args.at) : new Date(),
});

const host = args.host ?? "127.0.0.1";
const port = args.port ?? config.udp.port;

// Bun.udpSocket needs a `socket.data` handler even for a send-only client.
const sock = await Bun.udpSocket({
  socket: { data() { /* no responses expected */ } },
});
sock.send(packet, port, host);

console.log(
  `sent fob=${args.fob} ${args.granted ? "granted" : "denied"} -> ${host}:${port}`
);

// Give the kernel a moment to flush before exiting.
setTimeout(() => sock.close(), 50);
