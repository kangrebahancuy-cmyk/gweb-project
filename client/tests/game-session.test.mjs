// node --test client/tests/game-session.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { GameSession, cleanChat } from "../public/src/game/game-session.js";
import { decodePacket, encodeTank, decodeTank, TANK_TYPE, TANK_FLAGS, PACKET_TYPE, parseText } from "../public/src/protocol/packets.js";

const REAL = process.env.ITEMS_DAT ?? "/home/claude/ext/itemsdat-archive/items-v5.61.dat";

// ---- pembuat paket "dari server"
function variantExtra(args) {
  const out = [args.length];
  const enc = new TextEncoder();
  args.forEach((a, i) => {
    out.push(i);
    if (typeof a === "string") {
      const b = enc.encode(a);
      out.push(2, b.length & 255, (b.length >> 8) & 255, 0, 0, ...b);
    } else if (Array.isArray(a)) {
      out.push(a.length === 1 ? 1 : a.length === 2 ? 3 : 4, ...new Uint8Array(new Float32Array(a).buffer));
    } else {
      out.push(5, ...new Uint8Array(new Uint32Array([a]).buffer));
    }
  });
  return new Uint8Array(out);
}
const call = (netID, ...args) => decodePacket(encodeTank({ type: TANK_TYPE.CALL_FUNCTION, netID, extraData: variantExtra(args) }));
const tank = (f) => decodePacket(encodeTank(f));
const sent = () => { const a = []; return { a, send: (b) => a.push(b) }; };
const text = (s) => parseText(new TextDecoder().decode(s.subarray(4)));

function mapBytes() {
  const o = []; const u8 = (v) => o.push(v & 255); const u16 = (v) => { u8(v); u8(v >> 8); }; const u32 = (v) => { u16(v & 0xffff); u16(v >>> 16); };
  u16(0x19); u32(0x40); u16(1); o.push(...Buffer.from("A")); u32(4); u32(2); u32(8); o.push(0, 0, 0, 0, 0);
  for (let i = 0; i < 8; i++) { u16(i >= 4 ? 2 : 0); u16(0); u16(0); u16(0); }
  o.push(...new Array(12).fill(0)); u32(0); u32(0); u16(0); u16(0); u16(0); o.push(0, 0, 0, 0, 0, 0);
  return new Uint8Array(o);
}
const spawn = (netID, name, x, y, local) =>
  call(-1, "OnSpawn", `spawn|avatar\nnetID|${netID}\nuserID|${netID + 10}\ncolrect|0|0|20|30\nposXY|${x}|${y}\nname|\`2${name}\`\`\ncountry|id\ninvis|0\nmstate|0\nsmstate|0\nonlineID|\n${local ? "type|local\n" : ""}`);

function inventory(pairs) {
  const o = [1, 200, 0, 0, 0, pairs.length & 255, pairs.length >> 8];
  for (const [id, n] of pairs) o.push(id & 255, id >> 8, n & 255, n >> 8);
  return tank({ type: TANK_TYPE.SEND_INVENTORY_STATE, netID: -1, extraData: new Uint8Array(o) });
}

test("start(): minta items.dat, lalu enter_game; items diparse dari paket zlib", { skip: !existsSync(REAL) }, async () => {
  const s = sent();
  const g = new GameSession({ send: s.send });
  const p = g.start(5000);
  assert.equal(text(s.a[0]).get("action"), "refresh_item_data");
  assert.equal(new DataView(s.a[0].buffer).getUint32(0, true), PACKET_TYPE.GAME_MESSAGE);
  const raw = readFileSync(REAL);
  g.handle(tank({ type: TANK_TYPE.SEND_ITEM_DATABASE_DATA, netID: -1, itemID: raw.length, extraData: new Uint8Array(deflateSync(raw)) }));
  const db = await p;
  assert.equal(db.count, 16480);
  assert.equal(text(s.a[1]).get("action"), "enter_game");
});

test("start(): items.dat rusak menolak janji, bukan menggantung", async () => {
  const g = new GameSession({ send() {} });
  g.on("error", () => {});
  const p = g.start(5000);
  g.handle(tank({ type: TANK_TYPE.SEND_ITEM_DATABASE_DATA, netID: -1, itemID: 100, extraData: new Uint8Array([1, 2, 3]) }));
  await assert.rejects(p);
});

