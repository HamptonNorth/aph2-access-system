// UHPPOTE protocol encode / decode.
//
// The UHPPOTE access controller speaks a 64-byte UDP datagram protocol on
// port 60000. Every packet has the same envelope:
//
//   offset | size | purpose                 | encoding
//   -------|------|-------------------------|---------------------------
//    0     | 1    | start of message        | always 0x17
//    1     | 1    | function code           | e.g. 0x20 = swipe event
//    2-3   | 2    | reserved                | always 0x00 0x00
//    4-7   | 4    | controller serial num   | uint32 little-endian
//    8-63  | 56   | function-specific body  | layout depends on function
//
// We currently care about ONE function: 0x20 ("swipe event"), which the
// controller pushes to the listener IP:port whenever a fob is presented.
//
// Swipe event body layout (offsets relative to the start of the packet):
//
//   offset | size | purpose                   | encoding
//   -------|------|---------------------------|---------------------------
//    8-11  | 4    | event index (record num)  | uint32 little-endian
//   12     | 1    | event type                | 0x01 = card swipe
//   13     | 1    | granted-by-controller     | 1 = allowed, 0 = denied
//   14     | 1    | door number               | 1..4
//   15     | 1    | direction                 | 1 = in, 2 = out
//   16-19  | 4    | card number (the fob)     | uint32 little-endian
//   20-21  | 2    | year                      | BCD: e.g. 2026 -> 0x20 0x26
//   22     | 1    | month                     | BCD: e.g. May  -> 0x05
//   23     | 1    | day                       | BCD
//   24     | 1    | hour                      | BCD
//   25     | 1    | minute                    | BCD
//   26     | 1    | second                    | BCD
//   27     | 1    | reason code               | controller-defined
//   28-63  | 36   | door states / padding     | zero-filled here
//
// The "granted" byte at offset 13 reflects the controller's own decision.
// We log it on the access_log row but it does NOT determine our outcome -
// that's the access-decision service's job (block / passback / etc.).
//
// Anything we don't understand on a real packet, we log and ignore. That
// means swapping in a real controller will Just Work for swipe events even
// if it sends us extra bytes we haven't decoded.

const PACKET_SIZE = 64;
const SOM = 0x17;

export const FUNCTION_SWIPE_EVENT = 0x20;
export const EVENT_TYPE_CARD_SWIPE = 0x01;

// ---------------------------------------------------------------------------
// BCD helpers
// ---------------------------------------------------------------------------

// Encode a value in 0..99 as one BCD byte: 24 -> 0x24, 7 -> 0x07.
function toBcd(value) {
  if (value < 0 || value > 99) {
    throw new Error(`BCD value out of range (0..99): ${value}`);
  }
  return ((Math.floor(value / 10) & 0x0f) << 4) | (value % 10 & 0x0f);
}

// Decode one BCD byte to a number in 0..99.
function fromBcd(byte) {
  return ((byte >> 4) & 0x0f) * 10 + (byte & 0x0f);
}

// ---------------------------------------------------------------------------
// Encode (used by tests + scripts/fake-controller.js)
// ---------------------------------------------------------------------------

/**
 * Build a 64-byte swipe-event packet for testing. Real controllers emit
 * these; we craft one here so the listener can be exercised end-to-end with
 * no hardware.
 *
 * `timestamp` should be a Temporal.Instant (or anything with .toZonedDateTimeISO("UTC"))
 * but to keep this module dependency-free we accept a plain Date too.
 *
 * @param {object} fields
 * @param {number} fields.controllerSn  Controller serial number (uint32).
 * @param {number} fields.eventIndex    Record number on the controller.
 * @param {number} fields.cardNumber    10-digit fob number (uint32).
 * @param {boolean} fields.granted      Did the controller open the door?
 * @param {number} [fields.door=1]      Door 1..4.
 * @param {number} [fields.direction=1] 1 = in, 2 = out.
 * @param {Date}   [fields.timestamp]   Defaults to now().
 * @returns {Uint8Array}
 */
