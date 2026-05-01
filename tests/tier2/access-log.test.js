// Access-log queries with filters. Seeds access_log via the existing
// handlePacket pipeline so the test exercises the full path.

import { describe, it, expect, beforeAll } from "bun:test";

import { loginAs } from "./setup.js";
import { encodeSwipeEvent } from "../../server/lib/uhppote-protocol.js";
import { handlePacket } from "../../server/services/udp-listener.js";

const config = { passbackMinutes: 2 };

beforeAll(() => {
  // Seed a handful of swipes across both seeded users + an unknown fob.
  handlePacket(
    encodeSwipeEvent({
      controllerSn: 1, eventIndex: 1, cardNumber: 1, granted: true,
      timestamp: new Date("2026-04-01T09:00:00Z"),
    }),
    config,
  );
  handlePacket(
    encodeSwipeEvent({
      controllerSn: 1, eventIndex: 2, cardNumber: 1, granted: true,
      timestamp: new Date("2026-04-02T09:00:00Z"),
    }),
    config,
  );
  handlePacket(
    encodeSwipeEvent({
      controllerSn: 1, eventIndex: 3, cardNumber: 2, granted: false,
      timestamp: new Date("2026-04-02T10:00:00Z"),
    }),
    config,
  );
  handlePacket(
    encodeSwipeEvent({
      controllerSn: 1, eventIndex: 4, cardNumber: 9999, granted: false,
      timestamp: new Date("2026-04-03T11:00:00Z"),
    }),
    config,
  );
});

// All filters combine with this date window so we only see the 4 swipes the
// beforeAll seeded - other suites running in the same process write rows
// outside this window (e.g. udp-flow.test.js uses 2026-05).
const SEED_RANGE = "from=2026-04-01T00:00:00Z&to=2026-04-04T00:00:00Z";

describe("access-log filters", () => {
  it("no filters returns rows newest first", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.get(`/api/access-log?${SEED_RANGE}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_log.length).toBe(4);
    const ts = body.access_log.map((r) => r.ts);
    expect(ts).toEqual([...ts].sort().reverse());
  });

  it("date range filters work", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.get("/api/access-log?from=2026-04-02T00:00:00Z&to=2026-04-02T23:59:59Z");
    const body = await res.json();
    expect(body.access_log.every((r) => r.ts.startsWith("2026-04-02"))).toBe(true);
    expect(body.access_log.length).toBe(2);
  });

  it("user_id filter returns only that user's rows", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.get(`/api/access-log?user_id=1&${SEED_RANGE}`);
    const body = await res.json();
    expect(body.access_log.every((r) => r.user_id === 1)).toBe(true);
    expect(body.access_log.length).toBe(2);
  });

  it("group_id filter returns only that group's rows", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.get(`/api/access-log?group_id=1&${SEED_RANGE}`);  // Trustees, contains Alice (id=1)
    const body = await res.json();
    expect(body.access_log.every((r) => r.group_id === 1)).toBe(true);
  });

  it("outcome filter rejects unknown values", async () => {
    const a = await loginAs("admin", "adminpw");
    const res = await a.get("/api/access-log?outcome=banana");
    expect(res.status).toBe(400);
  });

  it("403 if the admin lacks view_reports", async () => {
    // usermgr admin has manage_users but not view_reports.
    const a = await loginAs("usermgr", "usermgrpw");
    const res = await a.get("/api/access-log");
    expect(res.status).toBe(403);
  });
});
