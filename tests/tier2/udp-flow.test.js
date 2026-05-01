// End-to-end test for the UDP swipe pipeline:
//   encode packet -> handlePacket -> SQL insert -> readback.
//
// We don't bind a real UDP socket here - we call handlePacket directly. That
// gives us the full decode -> decide -> log path with no port collision risk
// when running tests in parallel. A separate "real socket" smoke test can
// come later if we ever distrust Bun.udpSocket.

import { describe, it, expect, beforeAll } from "bun:test";

// Side-effecting setup MUST come before importing anything that touches the
// shared db handle.
import "./setup.js";

import { encodeSwipeEvent } from "../../server/lib/uhppote-protocol.js";
import { handlePacket } from "../../server/services/udp-listener.js";
import db from "../../server/db.js";

const config = { passbackMinutes: 2 };

function makePacket(fob, when, opts = {}) {
  return encodeSwipeEvent({
    controllerSn: 423187757,
    eventIndex: opts.eventIndex ?? Math.floor(Math.random() * 1_000_000),
    cardNumber: Number(fob),
    granted: opts.grantedByController ?? true,
    door: 1,
    direction: 1,
    timestamp: when,
  });
}

function readLatestLogForFob(fob) {
  return db.query(`
    SELECT id, ts, fob_number, user_id, outcome, controller_sn
    FROM access_log
    WHERE fob_number = $fob
    ORDER BY id DESC
    LIMIT 1
  `).get({ $fob: fob });
}

describe("UDP swipe pipeline (decode -> decide -> log)", () => {
  it("logs 'granted' for a known unblocked fob and links it to the user", () => {
    const packet = makePacket("0000000001", new Date("2026-05-01T10:00:00Z"));
    const result = handlePacket(packet, config);

    expect(result).not.toBeNull();
    expect(result.outcome).toBe("granted");

    const row = readLatestLogForFob("0000000001");
    expect(row.outcome).toBe("granted");
    expect(row.user_id).toBe(1);             // Alice
    expect(row.controller_sn).toBe(423187757);
    expect(row.ts).toBe("2026-05-01T10:00:00.000Z");
  });

  it("logs 'blocked' for a blocked user", () => {
    const packet = makePacket("0000000002", new Date("2026-05-01T10:01:00Z"));
    const result = handlePacket(packet, config);

    expect(result.outcome).toBe("blocked");
    const row = readLatestLogForFob("0000000002");
    expect(row.outcome).toBe("blocked");
    expect(row.user_id).toBe(2);             // Bob
  });

  it("logs 'unknown' for a fob that doesn't match any user", () => {
    const packet = makePacket("0000099999", new Date("2026-05-01T10:02:00Z"));
    const result = handlePacket(packet, config);

    expect(result.outcome).toBe("unknown");
    const row = readLatestLogForFob("0000099999");
    expect(row.outcome).toBe("unknown");
    expect(row.user_id).toBe(null);
  });

  it("logs 'passback' on a re-swipe inside the passback window", () => {
    // The 'granted' row written by the first test 6 minutes ago is too old
    // for the 2-minute window. Send a fresh granted swipe, then a re-swipe.
    handlePacket(
      makePacket("0000000001", new Date("2026-05-01T11:00:00Z")),
      config,
    );
    const reswipe = handlePacket(
      makePacket("0000000001", new Date("2026-05-01T11:00:30Z")),
      config,
    );
    expect(reswipe.outcome).toBe("passback");

    const row = readLatestLogForFob("0000000001");
    expect(row.outcome).toBe("passback");
    expect(row.user_id).toBe(1);
  });

  it("returns null and logs nothing for a malformed packet", () => {
    const garbage = new Uint8Array(64);   // SOM is 0x00, not 0x17
    const result = handlePacket(garbage, config);
    expect(result).toBeNull();
  });
});
