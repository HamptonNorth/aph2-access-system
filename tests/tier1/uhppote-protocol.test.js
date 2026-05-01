// Round-trip and edge-case tests for the UHPPOTE packet encoder/decoder.
// Pure-logic, no DB, no socket - safe to run in any environment.

import { describe, it, expect } from "bun:test";

import {
  encodeSwipeEvent,
  decodeSwipeEvent,
  PROTOCOL_INTERNALS,
} from "../../server/lib/uhppote-protocol.js";

describe("BCD helpers", () => {
  const { toBcd, fromBcd } = PROTOCOL_INTERNALS;

  it("round-trips every value in the documented range", () => {
    for (let n = 0; n <= 99; n += 1) {
      expect(fromBcd(toBcd(n))).toBe(n);
    }
  });

  it("encodes the obvious cases the way the protocol spec says", () => {
    expect(toBcd(0)).toBe(0x00);
    expect(toBcd(7)).toBe(0x07);
    expect(toBcd(24)).toBe(0x24);
    expect(toBcd(99)).toBe(0x99);
  });

  it("rejects out-of-range values", () => {
    expect(() => toBcd(-1)).toThrow();
    expect(() => toBcd(100)).toThrow();
  });
});

describe("encode / decode round-trip", () => {
  it("preserves every documented field for a granted swipe", () => {
    const ts = new Date("2026-05-01T13:24:30Z");
    const packet = encodeSwipeEvent({
      controllerSn: 423187757,
      eventIndex: 42,
      cardNumber: 1234567890,
      granted: true,
      door: 1,
      direction: 1,
      timestamp: ts,
    });

    expect(packet.length).toBe(64);
    expect(packet[0]).toBe(0x17);  // SOM
    expect(packet[1]).toBe(0x20);  // function

    const decoded = decodeSwipeEvent(packet);
    expect(decoded.controllerSn).toBe(423187757);
    expect(decoded.eventIndex).toBe(42);
    expect(decoded.cardNumber).toBe(1234567890);
    expect(decoded.fobNumber).toBe("1234567890");
    expect(decoded.grantedByController).toBe(true);
    expect(decoded.door).toBe(1);
    expect(decoded.direction).toBe(1);
    expect(decoded.timestamp).toBe("2026-05-01T13:24:30.000Z");
  });

  it("preserves a denied swipe and door 2 / direction out", () => {
    // 4294967295 = max uint32 = the largest fob number the UHPPOTE wire
    // protocol can carry (and exactly 10 decimal digits, which is what
    // gets printed on the fob).
    const packet = encodeSwipeEvent({
      controllerSn: 1,
      eventIndex: 1,
      cardNumber: 4294967295,
      granted: false,
      door: 2,
      direction: 2,
      timestamp: new Date("2026-12-31T23:59:59Z"),
    });
    const decoded = decodeSwipeEvent(packet);
    expect(decoded.grantedByController).toBe(false);
    expect(decoded.door).toBe(2);
    expect(decoded.direction).toBe(2);
    expect(decoded.cardNumber).toBe(4294967295);
    expect(decoded.fobNumber).toBe("4294967295");
    expect(decoded.timestamp).toBe("2026-12-31T23:59:59.000Z");
  });

  it("zero-pads short fob numbers to 10 digits", () => {
    const packet = encodeSwipeEvent({
      controllerSn: 1,
      eventIndex: 1,
      cardNumber: 42,
      granted: true,
    });
    const decoded = decodeSwipeEvent(packet);
    expect(decoded.cardNumber).toBe(42);
    expect(decoded.fobNumber).toBe("0000000042");
  });
});

describe("decode error handling", () => {
  it("rejects packets that are the wrong size", () => {
    expect(() => decodeSwipeEvent(new Uint8Array(32))).toThrow(/expected 64/);
    expect(() => decodeSwipeEvent(new Uint8Array(65))).toThrow(/expected 64/);
  });

  it("rejects packets without the start-of-message byte", () => {
    const buf = new Uint8Array(64);
    buf[0] = 0xFF;
    buf[1] = 0x20;
    expect(() => decodeSwipeEvent(buf)).toThrow(/SOM/);
  });

  it("rejects function codes we don't speak yet", () => {
    const buf = new Uint8Array(64);
    buf[0] = 0x17;
    buf[1] = 0x94;  // some other UHPPOTE function
    expect(() => decodeSwipeEvent(buf)).toThrow(/function code/);
  });
});
