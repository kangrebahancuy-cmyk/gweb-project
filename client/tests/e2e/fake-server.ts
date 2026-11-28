// Server palsu untuk uji e2e di browser: login HTTP + gateway WS yang meniru urutan GrowServer
// (login -> SuperMain -> transfer -> items.dat -> inventori -> dunia -> pemain lain -> pukul/pasang).
// Jalankan: bun client/tests/e2e/fake-server.ts   (PORT=8081 untuk dev server)
import { readFileSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { callPacket, helloPacket } from "../helpers.mjs";
import { decodePacket, encodeTank, parseText, TANK_TYPE } from "../../public/src/protocol/packets.js";
import { startDevServer } from "../../tools/dev-server";

const ITEMS = process.env.ITEMS_DAT ?? "/home/claude/ext/itemsdat-archive/items-v5.61.dat";
if (!existsSync(ITEMS)) throw new Error("butuh items.dat: set ITEMS_DAT");
const itemsRaw = readFileSync(ITEMS);
const itemsZ = new Uint8Array(deflateSync(itemsRaw));

const W = 20, H = 12;
const fg = new Uint16Array(W * H), bg = new Uint16Array(W * H);
const extras = new Map<number, number[]>(); // indeks tile -> [tipe, ...payload]
const hitsOn = new Map<number, number>();
const enc = (str: string) => [str.length & 255, str.length >> 8, ...Buffer.from(str)];
const u32b = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  if (y === H - 1) fg[i] = 8; else if (y >= 8) fg[i] = 2; else bg[i] = 14;
}
// variasi untuk uji penyambungan: bukit tanah, platform kayu, tiang lampu, lava, blok sendirian
for (let x = 6; x < 12; x++) fg[7 * W + x] = 2;
for (let x = 8; x < 10; x++) fg[6 * W + x] = 2;
fg[5 * W + 14] = 102; fg[5 * W + 15] = 102; fg[5 * W + 16] = 102;
fg[7 * W + 17] = 992; fg[6 * W + 17] = 992; fg[5 * W + 17] = 992;
fg[7 * W + 2] = 4; fg[7 * W + 3] = 4; fg[8 * W + 3] = 4;
fg[4 * W + 3] = 2;
fg[7 * W + 0] = 6;
// pohon (seed) dengan umur berbeda, pintu dan papan berlabel
for (const [x, id, age, fruit] of [[11, 3, 0, 0], [12, 11, 20, 0], [13, 101, 100000, 3], [4, 5, 100000, 2]]) { fg[7 * W + x] = id; extras.set(7 * W + x, [4, ...u32b(age), fruit]); }
fg[7 * W + 5] = 12; extras.set(7 * W + 5, [1, ...enc("START"), 0]);
fg[7 * W + 1] = 20; extras.set(7 * W + 1, [2, ...enc("Halo!"), ...u32b(0xffffffff)]);

function mapBytes() {
  const o: number[] = [];
  const u8 = (v: number) => o.push(v & 255), u16 = (v: number) => { u8(v); u8(v >> 8); }, u32 = (v: number) => { u16(v & 0xffff); u16(v >>> 16); };
  u16(0x19); u32(0x40); u16(5); o.push(...Buffer.from("START")); u32(W); u32(H); u32(W * H); o.push(0, 0, 0, 0, 0);
  for (let i = 0; i < W * H; i++) { const ex = extras.get(i); u16(fg[i]); u16(bg[i]); u16(0); u16(ex ? (fg[i] % 2 === 1 && fg[i] > 2 ? 0x11 : 1) : 0); if (ex) o.push(...ex); }
  o.push(...new Array(12).fill(0)); u32(0); u32(0); u16(0); u16(0); u16(0); o.push(0, 0, 0, 0, 0, 0);
  return new Uint8Array(o);
}
const spawnTxt = (id: number, name: string, x: number, y: number, local: boolean) =>
  `spawn|avatar\nnetID|${id}\nuserID|${id + 10}\ncolrect|0|0|20|30\nposXY|${x}|${y}\nname|\`2${name}\`\`\ncountry|id\ninvis|0\nmstate|0\nsmstate|0\nonlineID|\n${local ? "type|local\n" : ""}`;
