// node --test client/tests/world-data.test.mjs
// Payload dibangun tangan mengikuti World.serialize() dan Tile.serialize() GrowServer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorld, TILE_FLAG } from "../public/src/game/world-data.js";

class W {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { return this.u8(v).u8(v >> 8); }
  u32(v) { return this.u16(v & 0xffff).u16(v >>> 16); }
  f32(v) { const b = new Uint8Array(new Float32Array([v]).buffer); this.a.push(...b); return this; }
  str(s) { const b = new TextEncoder().encode(s); this.u16(b.length); this.a.push(...b); return this; }
  zeros(n) { for (let i = 0; i < n; i++) this.a.push(0); return this; }
  bytes() { return new Uint8Array(this.a); }
}

function build({ w = 3, h = 2, tiles, dropped = [] } = {}) {
  const o = new W();
  o.u16(0x19).u32(0x40).str("START").u32(w).u32(h).u32(w * h).zeros(5);
  for (let i = 0; i < w * h; i++) (tiles?.[i] ?? ((t) => t.u16(0).u16(0).u16(0).u16(0)))(o);
  o.zeros(12).u32(dropped.length).u32(7);
  for (const d of dropped) o.u16(d.id).f32(d.x).f32(d.y).u8(d.amount).u8(0).u32(d.uid);
  o.u16(2).u16(0).u16(2).zeros(6);
  return o.bytes();
}
const plain = (fg, bg) => (t) => t.u16(fg).u16(bg).u16(0).u16(0);

test("dunia sederhana dengan item jatuh dan cuaca", () => {
  const b = build({ tiles: [plain(2, 14), plain(8, 0)], dropped: [{ id: 2, x: 96.5, y: 32, amount: 3, uid: 9 }] });
  const w = parseWorld(b);
  assert.equal(w.name, "START");
  assert.equal(w.width, 3);
  assert.equal(w.height, 2);
  assert.equal(w.fg[0], 2);
  assert.equal(w.bg[0], 14);
  assert.equal(w.fg[1], 8);
  assert.deepEqual(w.dropped, [{ id: 2, x: 96.5, y: 32, amount: 3, uid: 9 }]);
  assert.equal(w.weather, 2);
  assert.equal(w.bytesRead, b.length);
});

test("ekstra: pintu, papan, kunci dunia, bibit, mesin jual", () => {
  const b = build({
    tiles: [
      (t) => t.u16(6).u16(0).u16(0).u16(TILE_FLAG.EXTRA).u8(1).str("EXIT").u8(8),
      (t) => t.u16(20).u16(0).u16(0).u16(TILE_FLAG.EXTRA).u8(2).str("Halo").u32(0xffffffff),
      (t) => t.u16(242).u16(0).u16(0).u16(TILE_FLAG.EXTRA | TILE_FLAG.PUBLIC).u8(3).u8(0).u32(1).u32(2).u32(-120 >>> 0).u32(5).u8(0).u8(0).u16(0).u32(120),
      (t) => t.u16(3).u16(0).u16(0).u16(TILE_FLAG.EXTRA | TILE_FLAG.SEED).u8(4).u32(100).u8(2),
      (t) => t.u16(2978).u16(0).u16(0).u16(TILE_FLAG.EXTRA).u8(24).u32(4584).u32(-1 >>> 0),
      (t) => t.u16(9).u16(0).u16(0).u16(TILE_FLAG.LOCKED).u16(3),
    ],
  });
  const w = parseWorld(b);
  assert.deepEqual(w.extras.get(0), { type: 1, label: "EXIT", locked: true });
  assert.deepEqual(w.extras.get(1), { type: 2, label: "Halo" });
  assert.deepEqual(w.extras.get(2), { type: 3, settings: 0, owner: 1, accessCount: 2 });
  assert.deepEqual(w.extras.get(3), { type: 4, age: 100, fruit: 2 });
  assert.deepEqual(w.extras.get(4), { type: 24, itemId: 4584, price: -1 });
  assert.equal(w.extras.size, 5);
  assert.equal(w.bytesRead, b.length);
});

test("ekstra bawaan GrowServer (tabel DEFAULT_EXTRA) terbaca tanpa selip", () => {
  // [tipe, ...payload] persis seperti default-extra-tile.ts
  const z = (n) => Array(n).fill(0);
  const cases = [[9, ...z(4)], [10, 255, 255, 255, 255, 0x7f], [14, 0, 0, 0, 255, 255, 255, 255, ...z(18)],
    [22], [31, 0, 0, 0, ...z(12), 0, ...z(16)], [54, 0, 0], [61, ...z(35)], [62, ...z(8), 1, 0, 136, 19, 0, 0],
    [42, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, ...z(4), 255, 255, 255, 255], [55, ...z(20)], [44, ...z(9)], [74]];
  for (const c of cases) {
    const w = parseWorld(build({ w: 1, h: 1, tiles: [(t) => { t.u16(1).u16(0).u16(0).u16(TILE_FLAG.EXTRA); c.forEach((x) => t.u8(x)); }] }));
    assert.equal(w.extras.get(0).type, c[0], `tipe ${c[0]}`);
  }
});

test("tipe ekstra tak dikenal ditolak dengan pesan jelas", () => {
  const b = build({ w: 1, h: 1, tiles: [(t) => t.u16(1).u16(0).u16(0).u16(1).u8(200)] });
  assert.throws(() => parseWorld(b), /tipe data ekstra 200/);
});

test("input rusak: terpotong, ukuran tak cocok, versi lama", () => {
  const b = build();
  for (const n of [0, 5, 20, b.length - 1]) assert.throws(() => parseWorld(b.subarray(0, n)), RangeError);
  const bad = new W().u16(0x19).u32(0x40).str("X").u32(5).u32(5).u32(7).zeros(5).bytes();
  assert.throws(() => parseWorld(bad), /ukuran dunia/);
  assert.throws(() => parseWorld(new W().u16(0).u32(0).bytes()), /versi dunia/);
  const huge = new W().u16(0x19).u32(0x40).str("X").u32(0xffffffff).u32(2).u32(0xfffffffe).zeros(5).bytes();
  assert.throws(() => parseWorld(huge), RangeError);
});
