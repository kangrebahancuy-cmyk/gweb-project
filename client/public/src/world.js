// Dunia berbasis tile. Murni logika (tanpa DOM) supaya bisa diuji di Node.

export const TILE = 32;

export class World {
  /**
   * @param {number} w lebar dalam tile
   * @param {number} h tinggi dalam tile
   * @param {Record<string, {solid?: boolean, hits?: number}>} defs definisi tile per id
   */
  constructor(w, h, defs) {
    this.w = w;
    this.h = h;
    this.defs = defs;
    this.tiles = new Uint16Array(w * h);
    this.damage = new Map(); // "x,y" -> jumlah pukulan yang sudah diterima
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x, y) {
    return this.inBounds(x, y) ? this.tiles[y * this.w + x] : 0;
  }

  set(x, y, id) {
    if (!this.inBounds(x, y)) return false;
    this.tiles[y * this.w + x] = id;
    this.damage.delete(`${x},${y}`);
    return true;
  }

  // Kiri, kanan, dan bawah dunia dianggap padat. Atas dianggap udara.
  isSolid(x, y) {
    if (y < 0) return false;
    if (x < 0 || x >= this.w || y >= this.h) return true;
    const id = this.tiles[y * this.w + x];
    return id !== 0 && !!this.defs[id]?.solid;
  }

  /** Pukul tile. Mengembalikan true kalau tile pecah. */
  hit(x, y) {
    const id = this.get(x, y);
    if (!id) return false;
    const need = this.defs[id]?.hits ?? 3;
    if (need === Infinity || need < 0) return false; // tidak bisa dipecahkan
    const key = `${x},${y}`;
    const n = (this.damage.get(key) ?? 0) + 1;
    if (n >= need) {
      this.set(x, y, 0);
      return true;
    }
    this.damage.set(key, n);
    return false;
  }

  /** Progres kerusakan 0..1 untuk efek retak. */
  damageRatio(x, y) {
    const id = this.get(x, y);
    const need = this.defs[id]?.hits ?? 3;
    const n = this.damage.get(`${x},${y}`) ?? 0;
    return need > 0 && Number.isFinite(need) ? n / need : 0;
  }
}

// Id tile bawaan. Sama dengan kunci di manifest.json.
export const T = { AIR: 0, DIRT: 1, WOOD: 2, COBBLE: 3, ROCK: 4, BRICK: 5, PURPLE: 6, LAVA: 7, BEDROCK: 8 };

/** Dunia contoh 100x60 ala Growtopia: langit di atas, tanah, batu, lava, dasar tak bisa dipecah. */
export function generateWorld(defs, w = 100, h = 60, seed = 1337) {
  const world = new World(w, h, defs);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ground = 24;
  for (let y = ground; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let id = T.DIRT;
      if (y >= ground + 8) id = rnd() < 0.15 ? T.ROCK : T.COBBLE;
      if (y >= h - 8) id = rnd() < 0.3 ? T.PURPLE : T.ROCK;
      if (y >= h - 4 && rnd() < 0.5) id = T.LAVA;
      if (y === h - 1) id = T.BEDROCK;
      world.tiles[y * w + x] = id;
    }
  }
  // Pintu masuk (spawn) dan beberapa platform kayu.
  for (let x = 0; x < 6; x++) world.set(2 + x, ground - 6, T.WOOD);
  for (let x = 0; x < 8; x++) world.set(20 + x, ground - 4, T.WOOD);
  for (let x = 0; x < 5; x++) world.set(40 + x, ground - 7, T.BRICK);
  // Gua kecil.
  for (let y = ground + 3; y < ground + 6; y++) for (let x = 60; x < 70; x++) world.set(x, y, 0);
  return world;
}

export const SPAWN = { x: 3 * TILE, y: (24 - 8) * TILE };
