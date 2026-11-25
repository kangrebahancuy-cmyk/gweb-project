# Deploy

Satu domain, satu sertifikat: Caddy melayani klien statis, meneruskan `/ws/*` ke gateway, dan
meneruskan jalur login ke server login GrowServer. Dengan begitu tidak ada masalah CORS dan tidak ada
mixed content (halaman HTTPS hanya boleh membuka `wss://`).

## Port GrowServer

| Port | Layanan |
|---|---|
| 17091 (dan port di `server_ports`) | game server ENet (UDP, klien native) |
| 17900 | server_data.php (HTTPS) |
| 17901 | server login HTTP (`/player/growid/...`) |
| 17902 | server CDN |
| **17903** | **gateway WebSocket (baru)** |

## Caddyfile

```caddy
game.contoh.com {
    encode gzip

    # gateway WebSocket (Caddy menangani upgrade otomatis)
    @ws path /ws/*
    reverse_proxy @ws 127.0.0.1:17903

    # endpoint login GrowServer
    @login path /player/* /login /register /dashboard
    reverse_proxy @login 127.0.0.1:17901

    # klien statis
    root * /srv/gweb/client/public
    file_server
}
```

Buka `https://game.contoh.com/login.html`. Tanpa parameter `?ws=` dan `?login=`, halaman memakai host yang
sama, yang sesuai dengan konfigurasi di atas.

## Variabel lingkungan GrowServer

| Variabel | Default | Arti |
|---|---|---|
| `WS_GATEWAY_PORT` | `17903` | port gateway, `0` menonaktifkan |
| `WS_GATEWAY_HOST` | `0.0.0.0` | alamat yang didengar; pakai `127.0.0.1` kalau Caddy satu mesin |
| `WS_ALLOWED_ORIGINS` | kosong | daftar origin yang boleh, dipisah koma. Origin yang host-nya sama dengan header `Host` selalu boleh |
| `WS_TRUST_PROXY` | `0` | `1` = percayai `X-Forwarded-For` untuk batas koneksi per IP |

Contoh produksi di belakang Caddy satu mesin:

```bash
WS_GATEWAY_HOST=127.0.0.1 WS_TRUST_PROXY=1 WS_ALLOWED_ORIGINS=https://game.contoh.com bun run start
```

**Jangan** set `WS_TRUST_PROXY=1` kalau port gateway bisa dijangkau langsung dari internet: klien bisa
memalsukan `X-Forwarded-For` dan menghindari batas per IP. GrowServer mencatat peringatan saat kombinasi
itu terdeteksi.

Kalau Caddy berada di kontainer lain, ganti `127.0.0.1` pada Caddyfile dengan nama layanan GrowServer,
dan batasi port 17903 dengan firewall atau jaringan Docker internal.

## Batas bawaan gateway

Maks 2000 koneksi total, 10 per IP, frame maks 16 KiB, 100 pesan/detik (burst 200), hanya frame biner,
paket di bawah 4 byte dibuang, koneksi diam diputus setelah 120 detik. Ubah di `ws-gateway.ts`
(`GatewayOptions`) kalau perlu.
