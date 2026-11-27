// Tampilan dan input permainan: kanvas, kamera, fisika lokal, hotbar, chat.
// Logika protokol ada di GameSession; file ini hanya menggambar keadaan darinya dan
// meneruskan niat pemain. Pemain digambar sebagai kotak berwarna (sementara, sampai ada pixel art sendiri).
import { createPlayer, stepPlayer } from "../physics.js";
import { decodeRttex } from "./rttex.js";
import { ACTION } from "./items.js";
import { TILE_FLAG } from "./world-data.js";

const TILE = 32;
const REACH = 4; // jarak pukul/pasang dalam tile (server tetap memeriksa sendiri)
const SEND_INTERVAL_MS = 100;
const SAFE_NAME = /^[\w.\-]+$/;

/** Warna cadangan yang stabil per item, dipakai kalau tekstur belum/gagal dimuat. */
function fallbackColor(id) {
  const h = (id * 2654435761) >>> 0;
  return `hsl(${h % 360} 45% ${35 + ((h >> 9) % 30)}%)`;
}

export class GameView {
  /**
   * @param {object} o
   * @param {HTMLCanvasElement} o.canvas
   * @param {import('./game-session.js').GameSession} o.session
   * @param {string} [o.cdnBase] mis. "/cdn/growtopia/game/" (harus berakhir slash)
   * @param {HTMLElement} [o.hotbar]
   */
  constructor(o) {
    this.canvas = o.canvas;
    this.ctx = o.canvas.getContext("2d");
    this.s = o.session;
    this.cdnBase = o.cdnBase ?? "/cdn/growtopia/game/";
    this.hotbarEl = o.hotbar ?? null;
    this.keys = new Set();
    this.me = null; // fisika lokal
    this.selected = 0; // item terpilih untuk dipasang
    this.cam = { x: 0, y: 0 };
    this.mouse = { x: 0, y: 0, tx: 0, ty: 0, left: false, right: false };
    this.textures = new Map(); // nama file -> {state, bmp}
    this.lastSend = 0;
    this.lastSent = null;
    this.lastAct = 0;
    this.raf = 0;
    this.last = 0;
    this._bind();
  }

