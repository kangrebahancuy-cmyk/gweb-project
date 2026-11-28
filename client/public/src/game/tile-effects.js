// Logika murni untuk efek tile: retak saat dipukul, pertumbuhan pohon, warna seed.

export const PUNCH_DAMAGE = 6; // satuan damage di paket TILE_APPLY_DAMAGE (server: damage / 6 = jumlah pukulan)
export const CRACK_FRAMES = 4;

/** Frame retak (0..3) untuk jumlah pukulan terhadap kekerasan blok (item.breakHits = pukulan sampai pecah). */
export function crackFrame(hits, breakHits) {
  const need = breakHits > 0 ? breakHits : 1;
  const f = Math.floor((hits / need) * CRACK_FRAMES);
  return Math.max(0, Math.min(CRACK_FRAMES - 1, f));
}

/** Warna mentah 0xBBGGRRAA (format seedColor dan warna kulit) -> {r,g,b}. */
export function rawRGB(raw) {
  const v = raw >>> 0;
  return { r: (v >> 8) & 255, g: (v >> 16) & 255, b: (v >>> 24) & 255 };
}

/**
 * Pertumbuhan pohon.
 * @param {number} age detik sejak ditanam (data ekstra tipe 4)
 * @param {number} growTime detik sampai siap panen (item.growTime)
 */
export function treeGrowth(age, growTime) {
  const t = growTime > 0 ? Math.max(0, Math.min(1, age / growTime)) : 1;
  return { progress: t, ready: t >= 1, scale: 0.55 + 0.45 * t };
}

/** Sel atlas (halaman tiles_page1) untuk bentuk pohon: baris 19 = batang, baris 18 = daun, kolom = indeks. */
export const TREE_SHEET = Object.freeze({ file: "tiles_page1.rttex", trunkRow: 19, leavesRow: 18 });

/** Sel ikon seed 16x16 di seed.rttex: baris 0 = dasar (seedBase), baris 1 = hiasan (seedOverlay). */
export const SEED_ICON = Object.freeze({ file: "seed.rttex", size: 16 });

/** Teks label di tile (pintu/papan): dibersihkan dan dipendekkan. */
export function tileLabel(s, max = 12) {
  const t = String(s ?? "").replace(/`./g, "").replace(/[\r\n]+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}
