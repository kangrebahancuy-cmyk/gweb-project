import test from "node:test";
import assert from "node:assert/strict";
import { decodePacket, encodeTank, parseText } from "../public/src/protocol/packets.js";
import { LoginSession, SUPERMAIN, parseSettings, stripColor } from "../public/src/protocol/session.js";
import { callPacket, helloPacket } from "./helpers.mjs";

class FakeSocket {
  constructor(url, onSend) {
    this.url = url;
    this.sent = [];
    this.closed = false;
    this._onSend = onSend;
  }
  send(bytes) {
    const p = decodePacket(bytes);
    this.sent.push(p.kind === "text" ? parseText(p.text) : p);
    queueMicrotask(() => this._onSend?.(this, this.sent.at(-1)));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.({}));
  }
  deliver(u8) {
    if (this.closed) return;
    this.onmessage?.({ data: u8.slice().buffer });
  }
}

/** Server palsu: meniru urutan GrowServer. `over` mengganti perilaku tertentu. */
function makeNet(over = {}) {
  const sockets = [];
  const TOKEN = 123456;
  const behavior = {
    port: 17092,
    addr: "127.0.0.1",
    userID: 42,
    onText(sock, t) {
      if (t.has("ltoken")) {
        sock.deliver(callPacket("SetHasGrowID", [{ i32: 1 }, t.get("tankIDName") || "alice", "sess"]));
        sock.deliver(callPacket("OnSendToServer", [this.port, TOKEN, this.userID, `${this.addr}||`, 1, "alice"]));
        sock.close();
      } else if (t.has("tankIDName") && t.has("token") && !t.has("user")) {
        sock.deliver(callPacket(SUPERMAIN, [999, "cdn.example", "growtopia/", "anticheat", "proto=216|isPayingUser=1|", 55]));
      } else if (t.has("token") && t.has("user")) {
        if (t.get("token") === String(TOKEN) && t.get("user") === String(this.userID)) {
          sock.deliver(callPacket("SetHasGrowID", [{ i32: 1 }, "alice", "sess"]));
        } else {
          sock.deliver(callPacket("OnConsoleMessage", ["`4Sub-server transfer verification failed or expired.``"]));
        }
      }
    },
    ...over,
  };
  const createSocket = (url) => {
    const s = new FakeSocket(url, (sock, p) => p.has && behavior.onText.call(behavior, sock, p));
    sockets.push(s);
    queueMicrotask(() => s.deliver(helloPacket()));
    return s;
  };
  return { sockets, createSocket, TOKEN };
}

const session = (net, extra = {}) =>
  new LoginSession({ wsBase: "wss://game.contoh.com/", ltoken: "TOKENB64", name: "alice", createSocket: net.createSocket, stepTimeoutMs: 300, ...extra });

const once = (s, ev) => new Promise((res) => s.on(ev, res));

test("alur penuh: login -> SuperMain -> ltoken -> OnSendToServer -> transfer -> ready", async () => {
  const net = makeNet();
  const s = session(net);
  const states = [];
  s.on("state", (x) => states.push(x));
  const supermain = once(s, "supermain");
  const ready = once(s, "ready");
  s.start();

  const info = await supermain;
  assert.equal(info.itemsHash, 999);
  assert.equal(info.cdnHost, "cdn.example");
  assert.equal(info.cdnPath, "growtopia/");
  assert.equal(info.settings.isPayingUser, "1");

  const r = await ready;
  assert.equal(r.userID, 42);
  assert.equal(s.state, "ready");
  assert.deepEqual(states, ["connecting-login", "await-supermain", "await-redirect", "connecting-game", "await-ready", "ready"]);

  // dua koneksi: login (port awal) lalu game (port dari redirect); slash akhir wsBase dibuang
  assert.deepEqual(net.sockets.map((x) => x.url), ["wss://game.contoh.com/ws/17091", "wss://game.contoh.com/ws/17092"]);
  assert.equal(net.sockets[0].closed, true);

  // isi paket yang dikirim klien
  const [staticReq, ltokenReq] = net.sockets[0].sent;
  assert.equal(staticReq.get("tankIDName"), "alice");
  assert.equal(staticReq.has("ltoken"), false);
  assert.equal(ltokenReq.get("ltoken"), "TOKENB64");
  const transfer = net.sockets[1].sent[0];
  assert.equal(transfer.get("token"), String(net.TOKEN));
  assert.equal(transfer.get("user"), "42");
  assert.equal(transfer.get("tankIDName"), "alice");
  assert.equal(transfer.get("lmode"), "1");
});

test("setelah ready, paket game diteruskan dan send() bekerja", async () => {
  const net = makeNet();
  const s = session(net);
  const ready = once(s, "ready");
  s.start();
  await ready;
  const got = once(s, "packet");
  net.sockets[1].deliver(callPacket("OnSetPos", [[1, 2]]));
  assert.equal((await got).kind, "tank");
  s.send(encodeTank({ type: 0, posX: 5 }));
  assert.equal(net.sockets[1].sent.length, 2);
  assert.equal(net.sockets[1].sent[1].tank.posX, 5);
});

