// Codec paket Growtopia untuk klien web. Little-endian, tanpa dependensi.
// Format mengikuti GrowServer (src/game/packets/*): satu frame WebSocket = satu paket ENet.
//
//   [u32 tipe paket] + isi
//   GENERIC_TEXT / GAME_MESSAGE : isi = teks UTF-8 "kunci|nilai\n..."
//   GAME_PACKET                 : isi = header tank 56 byte + extraData
//
// Semua pembacaan diperiksa batasnya dan melempar RangeError untuk data cacat,
// karena data ini datang dari jaringan.

export const PACKET_TYPE = Object.freeze({
  UNKNOWN: 0,
  SERVER_HELLO: 1,
  GENERIC_TEXT: 2,
  GAME_MESSAGE: 3,
  GAME_PACKET: 4,
  ERROR: 5,
  TRACK: 6,
  CLIENT_LOG_REQUEST: 7,
  CLIENT_LOG_RESPONSE: 8,
});

const TANK_NAMES = [
  "STATE", "CALL_FUNCTION", "UPDATE_STATUS", "TILE_CHANGE_REQUEST", "SEND_MAP_DATA",
  "SEND_TILE_UPDATE_DATA", "SEND_TILE_UPDATE_DATA_MULTIPLE", "TILE_ACTIVATE_REQUEST",
  "TILE_APPLY_DAMAGE", "SEND_INVENTORY_STATE", "ITEM_ACTIVATE_REQUEST",
  "ITEM_ACTIVATE_OBJECT_REQUEST", "SEND_TILE_TREE_STATE", "MODIFY_ITEM_INVENTORY",
  "ITEM_CHANGE_OBJECT", "SEND_LOCK", "SEND_ITEM_DATABASE_DATA", "SEND_PARTICLE_EFFECT",
  "SET_ICON_STATE", "ITEM_EFFECT", "SET_CHARACTER_STATE", "PING_REPLY", "PING_REQUEST",
  "GOT_PUNCHED", "APP_CHECK_RESPONSE", "APP_INTEGRITY_FAIL", "DISCONNECT", "BATTLE_JOIN",
  "BATTLE_EVENT", "USE_DOOR", "SEND_PARENTAL", "GONE_FISHIN", "STEAM", "PET_BATTLE", "NPC",
  "SPECIAL", "SEND_PARTICLE_EFFECT_V2", "ACTIVE_ARROWO_ITEM", "SELECTILE_INDEX",
  "SEND_PLAYER_TRIBUTE_DATA", "ON_STEP_ONILE_MOD",
];
/** Tipe paket tank (TANK_PACKET_TYPE di server). */
export const TANK_TYPE = Object.freeze(Object.fromEntries(TANK_NAMES.map((n, i) => [n, i])));
export const tankTypeName = (t) => TANK_NAMES[t] ?? `UNKNOWN_${t}`;

export const TANK_FLAGS = Object.freeze({
  NONE: 0,
  RESET_VISUAL_STATE: 1 << 2,
  EXTENDED_DATA: 1 << 3,
  FACING_LEFT: 1 << 4,
  ON_GROUND: 1 << 5,
  ON_JUMP: 1 << 7,
  ON_PUNCHED: 1 << 9,
  ON_PLACED: 1 << 10,
});

export const LOGON_MODE = Object.freeze({ WELCOME: 1, TRANSFER: 2 });

export const TANK_HEADER_SIZE = 56;
/** Awalan 4 byte (tipe paket) sebelum header tank. */
export const PACKET_PREFIX = 4;
export const TANK_TOTAL_HEADER = PACKET_PREFIX + TANK_HEADER_SIZE; // 60

// Batas extraData. Mengirim ke server: kecil (aksi pemain). Menerima dari server: items.dat terkompresi
// berukuran sekitar 1.0-1.1 MB dan dikirim dalam satu paket, jadi batas terima harus lebih longgar.
// Panjang paket tetap dibatasi oleh ukuran frame WebSocket yang sebenarnya diterima.
const MAX_EXTRA_SEND = 1 << 20; // 1 MiB
const MAX_EXTRA_RECV = 16 << 20; // 16 MiB

const enc = new TextEncoder();
const dec = new TextDecoder("utf-8");

// ---------------------------------------------------------------- teks

/** Kodekan paket teks. Mengembalikan Uint8Array siap kirim. */
export function encodeText(text, type = PACKET_TYPE.GENERIC_TEXT) {
  const body = enc.encode(text);
  const out = new Uint8Array(PACKET_PREFIX + body.length);
  new DataView(out.buffer).setUint32(0, type, true);
  out.set(body, PACKET_PREFIX);
  return out;
}

