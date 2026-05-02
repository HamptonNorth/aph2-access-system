// UDP listener: binds a Bun.udpSocket on the configured port, decodes every
// incoming packet as a UHPPOTE swipe event, runs the access-decision service,
// and writes one row to access_log.
//
// Errors decoding any individual packet are caught and logged - the listener
// must NEVER crash, otherwise we lose visibility into any subsequent swipes.

import db from "../db.js";
import { decodeSwipeEvent } from "../lib/uhppote-protocol.js";
import { decide } from "./access-decision.js";
import { Temporal } from "../lib/temporal.js";

// Prepared statements at module scope (mirrors the diary pattern). Cheaper
// than re-preparing per packet and clearer for volunteers reading the file.

// `deleted_at IS NULL` is defence in depth - on soft-delete we already null
// out fob_number, but if anything ever leaves a stale fob on a deleted row
// we don't want it suddenly granting access.
const findUserStmt = db.query(`
  SELECT id, first_name, surname, fob_number, group_id, blocked, blocked_reason
  FROM users
  WHERE fob_number = $fob AND deleted_at IS NULL
`);

const lastGrantedStmt = db.query(`
  SELECT ts
  FROM access_log
  WHERE fob_number = $fob AND outcome = 'granted'
  ORDER BY ts DESC
  LIMIT 1
`);

const insertLogStmt = db.query(`
  INSERT INTO access_log (ts, fob_number, user_id, outcome, controller_sn, raw_packet)
  VALUES ($ts, $fob, $userId, $outcome, $sn, $raw)
`);

const queries = {
  findUserByFob(fob) {
    return findUserStmt.get({ $fob: fob });
  },
  lastGrantedAccessForFob(fob) {
    return lastGrantedStmt.get({ $fob: fob });
  },
};

/**
 * Process a single received UDP datagram. Exported so tests can drive the
 * pipeline synchronously (decode -> decide -> log) without binding a real
 * socket. Returns the inserted access_log row id, or null if the packet
 * could not be decoded.
 *
 * @param {Uint8Array | Buffer} bytes
 * @param {object} config { passbackMinutes }
 * @returns {{ id: number, outcome: string, userId: number | null } | null}
 */
export function handlePacket(bytes, config) {
  let event;
  try {
    event = decodeSwipeEvent(bytes);
  } catch (err) {
    console.warn(`[udp] dropped malformed packet: ${err.message}`);
    return null;
  }

  const { outcome, userId } = decide(event, queries, config);

  // Some controllers will send the packet with their clock slightly skewed.
  // We trust the controller's timestamp for `ts` (it's what actually happened
  // at the door), but if it's garbage we fall back to "now" so we still get
  // a row. Sentinel: any year < 2000 means BCD junk.
  const ts = Date.parse(event.timestamp) > Date.parse("2000-01-01")
    ? event.timestamp
    : Temporal.Now.instant().toString();

  const result = insertLogStmt.run({
    $ts: ts,
    $fob: event.fobNumber,
    $userId: userId,
    $outcome: outcome,
    $sn: event.controllerSn,
    $raw: bytes,
  });

  return { id: Number(result.lastInsertRowid), outcome, userId };
}

/**
 * Bind a Bun UDP socket and process every incoming packet. Returns the live
 * socket so callers can close() it on shutdown.
 *
 * @param {object} opts
 * @param {string} opts.host
 * @param {number} opts.port
 * @param {object} opts.config { passbackMinutes }
 */
export async function startUdpListener({ host, port, config }) {
  const socket = await Bun.udpSocket({
    hostname: host,
    port,
    socket: {
      data(_socket, buf, fromPort, fromAddr) {
        try {
          const result = handlePacket(buf, config);
          if (result) {
            console.log(
              `[udp] ${fromAddr}:${fromPort} -> log #${result.id} ${result.outcome}`
            );
          }
        } catch (err) {
          // Belt-and-braces: handlePacket already swallows decode errors,
          // but anything thrown by the DB shouldn't kill the listener.
          console.error("[udp] error handling packet:", err);
        }
      },
    },
  });

  console.log(`[udp] listening on ${host}:${port}`);
  return socket;
}
