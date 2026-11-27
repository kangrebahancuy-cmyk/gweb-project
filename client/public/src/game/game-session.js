// Sesi permainan: dipasang di atas LoginSession yang sudah "ready".
//
// Menangani alur setelah login (mengikuti GrowServer):
//   refresh_item_data -> SEND_ITEM_DATABASE_DATA (zlib, itemID = panjang asli)
//   enter_game        -> inventori, gem, dst.
//   join_request      -> SEND_MAP_DATA, OnSpawn (local + pemain lain), OnSetPos
// Selama di dunia:
//   STATE (gerak), TILE_CHANGE_REQUEST (pukul/pasang), SEND_TILE_UPDATE_DATA,
//   TILE_APPLY_DAMAGE, OnTalkBubble / OnConsoleMessage, OnRemove.
//
// Kelas ini tidak menyentuh DOM atau jaringan sendiri: ia menerima paket hasil decodePacket()
// lewat handle() dan mengirim lewat fungsi `send`. Itu membuatnya bisa diuji tanpa browser.
// Server adalah otoritas: klien hanya mengirim niat, dan keadaan dunia berubah hanya karena
// paket dari server.

import { TANK_TYPE, TANK_FLAGS, PACKET_TYPE, buildText, encodeText, encodeTank, parseCall, parseText } from "../protocol/packets.js";
import { ItemDB, parseItemsDat, inflateZlib, ACTION } from "./items.js";
import { parseWorld, tileIndex, TILE_FLAG } from "./world-data.js";

export const ITEM_FIST = 18;
export const ITEM_WRENCH = 32;
const MAX_ITEMS_UNCOMPRESSED = 32 * 1024 * 1024;
const MAX_PLAYERS = 4096;
const MAX_CHAT = 200;

