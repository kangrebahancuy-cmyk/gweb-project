// node --test client/tests/items.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { parseItemsDat, inflateZlib, ItemDB } from "../public/src/game/items.js";

const REAL = process.env.ITEMS_DAT ?? "/home/claude/ext/itemsdat-archive/items-v5.61.dat";

test("data terpotong ditolak dengan RangeError, bukan crash", () => {
  assert.throws(() => parseItemsDat(new Uint8Array([27, 0, 5, 0, 0, 0, 1])), RangeError);
  assert.throws(() => parseItemsDat(new Uint8Array([3, 0, 0, 0, 0, 0])), /versi/);
  assert.throws(() => parseItemsDat(new Uint8Array([27, 0, 0xff, 0xff, 0xff, 0x7f])), /jumlah/);
});

test("inflateZlib: roundtrip dan batas ukuran", async () => {
  const raw = new Uint8Array(5000).map((_, i) => i % 7);
  const z = new Uint8Array(deflateSync(raw));
  assert.deepEqual(await inflateZlib(z, raw.length), raw);
  await assert.rejects(inflateZlib(z, 100), /melebihi/);
});

test("items.dat asli: terbaca penuh, jumlah dan nama dikenal", { skip: !existsSync(REAL) }, () => {
  const buf = new Uint8Array(readFileSync(REAL));
  const p = parseItemsDat(buf);
  assert.equal(p.version, 27);
  assert.equal(p.count, 16480);
  assert.equal(p.items.size, 16480);
  assert.equal(p.bytesRead, buf.length);
  const db = new ItemDB(p);
  assert.equal(db.name(0), "Blank");
  assert.equal(db.name(2), "Dirt");
  assert.equal(db.name(18), "Fist");
  assert.equal(db.name(32), "Wrench");
  assert.equal(db.isSolid(2), true);
  assert.equal(db.isSolid(0), false);
});
