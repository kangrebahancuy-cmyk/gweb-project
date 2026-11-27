// Dev server satu-origin untuk pengembangan lokal. Jalankan dengan Bun:
//
//   bun client/tools/dev-server.ts
//
// Browser hanya bicara ke satu alamat (default http://localhost:8080):
//   /ws/<port>                      -> gateway WebSocket GrowServer (ws://127.0.0.1:17903)
//   /player/*, /login, /register    -> server login GrowServer (http://127.0.0.1:17901)
//   /cdn/*                          -> CDN GrowServer (http://127.0.0.1:17902), redirect ke host cadangan diikuti di sisi server
//   selain itu                      -> file statis di client/public
//
// Kenapa perlu: server login GrowServer tidak mengirim header CORS, jadi halaman dari origin lain
// tidak bisa memanggilnya. Dengan satu origin, masalah itu hilang (sama seperti Caddy di produksi).
//
// Variabel lingkungan: PORT, HOST, LOGIN_UPSTREAM, WS_UPSTREAM, CDN_UPSTREAM.
// Hanya untuk pengembangan lokal. Untuk produksi pakai Caddy (docs/DEPLOY.md).
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, normalize, sep } from "node:path";

export interface DevServerOptions {
  port?: number;
  hostname?: string;
  loginUpstream?: string;
  wsUpstream?: string;
  cdnUpstream?: string;
  /** Host yang boleh menjadi tujuan redirect CDN (cadangan GrowServer: growserver-cache.netlify.app). */
  cdnRedirectHosts?: string[];
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
  const cdnUpstream = (opts.cdnUpstream ?? "http://127.0.0.1:17902").replace(/\/+$/, "");
  const cdnHosts = new Set(opts.cdnRedirectHosts ?? ["growserver-cache.netlify.app"]);

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

      if (url.pathname.startsWith("/cdn/")) {
        if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
        if (url.pathname.includes("..") || url.pathname.includes("\\")) return new Response("bad path", { status: 400 });
        try {
          let res = await fetch(cdnUpstream + url.pathname.slice(4) + url.search, { redirect: "manual" });
          // GrowServer mengalihkan aset yang tidak ada ke CDN cadangan. Ikuti di sini (satu kali, https, host yang diizinkan)
          // karena CDN cadangan belum tentu mengirim header CORS untuk browser.
          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get("location") ?? "";
            let target: URL | null = null;
            try {
              target = new URL(loc, cdnUpstream);
            } catch {
              /* abaikan */
            }
            if (!target || target.protocol !== "https:" || !cdnHosts.has(target.host)) {
              return new Response("redirect CDN ke host yang tidak diizinkan", { status: 502 });
            }
            res = await fetch(target, { redirect: "error" });
          }
          const out = new Headers();
          const ct = res.headers.get("content-type");
          if (ct) out.set("content-type", ct);
          out.set("cache-control", "public, max-age=3600");
          return new Response(res.body, { status: res.status, headers: out });
        } catch {
          return new Response(`CDN tidak bisa dihubungi di ${cdnUpstream}`, { status: 502 });
        }
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
    cdnUpstream: process.env.CDN_UPSTREAM,
  });
  console.log(`dev server: http://localhost:${server.port}/login.html`);
}
