import { test } from "node:test";
import assert from "node:assert/strict";
import { crackFrame, rawRGB, treeGrowth, tileLabel } from "../public/src/game/tile-effects.js";

test("crackFrame: 0..3 mengikuti pukulan/kekerasan, tidak melewati batas", () => {
  assert.equal(crackFrame(0, 4), 0);
  assert.equal(crackFrame(1, 4), 1);
  assert.equal(crackFrame(2, 4), 2);
  assert.equal(crackFrame(3, 4), 3);
  assert.equal(crackFrame(99, 4), 3);
  assert.equal(crackFrame(1, 0), 3); // kekerasan tak valid dianggap 1
});
test("rawRGB: warna kulit bawaan dan seed tanah", () => {
  assert.deepEqual(rawRGB(0x8295c3ff), { r: 195, g: 149, b: 130 });
  assert.deepEqual(rawRGB(0x133960ff), { r: 96, g: 57, b: 19 });
});
test("treeGrowth", () => {
  assert.equal(treeGrowth(0, 100).ready, false);
  assert.equal(treeGrowth(0, 100).scale, 0.55);
  assert.equal(treeGrowth(100, 100).ready, true);
  assert.equal(treeGrowth(500, 100).scale, 1);
  assert.equal(treeGrowth(5, 0).ready, true);
});
test("tileLabel membuang kode warna dan memendekkan", () => {
  assert.equal(tileLabel("`2START``"), "START");
  assert.equal(tileLabel("a".repeat(30)).length, 12);
  assert.equal(tileLabel(null), "");
});
