// Pemilihan frame tile berdasarkan tetangga ("smart edge"), diturunkan dari atlas tekstur asli.
//
// Cara menurunkannya: tiap item punya lembar frame yang dimulai di (textureX, textureY); frame ke-n
// ada di kolom textureX + n % 8, baris textureY + floor(n / 8). Isi frame diperiksa langsung dari
// tiles_page1.rttex (celah transparan di sisi kiri/kanan, rumput di atas, sudut membulat), lalu
// dicocokkan dengan himpunan tetangga yang tidak ada.
//
// Jenis (item.storageType) yang sudah ditangani, dengan keyakinannya:
//   1  satu frame (pasti)
//   2  tepi pintar 16 frame: tanah, bedrock, latar gua (frame 0-12 terverifikasi dari gambar; kombinasi
//      yang tidak punya frame sendiri memakai frame terdekat)
//   3  horizontal 4 frame: kiri, tengah, kanan, tunggal (terverifikasi dari platform kayu)
//   7  vertikal 4 frame: bawah, tengah, atas, tunggal (terverifikasi dari lampu jalan dan pilar)
// Jenis lain (4, 5, 6, 8, 9, 10) memakai frame 0 sampai aturannya diverifikasi.
// Tetangga di luar dunia dianggap ada (tepi dunia tanpa garis tepi); ini tebakan.

const T = 1, L = 2, R = 4, B = 8; // bit "tetangga tidak ada"

/** Tabel jenis 2: himpunan sisi terbuka -> frame. */
const EDGE16 = new Map([
  [0, 0], [T, 1], [L, 3], [R, 4], [T | L, 5], [T | R, 6], [L | B, 7], [R | B, 8], [L | R, 9],
  [T | L | R, 10], [L | R | B, 11], [T | L | R | B, 12],
  [B, 0], [T | B, 1], [T | L | B, 5], [T | R | B, 6], // tidak punya frame sendiri: pakai yang terdekat
]);
const DIAG_TL = 13, DIAG_TR = 14; // sudut dalam; sudut bawah tampak sama dengan frame 0

/**
 * @param {(dx:number,dy:number)=>boolean} same apakah tetangga relatif (dx,dy) berjenis sama
 * @param {number} storageType
 * @returns {number} indeks frame
 */
export function frameIndex(storageType, same) {
  switch (storageType) {
    case 2: {
      let open = 0;
      if (!same(0, -1)) open |= T;
      if (!same(-1, 0)) open |= L;
      if (!same(1, 0)) open |= R;
      if (!same(0, 1)) open |= B;
      if (open === 0) {
        if (!same(-1, -1)) return DIAG_TL;
        if (!same(1, -1)) return DIAG_TR;
        return 0;
      }
      return EDGE16.get(open) ?? 0;
    }
    case 3: {
      const l = same(-1, 0), r = same(1, 0);
      return l && r ? 1 : r ? 0 : l ? 2 : 3;
    }
    case 7: {
      const up = same(0, -1), down = same(0, 1);
      return up && down ? 1 : up ? 0 : down ? 2 : 3;
    }
    default:
      return 0;
  }
}

/** Koordinat sel atlas (kolom, baris) untuk frame n. */
export const framePos = (it, n) => ({ col: it.textureX + (n % 8), row: it.textureY + Math.floor(n / 8) });
