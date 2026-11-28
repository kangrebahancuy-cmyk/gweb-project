# gweb-project

Klien web untuk server [GrowServer](https://github.com/StileDevs/GrowServer): browser berbicara dengan
server lewat WebSocket memakai paket Growtopia yang sama persis dengan klien native, jadi seluruh logika
game (dunia, inventori, database) tetap berjalan di GrowServer tanpa diubah.

```
Browser (client/)  --WebSocket biner-->  Gateway (server/overlay)  -->  GameServer GrowServer
   codec paket + sesi login               WebPeer meniru Peer ENet        logika game yang sama
```

## Status

| Bagian | Status |
|---|---|
| Gateway WebSocket untuk GrowServer (`WebPeer`, cek Origin, rate limit, batas koneksi) | selesai, teruji |
| Codec paket Growtopia di klien (teks, tank 56 byte, variant) | selesai, teruji terhadap encoder asli GrowServer |
| Sesi login (login -> SuperMain -> ltoken -> OnSendToServer -> transfer) | selesai, teruji end-to-end dengan `PlayerAuth` asli |
| Halaman login (`client/public/login.html`) | selesai, teruji di Chrome dengan server stub |
| Parse `items.dat` dan `SEND_MAP_DATA`, render dunia nyata | belum |
| Gerak, pukul, pasang, chat, inventori, dialog | belum |

**Belum pernah dijalankan terhadap proses GrowServer sungguhan** (dependensinya tidak bisa dipasang di
lingkungan tempat ini dibuat). Yang dites memakai kode asli GrowServer (`Variant`, `GameUpdatePacket`,
`PlayerAuth`, `TextParser`) tetapi dengan "lem" `game-server.ts` yang ditiru tanpa database.
Percobaan pertama di server Anda adalah ujian sebenarnya; lihat "Mencoba" di bawah.

## Struktur

```
server/
  overlay/src/services/ws-gateway.ts   gateway WebSocket (disalin ke GrowServer)
  patches/0001-ws-gateway-hook.patch   menyalakan gateway dari src/game/index.ts
  patches/0002-require-issued-transfer-token.patch   perbaikan celah login (BACA docs/SECURITY-NOTES.md)
  apply.sh                             memasang overlay + patch ke salinan GrowServer
  tests/                               tes gateway dan tes kecocokan dengan kode asli GrowServer
client/
  public/                              situs statis (HTML + ES modules, tanpa build)
    login.html, src/login-page.js      halaman login
    src/protocol/packets.js            codec paket
    src/protocol/session.js            mesin sesi login
    index.html, src/main.js ...        prototipe dunia 2D offline (dari tahap sebelumnya)
  tools/                               konverter .rttex -> PNG, dev-server.ts (dev server satu-origin)
  tests/                               tes codec, sesi, fisika
docs/
  DEPLOY.md                            reverse proxy (Caddy) dan variabel lingkungan
how-to.md                              panduan dari nol (unduhan, pemasangan, menjalankan, masalah umum)
  SECURITY-NOTES.md                    temuan keamanan di GrowServer dan batas perlindungan gateway
```

## Mencoba

1. Pasang gateway ke salinan GrowServer Anda (aman diulang):

   ```bash
   ./server/apply.sh /path/ke/GrowServer          # tambahkan --no-auth-fix untuk melewati patch 0002
   ```

2. Jalankan GrowServer seperti biasa, dengan variabel gateway:

   ```bash
   WS_ALLOWED_ORIGINS=http://localhost:8080 bun run start
   ```

   Gateway mendengar di port `17903` (port `17902` sudah dipakai server CDN GrowServer).

3. Jalankan dev server satu-origin (file statis + proxy login + proxy WebSocket) di terminal lain:

   ```bash
   bun client/tools/dev-server.ts
   # buka http://localhost:8080/login.html
   ```

   Login dengan akun GrowID yang sudah terdaftar (daftar dulu di `http://localhost:17901/register`).
   Hasil yang diharapkan: status "Terhubung sebagai ...". Kalau macet, kolom log menampilkan pesan
   terakhir dari server. Server login GrowServer tidak mengirim header CORS, jadi halaman **harus**
   dilayani lewat dev server ini (atau Caddy di produksi), bukan lewat `python -m http.server`.

Panduan lengkap dari nol, termasuk apa yang perlu dan tidak perlu diunduh: **[how-to.md](how-to.md)**.

## Tes

```bash
node --test client/tests/*.test.mjs                       # codec, sesi, fisika (tanpa dependensi)
bun test client/tests/dev-server.test.ts                  # dev server: proxy login dan WebSocket
bun test server/tests/ws-gateway.test.ts                  # gateway dengan server Bun dan WebSocket sungguhan
GROWSERVER_DIR=/path/ke/GrowServer-yang-sudah-dipatch \
  bun test server/tests/compat.test.ts                    # kecocokan dengan kode asli GrowServer
```

Tes kecocokan dilewati otomatis kalau `GROWSERVER_DIR` tidak diisi; tes penolakan token `0` hanya jalan
kalau patch 0002 terdeteksi di salinan itu.

## Aset dan hak cipta

Aset resmi Growtopia (dari APK atau CDN `growserver-cache`) milik pemegang hak ciptanya. `.gitignore`
mengecualikan `client/public/assets/gen/`. Untuk rilis publik, ganti semuanya dengan karya sendiri lewat
`client/public/manifest.json` (lihat `client/README.md`).

## Langkah berikutnya

1. Unduh dan parse `items.dat` (hash dan alamat CDN sudah diterima dari SuperMain di `session.info`).
2. Parse `SEND_MAP_DATA` dan render dunia dengan renderer yang ada.
3. Kirim paket `STATE` (gerak) dan `TILE_CHANGE_REQUEST` (pukul/pasang), terima `SEND_TILE_UPDATE_DATA`.

## Status tahap 3 (bermain di server asli)

Setelah login, halaman `login.html` membuka kanvas game: items.dat dimuat dari server, masuk dunia
lewat nama, dunia asli digambar, pemain lain terlihat, gerak/pukul/pasang/chat dikirim ke GrowServer.
Tekstur diambil lewat `/cdn/*` (dev server meneruskan ke CDN GrowServer); kalau gagal dimuat, tile
digambar sebagai kotak berwarna. Sudah ada: sambungan tile otomatis, karakter dari sprite asli, pohon/seed (tumbuh sesuai umur),
retak blok, label pintu dan papan. Belum ada: dialog/wrench, suara, HUD seperti klien asli.

Uji end-to-end tanpa GrowServer: `bun run e2e` (server palsu, cetak alamat), lalu
`python3 -I client/tests/e2e/e2e.py <port-dev> <port-log> <folder-screenshot>`.
