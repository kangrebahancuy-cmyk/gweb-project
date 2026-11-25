/**
 * WebSocket gateway untuk GrowServer.
 *
 * Browser tidak bisa membuka UDP/ENet, jadi klien web memakai WebSocket biner.
 * Satu frame WebSocket membawa satu paket Growtopia yang sama persis dengan yang
 * dikirim lewat ENet (4 byte tipe + isi). Gateway membungkus tiap koneksi sebagai
 * `WebPeer` dan menyuntikkannya ke emitter ENet milik GameServer
 * ("connect" / "receive" / "disconnect"), sehingga seluruh logika game berjalan
 * tanpa perubahan.
 *
 * Rute: ws(s)://host:PORT/ws/<port-game-server>
 *
 * File ini sengaja tidak mengimpor modul GrowServer lain supaya bisa dites sendiri.
 */

/** Paket minimal yang dibutuhkan GameServer (`packet.data()`); Packet wasm memenuhi ini. */
export interface PacketLike {
  data(): Uint8Array;
}

/** Bagian emitter ENet (nanoevents) yang kita pakai. */
export interface PeerEmitter {
  emit(event: string, ...args: any[]): void;
}

export interface LoggerLike {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface SocketLike {
  send(data: Uint8Array): number | void;
  close(code?: number, reason?: string): void;
}

/** ID peer web dimulai jauh di atas ID peer ENet (maks 1024) supaya tidak bentrok. */
const WEB_PEER_ID_BASE = 1_000_000;
let nextPeerId = WEB_PEER_ID_BASE;

function allocPeerId(): number {
  const id = nextPeerId++;
  if (nextPeerId >= 0x7fffffff) nextPeerId = WEB_PEER_ID_BASE;
  return id;
}

/** Meniru permukaan `Peer` dari growtopia.wasm yang dipakai GrowServer. */
export class WebPeer {
  public readonly id: number;
  public closed = false;

  constructor(private readonly socket: SocketLike) {
    this.id = allocPeerId();
  }

  send(packet: PacketLike, _channel = 0): void {
    if (this.closed) throw new Error("NotConnected");
    // salin: data() dari wasm bisa berupa view ke memori yang dipakai ulang
    const bytes = new Uint8Array(packet.data());
    const sent = this.socket.send(bytes);
    if (sent === 0) {
      // Bun mengembalikan 0 kalau frame dibuang: koneksi sudah tidak sehat
      this.disconnectNow(1011);
    }
  }

  sendRaw(data: Uint8Array, _channel = 0, _flags = 1): void {
    this.send({ data: () => data });
  }

  disconnect(code = 0): void {
    this.close(code);
  }

  disconnectNow(code = 0): void {
    this.close(code);
  }

  /** WebSocket mengirim frame yang sudah antre sebelum frame close, jadi sama dengan disconnect. */
  disconnectLater(code = 0): void {
    this.close(code);
  }

  private close(_code: number): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.close(1000, "bye");
    } catch {
      /* socket sudah tertutup */
    }
  }
}

/** Token bucket sederhana per koneksi. */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSec: number,
    private readonly burst: number,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.tokens = burst;
    this.last = now();
  }

  /** true kalau pesan diizinkan. */
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.ratePerSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Cek header Origin. Origin dengan host yang sama dengan header Host selalu boleh. */
export function isOriginAllowed(origin: string | null, host: string | null, allowed: string[], allowMissing = false): boolean {
  if (!origin) return allowMissing;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (allowed.includes("*")) return true;
  if (allowed.includes(parsed.origin)) return true;
  return !!host && parsed.host === host;
}

export interface GatewayOptions {
  /** Port TCP gateway. */
  port: number;
  hostname?: string;
  /** Origin yang boleh, mis. ["https://game.contoh.com"]. Origin yang host-nya sama dengan Host selalu boleh. */
  allowedOrigins: string[];
  /** Izinkan koneksi tanpa header Origin (klien non-browser, untuk tes). Default: false. */
  allowMissingOrigin?: boolean;
  /** Percayai X-Forwarded-For (hanya kalau di belakang reverse proxy sendiri, mis. Caddy). */
  trustProxy?: boolean;
  maxConnections?: number;
  maxConnectionsPerIp?: number;
  /** Ukuran maksimum satu frame dari klien, dalam byte. */
  maxMessageBytes?: number;
  messagesPerSecond?: number;
  messageBurst?: number;
  /** Cari emitter ENet untuk port game server; undefined kalau tidak ada. */
  resolve(port: number): PeerEmitter | undefined;
  logger?: LoggerLike;
}

