import { TILE, generateWorld, World, SPAWN } from "./world.js";
import { createPlayer, stepPlayer } from "./physics.js";
import { loadAssets, drawTile } from "./assets.js";
import { createNet, LocalTransport } from "./net.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const REACH = 3.5; // jangkauan pukul/pasang, dalam tile
const STEP = 1 / 60;

const state = {
  assets: null,
  world: null,
  player: null,
  net: null,
  remotes: new Map(), // id -> {x,y,f,name}
  keys: new Set(),
  mouse: { x: 0, y: 0, left: false, right: false },
  hotbarIndex: 0,
  scale: 2,
  cam: { x: 0, y: 0 },
  hitCooldown: 0,
  walkTime: 0,
  atlasViewer: false,
  atlasHover: null,
  message: "",
  messageT: 0,
};

function toast(text) {
  state.message = text;
  state.messageT = 2.5;
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  // Skala bilangan bulat supaya pixel art tetap tajam: ~2x di 650px, 3x di 1080px.
  state.scale = Math.max(1, Math.round(window.innerHeight / 320));
}

// ---------- Input ----------
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  state.keys.add(e.code);
  if (e.code === "F2") {
    e.preventDefault();
    state.atlasViewer = !state.atlasViewer;
  }
  const n = Number(e.key);
  if (n >= 1 && n <= state.assets?.manifest.hotbar.length) state.hotbarIndex = n - 1;
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => state.keys.delete(e.code));
window.addEventListener("blur", () => state.keys.clear());
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("mousemove", (e) => {
  state.mouse.x = e.offsetX;
  state.mouse.y = e.offsetY;
});
canvas.addEventListener("mousedown", (e) => {
  if (state.atlasViewer) return atlasClick();
  if (e.button === 0) state.mouse.left = true;
  if (e.button === 2) {
    state.mouse.right = true;
    placeTile();
  }
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) state.mouse.left = false;
  if (e.button === 2) state.mouse.right = false;
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const n = state.assets.manifest.hotbar.length;
    state.hotbarIndex = (state.hotbarIndex + (e.deltaY > 0 ? 1 : -1) + n) % n;
  },
  { passive: false },
);

function readInput() {
  const k = state.keys;
  return {
    left: k.has("KeyA") || k.has("ArrowLeft"),
    right: k.has("KeyD") || k.has("ArrowRight"),
    jump: k.has("KeyW") || k.has("ArrowUp") || k.has("Space"),
  };
}

// ---------- Aksi dunia ----------
function mouseTile() {
  const wx = state.mouse.x / state.scale + state.cam.x;
  const wy = state.mouse.y / state.scale + state.cam.y;
  return { x: Math.floor(wx / TILE), y: Math.floor(wy / TILE) };
}

function inReach(tx, ty) {
  const p = state.player;
  const dx = tx * TILE + TILE / 2 - (p.x + p.w / 2);
  const dy = ty * TILE + TILE / 2 - (p.y + p.h / 2);
  return Math.hypot(dx, dy) <= REACH * TILE;
}

function setTile(x, y, id) {
  if (state.world.set(x, y, id)) state.net.send({ t: "tile", x, y, id });
}

function punchTile() {
  const { x, y } = mouseTile();
  if (!state.world.inBounds(x, y) || !state.world.get(x, y) || !inReach(x, y)) return;
  if (state.world.hit(x, y)) state.net.send({ t: "tile", x, y, id: 0 });
}

function placeTile() {
  const { x, y } = mouseTile();
  const id = state.assets.manifest.hotbar[state.hotbarIndex];
  if (!state.world.inBounds(x, y) || state.world.get(x, y) !== 0 || !inReach(x, y)) return;
  const p = state.player;
  const overlap =
    p.x < (x + 1) * TILE && p.x + p.w > x * TILE && p.y < (y + 1) * TILE && p.y + p.h > y * TILE;
  if (overlap) return toast("Terhalang pemain");
  setTile(x, y, id);
}