const tileBytes = (f: number, b: number) => new Uint8Array([f & 255, f >> 8, b & 255, b >> 8, 0, 0, 0, 0]);

export const log: string[] = [];
const accounts = new Map<string, string>();
const TOKEN = 777, USER = 1;

const http = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req, srv) {
    const u = new URL(req.url);
    if (u.pathname === "/__log") return Response.json(log);
    if (srv.upgrade(req, { data: { phase: "login" } })) return undefined;
    if (req.method === "POST") {
      const b: any = await req.json();
      if (u.pathname === "/player/growid/register/validate") { accounts.set(b.growId.toLowerCase(), b.password); return new Response(null, { status: 302, headers: { Location: "/player/growid/validate/checktoken/" + btoa("reg") } }); }
      if (u.pathname === "/player/growid/login/validate") {
        if (accounts.get(b.growId.toLowerCase()) !== b.password) return Response.json({ status: "error", message: "Invalid GrowID or password." }, { status: 400 });
        return new Response(null, { status: 302, headers: { Location: "/player/growid/validate/checktoken/" + btoa("tok") } });
      }
    }
    if (u.pathname.startsWith("/player/growid/validate/checktoken/"))
      return new Response(JSON.stringify({ status: "success", token: decodeURIComponent(u.pathname.split("/").pop()!), accountType: "growtopia", accountAge: 2 }), { headers: { "Content-Type": "text/html" } });
    if (u.pathname.startsWith("/growtopia/game/")) {
      const name = u.pathname.split("/").pop()!;
      const f = Bun.file("/home/claude/kangrebahancuy-cmyk/gtindapkzip/assets/game/" + name);
      return /^[\w.\-]+$/.test(name) && (await f.exists()) ? new Response(f) : new Response("nf", { status: 404 });
    }
    if (u.pathname.startsWith("/growtopia/interface/")) {
      const rel = u.pathname.slice("/growtopia/interface/".length);
      const f = Bun.file("/home/claude/kangrebahancuy-cmyk/gtindapkzip/assets/interface/" + rel);
      return /^[\w\-/]+\.rttex$/.test(rel) && !rel.includes("..") && (await f.exists()) ? new Response(f) : new Response("nf", { status: 404 });
    }
    return new Response("nf", { status: 404 });
  },
  websocket: {
    open(ws) { ws.send(helloPacket()); },
    message(ws, m) {
      const p: any = decodePacket(new Uint8Array(m as ArrayBuffer));
      if (p.kind === "text") return onText(ws, parseText(p.text));
      if (p.kind === "tank") return onTank(ws, p.tank);
    },
  },
});

