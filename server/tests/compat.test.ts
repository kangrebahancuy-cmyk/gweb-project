/**
 * Tes kecocokan dengan kode ASLI GrowServer.
 *
 * Dijalankan hanya kalau GROWSERVER_DIR menunjuk ke salinan GrowServer:
 *   GROWSERVER_DIR=/path/ke/GrowServer bun test server/tests/compat.test.ts
 *
 * Yang dipakai dari GrowServer: Variant + GameUpdatePacket (encoder), ExtendBuffer,
 * decodeTextPacket, TextParser, dan PlayerAuth (validasi token transfer).
 * Yang ditiru: hanya "lem" game-server.ts (cabang teks) tanpa database, karena
 * dependensi GrowServer (pino, bun:sqlite/drizzle, dst.) tidak dipasang di sini.
 *
 * Gateway yang dites adalah gateway asli, bukan tiruan.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startWsGateway, type GatewayHandle } from "../overlay/src/services/ws-gateway";
import { decodePacket, encodeTank, parseCall, TANK_TYPE, encodeText } from "../../client/public/src/protocol/packets.js";
import { LoginSession } from "../../client/public/src/protocol/session.js";

const GS = process.env.GROWSERVER_DIR;
const suite = GS ? describe : describe.skip;

let ExtendBuffer: any, decodeTextPacket: any, TextParser: any, PlayerAuth: any, GameUpdatePacket: any, Variant: any, int64: any, int32: any;
// dihitung saat file dimuat (bukan di beforeAll) karena tes didaftarkan sebelum beforeAll jalan
const hasAuthFix = !!GS && readFileSync(`${GS}/src/game/player/auth.ts`, "utf8").includes("A transfer is only valid with a token this server issued");

beforeAll(async () => {
  if (!GS) return;
  const noop = () => {};
  const logger: any = { info: noop, debug: noop, warn: noop, error: noop };
  logger.child = () => logger;
  mock.module(`${GS}/src/utils/logger`, () => ({ logger }));

  ({ ExtendBuffer } = await import(`${GS}/src/utils/extend-buffer`));
  ({ decodeTextPacket } = await import(`${GS}/src/utils/text-packet`));
  ({ TextParser } = await import(`${GS}/src/utils/text-parser`));
  ({ PlayerAuth } = await import(`${GS}/src/game/player/auth`));
  ({ GameUpdatePacket } = await import(`${GS}/src/game/packets/game-packet`));

  // Variant ada di file yang menarik banyak dependensi berat. Ambil HANYA kelas Variant
  // (enum VariantTypes .. sebelum VariantHandler) apa adanya dari sumber aslinya.
  const src = readFileSync(`${GS}/src/game/packets/variants.ts`, "utf8");
  const a = src.indexOf("export enum VariantTypes");
  const b = src.indexOf("export class VariantHandler");
  if (a < 0 || b < 0) throw new Error("struktur variants.ts berubah, perbarui tes ini");
  const header = [
    `import { GameUpdatePacket } from "${GS}/src/game/packets/game-packet";`,
    `import { ExtendBuffer } from "${GS}/src/utils/extend-buffer";`,
    `import { TANK_PACKET_FLAGS, TANK_PACKET_TYPE } from "${GS}/src/constants";`,
    `const Packet: any = class {}; const PacketKind: any = {};`,
  ].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "gw-variant-"));
  const file = join(dir, "variant-slice.ts");
  writeFileSync(file, `${header}\n${src.slice(a, b)}`);
  ({ Variant, int64, int32 } = await import(file));
});

suite("encoder asli GrowServer -> decoder klien", () => {
  test("variant: string, unsigned, signed, int64, float 1-3", () => {
    const bytes: Buffer = Variant.from({ netID: 7, delay: 250 }, "OnTest", 5, -9, int32(3), int64(2 ** 40), [1.5], [1, 2], [1, 2, 3], "héllo").parse();
    const pkt = decodePacket(new Uint8Array(bytes));
    expect(pkt.kind).toBe("tank");
    const call = parseCall(pkt.tank);
    expect(call.name).toBe("OnTest");
    expect(call.netID).toBe(7);
    expect(call.delay).toBe(250);
    expect(call.args).toEqual([5, -9, 3, 2 ** 40, [1.5], [1, 2], [1, 2, 3], "héllo"]);
  });

  test("OnSendToServer dan SuperMain persis seperti yang dikirim server", () => {
    const send = parseCall(
      decodePacket(new Uint8Array(Variant.from({ netID: -1 }, "OnSendToServer", 17092, 654321, 42, "127.0.0.1|door|", 1, "alice").parse())).tank,
    );
    expect(send.args).toEqual([17092, 654321, 42, "127.0.0.1|door|", 1, "alice"]);
    const sm = parseCall(
      decodePacket(new Uint8Array(Variant.from({ netID: -1 }, "OnSuperMainStartAcceptLogonHrdxs47254722215a", 1234567, "cdn.host", "growtopia/", "ac", "proto=216|", 99).parse())).tank,
    );
    expect(sm.args[0]).toBe(1234567);
    expect(sm.args[1]).toBe("cdn.host");
  });

  test("GameUpdatePacket asli: semua field terbaca klien", () => {
    const real = GameUpdatePacket.create({
      type: TANK_TYPE.TILE_CHANGE_REQUEST, netID: 3, flags: 1 << 5, itemID: 18, posX: 12.5, posY: 7.25, speedX: -1.5, tileX: 11, tileY: 22, extraData: [9, 8, 7],
    }).parse() as Buffer;
    const d = decodePacket(new Uint8Array(real)).tank;
    expect(d).toMatchObject({ type: TANK_TYPE.TILE_CHANGE_REQUEST, netID: 3, itemID: 18, posX: 12.5, posY: 7.25, speedX: -1.5, tileX: 11, tileY: 22 });
    expect([...d.extraData]).toEqual([9, 8, 7]);
  });
});

suite("encoder klien -> decoder asli GrowServer", () => {
  test("encodeTank dibaca GameUpdatePacket.fromExtendBuffer dengan nilai sama", () => {
    const mine = encodeTank({
      type: TANK_TYPE.STATE, objectType: 1, jumpCount: 2, buildRange: 3, netID: 9, targetNetID: -1, flags: 1 << 5, floatVar: 0.5,
      itemID: 18, posX: 100.5, posY: 200.25, speedX: 3, speedY: -4, particleID: 6, tileX: 5, tileY: 6, extraData: Uint8Array.of(1, 2, 3, 4),
    });
    const buf = new ExtendBuffer(Array.from(mine));
    expect(buf.readI32()).toBe(4); // PACKET_TYPE.GAME_PACKET
    const real = GameUpdatePacket.fromExtendBuffer(buf).data;
    expect(real).toMatchObject({
      type: 0, objectType: 1, jumpCount: 2, buildRange: 3, netID: 9, targetNetID: -1, itemID: 18, posX: 100.5, posY: 200.25,
      speedX: 3, speedY: -4, particleID: 6, tileX: 5, tileY: 6, extraDataLength: 4,
    });
    expect(real.extraData).toEqual([1, 2, 3, 4]);
    expect(real.flags & (1 << 3)).toBeTruthy(); // EXTENDED_DATA diatur otomatis
  });

  test("paket teks klien dibaca decodeTextPacket + TextParser asli", () => {
    const pkt = encodeText("protocol|216\nltoken|QUJD\ntankIDName|alice\n");
    const t = new TextParser(decodeTextPacket(pkt));
    expect(t.get("ltoken")).toBe("QUJD");
    expect(t.get("tankIDName")).toBe("alice");
    expect(t.getInt("protocol", 0, 0)).toBe(216);
  });
});

// ---- Login penuh lewat gateway sungguhan, dengan lem game-server.ts yang meniru cabang teks ----

function makeEmitter() {
  const h: Record<string, Function[]> = {};
  return {
    on: (n: string, f: Function) => void (h[n] ??= []).push(f),
    emit: (n: string, ...a: any[]) => void (h[n] ?? []).forEach((f) => f(...a)),
  };
}

/** Meniru cabang teks GameServer.handlePacket (tanpa DB). ltoken valid kalau _token == "SESSION-OK". */
function attachFakeGameServer(em: ReturnType<typeof makeEmitter>, port: number, log: string[]) {
  const players = new WeakMap<object, { auth: any; playerId: number }>();
  const send = (peer: any, bytes: Buffer) => peer.send({ data: () => new Uint8Array(bytes) });
  const call = (peer: any, name: string, ...args: any[]) => send(peer, Variant.from({ netID: -1 }, name, ...args).parse());

  em.on("connect", (peer: any) => {
    players.set(peer, { auth: new PlayerAuth(), playerId: 0 });
    peer.send({ data: () => new Uint8Array([1, 0, 0, 0, 0]) });
  });
  em.on("receive", (peer: any, packet: any) => {
    const p = players.get(peer)!;
    const data: Uint8Array = packet.data();
    const buf = new ExtendBuffer(Array.from(data));
    const type = buf.readI32();
    if (type !== 2 && type !== 3) return;
    const payload = decodeTextPacket(data);
    const text = new TextParser(payload);

    if (text.contains("tankIDName") && !text.contains("ltoken") && text.contains("token")) {
      call(peer, "OnSuperMainStartAcceptLogonHrdxs47254722215a", 424242, "cdn.test", "growtopia/", "ac", "proto=216|", 7);
    }
    if (text.contains("ltoken")) {
      const ok = p.auth.parseLToken(text.get("ltoken")) && p.auth.validate() && p.auth.token === "SESSION-OK";
      if (!ok) return call(peer, "OnConsoleMessage", "`4Invalid or expired session token, please login again.``");
      p.playerId = 42; // = session.player_id di server asli
      const ts = p.auth.prepareTransfer({ playerId: p.playerId, sourceServer: "s", sessionToken: p.auth.token });
      call(peer, "SetHasGrowID", int32(1), p.auth.tankIDName, p.auth.token);
      call(peer, "OnSendToServer", port, ts.token, p.playerId, "127.0.0.1||", 1, p.auth.tankIDName);
      peer.disconnectLater();
    }
    if (text.contains("token") && text.contains("user")) {
      p.auth.parseRaw(payload);
      const ok = p.auth.validateSubServerTransfer(text.get("token"), text.get("user"));
      if (!ok) {
        call(peer, "OnConsoleMessage", "`4Sub-server transfer verification failed or expired.``");
        return peer.disconnectLater();
      }
      log.push(`login:${text.get("user")}:${p.auth.tankIDName}`);
      call(peer, "SetHasGrowID", int32(1), p.auth.tankIDName, "saved");
    }
  });
}

