import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { frameIndex, framePos } from "../public/src/game/tile-frame.js";
import { parseItemsDat } from "../public/src/game/items.js";

// grid string: '#' = tile sejenis; di luar grid dianggap ada (sama dengan perilaku renderer)
const sameIn = (rows, x, y) => (dx, dy) => {
  const r = rows[y + dy];
  if (r === undefined) return true;
  const c = r[x + dx];
  return c === undefined ? true : c === "#";
};

test("jenis 2: blok terisolasi, tepi, dan kolom", () => {
  const f = (rows, x, y) => frameIndex(2, sameIn(rows, x, y));
  assert.equal(f(["...", ".#.", "..."], 1, 1), 12); // sendirian
  assert.equal(f([".#.", ".#.", ".#."], 1, 1), 9); // tengah kolom
  assert.equal(f(["...", ".#.", ".#."], 1, 1), 10); // ujung atas kolom (rumput)
  assert.equal(f([".#.", ".#.", "..."], 1, 1), 11); // ujung bawah kolom
  assert.equal(f(["###", "###", "###"], 1, 1), 0); // di dalam
  assert.equal(f(["###", "###", "###"], 1, 0), 0);
  assert.equal(f(["...", "###", "###"], 1, 1), 1); // permukaan datar
  assert.equal(f(["...", ".##", ".##"], 1, 1), 5); // sudut kiri atas
  assert.equal(f(["...", "##.", "##."], 1, 1), 6); // sudut kanan atas
  assert.equal(f(["###", ".##", ".##"], 1, 1), 3); // tepi kiri
  assert.equal(f(["###", "##.", "###"], 1, 1), 4); // tepi kanan
  assert.equal(f(["###", ".##", "..."], 1, 1), 7); // sudut kiri bawah
});

test("jenis 2: sudut dalam", () => {
  const same = (m) => (dx, dy) => !m.has(`${dx},${dy}`);
  assert.equal(frameIndex(2, same(new Set(["-1,-1"]))), 13);
  assert.equal(frameIndex(2, same(new Set(["1,-1"]))), 14);
  assert.equal(frameIndex(2, same(new Set(["1,1"]))), 0);
});

test("jenis 3 horizontal dan 7 vertikal", () => {
  const h = (l, r) => frameIndex(3, (dx) => (dx < 0 ? l : r));
  assert.deepEqual([h(false, true), h(true, true), h(true, false), h(false, false)], [0, 1, 2, 3]);
  const v = (u, d) => frameIndex(7, (_, dy) => (dy < 0 ? u : d));
  assert.deepEqual([v(true, false), v(true, true), v(false, true), v(false, false)], [0, 1, 2, 3]);
});

test("jenis lain jatuh ke frame 0; framePos membungkus tiap 8 kolom", () => {
  assert.equal(frameIndex(5, () => false), 0);
  assert.equal(frameIndex(1, () => false), 0);
  assert.deepEqual(framePos({ textureX: 8, textureY: 20 }, 13), { col: 13, row: 21 });
});

const REAL = "/home/claude/ext/itemsdat-archive/items-v5.61.dat";
test("item nyata: tanah memakai jenis 2 dan frame 13 ada di atlas", { skip: !existsSync(REAL) }, () => {
  const p = parseItemsDat(new Uint8Array(readFileSync(REAL)));
  assert.equal(p.items.get(2).storageType, 2);
  assert.equal(p.items.get(102).storageType, 3);
  assert.equal(p.items.get(992).storageType, 7);
});