/** Hapus kode warna Growtopia (backtick + 1 karakter). */
const stripColor = (s) => String(s).replace(/`./g, "");
/** Buang awalan metadata chat: "CP:_PL:0_OID:_" dan "CT:[W]_". */
export const cleanChat = (s) => stripColor(s).replace(/^CP:_PL:\d+_OID:_/, "").replace(/^CT:\[[^\]]*\]_/, "").trim();

export class GameSession {
  /**
   * @param {object} o
   * @param {(bytes:Uint8Array)=>void} o.send kirim satu frame ke server
   * @param {string} [o.name] GrowID sendiri (untuk menandai pemain lokal)
   */
  constructor(o) {
    if (typeof o?.send !== "function") throw new TypeError("send wajib");
    this.send = o.send;
    this.name = o.name ?? "";
    this.handlers = {};
    this.items = null; // ItemDB
    this.world = null; // hasil parseWorld, dengan fg/bg/flags yang berubah
    this.worldName = "";
    this.inventory = new Map(); // itemID -> jumlah
    this.inventoryMax = 0;
    this.players = new Map(); // netID -> {netID,userID,name,x,y,facingLeft,local}
    this.me = null; // entri pemain lokal
    this.damage = new Map(); // indeks tile -> {amount, at}
    this._itemsWaiter = null;
    this._seq = 0;
  }

  on(event, fn) {
    (this.handlers[event] ??= []).push(fn);
    return this;
  }
  _emit(event, payload) {
    for (const fn of this.handlers[event] ?? []) fn(payload);
  }

  /** Pasang ke LoginSession yang sudah siap. */
  attach(login) {
    login.on("packet", (p) => this.handle(p));
    login.on("console", (t) => this._emit("console", t));
    login.on("text", (t) => this._onText(t));
    login.on("failed", (e) => this._emit("disconnect", e));
    login.on("state", (s) => {
      if (s === "closed") this._emit("disconnect", new Error("koneksi ditutup"));
    });
    return this;
  }

  // ------------------------------------------------------------ kirim

  _text(pairs) {
    this.send(encodeText(buildText(pairs), PACKET_TYPE.GAME_MESSAGE));
  }

  /** Minta items.dat dan bangun UI: urutan yang sama dengan klien asli. Mengembalikan ItemDB. */
  async start(timeoutMs = 20000) {
    const items = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("waktu habis menunggu items.dat")), timeoutMs);
      this._itemsWaiter = { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } };
    });
    this._text([["action", "refresh_item_data"]]);
    const db = await items;
    this._text([["action", "enter_game"]]);
    return db;
  }

  /** Masuk ke dunia. Nama dibatasi seperti di server: huruf/angka, maksimal 24. */
  joinWorld(name) {
    const n = String(name).trim().toUpperCase();
    if (!/^[A-Z0-9]{1,24}$/.test(n)) throw new RangeError("nama dunia hanya huruf dan angka, maksimal 24 karakter");
    this._text([["action", "join_request"], ["name", n], ["invitedWorld", 0]]);
  }

  leaveWorld() {
    this._text([["action", "quit_to_exit"]]);
  }

  say(text) {
    const t = String(text).replace(/[\r\n|\0]/g, " ").slice(0, MAX_CHAT).trim();
    if (!t) return;
    this._text([["action", "input"], ["text", t]]);
  }

  /** Kirim posisi (piksel) dan arah. Server tidak mempercayai klien untuk tabrakan; ini hanya laporan. */
  sendMove(x, y, { facingLeft = false, speedX = 0, speedY = 0, onGround = true, jumping = false } = {}) {
    let flags = 0;
    if (facingLeft) flags |= TANK_FLAGS.FACING_LEFT;
    if (onGround) flags |= TANK_FLAGS.ON_GROUND;
    if (jumping) flags |= TANK_FLAGS.ON_JUMP;
    this.send(encodeTank({ type: TANK_TYPE.STATE, netID: this.me?.netID ?? 0, posX: x, posY: y, speedX, speedY, flags }));
    if (this.me) {
      this.me.x = x;
      this.me.y = y;
      this.me.facingLeft = facingLeft;
    }
  }

  /** Pukul tile. */
  punch(tx, ty, opts = {}) {
    this._tileRequest(ITEM_FIST, tx, ty, opts);
  }

  /** Pasang item dari inventori di tile. Mengembalikan false kalau item tidak dimiliki (tidak dikirim). */
  place(itemID, tx, ty, opts = {}) {
    if (itemID === ITEM_FIST || itemID === ITEM_WRENCH) return false;
    if ((this.inventory.get(itemID) ?? 0) <= 0) return false;
    this._tileRequest(itemID, tx, ty, opts);
    return true;
  }

  wrench(tx, ty, opts = {}) {
    this._tileRequest(ITEM_WRENCH, tx, ty, opts);
  }

  _tileRequest(itemID, tx, ty, { facingLeft } = {}) {
    if (!this.world || !this.me) return;
    if (tileIndex(this.world, tx, ty) < 0) return;
    let flags = 0;
    if (facingLeft ?? this.me.facingLeft) flags |= TANK_FLAGS.FACING_LEFT;
    this.send(
      encodeTank({
        type: TANK_TYPE.TILE_CHANGE_REQUEST,
        netID: this.me.netID,
        itemID,
        tileX: tx,
        tileY: ty,
        posX: this.me.x,
        posY: this.me.y,
        flags,
      }),
    );
  }

  // ------------------------------------------------------------ terima

  _onText(text) {
    const p = parseText(text);
    if (p.has("action")) this._emit("action", { action: p.get("action"), text });
  }

  /** Proses satu paket hasil decodePacket(). Galat tidak melempar keluar: dilaporkan lewat event "error". */
  handle(pkt) {
    try {
      this._handle(pkt);
    } catch (e) {
      this._emit("error", e);
    }
  }

  _handle(pkt) {
    if (pkt.kind === "text") return this._onText(pkt.text);
    if (pkt.kind !== "tank") return;
    const t = pkt.tank;
    switch (t.type) {
      case TANK_TYPE.SEND_ITEM_DATABASE_DATA: return this._onItems(t);
      case TANK_TYPE.SEND_INVENTORY_STATE: return this._onInventory(t.extraData);
      case TANK_TYPE.MODIFY_ITEM_INVENTORY: return this._onModifyInventory(t);
      case TANK_TYPE.SEND_MAP_DATA: return this._onMap(t.extraData);
      case TANK_TYPE.STATE: return this._onState(t);
      case TANK_TYPE.TILE_CHANGE_REQUEST: return this._onTileChange(t);
      case TANK_TYPE.SEND_TILE_UPDATE_DATA: return this._onTileUpdate(t);
      case TANK_TYPE.TILE_APPLY_DAMAGE: return this._onDamage(t);
      case TANK_TYPE.CALL_FUNCTION: return this._onCall(t);
      default: return;
    }
  }

  async _onItems(t) {
    const waiter = this._itemsWaiter;
    try {
      const expected = t.itemID;
      if (!(expected > 0) || expected > MAX_ITEMS_UNCOMPRESSED) throw new RangeError(`panjang items.dat tidak masuk akal: ${expected}`);
      const raw = await inflateZlib(t.extraData, expected);
      const db = new ItemDB(parseItemsDat(raw));
      this.items = db;
      this._itemsWaiter = null;
      this._emit("items", db);
      waiter?.resolve(db);
    } catch (e) {
      this._itemsWaiter = null;
      waiter?.reject(e);
      this._emit("error", e);
    }
  }

  _onInventory(extra) {
    const v = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
    if (extra.length < 7) throw new RangeError("inventori terpotong");
    const max = v.getUint32(1, true);
    const n = v.getUint16(5, true);
    if (7 + n * 4 > extra.length) throw new RangeError("inventori terpotong");
    const inv = new Map();
    for (let i = 0; i < n; i++) {
      const id = v.getUint16(7 + i * 4, true);
      const amt = v.getUint16(9 + i * 4, true) & 0xff; // bit 8 = dipakai (pakaian)
      inv.set(id, amt);
    }
    this.inventory = inv;
    this.inventoryMax = max;
    this._emit("inventory", inv);
  }

  _onModifyInventory(t) {
    const delta = t.buildRange > 0 ? t.buildRange : -t.jumpCount;
    if (!delta) return;
    const next = (this.inventory.get(t.itemID) ?? 0) + delta;
    if (next <= 0) this.inventory.delete(t.itemID);
    else this.inventory.set(t.itemID, Math.min(next, 255));
    this._emit("inventory", this.inventory);
  }

  _onMap(extra) {
    const w = parseWorld(extra);
    this.world = w;
    this.worldName = w.name;
    this.players.clear();
    this.me = null;
    this.damage.clear();
    this._emit("world", w);
  }

  _onState(t) {
    const p = this.players.get(t.netID);
    if (!p || p.local) return; // gerak sendiri ditentukan klien; hanya pemain lain yang dipercaya dari paket ini
    p.x = t.posX;
    p.y = t.posY;
    p.facingLeft = (t.flags & TANK_FLAGS.FACING_LEFT) !== 0;
    p.speedX = t.speedX;
    p.speedY = t.speedY;
    this._emit("players", this.players);
  }

  _setTile(idx, fg, bg, flags) {
    const w = this.world;
    w.fg[idx] = fg;
    w.bg[idx] = bg;
    w.flags[idx] = flags;
    this.damage.delete(idx);
  }

  _onTileChange(t) {
    const w = this.world;
    if (!w) return;
    const idx = tileIndex(w, t.tileX, t.tileY);
    if (idx < 0) return;
    // pukulan yang menghancurkan blok datang sebagai itemID=FIST; keadaan akhirnya
    // dikirim server lewat SEND_TILE_UPDATE_DATA, jadi di sini tidak ada yang diubah.
    if (t.itemID === ITEM_FIST || t.itemID === ITEM_WRENCH) return;
    const it = this.items?.get(t.itemID);
    if (!it) return;
    if (it.type === ACTION.BACKGROUND) {
      w.bg[idx] = t.itemID;
    } else {
      w.fg[idx] = t.itemID;
      let f = w.flags[idx] & (TILE_FLAG.LOCKED | TILE_FLAG.WATER);
      if (t.flags & TANK_FLAGS.FACING_LEFT) f |= TILE_FLAG.FLIPPED;
      w.flags[idx] = f;
      w.extras.delete(idx);
    }
    this.damage.delete(idx);
    if (t.netID === this.me?.netID) {
      // klien asli mengurangi inventori sendiri saat menerima gema ini
      const have = this.inventory.get(t.itemID) ?? 0;
      if (have <= 1) this.inventory.delete(t.itemID);
      else this.inventory.set(t.itemID, have - 1);
      this._emit("inventory", this.inventory);
    }
    this._emit("tile", { x: t.tileX, y: t.tileY });
  }

  _onTileUpdate(t) {
    const w = this.world;
    if (!w) return;
    const idx = tileIndex(w, t.tileX, t.tileY);
    if (idx < 0) return;
    const b = t.extraData;
    if (b.length < 8) throw new RangeError("pembaruan tile terlalu pendek");
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const flags = v.getUint16(6, true);
    this._setTile(idx, v.getUint16(0, true), v.getUint16(2, true), flags);
    // data ekstra tidak di-parse ulang di sini; hapus yang lama supaya tidak basi
    w.extras.delete(idx);
    this._emit("tile", { x: t.tileX, y: t.tileY });
  }

  _onDamage(t) {
    const w = this.world;
    if (!w) return;
    const idx = tileIndex(w, t.tileX, t.tileY);
    if (idx < 0) return;
    this.damage.set(idx, { amount: t.itemID, at: Date.now() });
    this._emit("damage", { x: t.tileX, y: t.tileY, netID: t.netID });
  }

  _onCall(t) {
    const call = parseCall(t);
    const a = call.args;
    switch (call.name) {
      case "OnSpawn": return this._onSpawn(String(a[0] ?? ""));
      case "OnRemove": {
        const p = parseText(String(a[0] ?? ""));
        const id = p.getInt("netID", -1);
        if (this.players.delete(id)) this._emit("players", this.players);
        return;
      }
      case "OnSetPos": {
        const p = this.players.get(call.netID);
        const [x, y] = Array.isArray(a[0]) ? a[0] : [];
        if (p && Number.isFinite(x) && Number.isFinite(y)) {
          p.x = x;
          p.y = y;
          this._emit("players", this.players);
        }
        return;
      }
      case "OnSetClothing": {
        const p = this.players.get(call.netID);
        if (!p) return;
        const v3 = (x) => (Array.isArray(x) ? x.map((n) => (Number.isFinite(n) ? Math.round(n) : 0)) : [0, 0, 0]);
        const [hair, shirt, pants] = v3(a[0]);
        const [feet, face, hand] = v3(a[1]);
        const [back, mask, necklace] = v3(a[2]);
        p.clothes = { hair, shirt, pants, feet, face, hand, back, mask, necklace, ances: v3(a[4])[0] };
        p.skin = Number(a[3]) >>> 0;
        this._emit("players", this.players);
        return;
      }
      case "OnTalkBubble": {
        const [netID, text] = a;
        this._emit("chat", { netID, text: cleanChat(text), name: this.players.get(netID)?.name ?? "" });
        return;
      }
      case "OnFailedToEnterWorld": return this._emit("joinfailed", {});
      case "OnRequestWorldSelectMenu": return this._emit("worldmenu", {});
      default: return;
    }
  }

  _onSpawn(text) {
    const p = parseText(text);
    if (p.get("spawn") !== "avatar") return;
    const netID = p.getInt("netID", -1);
    if (netID < 0) return;
    if (!this.players.has(netID) && this.players.size >= MAX_PLAYERS) return;
    const [x, y] = [p.get("posXY", 0), p.get("posXY", 1)].map(Number);
    const entry = {
      netID,
      userID: p.getInt("userID", 0),
      name: stripColor(p.get("name")),
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      facingLeft: false,
      speedX: 0,
      speedY: 0,
      local: p.get("type") === "local",
      clothes: null,
      skin: 0x8295c3ff,
    };
    this.players.set(netID, entry);
    if (entry.local) this.me = entry;
    this._emit("players", this.players);
    if (entry.local) this._emit("spawn", entry);
  }
}
