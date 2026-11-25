import test from "node:test";
import assert from "node:assert/strict";
import {
  PACKET_TYPE, TANK_TYPE, TANK_FLAGS, TANK_TOTAL_HEADER,
  buildText, decodePacket, decodeTank, decodeText, decodeVariants, encodeTank, encodeText, parseCall, parseText,
} from "../public/src/protocol/packets.js";
import { callPacket, helloPacket, variantExtra } from "./helpers.mjs";

test("ukuran header: 4 byte tipe + 56 byte tank = 60", () => {
  assert.equal(TANK_TOTAL_HEADER, 60);
  assert.equal(encodeTank({ type: TANK_TYPE.STATE }).length, 60);
});

test("tank: round trip semua field", () => {
  const f = {
    type: TANK_TYPE.STATE, objectType: 7, jumpCount: 2, buildRange: 128, netID: 5, targetNetID: -1,
    flags: TANK_FLAGS.ON_GROUND | TANK_FLAGS.FACING_LEFT, floatVar: 1.5, itemID: 18, posX: 320.5, posY: 640.25,
    speedX: -12.5, speedY: 3.75, particleID: 4, tileX: 12, tileY: -3,
  };
  const d = decodeTank(encodeTank(f));
  for (const k of Object.keys(f)) assert.equal(d[k], f[k], k);
  assert.equal(d.extraData.length, 0);
});

test("tank: extraData menyalakan flag EXTENDED_DATA dan ikut terbaca", () => {
  const b = encodeTank({ type: TANK_TYPE.SEND_MAP_DATA, extraData: Uint8Array.of(1, 2, 3, 4, 5) });
  const d = decodeTank(b);
  assert.ok(d.flags & TANK_FLAGS.EXTENDED_DATA);
  assert.deepEqual([...d.extraData], [1, 2, 3, 4, 5]);
});

test("tank: tata letak byte sama dengan GrowServer (offset field)", () => {
  const b = encodeTank({ type: 3, objectType: 4, jumpCount: 5, buildRange: 6, netID: 0x01020304, itemID: 0x0a0b0c0d, tileX: 9, tileY: 10 });
  assert.deepEqual([...b.subarray(0, 8)], [4, 0, 0, 0, 3, 4, 5, 6]);
  assert.deepEqual([...b.subarray(8, 12)], [4, 3, 2, 1]); // netID little-endian
  assert.deepEqual([...b.subarray(24, 28)], [0x0d, 0x0c, 0x0b, 0x0a]); // itemID di offset 24
  assert.equal(new DataView(b.buffer).getInt32(48, true), 9);
  assert.equal(new DataView(b.buffer).getInt32(52, true), 10);
});

test("tank: data cacat ditolak, bukan dibaca di luar batas", () => {
  assert.throws(() => decodeTank(new Uint8Array(59)), RangeError);
  const b = encodeTank({ type: 1, extraData: Uint8Array.of(1, 2, 3) });
  new DataView(b.buffer).setUint32(56, 0xffffff, true); // klaim extraData sangat besar
  assert.throws(() => decodeTank(b), RangeError);
  const c = encodeTank({ type: 1, extraData: Uint8Array.of(1, 2, 3) });
  assert.throws(() => decodeTank(c.subarray(0, c.length - 1)), RangeError); // terpotong
  const wrong = encodeTank({ type: 1 });
  wrong[0] = 2;
  assert.throws(() => decodeTank(wrong), RangeError);
});

test("teks: encode/decode dan penghentian di NUL atau byte kontrol", () => {
  assert.equal(decodeText(encodeText("action|quit\n")), "action|quit\n");
  const withNul = Uint8Array.from([2, 0, 0, 0, ...new TextEncoder().encode("a|b\n"), 0, ...new TextEncoder().encode("sampah")]);
  assert.equal(decodeText(withNul), "a|b\n");
  const withCtl = Uint8Array.from([2, 0, 0, 0, ...new TextEncoder().encode("a|b"), 0x01, ...new TextEncoder().encode("x")]);
  assert.equal(decodeText(withCtl), "a|b");
  assert.throws(() => decodeText(new Uint8Array(3)), RangeError);
});

