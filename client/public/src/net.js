// Lapisan jaringan. Game hanya bicara ke objek Net, tidak peduli transport-nya.
//
// Mode offline (default): LocalTransport, semua jalan di browser.
// Mode online: tambahkan ?ws=wss://alamat-gateway ke URL.
//
// PENTING: browser tidak bisa membuka UDP/ENet. Server Growtopia asli memakai ENet,
// jadi dibutuhkan gateway WebSocket (atau endpoint WebSocket di server Anda)
// yang menerjemahkan pesan JSON di bawah ini. Protokol sengaja dibuat sederhana
// dan bisa Anda ubah sesuai server.
//
// Klien -> server:
//   {t:"hello", name}
//   {t:"pos", x, y, vx, vy, f}        ~15x per detik
//   {t:"tile", x, y, id}              id 0 = hancurkan
// Server -> klien:
//   {t:"welcome", id, w, h, tiles:[...w*h id...]}
//   {t:"players", list:[{id,name,x,y,f}]}
//   {t:"tile", x, y, id}
//   {t:"left", id}

export class Net {
  constructor() {
    this.handlers = {};
    this.id = "local";
    this.online = false;
  }
  on(type, fn) {
    this.handlers[type] = fn;
    return this;
  }
  emit(msg) {
    this.handlers[msg.t]?.(msg);
  }
  send() {}
}

export class LocalTransport extends Net {
  connect() {
    // Offline: tidak ada pemain lain dan dunia dibuat oleh klien.
    return Promise.resolve();
  }
}

export class WebSocketTransport extends Net {
  constructor(url, name) {
    super();
    this.url = url;
    this.name = name;
    this.online = true;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = (this.ws = new WebSocket(this.url));
      ws.onopen = () => {
        this.send({ t: "hello", name: this.name });
        resolve();
      };
      ws.onerror = () => reject(new Error("Gagal terhubung ke " + this.url));
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.t === "welcome") this.id = msg.id;
          this.emit(msg);
        } catch (err) {
          console.warn("[net] pesan tidak valid", err);
        }
      };
      ws.onclose = () => this.emit({ t: "closed" });
    });
  }
  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

export function createNet(name) {
  const url = new URLSearchParams(location.search).get("ws");
  return url ? new WebSocketTransport(url, name) : new LocalTransport();
}
