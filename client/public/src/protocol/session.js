// Sesi login Growtopia lewat gateway WebSocket.
//
// Alur (mengikuti GrowServer, src/game/server/game-server.ts):
//   1. Buka koneksi login -> server kirim HELLO.
//   2. Kirim permintaan konten statis (tankIDName + token) -> server balas
//      OnSuperMainStartAcceptLogonHrdxs47254722215a (hash items.dat, CDN, settings).
//   3. Kirim ltoken -> server balas SetHasGrowID + OnSendToServer(port, token, userID, "addr|door|", lmode, nama)
//      lalu menutup koneksi login.
//   4. Buka koneksi ke port yang diberikan -> HELLO -> kirim token transfer + user.
//   5. Server membalas SetHasGrowID: sesi siap. Soket game diserahkan lewat event "ready".
//
// Alamat dari OnSendToServer sengaja DIABAIKAN. Hanya port yang dipakai, dan koneksi
// selalu ke wsBase yang kita konfigurasi, supaya server tidak bisa mengarahkan browser
// ke host lain.

import { PACKET_TYPE, LOGON_MODE, TANK_TYPE, buildText, decodePacket, encodeText, parseCall } from "./packets.js";

export const SUPERMAIN = "OnSuperMainStartAcceptLogonHrdxs47254722215a";

