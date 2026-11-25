// Fisika pemain: gravitasi, lari, lompat, tabrakan AABB per sumbu. Tanpa DOM.
import { TILE } from "./world.js";

export const PHYS = {
  maxSpeed: 190, // px/detik
  accel: 1500,
  friction: 1800,
  jumpVel: 560,
  gravity: 1900,
  maxFall: 900,
};

export function createPlayer(x, y) {
  return { x, y, w: 20, h: 30, vx: 0, vy: 0, onGround: false, facing: 1 };
}

function collides(world, x, y, w, h) {
  const x0 = Math.floor(x / TILE);
  const x1 = Math.floor((x + w - 1e-6) / TILE);
  const y0 = Math.floor(y / TILE);
  const y1 = Math.floor((y + h - 1e-6) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (world.isSolid(tx, ty)) return true;
    }
  }
  return false;
}

/**
 * Maju satu langkah.
 * @param p pemain
 * @param input {left:boolean,right:boolean,jump:boolean}
 * @param world World
 * @param dt detik
 */
export function stepPlayer(p, input, world, dt) {
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    p.vx += dir * PHYS.accel * dt;
    p.vx = Math.max(-PHYS.maxSpeed, Math.min(PHYS.maxSpeed, p.vx));
    p.facing = dir;
  } else {
    const d = PHYS.friction * dt;
    p.vx = Math.abs(p.vx) <= d ? 0 : p.vx - Math.sign(p.vx) * d;
  }

  if (input.jump && p.onGround) {
    p.vy = -PHYS.jumpVel;
    p.onGround = false;
  }
  p.vy = Math.min(PHYS.maxFall, p.vy + PHYS.gravity * dt);

  // Sumbu X
  p.x += p.vx * dt;
  if (collides(world, p.x, p.y, p.w, p.h)) {
    if (p.vx > 0) p.x = Math.floor((p.x + p.w - 1e-6) / TILE) * TILE - p.w;
    else p.x = (Math.floor(p.x / TILE) + 1) * TILE;
    p.vx = 0;
  }

  // Sumbu Y
  p.y += p.vy * dt;
  p.onGround = false;
  if (collides(world, p.x, p.y, p.w, p.h)) {
    if (p.vy > 0) {
      p.y = Math.floor((p.y + p.h - 1e-6) / TILE) * TILE - p.h;
      p.onGround = true;
    } else {
      p.y = (Math.floor(p.y / TILE) + 1) * TILE;
    }
    p.vy = 0;
  }
  return p;
}
