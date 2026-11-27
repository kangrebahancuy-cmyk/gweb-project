import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { decodeRttex } from "../public/src/game/rttex.js";

function make(w, h, px) {
  const body = Buffer.concat([Buffer.from("RTTXTR\0\0"), Buffer.alloc(20), Buffer.alloc(96), Buffer.from(px)]);
  body.writeInt32LE(h, 8); body.writeInt32LE(w, 12); body.writeInt32LE(5121, 16);
  const z = deflateSync(body);
  const pk = Buffer.alloc(32); pk.write("RTPACK"); pk.writeUInt32LE(z.length, 8); pk.writeUInt32LE(body.length, 12);
  return new Uint8Array(Buffer.concat([pk, z]));
}

test("RTPACK+RTTXTR: piksel dibalik vertikal", async () => {
  // urutan di file: baris bawah dulu
  const r = await decodeRttex(make(2, 2, [1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255]));
  assert.deepEqual(Array.from(r.rgba.subarray(0, 4)), [3, 3, 3, 255]);
  assert.deepEqual(Array.from(r.rgba.subarray(8, 12)), [1, 1, 1, 255]);
});

test("menolak data rusak", async () => {
  await assert.rejects(decodeRttex(new Uint8Array(40)), /RTTEX/);
  const bad = make(8, 8, [0, 0, 0, 255]); // piksel kurang
  await assert.rejects(decodeRttex(bad), RangeError);
});

const REAL = "/home/claude/kangrebahancuy-cmyk/gtindapkzip/assets/interface/cross.rttex";
test("file .rttex asli dari APK terbaca", { skip: !existsSync(REAL) }, async () => {
  const r = await decodeRttex(new Uint8Array(readFileSync(REAL)));
  assert.ok(r.width > 0 && r.height > 0);
  assert.equal(r.rgba.length, r.width * r.height * 4);
});
