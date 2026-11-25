// Pembantu tes: meniru sisi SERVER (encoder variant seperti Variant.parse di GrowServer).
import { PACKET_TYPE, TANK_TYPE, encodeTank, encodeText } from "../public/src/protocol/packets.js";

const enc = new TextEncoder();

/** args: string | number (u32/i32 otomatis) | {i32} | {i64: bigint|number} | number[] (float 1-3) */
export function variantExtra(args) {
  const parts = [];
  let idx = 0;
  const u8 = (n) => parts.push(Uint8Array.of(n));
  const dv = (size, fn) => {
    const b = new Uint8Array(size);
    fn(new DataView(b.buffer));
    parts.push(b);
  };
  u8(args.length);
  for (const a of args) {
    u8(idx++);
    if (typeof a === "string") {
      u8(2);
      const s = enc.encode(a);
      dv(4, (v) => v.setUint32(0, s.length, true));
      parts.push(s);
    } else if (typeof a === "number") {
      if (a < 0) {
        u8(9);
        dv(4, (v) => v.setInt32(0, a, true));
      } else {
        u8(5);
        dv(4, (v) => v.setUint32(0, a, true));
      }
    } else if (Array.isArray(a)) {
      u8(a.length === 1 ? 1 : a.length === 2 ? 3 : 4);
      for (const f of a) dv(4, (v) => v.setFloat32(0, f, true));
    } else if ("i32" in a) {
      u8(9);
      dv(4, (v) => v.setInt32(0, a.i32, true));
    } else if ("i64" in a) {
      u8(10);
      dv(8, (v) => v.setBigInt64(0, BigInt(a.i64), true));
    }
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Paket CALL_FUNCTION seperti yang dikirim server. */
export function callPacket(name, args = [], { netID = -1, delay = 0 } = {}) {
  return encodeTank({ type: TANK_TYPE.CALL_FUNCTION, netID, itemID: delay, extraData: variantExtra([name, ...args]) });
}

export const helloPacket = () => Uint8Array.of(PACKET_TYPE.SERVER_HELLO, 0, 0, 0, 0);
export const textPacket = (t) => encodeText(t, PACKET_TYPE.GENERIC_TEXT);