test("alamat dari OnSendToServer diabaikan: selalu pakai wsBase", async () => {
  const net = makeNet({ addr: "evil.example" });
  const s = session(net);
  const ready = once(s, "ready");
  s.start();
  await ready;
  assert.ok(net.sockets.every((x) => x.url.startsWith("wss://game.contoh.com/ws/")));
});

test("token ltoken salah: server hanya kirim console -> gagal saat timeout, pesan server disertakan", async () => {
  const net = makeNet({
    onText(sock, t) {
      if (t.has("ltoken")) sock.deliver(callPacket("OnConsoleMessage", ["`4Invalid or expired session token, please login again.``"]));
      else if (t.has("tankIDName")) sock.deliver(callPacket(SUPERMAIN, [1, "c", "p", "a", "s", 2]));
    },
  });
  const s = session(net);
  const failed = once(s, "failed");
  s.start();
  const err = await failed;
  assert.match(err.message, /waktu habis menunggu OnSendToServer/);
  assert.match(err.message, /Invalid or expired session token/); // kode warna sudah dibuang
  assert.equal(s.state, "failed");
});

test("transfer ditolak: gagal cepat, tanpa menunggu timeout", async () => {
  const net = makeNet({
    onText(sock, t) {
      if (t.has("ltoken")) sock.deliver(callPacket("OnSendToServer", [17092, 1, 42, "127.0.0.1||", 1, "alice"])), sock.close();
      else if (t.has("tankIDName") && !t.has("user")) sock.deliver(callPacket(SUPERMAIN, [1, "c", "p", "a", "s", 2]));
      else if (t.has("user")) sock.deliver(callPacket("OnConsoleMessage", ["`4Sub-server transfer verification failed or expired.``"]));
    },
  });
  const s = session(net, { stepTimeoutMs: 5000 });
  const failed = once(s, "failed");
  const t0 = Date.now();
  s.start();
  const err = await failed;
  assert.match(err.message, /transfer ditolak/);
  assert.ok(Date.now() - t0 < 2000, "harus gagal cepat, bukan menunggu timeout 5 detik");
});

test("port redirect tidak valid atau di luar allowedPorts ditolak", async () => {
  for (const [port, opts] of [[0, {}], [70000, {}], [17099, { allowedPorts: [17091, 17092] }]]) {
    const net = makeNet({ port });
    const s = session(net, opts);
    const failed = once(s, "failed");
    s.start();
    const err = await failed;
    assert.match(err.message, /kesalahan protokol/);
    assert.equal(net.sockets.length, 1, `port ${port}: tidak boleh membuka koneksi kedua`);
  }
});

test("koneksi login ditutup sebelum redirect -> gagal", async () => {
  const net = makeNet({
    onText(sock, t) {
      if (t.has("tankIDName") && !t.has("ltoken")) sock.close();
    },
  });
  const s = session(net);
  const failed = once(s, "failed");
  s.start();
  assert.match((await failed).message, /ditutup sebelum selesai/);
});

test("paket cacat dan frame teks diabaikan tanpa merusak sesi", async () => {
  const net = makeNet();
  const s = session(net);
  const warnings = [];
  s.on("warning", (w) => warnings.push(w));
  const ready = once(s, "ready");
  s.start();
  await new Promise((r) => queueMicrotask(r));
  const sock = net.sockets[0];
  sock.onmessage({ data: Uint8Array.of(1, 2).buffer }); // terlalu pendek
  sock.onmessage({ data: "teks bukan biner" }); // bukan ArrayBuffer
  await ready;
  assert.equal(warnings.length, 1);
  assert.equal(s.state, "ready");
});

test("close() menghentikan sesi dan mengabaikan event berikutnya", async () => {
  const net = makeNet();
  const s = session(net);
  let failed = false;
  s.on("failed", () => (failed = true));
  s.start();
  s.close();
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(s.state, "closed");
  assert.equal(failed, false);
});

test("konstruktor dan state: parameter wajib, tidak bisa start dua kali, send sebelum siap", () => {
  assert.throws(() => new LoginSession({ wsBase: "ws://x" }), TypeError);
  const net = makeNet();
  const s = session(net);
  assert.throws(() => s.send(Uint8Array.of(1)), /belum siap/);
  s.start();
  assert.throws(() => s.start(), /sudah dimulai/);
  s.close();
});

test("helper: parseSettings dan stripColor", () => {
  assert.deepEqual(parseSettings("proto=216|a=b=c|isPayingUser=1|"), { proto: "216", a: "b=c", isPayingUser: "1" });
  assert.equal(stripColor("`4Gagal``: `wbiasa``"), "Gagal: biasa");
});
