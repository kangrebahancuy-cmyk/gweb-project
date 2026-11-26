// Parser items.dat Growtopia (versi 11 sampai 27+) untuk browser dan Node, tanpa dependensi.
//
// Tata letak biner mengikuti pustaka `grow-items` milik StileDevs (MIT, github.com/StileDevs/grow-items),
// yang dipakai GrowServer untuk membuat file ini. Kode di sini ditulis ulang, bukan disalin, dan
// diuji terhadap `grow-items` serta terhadap items.dat asli (client/tests/items.test.mjs,
// server/tests/compat.test.ts).
//
// Nama field mengikuti `grow-items` supaya mudah dicocokkan. Nama itu tidak selalu sama dengan
// nama resmi (mis. `storageType` kemungkinan jenis render tile); arti yang belum pasti diberi catatan.

export const ITEM_KEY = "PBG892FXX982ABC*";

/** Nilai item.type (ActionTypes di GrowServer) yang dipakai renderer. */
export const ACTION = Object.freeze({
  FIST: 0, WRENCH: 1, DOOR: 2, LOCK: 3, MAIN_DOOR: 13, PLATFORM: 14, BEDROCK: 15, LAVA: 16,
  FOREGROUND: 17, BACKGROUND: 18, SEED: 19, CLOTHES: 20, CONSUMABLE: 8, SIGN: 10,
});

/** Bit item.flags (BlockFlags di GrowServer). */
export const BLOCK_FLAG = Object.freeze({
  MULTI_FACING: 1 << 0, WRENCHABLE: 1 << 1, SEEDLESS: 1 << 2, PERMANENT: 1 << 3, DROPLESS: 1 << 4,
  NO_SELF: 1 << 5, NO_SHADOW: 1 << 6, WORLD_LOCKED: 1 << 7, BETA: 1 << 8, AUTO_PICKUP: 1 << 9,
  MOD: 1 << 10, RANDOM_GROW: 1 << 11, PUBLIC: 1 << 12, FOREGROUND: 1 << 13,
});

const MAX_ITEMS = 200_000;
const MAX_INFLATED = 64 * 1024 * 1024;

