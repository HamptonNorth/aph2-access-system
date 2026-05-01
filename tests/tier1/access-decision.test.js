// Tests for the pure access-decision function. Stub the queries object so we
// can drive every branch without a database.

import { describe, it, expect } from "bun:test";
import { decide } from "../../server/services/access-decision.js";

function makeQueries({ user = null, lastGranted = null } = {}) {
  return {
    findUserByFob:           () => user,
    lastGrantedAccessForFob: () => lastGranted,
  };
}

const baseEvent = {
  fobNumber: "0000001234",
  timestamp: "2026-05-01T12:00:00.000Z",
};
const config = { passbackMinutes: 2 };

describe("access-decision.decide", () => {
  it("returns 'unknown' when no user has the fob", () => {
    const result = decide(baseEvent, makeQueries(), config);
    expect(result).toEqual({ outcome: "unknown", userId: null });
  });

  it("returns 'blocked' when the user is blocked, even with no prior swipes", () => {
    const queries = makeQueries({ user: { id: 9, blocked: 1 } });
    const result = decide(baseEvent, queries, config);
    expect(result).toEqual({ outcome: "blocked", userId: 9 });
  });

  it("returns 'blocked' even if also inside the passback window", () => {
    // 'blocked' is more diagnostic than 'passback' so it wins.
    const queries = makeQueries({
      user: { id: 9, blocked: 1 },
      lastGranted: { ts: "2026-05-01T11:59:00.000Z" }, // 1 min ago
    });
    const result = decide(baseEvent, queries, config);
    expect(result.outcome).toBe("blocked");
  });

  it("returns 'granted' for an allowed user with no prior swipe", () => {
    const queries = makeQueries({ user: { id: 7, blocked: 0 } });
    const result = decide(baseEvent, queries, config);
    expect(result).toEqual({ outcome: "granted", userId: 7 });
  });

  it("returns 'granted' if the last grant is older than the passback window", () => {
    const queries = makeQueries({
      user: { id: 7, blocked: 0 },
      lastGranted: { ts: "2026-05-01T11:55:00.000Z" }, // 5 min ago, window is 2
    });
    const result = decide(baseEvent, queries, config);
    expect(result.outcome).toBe("granted");
  });

  it("returns 'passback' if the last grant is inside the passback window", () => {
    const queries = makeQueries({
      user: { id: 7, blocked: 0 },
      lastGranted: { ts: "2026-05-01T11:59:00.000Z" }, // 1 min ago
    });
    const result = decide(baseEvent, queries, config);
    expect(result).toEqual({ outcome: "passback", userId: 7 });
  });

  it("uses a strict less-than for the passback window (boundary = granted)", () => {
    // Exactly passbackMinutes ago counts as outside the window.
    const queries = makeQueries({
      user: { id: 7, blocked: 0 },
      lastGranted: { ts: "2026-05-01T11:58:00.000Z" }, // exactly 2 min ago
    });
    const result = decide(baseEvent, queries, config);
    expect(result.outcome).toBe("granted");
  });

  it("ignores future-dated 'last grant' rows (clock skew safety)", () => {
    // A clock-skewed last grant in the future would make the diff negative;
    // treating that as 'granted' avoids locking out users when the controller
    // jumps ahead.
    const queries = makeQueries({
      user: { id: 7, blocked: 0 },
      lastGranted: { ts: "2026-05-01T12:05:00.000Z" }, // 5 min in the future
    });
    const result = decide(baseEvent, queries, config);
    expect(result.outcome).toBe("granted");
  });
});
