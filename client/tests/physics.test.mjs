import test from "node:test";
import assert from "node:assert/strict";
import { World, TILE, generateWorld, SPAWN, T } from "../public/src/world.js";
import { createPlayer, stepPlayer, PHYS } from "../public/src/physics.js";

const defs = { 1: { solid: true, hits: 3 }, 8: { solid: true, hits: -1 } };
const none = { left: false, right: false, jump: false };

function flatWorld() {
  const w = new World(20, 10, defs);
  for (let x = 0; x < 20; x++) w.set(x, 8, 1);
  return w;
}

function run(p, input, world, seconds) {
  for (let i = 0; i < Math.round(seconds * 60); i++) stepPlayer(p, input, world, 1 / 60);
}

test("jatuh lalu mendarat di atas tanah", () => {
  const w = flatWorld();
  const p = createPlayer(5 * TILE, 2 * TILE);
  run(p, none, w, 2);
  assert.equal(p.onGround, true);
  assert.equal(p.y + p.h, 8 * TILE);
  assert.equal(p.vy, 0);
});

test("tidak menembus dinding", () => {
  const w = flatWorld();
  for (let y = 0; y < 8; y++) w.set(10, y, 1);
  const p = createPlayer(5 * TILE, 8 * TILE - 30);
  run(p, { ...none, right: true }, w, 4);
  assert.ok(p.x + p.w <= 10 * TILE + 1e-6);
  assert.ok(p.x + p.w >= 10 * TILE - 1e-6);
});

test("tinggi lompat sekitar 2.6 tile", () => {
  const w = flatWorld();
  const p = createPlayer(5 * TILE, 8 * TILE - 30);
  run(p, none, w, 0.2);
  const y0 = p.y;
  stepPlayer(p, { ...none, jump: true }, w, 1 / 60);
  let top = p.y;
  for (let i = 0; i < 120; i++) {
    stepPlayer(p, none, w, 1 / 60);
    top = Math.min(top, p.y);
  }
  const height = (y0 - top) / TILE;
  assert.ok(height > 2.2 && height < 3.0, `tinggi lompat ${height}`);
});

test("tidak bisa lompat di udara", () => {
  const w = flatWorld();
  const p = createPlayer(5 * TILE, 2 * TILE);
  stepPlayer(p, { ...none, jump: true }, w, 1 / 60);
  assert.ok(p.vy >= 0);
});

test("batas dunia kiri dan kanan padat", () => {
  const w = flatWorld();
  const p = createPlayer(TILE, 8 * TILE - 30);
  run(p, { ...none, left: true }, w, 3);
  assert.ok(p.x >= 0);
});

test("pukul tile: pecah setelah 3 kali, bedrock tidak pecah", () => {
  const w = flatWorld();
  w.set(3, 3, 8);
  assert.equal(w.hit(4, 8), false);
  assert.equal(w.hit(4, 8), false);
  assert.equal(w.hit(4, 8), true);
  assert.equal(w.get(4, 8), 0);
  for (let i = 0; i < 20; i++) assert.equal(w.hit(3, 3), false);
  assert.equal(w.get(3, 3), 8);
});

test("dunia contoh: titik spawn tidak di dalam tile padat", () => {
  const d = Object.fromEntries(Object.values(T).filter(Boolean).map((id) => [id, { solid: true, hits: 3 }]));
  const w = generateWorld(d);
  assert.equal(w.isSolid(Math.floor(SPAWN.x / TILE), Math.floor(SPAWN.y / TILE)), false);
  const p = createPlayer(SPAWN.x, SPAWN.y);
  run(p, none, w, 3);
  assert.equal(p.onGround, true);
});