/**
 * Ambil teks dari paket teks. Sama dengan decodeTextPacket di server: berhenti di
 * NUL pertama dan di byte kontrol, supaya sampah di ujung tidak ikut terbaca.
 */
export function decodeText(bytes) {
  if (bytes.length < PACKET_PREFIX) throw new RangeError("paket teks terlalu pendek");
  let end = bytes.indexOf(0, PACKET_PREFIX);
  if (end < 0) end = bytes.length;
  const s = dec.decode(bytes.subarray(PACKET_PREFIX, end));
  // \n dan \r dipertahankan (pemisah baris protokol); kontrol lain mengakhiri teks
  const m = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f�]/.exec(s);
  return m ? s.slice(0, m.index) : s;
}

/** Parser "kunci|nilai1|nilai2\n..." (setara TextParser di server). */
export function parseText(raw) {
  const entries = [];
  const line0 = raw.split("\0", 1)[0];
  for (const rawLine of line0.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    let tokens = line.split("|");
    if (tokens[0] === "") tokens = tokens.slice(1);
    if (tokens.length >= 2) entries.push([tokens[0], tokens.slice(1)]);
  }
  return {
    entries,
    has: (k) => entries.some(([key]) => key === k),
    get: (k, i = 0) => entries.find(([key]) => key === k)?.[1][i] ?? "",
    getInt: (k, def = 0) => {
      const v = entries.find(([key]) => key === k)?.[1][0];
      const n = v === undefined ? NaN : Number.parseInt(v, 10);
      return Number.isNaN(n) ? def : n;
    },
  };
}

/** Bangun teks "kunci|nilai\n" dari daftar pasangan. Nilai tidak boleh mengandung "|" atau baris baru. */
export function buildText(pairs) {
  return pairs
    .map(([k, v]) => {
      const sv = String(v);
      if (/[|\n\r\0]/.test(String(k)) || /[|\n\r\0]/.test(sv)) throw new RangeError(`karakter terlarang pada "${k}"`);
      return `${k}|${sv}\n`;
    })
    .join("");
}

// ---------------------------------------------------------------- tank

const TANK_DEFAULTS = {
  type: 0, objectType: 0, jumpCount: 0, buildRange: 0, netID: 0, targetNetID: 0, flags: 0,
  floatVar: 0, itemID: 0, posX: 0, posY: 0, speedX: 0, speedY: 0, particleID: 0, tileX: 0, tileY: 0,
};

/** Kodekan paket game (tank). `extraData` opsional (Uint8Array); flag EXTENDED_DATA diatur otomatis. */
export function encodeTank(fields) {
  const f = { ...TANK_DEFAULTS, ...fields };
  const extra = f.extraData ?? new Uint8Array(0);
  if (extra.length > MAX_EXTRA_SEND) throw new RangeError("extraData terlalu besar");
  if (extra.length > 0) f.flags |= TANK_FLAGS.EXTENDED_DATA;
  const out = new Uint8Array(TANK_TOTAL_HEADER + extra.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, PACKET_TYPE.GAME_PACKET, true);
  v.setUint8(4, f.type);
  v.setUint8(5, f.objectType);
  v.setUint8(6, f.jumpCount);
  v.setUint8(7, f.buildRange);
  v.setInt32(8, f.netID, true);
  v.setInt32(12, f.targetNetID, true);
  v.setInt32(16, f.flags | 0, true);
  v.setFloat32(20, f.floatVar, true);
  v.setInt32(24, f.itemID, true);
  v.setFloat32(28, f.posX, true);
  v.setFloat32(32, f.posY, true);
  v.setFloat32(36, f.speedX, true);
  v.setFloat32(40, f.speedY, true);
  v.setFloat32(44, f.particleID, true);
  v.setInt32(48, f.tileX, true);
  v.setInt32(52, f.tileY, true);
  v.setUint32(56, extra.length, true);
  out.set(extra, TANK_TOTAL_HEADER);
  return out;
}