test("joinWorld memvalidasi nama dan mengirim join_request", () => {
  const s = sent();
  const g = new GameSession({ send: s.send });
  g.joinWorld(" start ");
  const t = text(s.a[0]);
  assert.equal(t.get("action"), "join_request");
  assert.equal(t.get("name"), "START");
  assert.throws(() => g.joinWorld("a|b"), RangeError);
  assert.throws(() => g.joinWorld("x".repeat(25)), RangeError);
  assert.throws(() => g.joinWorld(""), RangeError);
});

test("masuk dunia: peta, spawn lokal dan pemain lain, OnSetPos, OnRemove", () => {
  const g = new GameSession({ send() {} });
  const errs = []; g.on("error", (e) => errs.push(e));
  g.handle(tank({ type: TANK_TYPE.SEND_MAP_DATA, netID: -1, flags: 8, extraData: mapBytes() }));
  assert.equal(g.world.width, 4);
  g.handle(spawn(1, "dev", 64, 32, true));
  g.handle(spawn(2, "budi", 96, 32, false));
  assert.equal(g.me.netID, 1);
  assert.equal(g.players.size, 2);
  assert.equal(g.players.get(2).name, "budi");
  g.handle(call(2, "OnSetPos", [128, 64]));
  assert.equal(g.players.get(2).x, 128);
  g.handle(call(-1, "OnRemove", "netID|2\npId|12\n"));
  assert.equal(g.players.size, 1);
  assert.deepEqual(errs, []);
});

test("STATE pemain lain menggerakkan mereka; STATE untuk netID sendiri diabaikan", () => {
  const g = new GameSession({ send() {} });
  g.handle(tank({ type: TANK_TYPE.SEND_MAP_DATA, extraData: mapBytes() }));
  g.handle(spawn(1, "dev", 64, 32, true));
  g.handle(spawn(2, "budi", 96, 32, false));
  g.handle(tank({ type: TANK_TYPE.STATE, netID: 2, posX: 200, posY: 40, flags: TANK_FLAGS.FACING_LEFT }));
  assert.equal(g.players.get(2).x, 200);
  assert.equal(g.players.get(2).facingLeft, true);
  g.handle(tank({ type: TANK_TYPE.STATE, netID: 1, posX: 999, posY: 999 }));
  assert.equal(g.me.x, 64);
});

test("sendMove dan punch mengirim paket tank yang benar; di luar dunia tidak dikirim", () => {
  const s = sent();
  const g = new GameSession({ send: s.send });
  g.punch(1, 1); // belum di dunia
  assert.equal(s.a.length, 0);
  g.handle(tank({ type: TANK_TYPE.SEND_MAP_DATA, extraData: mapBytes() }));
  g.handle(spawn(1, "dev", 64, 32, true));
  g.sendMove(70, 33, { facingLeft: true });
  let t = decodeTank(s.a[0]);
  assert.equal(t.type, TANK_TYPE.STATE);
  assert.equal(t.posX, 70);
  assert.ok(t.flags & TANK_FLAGS.FACING_LEFT);
  g.punch(2, 1);
  t = decodeTank(s.a[1]);
  assert.equal(t.type, TANK_TYPE.TILE_CHANGE_REQUEST);
  assert.equal(t.itemID, 18);
  assert.equal(t.tileX, 2);
  g.punch(99, 99); // di luar peta
  assert.equal(s.a.length, 2);
});

test("place hanya kalau item ada di inventori; gema server mengubah tile dan mengurangi inventori", { skip: !existsSync(REAL) }, async () => {
  const s = sent();
  const g = new GameSession({ send: s.send });
  const raw = readFileSync(REAL);
  const p = g.start(5000);
  g.handle(tank({ type: TANK_TYPE.SEND_ITEM_DATABASE_DATA, itemID: raw.length, extraData: new Uint8Array(deflateSync(raw)) }));
  await p;
  g.handle(tank({ type: TANK_TYPE.SEND_MAP_DATA, extraData: mapBytes() }));
  g.handle(spawn(1, "dev", 64, 32, true));
  g.handle(inventory([[18, 1], [32, 1], [2, 3]]));
  const n = s.a.length;
  assert.equal(g.place(3, 1, 0), false); // tidak punya
  assert.equal(g.place(18, 1, 0), false); // fist bukan untuk dipasang
  assert.equal(s.a.length, n);
  assert.equal(g.place(2, 1, 0), true);
  assert.equal(decodeTank(s.a.at(-1)).itemID, 2);
  // gema dari server untuk pemain sendiri
  g.handle(tank({ type: TANK_TYPE.TILE_CHANGE_REQUEST, netID: 1, itemID: 2, tileX: 1, tileY: 0 }));
  assert.equal(g.world.fg[1], 2);
  assert.equal(g.inventory.get(2), 2);
  // gema dari pemain lain tidak mengurangi inventori kita
  g.handle(tank({ type: TANK_TYPE.TILE_CHANGE_REQUEST, netID: 5, itemID: 2, tileX: 2, tileY: 0 }));
  assert.equal(g.inventory.get(2), 2);
  // blok hancur: gema FIST tidak mengubah apa pun, SEND_TILE_UPDATE_DATA yang menentukan
  g.handle(tank({ type: TANK_TYPE.TILE_CHANGE_REQUEST, netID: 5, itemID: 18, tileX: 1, tileY: 0 }));
  assert.equal(g.world.fg[1], 2);
  g.handle(tank({ type: TANK_TYPE.SEND_TILE_UPDATE_DATA, tileX: 1, tileY: 0, extraData: new Uint8Array(8) }));
  assert.equal(g.world.fg[1], 0);
});