  _bind() {
    const s = this.s;
    s.on("spawn", (p) => {
      this.me = createPlayer(p.x, p.y);
      this.me.x = p.x;
      this.me.y = p.y;
    });
    s.on("world", () => {
      this.me = null;
    });
    s.on("players", () => {});
    s.on("inventory", () => this.renderHotbar());
    s.on("items", () => this.renderHotbar());

    const c = this.canvas;
    this._kd = (e) => {
      if (this._typing(e)) return;
      this.keys.add(e.code);
      if (/^Digit[1-9]$/.test(e.code)) this.select(Number(e.code.slice(5)) - 1);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
    };
    this._ku = (e) => this.keys.delete(e.code);
    this._blur = () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    };
    addEventListener("keydown", this._kd);
    addEventListener("keyup", this._ku);
    addEventListener("blur", this._blur);
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("mousemove", (e) => this._mouse(e));
    c.addEventListener("mousedown", (e) => {
      this._mouse(e);
      if (e.button === 0) this.mouse.left = true;
      if (e.button === 2) this.mouse.right = true;
    });
    addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
  }

  _typing(e) {
    const t = e.target;
    return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
  }

  _mouse(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / r.width;
    const sy = this.canvas.height / r.height;
    this.mouse.x = (e.clientX - r.left) * sx;
    this.mouse.y = (e.clientY - r.top) * sy;
  }

  start() {
    this.last = performance.now();
    const loop = (t) => {
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      this.update(dt, t);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    removeEventListener("keydown", this._kd);
    removeEventListener("keyup", this._ku);
    removeEventListener("blur", this._blur);
  }

  // ------------------------------------------------------------ inventori

  /** Item yang bisa dipasang, urut ID. Fist dan wrench tidak masuk; pakaian tidak dipasang sebagai blok. */
  placeables() {
    const db = this.s.items;
    const out = [];
    for (const [id, n] of this.s.inventory) {
      if (id === 18 || id === 32 || n <= 0) continue;
      const t = db?.get(id)?.type;
      if (t === ACTION.CLOTHES || t === ACTION.CONSUMABLE) continue;
      out.push(id);
    }
    return out.sort((a, b) => a - b);
  }

  select(i) {
    const list = this.placeables();
    if (i >= 0 && i < list.length) this.selected = i;
    this.renderHotbar();
  }

  renderHotbar() {
    const el = this.hotbarEl;
    if (!el) return;
    const list = this.placeables();
    if (this.selected >= list.length) this.selected = Math.max(0, list.length - 1);
    el.textContent = "";
    list.slice(0, 9).forEach((id, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = i === this.selected ? "slot sel" : "slot";
      b.textContent = `${i + 1}. ${this.s.items?.name(id) ?? id} x${this.s.inventory.get(id)}`;
      b.addEventListener("click", () => this.select(i));
      el.append(b);
    });
  }

  // ------------------------------------------------------------ update

  _solidAdapter() {
    const w = this.s.world;
    const db = this.s.items;
    return {
      isSolid: (tx, ty) => {
        if (ty < 0) return false;
        if (tx < 0 || tx >= w.width || ty >= w.height) return true;
        return db ? db.isSolid(w.fg[ty * w.width + tx]) : false;
      },
    };
  }

  update(dt, now) {
    const s = this.s;
    if (!s.world || !this.me) return;
    const k = this.keys;
    const input = {
      left: k.has("KeyA") || k.has("ArrowLeft"),
      right: k.has("KeyD") || k.has("ArrowRight"),
      jump: k.has("KeyW") || k.has("ArrowUp") || k.has("Space"),
    };
    stepPlayer(this.me, input, this._solidAdapter(), dt);

    // kamera
    const w = s.world;
    const vw = this.canvas.width;
    const vh = this.canvas.height;
    this.cam.x = Math.max(0, Math.min(w.width * TILE - vw, this.me.x + this.me.w / 2 - vw / 2));
    this.cam.y = Math.max(0, Math.min(w.height * TILE - vh, this.me.y + this.me.h / 2 - vh / 2));
    if (w.width * TILE < vw) this.cam.x = (w.width * TILE - vw) / 2;
    if (w.height * TILE < vh) this.cam.y = (w.height * TILE - vh) / 2;
    this.mouse.tx = Math.floor((this.mouse.x + this.cam.x) / TILE);
    this.mouse.ty = Math.floor((this.mouse.y + this.cam.y) / TILE);

    // laporan posisi: hanya kalau berubah atau tiap 1 detik
    if (now - this.lastSend >= SEND_INTERVAL_MS) {
      const st = [Math.round(this.me.x), Math.round(this.me.y), this.me.facing < 0, this.me.onGround];
      const changed = !this.lastSent || st.some((v, i) => v !== this.lastSent[i]);
      if (changed || now - this.lastSend > 1000) {
        s.sendMove(this.me.x, this.me.y, {
          facingLeft: this.me.facing < 0,
          speedX: this.me.vx,
          speedY: this.me.vy,
          onGround: this.me.onGround,
          jumping: this.me.vy < 0,
        });
        this.lastSent = st;
        this.lastSend = now;
      }
    }

    // pukul / pasang (ditahan = berulang tiap 150 ms)
    if ((this.mouse.left || this.mouse.right) && now - this.lastAct > 150) {
      const cx = Math.floor((this.me.x + this.me.w / 2) / TILE);
      const cy = Math.floor((this.me.y + this.me.h / 2) / TILE);
      const { tx, ty } = this.mouse;
      if (Math.abs(tx - cx) <= REACH && Math.abs(ty - cy) <= REACH) {
        const facingLeft = tx < cx ? true : tx > cx ? false : this.me.facing < 0;
        if (this.mouse.left) s.punch(tx, ty, { facingLeft });
        else {
          const id = this.placeables()[this.selected];
          if (id) s.place(id, tx, ty, { facingLeft });
        }
        this.lastAct = now;
      }
    }
  }

  // ------------------------------------------------------------ tekstur

  _texture(name) {
    if (!name || !SAFE_NAME.test(name)) return null;
    let t = this.textures.get(name);
    if (!t) {
      t = { state: "loading", bmp: null };
      this.textures.set(name, t);
      fetch(this.cdnBase + name)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((b) => decodeRttex(new Uint8Array(b)))
        .then((d) => createImageBitmap(new ImageData(d.rgba, d.width, d.height)))
        .then((bmp) => {
          t.bmp = bmp;
          t.state = "ok";
        })
        .catch(() => {
          t.state = "failed";
        });
    }
    return t.state === "ok" ? t.bmp : null;
  }

  _drawItem(ctx, id, dx, dy) {
    const it = this.s.items?.get(id);
    const bmp = it ? this._texture(it.texture) : null;
    if (bmp) {
      ctx.drawImage(bmp, it.textureX * TILE, it.textureY * TILE, TILE, TILE, dx, dy, TILE, TILE);
    } else {
      ctx.fillStyle = fallbackColor(id);
      ctx.fillRect(dx, dy, TILE, TILE);
    }
  }

  // ------------------------------------------------------------ gambar

  draw() {
    const ctx = this.ctx;
    const { width: vw, height: vh } = this.canvas;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#6fb7e8";
    ctx.fillRect(0, 0, vw, vh);
    const s = this.s;
    const w = s.world;
    if (!w) {
      ctx.fillStyle = "#fff";
      ctx.font = "16px system-ui";
      ctx.fillText("Belum di dunia. Masukkan nama dunia lalu Masuk.", 20, 30);
      return;
    }
    const cx = Math.round(this.cam.x);
    const cy = Math.round(this.cam.y);
    const x0 = Math.max(0, Math.floor(cx / TILE));
    const x1 = Math.min(w.width - 1, Math.floor((cx + vw) / TILE));
    const y0 = Math.max(0, Math.floor(cy / TILE));
    const y1 = Math.min(w.height - 1, Math.floor((cy + vh) / TILE));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w.width + x;
        if (w.bg[i]) this._drawItem(ctx, w.bg[i], x * TILE - cx, y * TILE - cy);
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * w.width + x;
        const fg = w.fg[i];
        if (!fg) continue;
        const dx = x * TILE - cx;
        const dy = y * TILE - cy;
        if (w.flags[i] & TILE_FLAG.SEED && fg % 2 === 1) {
          ctx.fillStyle = "#4caf50"; // pohon: render khusus belum dibuat
          ctx.fillRect(dx + 8, dy + 8, 16, 24);
        } else {
          this._drawItem(ctx, fg, dx, dy);
        }
        const d = s.damage.get(i);
        if (d) {
          const age = Date.now() - d.at;
          if (age < 4000) {
            ctx.fillStyle = `rgba(0,0,0,${Math.min(0.6, 0.15 + d.amount * 0.05)})`;
            ctx.fillRect(dx + 4, dy + 4, TILE - 8, TILE - 8);
          }
        }
      }
    }
    for (const d of w.dropped) {
      const dx = d.x - cx;
      const dy = d.y - cy;
      if (dx > -TILE && dx < vw && dy > -TILE && dy < vh) {
        ctx.save();
        ctx.scale(1, 1);
        this._drawItem(ctx, d.id, dx, dy);
        ctx.restore();
      }
    }

    // pemain
    ctx.font = "12px system-ui";
    ctx.textAlign = "center";
    for (const p of s.players.values()) {
      const px = (p.local && this.me ? this.me.x : p.x) - cx;
      const py = (p.local && this.me ? this.me.y : p.y) - cy;
      ctx.fillStyle = p.local ? "#ffcc33" : "#e86f6f";
      ctx.fillRect(px, py, 20, 30);
      ctx.fillStyle = "#222";
      ctx.fillRect(px + ((p.local && this.me ? this.me.facing < 0 : p.facingLeft) ? 3 : 11), py + 6, 6, 6);
      ctx.fillStyle = "#fff";
      ctx.fillText(p.name, px + 10, py - 4);
    }
    ctx.textAlign = "start";

    // penanda tile yang disorot
    const { tx, ty } = this.mouse;
    if (tx >= 0 && ty >= 0 && tx < w.width && ty < w.height) {
      ctx.strokeStyle = "rgba(255,255,255,.7)";
      ctx.strokeRect(tx * TILE - cx + 0.5, ty * TILE - cy + 0.5, TILE - 1, TILE - 1);
    }
  }
}
