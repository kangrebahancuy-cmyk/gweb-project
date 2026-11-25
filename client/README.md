# Klien web (prototipe dunia 2D offline)

Ini prototipe dari tahap sebelumnya. Login ke GrowServer ada di `public/login.html` (lihat README utama).

Klien web 2D tanpa dependensi (HTML + Canvas + ES modules). Dunia tile 100x60, fisika lari/lompat,
pukul dan pasang blok, hotbar. Berjalan offline di browser; mode online lewat WebSocket.

## Menjalankan

```bash
# 1. (sekali) konversi aset sementara dari folder APK yang sudah di-unzip
python3 -I tools/build_assets.py /path/ke/apk-unzip/assets

# 2. jalankan server statis
python3 -m http.server 8080 --directory public

# 3. buka http://localhost:8080
```

Tes: `node --test tests/*.test.mjs`

Kontrol: A/D atau panah = jalan, W/Spasi = lompat, klik kiri = pukul, klik kanan = pasang,
1-8 atau scroll = pilih blok, **F2 = pemilih sel atlas**.

## Mengganti ke pixel art buatan sendiri

Semua aset dirujuk dari `public/manifest.json`, kode tidak perlu diubah.

1. Buat atlas PNG dengan grid sel 32x32 (misalnya `public/assets/tiles_saya.png`).
2. Di `manifest.json`, tambahkan di `atlases` dan arahkan tiap tile ke `atlas`, `col`, `row`.
3. Untuk pemain, ubah `player.image`, `frameW/frameH`, `cols`, dan `walkFrames`.
4. Tekan F2 untuk melihat atlas dengan grid dan klik sel untuk menyalin `"col": x, "row": y`.

Kalau sebuah gambar gagal dimuat, game memakai kotak warna pengganti.

## Soal aset dari APK

`tools/build_assets.py` hanya untuk pengembangan lokal. Hasilnya masuk ke `public/assets/gen/`
yang di-gitignore. Aset Growtopia milik pemegang hak ciptanya, jadi jangan di-commit atau
di-deploy ke web publik. Ganti semuanya dengan karya sendiri sebelum dirilis.

## Online

Tambahkan `?ws=wss://alamat-gateway&name=Nama` ke URL. Browser tidak bisa memakai UDP/ENet,
jadi server perlu endpoint WebSocket atau gateway yang menerjemahkan pesan JSON di `src/net.js`
(`hello`, `pos`, `tile` dari klien; `welcome`, `players`, `tile`, `left` dari server).
Server harus menjadi otoritas untuk posisi dan perubahan tile, klien hanya mengirim niat.

## Struktur

- `src/world.js` dunia dan tile, `src/physics.js` fisika (keduanya murni, bisa dites di Node)
- `src/assets.js` loader manifest dan gambar, `src/net.js` transport lokal/WebSocket
- `src/main.js` input, render, HUD, loop game
- `tools/rttex2png.py` konverter `.rttex` ke PNG