suite("login penuh melalui gateway + PlayerAuth asli", () => {
  let gw: GatewayHandle;
  let log: string[];
  const b64 = (o: Record<string, string>) => Buffer.from(new URLSearchParams(o).toString()).toString("base64");

  beforeAll(() => {
    const em = makeEmitter();
    log = [];
    gw = startWsGateway({ port: 0, hostname: "127.0.0.1", allowedOrigins: [], allowMissingOrigin: true, resolve: () => em });
    attachFakeGameServer(em, 17091, log);
  });
  afterAll(() => gw?.stop());

  const wsBase = () => `ws://127.0.0.1:${gw.port}`;
  // gateway kita satu port; semua "port game" dipetakan ke emitter yang sama lewat resolve()

  test("klien web login sampai ready dengan ltoken valid", async () => {
    const ltoken = b64({ _token: "SESSION-OK", loginData: "tankIDName|alice\n", type: "2", username: "alice" });
    const s = new LoginSession({ wsBase: wsBase(), ltoken, name: "alice", port: 17091, stepTimeoutMs: 3000 });
    const ready = new Promise<any>((res, rej) => (s.on("ready", res), s.on("failed", rej)));
    s.start();
    const r = await ready;
    expect(r.userID).toBe(42);
    expect(s.info.itemsHash).toBe(424242);
    expect(s.info.cdnHost).toBe("cdn.test");
    expect(log).toContain("login:42:alice");
    s.close();
  });

  test("ltoken dengan sesi salah ditolak", async () => {
    const ltoken = b64({ _token: "SESI-PALSU", loginData: "tankIDName|alice\n", type: "2", username: "alice" });
    const s = new LoginSession({ wsBase: wsBase(), ltoken, name: "alice", port: 17091, stepTimeoutMs: 400 });
    const failed = new Promise<Error>((res) => s.on("failed", res));
    s.start();
    expect((await failed).message).toMatch(/Invalid or expired session token/);
  });

  const forge = (text: string) =>
    new Promise<{ ok: boolean; console: string }>((resolve) => {
      const ws = new WebSocket(`${wsBase()}/ws/17091`);
      ws.binaryType = "arraybuffer";
      let consoleMsg = "";
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve({ ok, console: consoleMsg });
        try {
          ws.close();
        } catch {}
      };
      ws.onmessage = (e) => {
        const pkt = decodePacket(new Uint8Array(e.data as ArrayBuffer));
        if (pkt.kind === "hello") return ws.send(encodeText(text));
        if (pkt.kind === "tank") {
          const c = parseCall(pkt.tank);
          if (c.name === "SetHasGrowID") finish(true);
          if (c.name === "OnConsoleMessage") consoleMsg = String(c.args[0]);
        }
      };
      ws.onclose = () => finish(false);
      setTimeout(() => finish(false), 1500);
    });

  test("token transfer karangan (acak) ditolak", async () => {
    const r = await forge("tankIDName|victim\ntoken|999999\nuser|1\n");
    expect(r.ok).toBe(false);
  });

  (hasAuthFix ? test : test.skip)("token transfer '0' ditolak (butuh patch 0002)", async () => {
    const before = log.length;
    const r = await forge("tankIDName|victim\ntoken|0\nuser|1\n");
    expect(r.ok).toBe(false);
    expect(r.console).toMatch(/verification failed/);
    expect(log.length).toBe(before);
  });
});