test("parseText: kunci, nilai ganda, CRLF, getInt", () => {
  const t = parseText("a|1\r\nb|x|y\nc|zz\n\nlead||q\n|d|5\n");
  assert.equal(t.get("a"), "1");
  assert.equal(t.get("b", 1), "y");
  assert.equal(t.getInt("a"), 1);
  assert.equal(t.getInt("c", 9), 9);
  assert.equal(t.get("d"), "5"); // token pertama kosong dibuang, seperti TextParser server
  assert.equal(t.has("nope"), false);
});

test("buildText menolak karakter pemisah di nilai (cegah injeksi baris)", () => {
  assert.equal(buildText([["a", 1], ["b", "x"]]), "a|1\nb|x\n");
  assert.throws(() => buildText([["a", "x\nadmin|1"]]), RangeError);
  assert.throws(() => buildText([["a", "x|y"]]), RangeError);
});

test("variant: semua tipe round trip", () => {
  const extra = variantExtra(["Fn", 7, -9, { i32: 5 }, { i64: 2n ** 40n }, [1.5], [1, 2], [1, 2, 3], "halo é"]);
  const v = decodeVariants(extra).map((x) => x.value);
  assert.deepEqual(v, ["Fn", 7, -9, 5, 2 ** 40, [1.5], [1, 2], [1, 2, 3], "halo é"]);
});

test("variant: int64 di luar rentang aman dikembalikan sebagai BigInt", () => {
  const v = decodeVariants(variantExtra(["F", { i64: 2n ** 62n }]));
  assert.equal(v[1].value, 2n ** 62n);
});

test("variant: terpotong dan tipe tak dikenal ditolak", () => {
  const ok = variantExtra(["Fn", "abc"]);
  assert.throws(() => decodeVariants(ok.subarray(0, ok.length - 2)), RangeError);
  const bad = Uint8Array.from([1, 0, 77]);
  assert.throws(() => decodeVariants(bad), /tidak dikenal/);
  assert.throws(() => decodeVariants(new Uint8Array(0)), RangeError);
});

test("parseCall: nama, argumen, netID, delay", () => {
  const pkt = decodePacket(callPacket("OnSetPos", [[10, 20]], { netID: 4, delay: 100 }));
  assert.equal(pkt.kind, "tank");
  const c = parseCall(pkt.tank);
  assert.equal(c.name, "OnSetPos");
  assert.deepEqual(c.args, [[10, 20]]);
  assert.equal(c.netID, 4);
  assert.equal(c.delay, 100);
});

test("decodePacket: hello, teks, game, lain-lain, terlalu pendek", () => {
  assert.deepEqual(decodePacket(helloPacket()), { kind: "hello" });
  assert.equal(decodePacket(encodeText("x|1")).kind, "text");
  assert.equal(decodePacket(encodeText("x|1", PACKET_TYPE.GAME_MESSAGE)).type, PACKET_TYPE.GAME_MESSAGE);
  assert.equal(decodePacket(encodeTank({ type: 0 })).kind, "tank");
  assert.deepEqual(decodePacket(Uint8Array.of(6, 0, 0, 0)), { kind: "other", type: 6 });
  assert.throws(() => decodePacket(Uint8Array.of(1, 2)), RangeError);
  assert.throws(() => decodePacket([1, 0, 0, 0]), TypeError);
});

test("decodePacket bekerja untuk view dengan byteOffset (subarray)", () => {
  const big = new Uint8Array(200);
  big.set(callPacket("OnConsoleMessage", ["hi"]), 13);
  const len = callPacket("OnConsoleMessage", ["hi"]).length;
  const c = parseCall(decodePacket(big.subarray(13, 13 + len)).tank);
  assert.equal(c.args[0], "hi");
});
