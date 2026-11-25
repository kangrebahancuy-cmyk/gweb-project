# How-to: menjalankan Growtopia web dari nol

Panduan ini membawa Anda dari komputer kosong sampai bisa login ke server GrowServer lewat browser.
Semua langkah dan perintah di sini sudah dicocokkan dengan kode ketiga repo StileDevs dan repo ini.

> **Status jujur:** klien web saat ini baru bisa **login dan tersambung ke server** (status "Terhubung
> sebagai ..."). Dunia, gerak, pukul/pasang, chat, dan inventori **belum** ada. Selain itu, rangkaian
> lengkap ini belum pernah dijalankan terhadap proses GrowServer sungguhan oleh saya (dependensinya
> tidak bisa dipasang di lingkungan pengembangan). Percobaan pertama di komputer Anda adalah ujian
> sebenarnya; bagian [Masalah umum](#9-masalah-umum) disiapkan untuk itu.

## 1. Apa yang perlu diunduh dan apa yang tidak

Anda bertanya apakah file dari GrowServer dibutuhkan. **Ya, GrowServer wajib**: dialah servernya (dunia,
akun, inventori, database). Dua repo lainnya **tidak wajib**.

| Repo | Perlu? | Alasan (dari kode) |
|---|---|---|
| [`kangrebahancuy-cmyk/gweb-project`](https://github.com/kangrebahancuy-cmyk/gweb-project) | **Wajib** | Klien web, gateway WebSocket, patch, dan dev server |
| [`StileDevs/GrowServer`](https://github.com/StileDevs/GrowServer) | **Wajib** | Server game. Gateway dipasang ke dalamnya |
| [`StileDevs/growserver-cache`](https://github.com/StileDevs/growserver-cache) | Tidak wajib | Hanya situs statis berisi aset resmi (`.rttex`, audio, XML). CDN bawaan GrowServer otomatis mengalihkan aset yang tidak ada ke `growserver-cache.netlify.app` (`default_cdn_server` di konfigurasi). Unduh hanya kalau mau menyajikan aset sendiri atau bekerja offline, lihat [bagian 8](#8-opsional-menyajikan-aset-sendiri-growserver-cache) |
| [`StileDevs/growserver-frontend`](https://github.com/StileDevs/growserver-frontend) | **Jangan dipakai** | Situs Vue lama (commit terakhir Januari 2025). Ia memanggil `/player/signup` dan `/player/login/validate`, dua rute yang **sudah tidak ada** di GrowServer sekarang. Halaman login dan daftar sudah tertanam di GrowServer sendiri |

Yang **tidak** Anda butuhkan untuk jalur web: APK, file hosts (`growtopia1.com`), Caddy, sertifikat
HTTPS lokal, dan klien Growtopia. Itu semua hanya untuk klien native.

## 2. Prasyarat

| Perangkat lunak | Untuk | Cek |
|---|---|---|
| [Bun](https://bun.sh) **v1.4 atau lebih baru** | menjalankan GrowServer, gateway, dan dev server | `bun --version` |
| [Git](https://git-scm.com) | mengunduh repo dan memasang patch | `git --version` |
| Browser modern (Chrome, Edge, Firefox) | membuka klien | |
| *Opsional:* Node.js 22+ | menjalankan tes klien (`node --test`) | `node --version` |
| *Opsional:* Python 3 + Pillow | mengonversi aset APK untuk prototipe 2D offline | `python3 -c "import PIL"` |

Koneksi internet dibutuhkan saat setup pertama: GrowServer mengunduh `items.dat` terbaru dari arsip
StileDevs (`StileDevs/itemsdat-archive`) dan paket-paketnya.

**Windows:** jalankan perintah di **Git Bash** atau **WSL** (skrip `apply.sh` adalah skrip bash).
Perintah Bun yang sama juga jalan di PowerShell. Cara mengisi variabel lingkungan berbeda per shell,
lihat langkah 6.

## 3. Unduh

Buat satu folder kerja dan unduh dua repo wajib:

```bash
mkdir growtopia-web && cd growtopia-web
git clone https://github.com/StileDevs/GrowServer
git clone https://github.com/kangrebahancuy-cmyk/gweb-project
```

Hasilnya:

```
growtopia-web/
  GrowServer/      server game
  gweb-project/    klien web + gateway + patch
```

## 4. Pasang dependensi dan siapkan GrowServer

```bash
cd GrowServer
bun install
bun run doctor      # memeriksa dependensi dan lingkungan, perbaiki apa pun yang ditandai
bun run setup
```

`bun run setup` mengerjakan 7 langkah: membuat `configs/server.toml`, sertifikat TLS di `.cache/tls`,
migrasi database (SQLite di `data/local.db`), `player-tribute.dat`, mengunduh dan memverifikasi
`items.dat` ke `.cache/items.dat`, membuat metadata wiki, lalu memeriksa Caddy.

- Peringatan "caddy not detected" **boleh diabaikan** untuk jalur web.
- Kalau langkah wiki gagal karena jaringan, ulangi dengan `bun run setup --skip-wiki`. (Efeknya pada
  fitur wiki di dalam game belum saya uji.)
- Kalau Anda sudah punya `items.dat`, letakkan di `GrowServer/.cache/items.dat` (GrowServer juga mencari
  di `configs/items.dat` dan `items.dat` di folder root).
- Anda boleh melewati `setup`: `bun run start` menjalankannya otomatis pada folder yang masih bersih.

Jangan menjalankan server dulu. Pasang gateway dulu di langkah berikutnya.

## 5. Pasang gateway WebSocket ke GrowServer

Dari folder `growtopia-web`:

```bash
cd gweb-project
./server/apply.sh ../GrowServer
```

Skrip ini menyalin `src/services/ws-gateway.ts` dan menerapkan dua patch. Aman dijalankan ulang (patch
yang sudah terpasang dilewati). Hasil yang diharapkan:

```
ok   src/services/ws-gateway.ts
ok   0001-ws-gateway-hook.patch
ok   0002-require-issued-transfer-token.patch
```

- **0001** menyalakan gateway dari `src/game/index.ts`.
- **0002** menutup celah login-sebagai-akun-mana-pun lewat token transfer `0`. **Baca
  [docs/SECURITY-NOTES.md](docs/SECURITY-NOTES.md)** sebelum memutuskan memakai `--no-auth-fix`.
- Kalau muncul `GAGAL ... tidak cocok dengan versi GrowServer ini`, kode upstream sudah berubah dari
  versi yang saya baca (commit `fa72b9e`). Kembalikan ke commit itu dengan
  `git -C ../GrowServer checkout fa72b9e`, lalu ulangi.
- Tanpa Git Bash/WSL: salin file `server/overlay/src/services/ws-gateway.ts` ke
  `GrowServer/src/services/`, lalu dari folder `GrowServer` jalankan
  `git apply ../gweb-project/server/patches/0001-ws-gateway-hook.patch` dan hal yang sama untuk `0002`.

## 6. Jalankan GrowServer

Dari folder `GrowServer`, set `WS_ALLOWED_ORIGINS` ke alamat tempat Anda membuka halaman klien.
Nilainya harus **sama persis** dengan yang tampil di address bar browser (`localhost` dan `127.0.0.1`
dianggap berbeda).

Git Bash / WSL / macOS / Linux:

```bash
WS_ALLOWED_ORIGINS=http://localhost:8080 bun run start
```

PowerShell:

```powershell
$env:WS_ALLOWED_ORIGINS = "http://localhost:8080"; bun run start
```

CMD:

```bat
set WS_ALLOWED_ORIGINS=http://localhost:8080 && bun run start
```

Tunggu sampai log menampilkan `server ready to use`, dan cari baris `ws gateway listening` (port 17903).
Terminal ini menjadi konsol server; biarkan terbuka. Hentikan dengan `Ctrl+C` atau perintah `stop`
supaya pemain dan dunia tersimpan (jangan di-kill paksa).

Port yang dipakai:

| Port | Layanan |
|---|---|
| 17091 | game server ENet (UDP, hanya klien native) |
| 17900 | `server_data.php` |
| 17901 | server login HTTP |
| 17902 | server CDN |
| **17903** | **gateway WebSocket (baru)** |

## 7. Daftar akun, jalankan klien, login

**a. Jalankan dev server klien** (langkah b di bawah), lalu buka `http://localhost:8080/login.html`.
Di halaman itu pilih tab **Buat akun**, isi GrowID (3-18 huruf, angka, atau `_`), kata sandi (minimal 6
karakter), dan ulangi kata sandi. Tombol **Buat akun dan masuk** membuat akun lalu langsung masuk.
Kalau Anda lebih suka halaman daftar bawaan GrowServer, bisa juga lewat `http://localhost:17901/register`
(setelah berhasil Anda melihat halaman JSON `"status":"success"`; itu normal).

Akun harus dibuat dulu: pesan **"Invalid GrowID or password."** saat login hanya berarti akun itu belum
ada (atau kata sandinya salah).

**b. Dev server klien** dijalankan di terminal baru, dari folder `gweb-project`:

```bash
bun client/tools/dev-server.ts
```

Dev server membuat browser hanya bicara ke satu alamat (`http://localhost:8080`): file statis dilayani
langsung, `/player/*` diteruskan ke server login, dan `/ws/*` diteruskan ke gateway. Ini wajib karena
server login GrowServer **tidak mengirim header CORS**; membuka `login.html` lewat `python -m http.server`
akan gagal dengan "Failed to fetch".

**c. Masuk.** Setelah akun ada, buka tab **Masuk** dan login dengan GrowID dan kata sandi tadi.

Hasil yang diharapkan di kolom log:

```
akun valid, membuka koneksi game
server menerima login (items.dat hash ..., cdn ...)
dialihkan ke port 17091
siap (userID ...).
```

dan status **"Terhubung sebagai <nama>"**. Itulah batas fungsi saat ini.

**Opsional, jadi developer:** di konsol GrowServer ketik `role <growid> developer` (peran: `user`,
`supporter`, `moderator`, `developer`, `owner`). Perintah konsol lain: `ping`, `list`, `say <pesan>`,
`save`, `stop`.

### Prototipe dunia 2D offline (terpisah dari login)

Halaman `http://localhost:8080/` adalah prototipe dunia 2D yang berjalan sendiri di browser tanpa server.
Ia memakai aset dari APK Anda yang dikonversi lokal (opsional; tanpa aset, game memakai kotak warna):

```bash
python3 client/tools/build_assets.py /path/ke/apk-yang-di-unzip/assets
```

Aset itu milik pemegang hak ciptanya. Hasilnya masuk ke `client/public/assets/gen/` yang di-gitignore;
jangan di-commit atau di-deploy. Rencana Anda mengganti dengan pixel art sendiri lewat
`client/public/manifest.json` (lihat `client/README.md`).

### Menjalankan tes (opsional)

```bash
cd gweb-project
node --test client/tests/*.test.mjs                  # codec, sesi login, fisika
bun test client/tests/dev-server.test.ts             # dev server
bun test server/tests/ws-gateway.test.ts             # gateway
GROWSERVER_DIR=../GrowServer bun test server/tests/compat.test.ts   # kecocokan dengan kode asli GrowServer
```

Jalankan tes terakhir setelah langkah 5 supaya tes penolakan token `0` ikut dijalankan.

## 8. Opsional: menyajikan aset sendiri (growserver-cache)

Tidak perlu untuk login. Berguna kalau nanti Anda ingin klien mengambil aset dari server sendiri,
bekerja tanpa internet, atau mengganti aset dengan pixel art Anda.

Cara kerja CDN GrowServer (dari `src/services/cdn-server.ts`): permintaan `/growtopia/<path>` dicari
dulu di `resources/cdn-static/<path>` (relatif ke folder tempat GrowServer dijalankan). Kalau tidak ada,
pengguna dialihkan (HTTP 302) ke `https://<default_cdn_server>/growtopia/<path>`.

```bash
git clone https://github.com/StileDevs/growserver-cache
mkdir -p GrowServer/resources/cdn-static
cp -r growserver-cache/public/growtopia GrowServer/resources/cdn-static/
```

Repo itu berisi sekitar 3.100 file: `game` (tekstur, termasuk `tiles_page*.rttex`), `interface`, `audio`,
dan `GameData`. Tekstur berformat `.rttex`; ubah ke PNG dengan `client/tools/rttex2png.py`
(`python3 -I client/tools/rttex2png.py <folder-rttex> <folder-keluaran>`).
Aset resmi itu milik pemegang hak ciptanya: aman untuk pengembangan lokal, tetapi ganti sebelum rilis
publik.

Untuk menimpa satu aset saja, taruh file Anda dengan nama dan jalur yang sama di
`resources/cdn-static/`; file lokal selalu menang atas CDN default.

## 9. Masalah umum

| Gejala | Penyebab dan solusi |
|---|---|
| `Failed to fetch` di halaman login | Halaman dibuka dari origin lain (mis. `python -m http.server`). Server login tidak mengirim CORS. Buka lewat `bun client/tools/dev-server.ts` |
| `server login tidak bisa dihubungi di http://127.0.0.1:17901` (502) | GrowServer belum jalan, atau login-nya crash. Lihat log terminal GrowServer |
| WebSocket gagal / `403 forbidden` di log gateway (`origin ditolak`) | `WS_ALLOWED_ORIGINS` tidak sama persis dengan address bar. Pakai `http://localhost:8080` di kedua tempat, bukan `127.0.0.1` di salah satunya |
| `404 no such server` dari gateway | Port game server tidak terdaftar. Gateway hanya meneruskan ke port di `server_ports` (default `17091`) di `configs/server.toml` |
| `Invalid GrowID or password` | Akun belum dibuat atau kata sandi salah. Pakai tab **Buat akun** di halaman login |
| `GrowID '...' is already registered` | Nama itu sudah dipakai. Pakai tab **Masuk**, atau pilih nama lain |
| Log berhenti di "Status: ..." tanpa error | Lihat kolom log halaman dan log GrowServer; kirim keduanya kalau perlu bantuan. Ini kasus yang paling mungkin muncul pada percobaan pertama |
| `GAGAL 0001 ... tidak cocok` saat `apply.sh` | Versi GrowServer berbeda. `git -C ../GrowServer checkout fa72b9e` lalu ulangi |
| Gagal mengunduh `items.dat` saat setup | Jaringan memblokir GitHub. Unduh manual dan taruh di `GrowServer/.cache/items.dat` |
| `address already in use` | Port 17900-17903 atau 8080 dipakai program lain. Untuk dev server: `PORT=8081 bun client/tools/dev-server.ts` (jangan lupa ubah `WS_ALLOWED_ORIGINS`) |
| Nama file aneh / "Download failed" di klien native | `items.dat` didekode dengan `grow-items` lama. Lihat tabel Troubleshooting di README GrowServer |

## 10. Menaruh di server publik

Untuk dipakai orang lain, jangan pakai dev server. Layani semuanya dari satu domain HTTPS lewat Caddy
dan atur batas gateway. Langkah lengkap, Caddyfile, dan variabel lingkungan (`WS_GATEWAY_HOST`,
`WS_TRUST_PROXY`, `WS_ALLOWED_ORIGINS`) ada di [docs/DEPLOY.md](docs/DEPLOY.md). Di `configs/server.toml`
ubah `host` dan `login_domain` ke domain Anda.

Sebelum membuka ke publik, baca [docs/SECURITY-NOTES.md](docs/SECURITY-NOTES.md): ada celah di GrowServer
yang sudah ditambal patch 0002, ada satu dugaan celah yang belum ditambal (nama akun di jalur `ltoken`),
dan logika game masih mempercayai paket klien.

## 11. Rangkuman perintah

```bash
# sekali
git clone https://github.com/StileDevs/GrowServer
git clone https://github.com/kangrebahancuy-cmyk/gweb-project
cd GrowServer && bun install && bun run setup && cd ..
./gweb-project/server/apply.sh ./GrowServer

# tiap kali main (dua terminal)
cd GrowServer   && WS_ALLOWED_ORIGINS=http://localhost:8080 bun run start
cd gweb-project && bun client/tools/dev-server.ts
# buka http://localhost:8080/login.html -> tab "Buat akun" (sekali), lalu tab "Masuk"
```

## 12. Setelah login berhasil

Langkah pengembangan berikutnya (belum dikerjakan): mengunduh dan mem-parse `items.dat` di klien,
mem-parse `SEND_MAP_DATA` untuk merender dunia nyata dengan renderer yang sudah ada, lalu mengirim paket
gerak (`STATE`) dan pukul/pasang (`TILE_CHANGE_REQUEST`). Detailnya di bagian "Langkah berikutnya" pada
[README.md](README.md).