function onText(ws: any, t: any) {
  if (t.has("ltoken")) {
    ws.send(callPacket("SetHasGrowID", [{ i32: 1 }, "dev", "sess"]));
    ws.send(callPacket("OnSendToServer", [17092, TOKEN, USER, "127.0.0.1||", 1, "dev"]));
    setTimeout(() => ws.close(), 20);
  } else if (t.has("tankIDName") && t.has("token") && !t.has("user")) {
    ws.send(callPacket("OnSuperMainStartAcceptLogonHrdxs47254722215a", [1, "cdn.example", "growtopia/", "x", "proto=216|isPayingUser=1|", 5]));
  } else if (t.has("token") && t.has("user")) {
    ws.send(callPacket("SetHasGrowID", [{ i32: 1 }, "dev", "sess"]));
  } else {
    const a = t.get("action");
    log.push("text:" + a);
    if (a === "refresh_item_data") ws.send(encodeTank({ type: TANK_TYPE.SEND_ITEM_DATABASE_DATA, netID: -1, flags: 8, itemID: itemsRaw.length, extraData: itemsZ }));
    if (a === "enter_game") ws.send(encodeTank({ type: TANK_TYPE.SEND_INVENTORY_STATE, netID: -1, extraData: new Uint8Array([1, 200, 0, 0, 0, 3, 0, 18, 0, 1, 0, 32, 0, 1, 0, 2, 0, 10, 0]) }));
    if (a === "join_request") {
      ws.send(encodeTank({ type: TANK_TYPE.SEND_MAP_DATA, netID: -1, flags: 8, extraData: mapBytes() }));
      ws.send(callPacket("OnSpawn", [spawnTxt(1, "dev", 64, 7 * 32 - 30, true)]));
      ws.send(callPacket("OnSpawn", [spawnTxt(2, "budi", 200, 7 * 32 - 30, false)]));
      ws.send(callPacket("OnSetClothing", [[0, 36, 48], [40, 34, 0], [0, 0, 0], 0x8295c3ff, [0, 0, 0]], { netID: 1 }));
      ws.send(callPacket("OnSetClothing", [[66, 38, 76], [78, 0, 94], [0, 0, 0], 0xb3a5e0ff, [0, 0, 0]], { netID: 2 }));
      ws.send(callPacket("OnTalkBubble", [2, "CP:_PL:0_OID:_`$halo dev", 0, 0], { netID: 2 }));
      ws.send(callPacket("OnSetBux", [{ i32: 12345 }, 1, 1]));
      ws.send(callPacket("OnConsoleMessage", ["CP:_PL:0_OID:_CT:[W]_`$<`2budi`$> halo dev"]));
    }
    if (a === "input") { log.push("say:" + t.get("text")); }
  }
}

function onTank(ws: any, t: any) {
  if (t.type === TANK_TYPE.STATE) { log.push(`state:${Math.round(t.posX)},${Math.round(t.posY)}`); return; }
  if (t.type !== TANK_TYPE.TILE_CHANGE_REQUEST) return;
  const i = t.tileY * W + t.tileX;
  if (t.itemID === 18) {
    log.push(`punch:${t.tileX},${t.tileY}`);
    if (!fg[i] || fg[i] === 8) return;
    ws.send(encodeTank({ type: TANK_TYPE.TILE_APPLY_DAMAGE, netID: 1, itemID: 6, tileX: t.tileX, tileY: t.tileY }));
    const h = (hitsOn.get(i) ?? 0) + 1; hitsOn.set(i, h);
    if (h < 4) return;
    hitsOn.delete(i); extras.delete(i);
    fg[i] = 0;
    ws.send(encodeTank({ type: TANK_TYPE.TILE_CHANGE_REQUEST, netID: 1, itemID: 18, buildRange: 18, tileX: t.tileX, tileY: t.tileY }));
    ws.send(encodeTank({ type: TANK_TYPE.SEND_TILE_UPDATE_DATA, tileX: t.tileX, tileY: t.tileY, extraData: tileBytes(0, bg[i]) }));
  } else if (!fg[i]) {
    log.push(`place:${t.itemID}@${t.tileX},${t.tileY}`);
    fg[i] = t.itemID;
    ws.send(encodeTank({ type: TANK_TYPE.TILE_CHANGE_REQUEST, netID: 1, itemID: t.itemID, tileX: t.tileX, tileY: t.tileY }));
  }
}

const dev = startDevServer({
  port: Number(process.env.PORT ?? 8081),
  loginUpstream: `http://127.0.0.1:${http.port}`,
  wsUpstream: `ws://127.0.0.1:${http.port}`,
  cdnUpstream: `http://127.0.0.1:${http.port}`,
});
console.log(`e2e: http://localhost:${dev.port}/login.html  (log: http://127.0.0.1:${http.port}/__log)`);
console.log(`LOGPORT=${http.port}`);
