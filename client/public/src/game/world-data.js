// Parser payload SEND_MAP_DATA (format dunia versi 0x19+ dari GrowServer / klien 5.6x).
//
// Urutan: u16 versi, u32 flag, string nama, u32 lebar, u32 tinggi, u32 jumlah tile, 5 byte,
// tile..., 12 byte, item jatuh, trailer cuaca. Tiap tile: fg, bg, parent, flag (+ u16 kunci bila
// LOCKED) dan data ekstra bila flag TILEEXTRA aktif. Tata letak ekstra diambil dari
// GrowServer (src/game/world/tiles/*) yang sendiri dicocokkan dengan dump dunia asli.
//
// Tata letak ekstra yang belum dikenal tidak bisa dilewati (ukurannya tidak diketahui), jadi
// parser berhenti dengan galat yang jelas, bukan menebak. Itu sama dengan perilaku klien asli.

export const TILE_FLAG = Object.freeze({
  EXTRA: 0x0001, LOCKED: 0x0002, SPLICED: 0x0004, SPAWN_SEEDS: 0x0008, SEED: 0x0010, FLIPPED: 0x0020,
  OPEN: 0x0040, PUBLIC: 0x0080, SILENCED: 0x0200, WATER: 0x0400, FIRE: 0x1000,
});

export const MIN_VERSION = 0x19;
const MAX_TILES = 250_000;
const MAX_DROPPED = 100_000;

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.p = 0;
  }
  need(n) {
    if (n < 0 || this.p + n > this.b.length) throw new RangeError(`data dunia terpotong di byte ${this.p} (butuh ${n})`);
  }
  u8() { this.need(1); return this.v.getUint8(this.p++); }
  u16() { this.need(2); const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
  u32() { this.need(4); const x = this.v.getUint32(this.p, true); this.p += 4; return x; }
  i32() { this.need(4); const x = this.v.getInt32(this.p, true); this.p += 4; return x; }
  f32() { this.need(4); const x = this.v.getFloat32(this.p, true); this.p += 4; return x; }
  skip(n) { this.need(n); this.p += n; }
  str() {
    const len = this.u16();
    this.need(len);
    const s = new TextDecoder("utf-8").decode(this.b.subarray(this.p, this.p + len));
    this.p += len;
    return s;
  }
}

/** Ukuran tetap (byte setelah byte tipe) untuk tipe ekstra yang tidak punya bagian berpanjang variabel. */
const FIXED = {
  9: 4, 10: 5, 15: 4, 18: 5, 19: 18, 22: 0, 26: 5, 27: 4, 28: 6, 30: 5, 34: 0, 38: 4, 39: 4, 40: 4, 41: 4,
  42: 21, 43: 16, 45: 0, 50: 4, 51: 0, 52: 0, 53: 8, 57: 4, 58: 0, 59: 0, 60: 5, 61: 35, 62: 14, 63: 12,
  66: 1, 67: 8, 68: 12, 72: 12, 73: 4, 74: 0, 77: 8, 80: 8, 81: 8, 8: 1, 23: 4, 49: 9,
};

/** Baca data ekstra satu tile (byte tipe sudah dibaca). Mengembalikan objek berisi field yang berguna. */
function readExtra(r, type) {
  switch (type) {
    case 1: return { type, label: r.str(), locked: !!(r.u8() & 0x8) };
    case 2: case 6: case 7: case 12: { const label = r.str(); r.skip(4); return { type, label }; }
    case 3: {
      const settings = r.u8();
      const owner = r.u32();
      const n = r.u32();
      if (n > 4096) throw new RangeError(`daftar akses kunci tidak masuk akal: ${n}`);
      r.skip(n * 4);
      r.skip(8); // tingkat minimum + cadangan (membawa tempo musik)
      return { type, settings, owner, accessCount: n };
    }
    case 4: return { type, age: r.u32(), fruit: r.u8() };
    case 11: return { type, playerId: r.u32(), name: r.str() };
    case 14: { const label = r.str(); r.skip(1 + 4 + 18); return { type, label }; }
    case 20: case 33: r.str(); return { type };
    case 21: case 47: r.str(); r.skip(5); return { type };
    case 24: return { type, itemId: r.u32(), price: r.i32() };
    case 25: {
      const flags = r.u8();
      const n = r.u32();
      if (n > 4096) throw new RangeError(`isi tangki ikan tidak masuk akal: ${n}`);
      r.skip(n * 4);
      return { type, flags };
    }
    case 31: r.skip(1); r.str(); r.skip(12 + 1 + 16); return { type };
    case 35: r.skip(4); r.str(); return { type };
    case 36: r.str(); r.skip(12); return { type };
    case 37: r.str(); r.skip(8); return { type };
    case 44: {
      r.skip(1 + 4);
      const n = r.u32();
      if (n > 65536) throw new RangeError(`daftar VIP tidak masuk akal: ${n}`);
      r.skip(n * 4);
      return { type };
    }
    case 54: { const len = r.u16(); r.skip(len); return { type }; }
    case 55: {
      r.skip(4);
      const n = r.u32();
      if (n > 4096) throw new RangeError(`isi oven tidak masuk akal: ${n}`);
      r.skip(n * 4 + 12);
      return { type };
    }
    case 56: r.str(); r.skip(4); return { type };
    default: {
      const size = FIXED[type];
      if (size === undefined) throw new RangeError(`tipe data ekstra ${type} belum didukung (byte ${r.p})`);
      r.skip(size);
      return { type };
    }
  }
}

/**
 * Parse payload SEND_MAP_DATA.
 * @param {Uint8Array} bytes
 */
export function parseWorld(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("butuh Uint8Array");
  const r = new Reader(bytes);
  const version = r.u16();
  if (version < MIN_VERSION) throw new RangeError(`versi dunia ${version} tidak didukung (minimal ${MIN_VERSION})`);
  r.u32(); // flag
  const name = r.str();
  const width = r.u32();
  const height = r.u32();
  const count = r.u32();
  if (count > MAX_TILES || width === 0 || height === 0 || width * height !== count) {
    throw new RangeError(`ukuran dunia tidak valid: ${width}x${height}, ${count} tile`);
  }
  r.skip(5);

  const fg = new Uint16Array(count);
  const bg = new Uint16Array(count);
  const parent = new Uint16Array(count);
  const flags = new Uint16Array(count);
  const extras = new Map();
  for (let i = 0; i < count; i++) {
    fg[i] = r.u16();
    bg[i] = r.u16();
    parent[i] = r.u16();
    const f = r.u16();
    flags[i] = f;
    if (f & TILE_FLAG.LOCKED) r.u16();
    if (f & TILE_FLAG.EXTRA) extras.set(i, readExtra(r, r.u8()));
  }

  r.skip(12);
  const droppedCount = r.u32();
  const droppedUid = r.u32();
  if (droppedCount > MAX_DROPPED) throw new RangeError(`jumlah item jatuh tidak masuk akal: ${droppedCount}`);
  const dropped = [];
  for (let i = 0; i < droppedCount; i++) {
    const id = r.u16();
    const x = r.f32();
    const y = r.f32();
    const amount = r.u8();
    r.u8();
    const uid = r.u32();
    dropped.push({ id, x, y, amount, uid });
  }

  const baseWeather = r.u16();
  r.u16();
  const weather = r.u16();
  r.skip(6);

  return { version, name, width, height, fg, bg, parent, flags, extras, dropped, droppedUid, baseWeather, weather, bytesRead: r.p };
}

/** Indeks tile dari koordinat; -1 kalau di luar dunia. */
export function tileIndex(world, x, y) {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return -1;
  return y * world.width + x;
}