/** Pembaca little-endian dengan pemeriksaan batas: data ini datang dari jaringan. */
class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
  }
  need(n) {
    if (n < 0 || this.p + n > this.b.length) throw new RangeError(`items.dat terpotong di byte ${this.p} (butuh ${n})`);
  }
  u8() { this.need(1); return this.v.getUint8(this.p++); }
  i8() { this.need(1); return this.v.getInt8(this.p++); }
  u16() { this.need(2); const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
  i16() { this.need(2); const x = this.v.getInt16(this.p, true); this.p += 2; return x; }
  i32() { this.need(4); const x = this.v.getInt32(this.p, true); this.p += 4; return x; }
  u32() { this.need(4); const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  skip(n) { this.need(n); this.p += n; }
  /** String u16-panjang. Byte dibaca sebagai latin1, sama seperti grow-items. */
  str(xorId) {
    const len = this.u16();
    this.need(len);
    let s = "";
    const k = ITEM_KEY;
    for (let i = 0; i < len; i++) {
      let c = this.b[this.p + i];
      if (xorId !== undefined) c ^= k.charCodeAt((xorId + i) % k.length);
      s += String.fromCharCode(c);
    }
    this.p += len;
    return s;
  }
}

/**
 * Parse items.dat.
 * @param {Uint8Array} bytes isi file (sudah dikembangkan dari zlib)
 * @returns {{version:number, count:number, items:Map<number,object>, bytesRead:number}}
 */
export function parseItemsDat(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("butuh Uint8Array");
  const r = new Reader(bytes);
  const version = r.u16();
  if (version < 11) throw new RangeError(`versi items.dat ${version} tidak didukung (minimal 11)`);
  const count = r.i32();
  if (count < 0 || count > MAX_ITEMS) throw new RangeError(`jumlah item tidak masuk akal: ${count}`);

  const items = new Map();
  for (let n = 0; n < count; n++) {
    const it = {};
    it.id = r.i32();
    it.flags = r.u16();
    it.type = r.u8();
    it.materialType = r.u8();
    it.name = r.str(it.id);
    it.texture = r.str();
    it.textureHash = r.i32();
    it.visualEffectType = r.u8();
    it.cookingTime = r.i32();
    it.textureX = r.u8();
    it.textureY = r.u8();
    it.storageType = r.u8(); // kemungkinan jenis render/penyambungan tile; belum dipastikan
    it.isStripeyWallpaper = r.u8();
    it.collisionType = r.u8();
    it.breakHits = r.u8() / 6;
    it.resetStateAfter = r.i32();
    it.bodyPartType = r.u8();
    it.rarity = r.i16();
    it.maxAmount = r.u8();
    it.extraFile = r.str();
    it.extraFileHash = r.i32();
    it.audioVolume = r.i32();
    it.petName = r.str();
    it.petPrefix = r.str();
    it.petSuffix = r.str();
    it.petAbility = r.str();
    it.seedBase = r.u8();
    it.seedOverlay = r.u8();
    it.treeBase = r.u8();
    it.treeLeaves = r.u8();
    it.seedColor = r.i32();
    it.seedOverlayColor = r.i32();
    it.ingredient = r.i32();
    it.growTime = r.i32();
    it.fxFlags = r.i32();
    it.extraOptions = r.str();
    it.texture2 = r.str();
    it.extraOptions2 = r.str();
    r.skip(4 + 4 + 4); // unknownInt1, unknownInt2, flags2
    r.skip(60); // extraBytes
    it.tileRange = r.i32();
    it.vaultCapacity = r.i32();

    if (version >= 11) {
      it.punchOptions = r.str();
      if (version >= 12) r.skip(4 + 9); // flags3, bodyPart
      if (version >= 13) it.lightRange = r.i32();
      if (version >= 14) r.skip(4);
      if (version >= 15) {
        it.canSit = r.u8();
        r.skip(6 * 4); // offset pemain, tekstur kursi, offset kaki kursi
        it.chairTexture = r.str();
      }
      if (version >= 16) it.itemRenderer = r.str();
      if (version >= 17) r.skip(4);
      if (version >= 18) r.skip(4);
      if (version >= 19) r.skip(9);
      if (version >= 21) r.skip(2);
      if (version >= 22) it.info = r.str();
      if (version >= 23) {
        const a = r.u16();
        const b = r.u16();
        if (a || b) it.recipe = [a, b];
      }
      if (version >= 24) r.skip(1);
      if (version >= 25) {
        it.hitSoundFX = r.str();
        r.skip(4);
      }
      if (version >= 26) r.skip(1);
      if (version >= 27) r.str();
    }
    items.set(it.id, it);
  }
  return { version, count, items, bytesRead: r.p };
}

/** Basis data item untuk renderer dan logika klien. */
export class ItemDB {
  constructor(parsed) {
    this.version = parsed.version;
    this.count = parsed.count;
    this.items = parsed.items;
  }
  get(id) {
    return this.items.get(id);
  }
  name(id) {
    return this.items.get(id)?.name ?? `#${id}`;
  }
  isBackground(id) {
    return this.items.get(id)?.type === ACTION.BACKGROUND;
  }
  /** Apakah tile dengan foreground ini menghalangi pemain. Aturan tabrakan Growtopia: 0 = tidak, lainnya = ya (kecuali tipe khusus). */
  isSolid(id) {
    if (!id) return false;
    const it = this.items.get(id);
    if (!it) return true;
    return it.collisionType !== 0 && it.collisionType !== 2 && it.type !== ACTION.BACKGROUND;
  }
}

/**
 * Kembangkan data zlib (deflate dengan header zlib) memakai DecompressionStream bawaan browser dan Node 18+.
 * @param {Uint8Array} bytes
 * @param {number} [expected] panjang hasil yang diharapkan; hasil yang lebih panjang dari ini ditolak
 */
export async function inflateZlib(bytes, expected) {
  const limit = Math.min(expected > 0 ? expected : MAX_INFLATED, MAX_INFLATED);
  const ds = new DecompressionStream("deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new RangeError(`hasil dekompresi melebihi batas ${limit} byte`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