interface ConnData {
  emitter: PeerEmitter;
  ip: string;
  peer?: WebPeer;
  limiter: RateLimiter;
  connected: boolean;
}

const silent: LoggerLike = { info() {}, warn() {}, error() {} };

export interface GatewayHandle {
  port: number;
  connections(): number;
  stop(): void;
}

export function startWsGateway(opts: GatewayOptions): GatewayHandle {
  const log = opts.logger ?? silent;
  const maxConnections = opts.maxConnections ?? 2000;
  const maxPerIp = opts.maxConnectionsPerIp ?? 10;
  const maxBytes = opts.maxMessageBytes ?? 16 * 1024;
  const perIp = new Map<string, number>();
  let total = 0;

  const server = Bun.serve<ConnData>({
    port: opts.port,
    hostname: opts.hostname ?? "0.0.0.0",
    fetch(req, srv) {
      const url = new URL(req.url);
      const m = /^\/ws\/(\d{1,5})$/.exec(url.pathname);
      if (!m) return new Response("not found", { status: 404 });

      if (!isOriginAllowed(req.headers.get("origin"), req.headers.get("host"), opts.allowedOrigins, opts.allowMissingOrigin)) {
        log.warn({ origin: req.headers.get("origin") }, "ws gateway: origin ditolak");
        return new Response("forbidden", { status: 403 });
      }

      const emitter = opts.resolve(Number(m[1]));
      if (!emitter) return new Response("no such server", { status: 404 });

      let ip = srv.requestIP(req)?.address ?? "unknown";
      if (opts.trustProxy) {
        const fwd = req.headers.get("x-forwarded-for");
        if (fwd) ip = fwd.split(",")[0]!.trim();
      }
      if (total >= maxConnections) return new Response("server full", { status: 503 });
      if ((perIp.get(ip) ?? 0) >= maxPerIp) return new Response("too many connections", { status: 429 });

      const data: ConnData = {
        emitter,
        ip,
        limiter: new RateLimiter(opts.messagesPerSecond ?? 100, opts.messageBurst ?? 200),
        connected: false,
      };
      if (srv.upgrade(req, { data })) return undefined;
      return new Response("upgrade failed", { status: 400 });
    },
    websocket: {
      maxPayloadLength: maxBytes,
      idleTimeout: 120,
      open(ws) {
        const d = ws.data;
        total++;
        perIp.set(d.ip, (perIp.get(d.ip) ?? 0) + 1);
        d.peer = new WebPeer(ws as unknown as SocketLike);
        d.connected = true;
        d.emitter.emit("connect", d.peer);
      },
      message(ws, message) {
        const d = ws.data;
        if (!d.peer || d.peer.closed) return;
        // hanya frame biner; teks bukan protokol Growtopia
        if (typeof message === "string") {
          ws.close(1003, "binary only");
          return;
        }
        if (!d.limiter.take()) {
          log.warn({ ip: d.ip, id: d.peer.id }, "ws gateway: rate limit, koneksi diputus");
          ws.close(1008, "rate limit");
          return;
        }
        const bytes = new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
        if (bytes.length < 4) return; // paket Growtopia minimal punya 4 byte tipe
        const packet: PacketLike & { free(): void } = { data: () => bytes, free() {} };
        d.emitter.emit("receive", d.peer, packet, 0);
      },
      close(ws, code) {
        const d = ws.data;
        total = Math.max(0, total - 1);
        const n = (perIp.get(d.ip) ?? 1) - 1;
        if (n <= 0) perIp.delete(d.ip);
        else perIp.set(d.ip, n);
        if (d.peer && d.connected) {
          d.peer.closed = true;
          d.connected = false;
          d.emitter.emit("disconnect", d.peer, code);
        }
      },
    },
  });

  log.info({ port: server.port }, "ws gateway listening");
  return {
    port: server.port ?? opts.port,
    connections: () => total,
    stop: () => void server.stop(true),
  };
}
