import { afterEach, describe, expect, test } from "bun:test";
import { RateLimiter, WebPeer, isOriginAllowed, startWsGateway, type GatewayHandle, type GatewayOptions } from "../overlay/src/services/ws-gateway";

/** Emitter palsu dengan bentuk yang sama seperti emitter ENet (nanoevents). */
function fakeEmitter() {
  const events: { name: string; args: any[] }[] = [];
  return {
    events,
    emit(name: string, ...args: any[]) {
      events.push({ name, args });
    },
    named(n: string) {
      return events.filter((e) => e.name === n);
    },
  };
}

let gw: GatewayHandle | undefined;
afterEach(() => {
  gw?.stop();
  gw = undefined;
});

function start(em: ReturnType<typeof fakeEmitter>, extra: Partial<GatewayOptions> = {}) {
  gw = startWsGateway({
    port: 0,
    hostname: "127.0.0.1",
    allowedOrigins: ["https://game.contoh.com"],
    allowMissingOrigin: true,
    resolve: (p) => (p === 17091 ? em : undefined),
    ...extra,
  });
  return gw;
}

function open(path: string, headers: Record<string, string> = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${gw!.port}${path}`, { headers } as any);
  ws.binaryType = "arraybuffer";
  return ws;
}

const opened = (ws: WebSocket) =>
  new Promise<void>((res, rej) => {
    ws.onopen = () => res();
    ws.onerror = () => rej(new Error("gagal terhubung"));
  });
const closed = (ws: WebSocket) => new Promise<number>((res) => (ws.onclose = (e) => res(e.code)));
const nextMessage = (ws: WebSocket) => new Promise<Uint8Array>((res) => (ws.onmessage = (e) => res(new Uint8Array(e.data as ArrayBuffer))));
const waitFor = async (cond: () => boolean, ms = 1500) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error("timeout menunggu kondisi");
    await Bun.sleep(10);
  }
};

describe("gateway", () => {
  test("connect -> server kirim -> klien kirim -> disconnect", async () => {
    const em = fakeEmitter();
    start(em);
    const ws = open("/ws/17091");
    await opened(ws);
    await waitFor(() => em.named("connect").length === 1);

    const peer = em.named("connect")[0]!.args[0] as WebPeer;
    expect(peer.id).toBeGreaterThanOrEqual(1_000_000);

    // server -> klien (contoh: paket HELLO 01 00 00 00 00)
    const got = nextMessage(ws);
    peer.send({ data: () => new Uint8Array([1, 0, 0, 0, 0]) });
    expect([...(await got)]).toEqual([1, 0, 0, 0, 0]);

    // klien -> server
    ws.send(new Uint8Array([2, 0, 0, 0, 0x61, 0x62]));
    await waitFor(() => em.named("receive").length === 1);
    const [p, packet, channel] = em.named("receive")[0]!.args;
    expect(p).toBe(peer);
    expect([...packet.data()]).toEqual([2, 0, 0, 0, 0x61, 0x62]);
    expect(channel).toBe(0);

    ws.close();
    await waitFor(() => em.named("disconnect").length === 1);
    expect(em.named("disconnect")[0]!.args[0]).toBe(peer);
    expect(() => peer.send({ data: () => new Uint8Array([1, 0, 0, 0]) })).toThrow("NotConnected");
    await waitFor(() => gw!.connections() === 0);
  });

  test("disconnectLater dari server menutup koneksi dan memicu disconnect", async () => {
    const em = fakeEmitter();
    start(em);
    const ws = open("/ws/17091");
    await opened(ws);
    await waitFor(() => em.named("connect").length === 1);
    const peer = em.named("connect")[0]!.args[0] as WebPeer;
    const c = closed(ws);
    peer.disconnectLater();
    expect(await c).toBe(1000);
    await waitFor(() => em.named("disconnect").length === 1);
  });

  test("path salah dan port game server tak dikenal -> 404", async () => {
    start(fakeEmitter());
    expect((await fetch(`http://127.0.0.1:${gw!.port}/`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${gw!.port}/ws/abc`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${gw!.port}/ws/9999`)).status).toBe(404);
  });

  test("origin asing ditolak 403, origin yang diizinkan lolos", async () => {
    const em = fakeEmitter();
    start(em, { allowMissingOrigin: false });
    const bad = await fetch(`http://127.0.0.1:${gw!.port}/ws/17091`, { headers: { Origin: "https://jahat.example" } });
    expect(bad.status).toBe(403);
    const none = await fetch(`http://127.0.0.1:${gw!.port}/ws/17091`);
    expect(none.status).toBe(403);
    const ws = open("/ws/17091", { Origin: "https://game.contoh.com" });
    await opened(ws);
    await waitFor(() => em.named("connect").length === 1);
    ws.close();
  });

  test("frame teks ditolak (1003)", async () => {
    const em = fakeEmitter();
    start(em);
    const ws = open("/ws/17091");
    await opened(ws);
    const c = closed(ws);
    ws.send("halo");
    expect(await c).toBe(1003);
    expect(em.named("receive").length).toBe(0);
  });

  test("frame terlalu besar memutus koneksi", async () => {
    const em = fakeEmitter();
    start(em, { maxMessageBytes: 64 });
    const ws = open("/ws/17091");
    await opened(ws);
    const c = closed(ws);
    ws.send(new Uint8Array(200));
    expect(await c).toBe(1009);
    expect(em.named("receive").length).toBe(0);
  });

  test("frame < 4 byte diabaikan, tidak sampai ke game", async () => {
    const em = fakeEmitter();
    start(em);
    const ws = open("/ws/17091");
    await opened(ws);
    ws.send(new Uint8Array([1, 2]));
    ws.send(new Uint8Array([2, 0, 0, 0]));
    await waitFor(() => em.named("receive").length === 1);
    expect(em.named("receive").length).toBe(1);
    ws.close();
  });

  test("rate limit memutus koneksi yang membanjiri (1008)", async () => {
    const em = fakeEmitter();
    start(em, { messagesPerSecond: 1, messageBurst: 3 });
    const ws = open("/ws/17091");
    await opened(ws);
    const c = closed(ws);
    for (let i = 0; i < 20; i++) ws.send(new Uint8Array([4, 0, 0, 0]));
    expect(await c).toBe(1008);
    expect(em.named("receive").length).toBeLessThanOrEqual(4);
  });

  test("batas koneksi per IP -> 429", async () => {
    const em = fakeEmitter();
    start(em, { maxConnectionsPerIp: 2 });
    const a = open("/ws/17091");
    const b = open("/ws/17091");
    await Promise.all([opened(a), opened(b)]);
    await waitFor(() => gw!.connections() === 2);
    const third = await fetch(`http://127.0.0.1:${gw!.port}/ws/17091`, { headers: { Upgrade: "websocket", Connection: "Upgrade" } });
    expect(third.status).toBe(429);
    a.close();
    b.close();
  });

  test("ID peer unik antar koneksi", async () => {
    const em = fakeEmitter();
    start(em);
    const a = open("/ws/17091");
    const b = open("/ws/17091");
    await Promise.all([opened(a), opened(b)]);
    await waitFor(() => em.named("connect").length === 2);
    const ids = em.named("connect").map((e) => (e.args[0] as WebPeer).id);
    expect(new Set(ids).size).toBe(2);
    a.close();
    b.close();
  });
});

