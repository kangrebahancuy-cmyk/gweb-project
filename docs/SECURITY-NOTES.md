# Catatan keamanan

Ditemukan saat membaca GrowServer (commit `fa72b9e`) untuk membuat gateway. Gateway membuat server
bisa dijangkau dari browser mana pun, jadi hal-hal ini jadi lebih penting dari sebelumnya.

## 1. Login sebagai akun mana pun lewat token transfer `0` (diperbaiki oleh patch 0002)

`PlayerAuth.validateSubServerTransfer` (src/game/player/auth.ts) menerima token `"0"`, `""` atau
`"undefined"` untuk nama akun apa pun yang dikirim klien, tanpa memeriksa token yang pernah dikeluarkan
server. Paket transfer yang memuat nama akun, token `0`, dan ID pemain sudah cukup untuk membuat server
memuat data pemain itu (`PlayerDB.getById`) dan menganggap koneksi tersebut sebagai pemiliknya. ID pemain
berurutan, jadi mudah ditebak. Isi paketnya sengaja tidak ditulis di sini.

**Diverifikasi** dengan menjalankan `PlayerAuth` asli: `validateSubServerTransfer("0", "1")` mengembalikan
`true`, sedangkan token acak mengembalikan `false`. Setelah patch 0002 token `"0"` mengembalikan `false`.
Tes kecocokan (`server/tests/compat.test.ts`) menolak percobaan ini melalui gateway sungguhan.

**Dampak patch 0002:** transfer sekarang hanya sah dengan token yang dikeluarkan server lewat
`OnSendToServer`. Alur normal (server mengirim token, klien mengirimnya kembali) tetap bekerja, dan itu
yang dites. Klien native tidak bisa saya uji di sini, jadi coba login dengan klien native setelah patch
dipasang. Kalau ada alur native yang ternyata mengandalkan token `0`, pasang tanpa patch ini
(`--no-auth-fix`), tetapi server tetap terbuka untuk pengambilalihan akun.

Disarankan melaporkan celah ini ke pemelihara upstream (StileDevs/GrowServer).

## 2. Nama akun di jalur `ltoken` dipercaya dari klien (BELUM diperbaiki, dugaan dari membaca kode)

Di `src/game/server/game-server.ts`, jalur `ltoken`:

```ts
player.tankIDName = player.auth.tankIDName;          // berasal dari isi ltoken buatan klien
player.playerId = session.player_id;                  // dari sesi yang valid
...
const dbPlayer = await PlayerDB.getByName(player.tankIDName);
if (dbPlayer) player.playerId = dbPlayer.id;          // menimpa playerId dengan akun yang DIKLAIM klien
```

`ltoken` hanyalah base64 dari parameter yang dikontrol klien (`loginData`, `username`). Siapa pun yang
punya satu sesi valid (akun sendiri) tampaknya bisa mencantumkan nama akun lain dan mendapat `playerId`
akun itu. **Ini belum saya jalankan** karena butuh database GrowServer; anggap sebagai dugaan yang perlu
diuji. Perbaikan yang disarankan: ambil pemain dari `session.player_id`
(`PlayerDB.getById(session.player_id)`), isi `tankIDName` dari record itu, dan abaikan nama dari klien.

## 3. Yang dilindungi gateway dan yang tidak

Dilindungi: origin yang tidak diizinkan ditolak, hanya frame biner, ukuran frame dibatasi, rate limit
per koneksi, batas koneksi total dan per IP, koneksi hanya ke port game server yang terdaftar.

Tidak dilindungi: logika game GrowServer tetap mempercayai paket klien seperti sebelumnya (posisi,
tile, dan sebagainya). Klien web lebih mudah dibuat bot daripada klien native, jadi validasi di sisi
server (jangkauan, laju aksi, kepemilikan item) lebih penting lagi. Header `Origin` hanya melindungi dari
halaman web pihak lain, bukan dari skrip non-browser.

## 4. Batas verifikasi

- Dependensi GrowServer tidak terpasang saat pengerjaan (tidak ada akses jaringan), jadi tidak ada
  pengecekan tipe TypeScript (`tsc`) dan GrowServer sungguhan tidak dijalankan. Sintaks hasil patch
  diperiksa dengan `bun build --no-bundle`.
- Klien web hanya mengirim/menerima paket login. Paket dunia belum diimplementasikan.