// ---------- Update ----------
let netAcc = 0;
function update(dt) {
  const p = state.player;
  stepPlayer(p, readInput(), state.world, dt);
  if (p.y > state.world.h * TILE + 200) respawn();

  if (Math.abs(p.vx) > 5 && p.onGround) state.walkTime += dt * Math.abs(p.vx) / 40;

  state.hitCooldown -= dt;
  if (state.mouse.left && !state.atlasViewer && state.hitCooldown <= 0) {
    punchTile();
    state.hitCooldown = 0.18;
  }
  if (state.mouse.right && !state.atlasViewer) placeTile();

  if (state.messageT > 0) state.messageT -= dt;

  netAcc += dt;
  if (state.net.online && netAcc >= 1 / 15) {
    netAcc = 0;
    state.net.send({ t: "pos", x: Math.round(p.x), y: Math.round(p.y), vx: Math.round(p.vx), vy: Math.round(p.vy), f: p.facing });
  }
}

function respawn() {
  Object.assign(state.player, createPlayer(SPAWN.x, SPAWN.y));
}

function updateCamera() {
  const vw = canvas.width / state.scale;
  const vh = canvas.height / state.scale;
  const p = state.player;
  const ww = state.world.w * TILE;
  const wh = state.world.h * TILE;
  let cx = p.x + p.w / 2 - vw / 2;
  let cy = p.y + p.h / 2 - vh / 2;
  cx = ww <= vw ? (ww - vw) / 2 : Math.max(0, Math.min(ww - vw, cx));
  cy = wh <= vh ? (wh - vh) / 2 : Math.max(0, Math.min(wh - vh, cy));
  state.cam.x = Math.round(cx);
  state.cam.y = Math.round(cy);
}

// ---------- Render ----------
function drawSprite(entity, tint) {
  const cfg = state.assets.manifest.player;
  const img = state.assets.tintedPlayer;
  const f = entity.facing ?? entity.f ?? 1;
  const dx = entity.x + cfg.drawOffsetX;
  const dy = entity.y + cfg.drawOffsetY;
  if (!img) {
    ctx.fillStyle = tint ?? "#e0a878";
    ctx.fillRect(entity.x, entity.y, 20, 30);
    return;
  }
  const moving = entity === state.player ? Math.abs(entity.vx) > 5 && entity.onGround : false;
  const frame = moving
    ? cfg.walkFrames[Math.floor(state.walkTime) % cfg.walkFrames.length]
    : cfg.idleFrame;
  const sx = (frame % cfg.cols) * cfg.frameW;
  const sy = Math.floor(frame / cfg.cols) * cfg.frameH;
  ctx.save();
  if (f < 0) {
    ctx.translate(dx + cfg.frameW, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(img, sx, sy, cfg.frameW, cfg.frameH, 0, 0, cfg.frameW, cfg.frameH);
  } else {
    ctx.drawImage(img, sx, sy, cfg.frameW, cfg.frameH, dx, dy, cfg.frameW, cfg.frameH);
  }
  ctx.restore();
}

function render() {
  const S = state.scale;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
  g.addColorStop(0, "#5aa9e6");
  g.addColorStop(1, "#d6ecfb");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(S, 0, 0, S, -state.cam.x * S, -state.cam.y * S);
  ctx.imageSmoothingEnabled = false;

  const vw = canvas.width / S;
  const vh = canvas.height / S;
  const x0 = Math.max(0, Math.floor(state.cam.x / TILE));
  const y0 = Math.max(0, Math.floor(state.cam.y / TILE));
  const x1 = Math.min(state.world.w - 1, Math.floor((state.cam.x + vw) / TILE));
  const y1 = Math.min(state.world.h - 1, Math.floor((state.cam.y + vh) / TILE));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const id = state.world.get(x, y);
      if (!id) continue;
      drawTile(ctx, state.assets, id, x * TILE, y * TILE, TILE);
      const r = state.world.damageRatio(x, y);
      if (r > 0) drawCracks(x * TILE, y * TILE, r);
    }
  }

  // Pemain lain
  for (const r of state.remotes.values()) {
    drawSprite(r, "#88a");
    drawName(r.name ?? "?", r.x + 10, r.y - 6);
  }
  drawSprite(state.player);
  drawName(state.playerName, state.player.x + 10, state.player.y - 6);

  // Sorotan tile di bawah kursor
  const t = mouseTile();
  if (state.world.inBounds(t.x, t.y) && !state.atlasViewer) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = inReach(t.x, t.y) ? "rgba(255,255,255,.9)" : "rgba(255,80,80,.7)";
    ctx.strokeRect(t.x * TILE + 0.5, t.y * TILE + 0.5, TILE - 1, TILE - 1);
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHud();
  if (state.atlasViewer) drawAtlasViewer();
}