export function encodeSwipeEvent(fields) {
  const {
    controllerSn,
    eventIndex,
    cardNumber,
    granted,
    door = 1,
    direction = 1,
    timestamp = new Date(),
    reason = 0,
  } = fields;

  const buf = new Uint8Array(PACKET_SIZE);
  const view = new DataView(buf.buffer);

  buf[0] = SOM;
  buf[1] = FUNCTION_SWIPE_EVENT;
  // bytes 2-3 left as 0
  view.setUint32(4, controllerSn, /* littleEndian */ true);
  view.setUint32(8, eventIndex, true);
  buf[12] = EVENT_TYPE_CARD_SWIPE;
  buf[13] = granted ? 1 : 0;
  buf[14] = door;
  buf[15] = direction;
  view.setUint32(16, cardNumber, true);

  // Timestamp BCD. The protocol stores year as two bytes (century, year),
  // e.g. 2026 -> [0x20, 0x26]. UTC because controllers are typically set
  // and read as wall-clock time but for our test packets we want determinism.
  const year = timestamp.getUTCFullYear();
  buf[20] = toBcd(Math.floor(year / 100));
  buf[21] = toBcd(year % 100);
  buf[22] = toBcd(timestamp.getUTCMonth() + 1);
  buf[23] = toBcd(timestamp.getUTCDate());
  buf[24] = toBcd(timestamp.getUTCHours());
  buf[25] = toBcd(timestamp.getUTCMinutes());
  buf[26] = toBcd(timestamp.getUTCSeconds());
  buf[27] = reason;
  // bytes 28-63 left zero-filled

  return buf;
}

// ---------------------------------------------------------------------------
// Decode (used by the UDP listener)
// ---------------------------------------------------------------------------

/**
 * Decode a 64-byte packet. Returns a plain object with the fields the rest
 * of the system uses. Throws if the packet is malformed (wrong SOM, wrong
 * size, unknown function code).
 *
 * @param {Uint8Array | Buffer} bytes
 * @returns {{
 *   functionCode: number,
 *   controllerSn: number,
 *   eventIndex: number,
 *   eventType: number,
 *   grantedByController: boolean,
 *   door: number,
 *   direction: number,
 *   cardNumber: number,
 *   fobNumber: string,
 *   timestamp: string,
 *   reason: number,
 * }}
 */
export function decodeSwipeEvent(bytes) {
  if (bytes.length !== PACKET_SIZE) {
    throw new Error(`expected ${PACKET_SIZE} bytes, got ${bytes.length}`);
  }
  if (bytes[0] !== SOM) {
    throw new Error(`bad SOM byte: 0x${bytes[0].toString(16)} (expected 0x17)`);
  }
  if (bytes[1] !== FUNCTION_SWIPE_EVENT) {
    throw new Error(`unsupported function code: 0x${bytes[1].toString(16)}`);
  }

  // DataView wants an ArrayBuffer; if we got a Node Buffer we still have
  // .buffer / .byteOffset / .byteLength on it.
  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset ?? 0,
    bytes.byteLength
  );

  const controllerSn = view.getUint32(4, true);
  const eventIndex   = view.getUint32(8, true);
  const eventType    = bytes[12];
  const grantedByController = bytes[13] === 1;
  const door         = bytes[14];
  const direction    = bytes[15];
  const cardNumber   = view.getUint32(16, true);

  const yearHi = fromBcd(bytes[20]);
  const yearLo = fromBcd(bytes[21]);
  const year   = yearHi * 100 + yearLo;
  const month  = fromBcd(bytes[22]);
  const day    = fromBcd(bytes[23]);
  const hour   = fromBcd(bytes[24]);
  const minute = fromBcd(bytes[25]);
  const second = fromBcd(bytes[26]);
  const reason = bytes[27];

  // Render as ISO 8601 with Z. We treat the controller's clock as UTC; the
  // installer will need to set it that way during commissioning. (Storing
  // UTC keeps the access_log unambiguous across DST changes.)
  const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
    .toISOString();

  // Pad the card number to 10 digits to match what's printed on the fob.
  const fobNumber = String(cardNumber).padStart(10, "0");

  return {
    functionCode: bytes[1],
    controllerSn,
    eventIndex,
    eventType,
    grantedByController,
    door,
    direction,
    cardNumber,
    fobNumber,
    timestamp,
    reason,
  };
}

export const PROTOCOL_INTERNALS = { toBcd, fromBcd, PACKET_SIZE, SOM };