test("TILE_APPLY_DAMAGE dicatat dan hilang saat tile berubah", () => {
  const g = new GameSession({ send() {} });
  g.handle(tank({ type: TANK_TYPE.SEND_MAP_DATA, extraData: mapBytes() }));
  g.handle(tank({ type: TANK_TYPE.TILE_APPLY_DAMAGE, netID: 1, itemID: 6, tileX: 1, tileY: 1 }));
  assert.equal(g.damage.get(1 + 1 * 4).amount, 6);
  g.handle(tank({ type: TANK_TYPE.SEND_TILE_UPDATE_DATA, tileX: 1, tileY: 1, extraData: new Uint8Array(8) }));
  assert.equal(g.damage.size, 0);
});

test("inventori: MODIFY_ITEM_INVENTORY menambah dan mengurangi", () => {
  const g = new GameSession({ send() {} });
  g.handle(inventory([[2, 5]]));
  g.handle(tank({ type: TANK_TYPE.MODIFY_ITEM_INVENTORY, itemID: 2, buildRange: 3 }));
  assert.equal(g.inventory.get(2), 8);
  g.handle(tank({ type: TANK_TYPE.MODIFY_ITEM_INVENTORY, itemID: 2, jumpCount: 8 }));
  assert.equal(g.inventory.has(2), false);
});

test("chat: OnTalkBubble dibersihkan dari metadata dan warna", () => {
  const g = new GameSession({ send() {} });
  const got = []; g.on("chat", (c) => got.push(c));
  g.handle(spawn(2, "budi", 0, 0, false));
  g.handle(call(-1, "OnTalkBubble", 2, "CP:_PL:0_OID:_`$halo semua", 0, 0));
  assert.deepEqual(got.at(-1), { netID: 2, text: "halo semua", name: "budi" });
  assert.equal(cleanChat("CT:[W]_`2dev: hai"), "dev: hai");
});

test("paket cacat tidak melempar keluar, hanya event error", () => {
  const g = new GameSession({ send() {} });
  const errs = []; g.on("error", (e) => errs.push(e));
  g.handle(tank({ type: TANK_TYPE.SEND_MAP_DATA, extraData: new Uint8Array([1, 2, 3]) }));
  g.handle(tank({ type: TANK_TYPE.SEND_INVENTORY_STATE, extraData: new Uint8Array([1]) }));
  assert.equal(errs.length, 2);
  g.say("a|b\nc");
});

test("OnSetClothing: pakaian dan warna kulit disimpan per pemain", () => {
  const g = new GameSession({ send() {} });
  g.handle(spawn(2, "budi", 0, 0, false));
  assert.equal(g.players.get(2).clothes, null);
  g.handle(call(2, "OnSetClothing", [66, 38, 76], [78, 0, 94], [0, 0, 0], 0xb3a5e0ff, [0, 0, 0]));
  const p = g.players.get(2);
  assert.deepEqual([p.clothes.hair, p.clothes.shirt, p.clothes.pants, p.clothes.feet, p.clothes.hand], [66, 38, 76, 78, 94]);
  assert.equal(p.skin, 0xb3a5e0ff);
  g.handle(call(99, "OnSetClothing", [1, 1, 1], [1, 1, 1], [0, 0, 0], 0, [0, 0, 0])); // pemain tak dikenal: diabaikan
});