function drawCracks(x, y, ratio) {
  ctx.fillStyle = `rgba(0,0,0,${0.25 * ratio})`;
  ctx.fillRect(x, y, TILE, TILE);
  ctx.strokeStyle = "rgba(0,0,0,.65)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 4);
  ctx.lineTo(x + 14, y + 14);
  ctx.lineTo(x + 10, y + 22);
  if (ratio > 0.4) {
    ctx.moveTo(x + 14, y + 14);
    ctx.lineTo(x + 26, y + 10);
  }
  if (ratio > 0.7) {
    ctx.moveTo(x + 10, y + 22);
    ctx.lineTo(x + 24, y + 28);
    ctx.moveTo(x + 20, y + 2);
    ctx.lineTo(x + 18, y + 14);
  }
  ctx.stroke();
}

function drawName(text, x, y) {
  ctx.font = "8px monospace";
  ctx.textAlign = "center";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,.7)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = "#fff";
  ctx.fillText(text, x, y);
}

function drawHud() {
  const { manifest } = state.assets;
  const slot = 44;
  const n = manifest.hotbar.length;
  const x0 = Math.round((canvas.width - n * slot) / 2);
  const y0 = canvas.height - slot - 12;
  ctx.font = "11px monospace";
  ctx.textAlign = "left";
  for (let i = 0; i < n; i++) {
    const x = x0 + i * slot;
    const sel = i === state.hotbarIndex;
    ctx.fillStyle = sel ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.55)";
    ctx.fillRect(x, y0, slot - 4, slot - 4);
    ctx.imageSmoothingEnabled = false;
    drawTile(ctx, state.assets, manifest.hotbar[i], x + 4, y0 + 4, 32);
    ctx.fillStyle = sel ? "#000" : "#fff";
    ctx.fillText(String(i + 1), x + 3, y0 + 12);
  }
  const t = mouseTile();
  const id = state.world.get(t.x, t.y);
  const name = id ? manifest.tiles[id]?.name ?? `#${id}` : "-";
  const p = state.player;
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fillRect(8, 8, 330, 44);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "left";
  ctx.fillText(`Pos ${Math.floor(p.x / TILE)},${Math.floor(p.y / TILE)}  Tile: ${name}`, 14, 24);
  ctx.fillText("A/D jalan  W/Spasi lompat  Klik kiri pukul  Klik kanan pasang", 14, 40);
  const sub = state.net.online ? "ONLINE" : "OFFLINE (lokal)";
  ctx.textAlign = "right";
  ctx.fillText(sub + "   F2: pemilih tile", canvas.width - 10, 20);
  if (state.messageT > 0) {
    ctx.textAlign = "center";
    ctx.fillText(state.message, canvas.width / 2, 70);
  }
}

// ---------- Pemilih sel atlas (F2): bantu menentukan col/row untuk manifest ----------
function atlasLayout() {
  const img = state.assets.images.tiles1;
  if (!img) return null;
  const scale = Math.min(1, (canvas.height - 30) / img.height, (canvas.width - 30) / img.width);
  return { img, scale, ox: 15, oy: 15 };
}