describe("helper", () => {
  test("isOriginAllowed", () => {
    const allowed = ["https://game.contoh.com"];
    expect(isOriginAllowed("https://game.contoh.com", "x", allowed)).toBe(true);
    expect(isOriginAllowed("https://jahat.example", "game.contoh.com", allowed)).toBe(false);
    expect(isOriginAllowed("https://game.contoh.com:8443", "x", allowed)).toBe(false);
    expect(isOriginAllowed("http://localhost:8080", "localhost:8080", [])).toBe(true); // same-origin
    expect(isOriginAllowed(null, "x", allowed)).toBe(false);
    expect(isOriginAllowed(null, "x", allowed, true)).toBe(true);
    expect(isOriginAllowed("bukan-url", "x", allowed)).toBe(false);
    expect(isOriginAllowed("https://apa.saja", "x", ["*"])).toBe(true);
  });

  test("RateLimiter mengisi ulang token seiring waktu", () => {
    let t = 0;
    const rl = new RateLimiter(10, 2, () => t);
    expect(rl.take()).toBe(true);
    expect(rl.take()).toBe(true);
    expect(rl.take()).toBe(false);
    t += 100; // 10/detik -> 1 token per 100 ms
    expect(rl.take()).toBe(true);
    expect(rl.take()).toBe(false);
  });
});
