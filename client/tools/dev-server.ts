// Dev server satu-origin untuk pengembangan lokal. Jalankan dengan Bun:
//
//   bun client/tools/dev-server.ts
//
// Browser hanya bicara ke satu alamat (default http://localhost:8080):
//   /ws/<port>                      -> gateway WebSocket GrowServer (ws://127.0.0.1:17903)
//   /player/*, /login, /register    -> server login GrowServer (http://127.0.0.1:17901)
//   selain itu                      -> file statis di client/public
//
// Kenapa perlu: server login GrowServer tidak mengirim header CORS, jadi halaman dari origin lain
// tidak bisa memanggilnya. Dengan satu origin, masalah itu hilang (sama seperti Caddy di produksi).
//
// Variabel lingkungan: PORT, HOST, LOGIN_UPSTREAM, WS_UPSTREAM.
// Hanya untuk pengembangan lokal. Untuk produksi pakai Caddy (docs/DEPLOY.md).
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, normalize, sep } from "node:path";

export interface DevServerOptions {
  port?: number;
  hostname?: string;
  loginUpstream?: string;
  wsUpstream?: string;
  root?: string;
}

interface ProxyWsData {
  path: string;
  origin: string | null;
  up: WebSocket | null;
  queue: (string | ArrayBuffer | Uint8Array)[] | null;
}

const LOGIN_PATH = /^\/(player\/|login$|register$|dashboard$)/;

/** Resolusi file statis di dalam root; null kalau di luar root atau bukan file. */
export function resolveStatic(root: string, pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  if (rel.endsWith("/")) rel += "index.html";
  const full = normalize(join(root, rel));
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    return existsSync(full) && statSync(full).isFile() ? full : null;
  } catch {
    return null;
  }
}

export function startDevServer(opts: DevServerOptions = {}) {
  const root = normalize(opts.root ?? fileURLToPath(new URL("../public", import.meta.url))).replace(/[\\/]+$/, "");
  const loginUpstream = (opts.loginUpstream ?? "http://127.0.0.1:17901").replace(/\/+$/, "");
  const wsUpstream = (opts.wsUpstream ?? "ws://127.0.0.1:17903").replace(/\/+$/, "");

  return Bun.serve<ProxyWsData>({
    port: opts.port ?? 8080,
    hostname: opts.hostname ?? "127.0.0.1",
    async fetch(req, server) {
      const url = new URL(req.url);

      if (/^\/ws\/\d{1,5}$/.test(url.pathname)) {
        const ok = server.upgrade(req, {
          data: { path: url.pathname, origin: req.headers.get("origin"), up: null, queue: [] },
        });
        return ok ? undefined : new Response("upgrade required", { status: 426 });
      }

      if (LOGIN_PATH.test(url.pathname)) {
        const headers = new Headers(req.headers);
        headers.delete("host");
        headers.delete("origin");
        try {
          const res = await fetch(loginUpstream + url.pathname + url.search, {
            method: req.method,
            headers,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
            redirect: "manual", // biarkan browser mengikuti redirect lewat origin ini
          });
          const out = new Headers(res.headers);
          out.delete("content-encoding");
          out.delete("content-length");
          return new Response(res.body, { status: res.status, headers: out });
        } catch {
          return new Response(`server login tidak bisa dihubungi di ${loginUpstream}. Apakah GrowServer sudah jalan?`, {
            status: 502,
          });
        }
      }

      if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
      const file = resolveStatic(root, url.pathname === "/" ? "/index.html" : url.pathname);
      if (!file) return new Response("not found", { status: 404 });
      return new Response(Bun.file(file), { headers: { "Cache-Control": "no-store" } });
    },
    websocket: {
      open(ws) {
        const d = ws.data;
        const headers: Record<string, string> = {};
        if (d.origin) headers["Origin"] = d.origin; // gateway menolak koneksi tanpa Origin
        const up = new WebSocket(wsUpstream + d.path, { headers } as unknown as string[]);
        up.binaryType = "arraybuffer";
        d.up = up;
        up.onopen = () => {
          for (const m of d.queue ?? []) up.send(m);
          d.queue = null;
        };
        up.onmessage = (e) => {
          try {
            ws.send(e.data as ArrayBuffer);
          } catch {
            /* klien sudah pergi */
          }
        };
        up.onclose = () => ws.close();
        up.onerror = () => ws.close();
      },
      message(ws, msg) {
        const d = ws.data;
        if (d.queue) d.queue.push(msg);
        else d.up?.send(msg);
      },
      close(ws) {
        ws.data.up?.close();
      },
    },
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 8080);
  const server = startDevServer({
    port,
    hostname: process.env.HOST ?? "127.0.0.1",
    loginUpstream: process.env.LOGIN_UPSTREAM,
    wsUpstream: process.env.WS_UPSTREAM,
  });
  console.log(`dev server: http://localhost:${server.port}/login.html`);
}