function drawAtlasViewer() {
  const L = atlasLayout();
  ctx.fillStyle = "rgba(10,10,20,.92)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!L) {
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText("Atlas tiles1 tidak termuat. Jalankan tools/build_assets.py dulu.", canvas.width / 2, canvas.height / 2);
    return;
  }
  const { img, scale, ox, oy } = L;
  ctx.fillStyle = "#2a2a3a";
  ctx.fillRect(ox, oy, img.width * scale, img.height * scale);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, ox, oy, img.width * scale, img.height * scale);
  const ts = state.assets.manifest.tileSize * scale;
  ctx.strokeStyle = "rgba(255,255,255,.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= img.width / state.assets.manifest.tileSize; i++) {
    ctx.moveTo(ox + i * ts + 0.5, oy);
    ctx.lineTo(ox + i * ts + 0.5, oy + img.height * scale);
    ctx.moveTo(ox, oy + i * ts + 0.5);
    ctx.lineTo(ox + img.width * scale, oy + i * ts + 0.5);
  }
  ctx.stroke();
  const col = Math.floor((state.mouse.x - ox) / ts);
  const row = Math.floor((state.mouse.y - oy) / ts);
  const max = img.width / state.assets.manifest.tileSize;
  state.atlasHover = col >= 0 && row >= 0 && col < max && row < max ? { col, row } : null;
  if (state.atlasHover) {
    ctx.strokeStyle = "#ffe14d";
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + col * ts, oy + row * ts, ts, ts);
    ctx.fillStyle = "rgba(0,0,0,.8)";
    ctx.fillRect(canvas.width - 330, 10, 320, 30);
    ctx.fillStyle = "#ffe14d";
    ctx.font = "13px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`"col": ${col}, "row": ${row}  (klik: salin)`, canvas.width - 322, 30);
  }
}

function atlasClick() {
  const h = state.atlasHover;
  if (!h) return;
  const text = `"col": ${h.col}, "row": ${h.row}`;
  navigator.clipboard?.writeText(text).catch(() => {});
  console.log("[atlas]", text);
  toast("Disalin: " + text);
}

// ---------- Jaringan ----------
function wireNet(net) {
  net.on("welcome", (m) => {
    if (m.tiles && m.w && m.h) {
      const w = new World(m.w, m.h, state.world.defs);
      w.tiles.set(m.tiles);
      state.world = w;
    }
  });
  net.on("players", (m) => {
    const seen = new Set();
    for (const p of m.list) {
      if (p.id === net.id) continue;
      seen.add(p.id);
      const r = state.remotes.get(p.id) ?? { x: p.x, y: p.y };
      r.tx = p.x;
      r.ty = p.y;
      r.f = p.f;
      r.name = p.name;
      state.remotes.set(p.id, r);
    }
    for (const id of state.remotes.keys()) if (!seen.has(id)) state.remotes.delete(id);
  });
  net.on("tile", (m) => state.world.set(m.x, m.y, m.id));
  net.on("left", (m) => state.remotes.delete(m.id));
  net.on("closed", () => toast("Koneksi terputus"));
  return net;
}

// ---------- Boot ----------
async function boot() {
  resize();
  window.addEventListener("resize", resize);
  ctx.font = "14px monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText("Memuat...", 20, 30);

  state.assets = await loadAssets("manifest.json");
  const defs = {};
  for (const [id, d] of Object.entries(state.assets.manifest.tiles)) {
    defs[id] = { solid: !!d.solid, hits: d.hits < 0 ? Infinity : d.hits };
  }
  state.world = generateWorld(defs);
  state.player = createPlayer(SPAWN.x, SPAWN.y);
  state.playerName = new URLSearchParams(location.search).get("name") || "Pemain";
  state.net = createNet(state.playerName);
  wireNet(state.net);
  try {
    await state.net.connect();
  } catch (e) {
    console.warn(e);
    toast("Server tidak bisa dihubungi, main offline");
    state.net = wireNet(new LocalTransport());
  }

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      update(STEP);
      acc -= STEP;
    }
    for (const r of state.remotes.values()) {
      if (r.tx !== undefined) {
        r.x += (r.tx - r.x) * 0.3;
        r.y += (r.ty - r.y) * 0.3;
      }
    }
    updateCamera();
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.gt = state; // memudahkan debugging dari console
}

boot().catch((e) => {
  console.error(e);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#300";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = "14px monospace";
  ctx.fillText("Gagal memulai: " + e.message, 20, 30);
});