/** Dekode paket game. Melempar RangeError kalau panjangnya tidak cocok. */
export function decodeTank(bytes) {
  if (bytes.length < TANK_TOTAL_HEADER) throw new RangeError("paket game lebih pendek dari header");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== PACKET_TYPE.GAME_PACKET) throw new RangeError("bukan paket game");
  const extraLen = v.getUint32(56, true);
  if (extraLen > MAX_EXTRA_RECV || extraLen > bytes.length - TANK_TOTAL_HEADER) {
    throw new RangeError(`extraDataLength ${extraLen} melebihi data yang ada`);
  }
  return {
    type: v.getUint8(4),
    objectType: v.getUint8(5),
    jumpCount: v.getUint8(6),
    buildRange: v.getUint8(7),
    netID: v.getInt32(8, true),
    targetNetID: v.getInt32(12, true),
    flags: v.getInt32(16, true),
    floatVar: v.getFloat32(20, true),
    itemID: v.getInt32(24, true),
    posX: v.getFloat32(28, true),
    posY: v.getFloat32(32, true),
    speedX: v.getFloat32(36, true),
    speedY: v.getFloat32(40, true),
    particleID: v.getFloat32(44, true),
    tileX: v.getInt32(48, true),
    tileY: v.getInt32(52, true),
    extraData: bytes.subarray(TANK_TOTAL_HEADER, TANK_TOTAL_HEADER + extraLen),
  };
}

// ---------------------------------------------------------------- variant

export const VARIANT = Object.freeze({
  NONE: 0, FLOAT_1: 1, STRING: 2, FLOAT_2: 3, FLOAT_3: 4, UNSIGNED_INT: 5, SIGNED_INT: 9, SIGNED_INT64: 10,
});

/** Dekode daftar argumen variant dari extraData paket CALL_FUNCTION. */
export function decodeVariants(extra) {
  const v = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let p = 0;
  const need = (n) => {
    if (p + n > extra.length) throw new RangeError("variant terpotong");
  };
  need(1);
  const count = v.getUint8(p++);
  const out = [];
  for (let i = 0; i < count; i++) {
    need(2);
    const index = v.getUint8(p++);
    const type = v.getUint8(p++);
    let value;
    switch (type) {
      case VARIANT.STRING: {
        need(4);
        const len = v.getUint32(p, true);
        p += 4;
        need(len);
        value = dec.decode(extra.subarray(p, p + len));
        p += len;
        break;
      }
      case VARIANT.UNSIGNED_INT:
        need(4);
        value = v.getUint32(p, true);
        p += 4;
        break;
      case VARIANT.SIGNED_INT:
        need(4);
        value = v.getInt32(p, true);
        p += 4;
        break;
      case VARIANT.SIGNED_INT64: {
        need(8);
        const big = v.getBigInt64(p, true);
        p += 8;
        value = Number.isSafeInteger(Number(big)) ? Number(big) : big;
        break;
      }
      case VARIANT.FLOAT_1:
      case VARIANT.FLOAT_2:
      case VARIANT.FLOAT_3: {
        const n = type === VARIANT.FLOAT_1 ? 1 : type === VARIANT.FLOAT_2 ? 2 : 3;
        need(4 * n);
        value = [];
        for (let k = 0; k < n; k++, p += 4) value.push(v.getFloat32(p, true));
        break;
      }
      default:
        // tipe tak dikenal: tidak bisa tahu panjangnya, jadi hentikan daripada salah baca
        throw new RangeError(`tipe variant tidak dikenal: ${type}`);
    }
    out.push({ index, type, value });
  }
  return out;
}

/** Ubah paket CALL_FUNCTION menjadi {name, args, netID, delay}. */
export function parseCall(tank) {
  if (tank.type !== TANK_TYPE.CALL_FUNCTION) throw new RangeError("bukan CALL_FUNCTION");
  const vars = decodeVariants(tank.extraData);
  if (vars.length === 0 || typeof vars[0].value !== "string") throw new RangeError("nama fungsi tidak ada");
  return { name: vars[0].value, args: vars.slice(1).map((x) => x.value), netID: tank.netID, delay: tank.itemID };
}

// ---------------------------------------------------------------- dekode umum

/**
 * Dekode satu frame dari server.
 * @returns {{kind:'hello'}|{kind:'text', type:number, text:string}|{kind:'tank', tank:object}|{kind:'other', type:number}}
 */
export function decodePacket(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("butuh Uint8Array");
  if (bytes.length < PACKET_PREFIX) throw new RangeError("paket lebih pendek dari 4 byte");
  const type = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  switch (type) {
    case PACKET_TYPE.SERVER_HELLO:
      return { kind: "hello" };
    case PACKET_TYPE.GENERIC_TEXT:
    case PACKET_TYPE.GAME_MESSAGE:
      return { kind: "text", type, text: decodeText(bytes) };
    case PACKET_TYPE.GAME_PACKET:
      return { kind: "tank", tank: decodeTank(bytes) };
    default:
      return { kind: "other", type };
  }
}