/** Hapus kode warna Growtopia (backtick + 1 karakter). */
export const stripColor = (s) => String(s).replace(/`./g, "");

/** Pecah string settings "k=v|k=v|" dari SuperMain. */
export function parseSettings(s) {
  const out = {};
  for (const part of String(s).split("|")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

export class LoginSession {
  /**
   * @param {object} o
   * @param {string} o.wsBase  mis. "wss://game.contoh.com" atau "ws://localhost:17903" (tanpa slash akhir)
   * @param {string} o.ltoken  token dari POST /player/growid/login/validate
   * @param {string} o.name    GrowID
   * @param {number} [o.port=17091] port game server untuk koneksi login
   * @param {number} [o.protocol=216]
   * @param {number[]} [o.allowedPorts] kalau diisi, port redirect harus ada di sini
   * @param {number} [o.stepTimeoutMs=10000]
   * @param {(url:string)=>object} [o.createSocket]
   */
  constructor(o) {
    if (!o?.wsBase || !o.ltoken || !o.name) throw new TypeError("wsBase, ltoken, dan name wajib");
    this.o = { port: 17091, protocol: 216, stepTimeoutMs: 10000, createSocket: (u) => new WebSocket(u), ...o };
    this.wsBase = this.o.wsBase.replace(/\/+$/, "");
    this.handlers = {};
    this.state = "idle";
    this.info = null; // dari SuperMain
    this.socket = null;
    this.redirect = null; // dari OnSendToServer
    this.lastConsole = "";
    this._gen = 0;
    this._timer = null;
  }

  on(event, fn) {
    (this.handlers[event] ??= []).push(fn);
    return this;
  }

  _emit(event, payload) {
    for (const fn of this.handlers[event] ?? []) fn(payload);
  }

  _setState(s) {
    this.state = s;
    this._emit("state", s);
  }

  /** Mulai login. Hasilnya lewat event "ready" atau "failed". */
  start() {
    if (this.state !== "idle") throw new Error("sesi sudah dimulai");
    this._connect(this.o.port, "login");
  }

  send(bytes) {
    if (this.state !== "ready") throw new Error("sesi belum siap");
    this.socket.send(bytes);
  }

  close() {
    this._gen++;
    clearTimeout(this._timer);
    try {
      this.socket?.close();
    } catch {
      /* sudah tertutup */
    }
    if (this.state !== "failed") this._setState("closed");
  }

  _fail(reason) {
    if (this.state === "failed" || this.state === "closed") return;
    this._gen++;
    clearTimeout(this._timer);
    const detail = this.lastConsole ? ` (server: ${this.lastConsole})` : "";
    try {
      this.socket?.close();
    } catch {
      /* abaikan */
    }
    this._setState("failed");
    this._emit("failed", new Error(reason + detail));
  }

  _arm(label) {
    clearTimeout(this._timer);
    const gen = this._gen;
    this._timer = setTimeout(() => {
      if (gen === this._gen) this._fail(`waktu habis menunggu ${label}`);
    }, this.o.stepTimeoutMs);
  }

  _connect(port, phase) {
    const gen = ++this._gen;
    const url = `${this.wsBase}/ws/${port}`;
    this._setState(phase === "login" ? "connecting-login" : "connecting-game");
    this._arm("koneksi");
    let sock;
    try {
      sock = this.o.createSocket(url);
    } catch (e) {
      return this._fail(`tidak bisa membuka ${url}: ${e.message}`);
    }
    sock.binaryType = "arraybuffer";
    this.socket = sock;
    sock.onerror = () => {
      if (gen === this._gen) this._fail(`koneksi ke ${url} gagal`);
    };
    sock.onclose = () => {
      if (gen !== this._gen) return;
      // login ditutup server setelah OnSendToServer: itu normal dan sudah menaikkan _gen
      this._fail(this.state === "ready" ? "koneksi terputus" : "koneksi ditutup sebelum selesai");
    };
    sock.onmessage = (ev) => {
      if (gen !== this._gen) return;
      if (!(ev.data instanceof ArrayBuffer)) return; // hanya biner
      let pkt;
      try {
        pkt = decodePacket(new Uint8Array(ev.data));
      } catch (e) {
        return this._emit("warning", `paket cacat diabaikan: ${e.message}`);
      }
      try {
        this._onPacket(pkt, phase);
      } catch (e) {
        this._fail(`kesalahan protokol: ${e.message}`);
      }
    };
  }

  _onPacket(pkt, phase) {
    if (pkt.kind === "hello") {
      return phase === "login" ? this._sendStaticRequest() : this._sendTransfer();
    }
    if (pkt.kind === "text") {
      return this._emit("text", pkt.text);
    }
    if (pkt.kind !== "tank") return;

    if (pkt.tank.type !== TANK_TYPE.CALL_FUNCTION) {
      if (this.state === "ready") this._emit("packet", pkt);
      return;
    }
    const call = parseCall(pkt.tank);

    if (call.name === "OnConsoleMessage") {
      this.lastConsole = stripColor(call.args[0] ?? "");
      this._emit("console", this.lastConsole);
      if (phase === "game" && this.state !== "ready" && /verification failed|expired/i.test(this.lastConsole)) {
        this._fail("transfer ditolak server");
      }
      return;
    }

    if (phase === "login") {
      if (call.name === SUPERMAIN && this.state === "await-supermain") {
        const [itemsHash, cdnHost, cdnPath, , settings, tributeHash] = call.args;
        this.info = { itemsHash, cdnHost, cdnPath, tributeHash, settings: parseSettings(settings) };
        this._emit("supermain", this.info);
        return this._sendLtoken();
      }
      if (call.name === "OnSendToServer" && this.state === "await-redirect") {
        return this._onRedirect(call.args);
      }
      return;
    }

    // phase === "game"
    if (call.name === "SetHasGrowID" && this.state === "await-ready") {
      clearTimeout(this._timer);
      this._setState("ready");
      return this._emit("ready", { socket: this.socket, info: this.info, name: this.o.name, userID: this.redirect.userID });
    }
    if (this.state === "ready") this._emit("packet", pkt);
  }

  _sendStaticRequest() {
    this._setState("await-supermain");
    this._arm("OnSuperMain");
    this.socket.send(
      encodeText(
        buildText([
          ["protocol", this.o.protocol],
          ["platformID", 0],
          ["tankIDName", this.o.name],
          ["token", "0"],
        ]),
      ),
    );
  }

  _sendLtoken() {
    this._setState("await-redirect");
    this._arm("OnSendToServer");
    this.socket.send(
      encodeText(
        buildText([
          ["protocol", this.o.protocol],
          ["ltoken", this.o.ltoken],
          ["platformID", 0],
        ]),
      ),
    );
  }

  _onRedirect(args) {
    const [port, token, userID, addr, lmode] = args;
    const door = String(addr ?? "").split("|")[1] ?? "";
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError(`port redirect tidak valid: ${port}`);
    if (this.o.allowedPorts && !this.o.allowedPorts.includes(port)) throw new RangeError(`port ${port} tidak diizinkan`);
    if (!Number.isInteger(token) || !Number.isInteger(userID)) throw new RangeError("token/userID redirect tidak valid");
    this.redirect = { port, token, userID, door, lmode: Number.isInteger(lmode) ? lmode : LOGON_MODE.WELCOME };
    this._emit("redirect", { port, door });
    const old = this.socket;
    this._gen++; // koneksi login ditutup dengan sengaja, bukan kegagalan
    try {
      old.close();
    } catch {
      /* abaikan */
    }
    this._connect(port, "game");
  }

  _sendTransfer() {
    const r = this.redirect;
    this._setState("await-ready");
    this._arm("SetHasGrowID");
    this.socket.send(
      encodeText(
        buildText([
          ["protocol", this.o.protocol],
          ["tankIDName", this.o.name],
          ["token", r.token],
          ["user", r.userID],
          ["lmode", r.lmode],
          ["doorID", r.door],
          ["platformID", 0],
        ]),
      ),
    );
  }
}

export { PACKET_TYPE };
