// bun test client/tests/dev-server.test.ts
// Menguji dev server dengan upstream palsu: proxy login (termasuk redirect), proxy WebSocket biner
// beserta header Origin, file statis, dan penolakan path traversal.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveStatic, startDevServer } from "../tools/dev-server";

let root: string;
let login: ReturnType<typeof Bun.serve>;
let ws: ReturnType<typeof Bun.serve>;
let dev: ReturnType<typeof startDevServer>;
const seenOrigins: (string | null)[] = [];
const seenPaths: string[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "devsrv-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "index.html"), "<h1>hi</h1>");
  writeFileSync(join(root, "src", "a.js"), "export const a = 1;");
  writeFileSync(join(tmpdir(), "devsrv-secret.txt"), "rahasia");

  login = Bun.serve({
    port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/player/growid/login/validate" && req.method === "POST") {
        const body = await req.json();
        if (body.password !== "benar123") return Response.json({ status: "error", message: "Invalid" }, { status: 400 });
        return new Response(null, { status: 302, headers: { Location: "/player/growid/validate/checktoken/TOK" } });
      }
      if (u.pathname.startsWith("/player/growid/validate/checktoken/")) {
        return new Response(JSON.stringify({ status: "success", token: u.pathname.split("/").pop() }), {
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("nf", { status: 404 });
    },
  });

  ws = Bun.serve({
    port: 0,
    fetch(req, srv) {
      seenOrigins.push(req.headers.get("origin"));
      seenPaths.push(new URL(req.url).pathname);
      return srv.upgrade(req) ? undefined : new Response("no", { status: 400 });
    },
    websocket: {
      message(sock, m) {
        sock.send(m); // echo biner
      },
    },
  });

  dev = startDevServer({
    port: 0,
    root,
    loginUpstream: `http://127.0.0.1:${login.port}`,
    wsUpstream: `ws://127.0.0.1:${ws.port}`,
  });
});

afterAll(() => {
  dev.stop(true);
  login.stop(true);
  ws.stop(true);
});

const base = () => `http://127.0.0.1:${dev.port}`;

describe("file statis", () => {
  test("menyajikan index dan modul JS dengan tipe yang benar", async () => {
    expect(await (await fetch(base() + "/")).text()).toContain("<h1>hi</h1>");
    const js = await fetch(base() + "/src/a.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
  });

  test("menolak path traversal", async () => {
    for (const p of ["/../devsrv-secret.txt", "/%2e%2e/devsrv-secret.txt", "/src/..%2f..%2fdevsrv-secret.txt"]) {
      const r = await fetch(base() + p);
      expect(await r.text()).not.toContain("rahasia");
    }
    expect(resolveStatic(root, "/../x")).toBeNull();
    expect(resolveStatic(root, "/%00")).toBeNull();
    expect(resolveStatic(root, "/%E0%A4%A")).toBeNull();
  });

  test("404 untuk file yang tidak ada", async () => {
    expect((await fetch(base() + "/tidak-ada.js")).status).toBe(404);
  });
});

describe("proxy login", () => {
  test("POST login diteruskan dan redirect diikuti browser sampai JSON token", async () => {
    const res = await fetch(base() + "/player/growid/login/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ growId: "abc", password: "benar123", data: "" }),
    });
    const body = JSON.parse(await res.text());
    expect(body).toEqual({ status: "success", token: "TOK" });
  });

  test("status error dari upstream tetap diteruskan", async () => {
    const res = await fetch(base() + "/player/growid/login/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ growId: "abc", password: "salah" }),
    });
    expect(res.status).toBe(400);
  });

  test("502 dengan pesan jelas kalau server login mati", async () => {
    const d = startDevServer({ port: 0, root, loginUpstream: "http://127.0.0.1:1" });
    const res = await fetch(`http://127.0.0.1:${d.port}/login`, { method: "POST", body: "x" });
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("GrowServer");
    d.stop(true);
  });
});

describe("proxy WebSocket", () => {
  function open(path: string, origin?: string) {
    return new Promise<WebSocket>((resolve, reject) => {
      const s = new WebSocket(`ws://127.0.0.1:${dev.port}${path}`, origin ? ({ headers: { Origin: origin } } as any) : undefined);
      s.binaryType = "arraybuffer";
      s.onopen = () => resolve(s);
      s.onerror = () => reject(new Error("ws gagal"));
    });
  }

  test("byte biner pulang-pergi utuh, termasuk pesan yang dikirim sebelum upstream siap", async () => {
    const s = await open("/ws/17091", "http://localhost:8080");
    const payload = new Uint8Array([4, 0, 0, 0, 1, 2, 3, 255, 0, 128]);
    const got = new Promise<Uint8Array>((r) => (s.onmessage = (e) => r(new Uint8Array(e.data as ArrayBuffer))));
    s.send(payload); // langsung setelah open: upstream mungkin belum terbuka
    expect(Array.from(await got)).toEqual(Array.from(payload));
    s.close();
  });

  test("header Origin browser diteruskan ke gateway, path dipertahankan", async () => {
    const s = await open("/ws/17092", "http://localhost:8080");
    s.send(new Uint8Array([1]));
    await new Promise<void>((r) => (s.onmessage = () => r()));
    expect(seenOrigins.at(-1)).toBe("http://localhost:8080");
    expect(seenPaths.at(-1)).toBe("/ws/17092");
    s.close();
  });

  test("path WebSocket selain /ws/<port> ditolak", async () => {
    await expect(open("/ws/abc")).rejects.toThrow();
    await expect(open("/lain")).rejects.toThrow();
  });
});

describe("proxy CDN", () => {
  test("meneruskan file, mengikuti redirect hanya ke host yang diizinkan", async () => {
    const cdn = Bun.serve({
      port: 0,
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === "/growtopia/game/a.rttex") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/octet-stream" } });
        if (p === "/evil") return new Response(null, { status: 302, headers: { Location: "https://evil.example/x" } });
        if (p === "/http") return new Response(null, { status: 302, headers: { Location: "http://growserver-cache.netlify.app/x" } });
        return new Response("nf", { status: 404 });
      },
    });
    const d = startDevServer({ port: 0, root, cdnUpstream: `http://127.0.0.1:${cdn.port}` });
    try {
      const ok = await fetch(`http://127.0.0.1:${d.port}/cdn/growtopia/game/a.rttex`);
      expect(Array.from(new Uint8Array(await ok.arrayBuffer()))).toEqual([1, 2, 3]);
      expect((await fetch(`http://127.0.0.1:${d.port}/cdn/evil`)).status).toBe(502);
      expect((await fetch(`http://127.0.0.1:${d.port}/cdn/http`)).status).toBe(502);
      expect((await fetch(`http://127.0.0.1:${d.port}/cdn/nope`)).status).toBe(404);
      expect((await fetch(`http://127.0.0.1:${d.port}/cdn/%2e%2e/x`)).status).not.toBe(200);
    } finally {
      d.stop(true);
      cdn.stop(true);
    }
  });
});

// Integrasi dengan gateway ASLI (tanpa upstream palsu di sisi WebSocket), memakai konfigurasi yang sama
// seperti tutorial: WS_ALLOWED_ORIGINS=http://localhost:8080, allowMissingOrigin tidak diaktifkan.
describe("dev server + gateway asli", () => {
  test("Origin yang diizinkan lolos, Origin lain ditolak gateway", async () => {
    const { startWsGateway } = await import("../../server/overlay/src/services/ws-gateway");
    const events: string[] = [];
    const emitter = { emit: (n: string) => void events.push(n) };
    const gw = startWsGateway({
      port: 0,
      hostname: "127.0.0.1",
      allowedOrigins: ["http://localhost:8080"],
      resolve: (p) => (p === 17091 ? (emitter as any) : undefined),
    });
    const d = startDevServer({ port: 0, root, wsUpstream: `ws://127.0.0.1:${gw.port}` });
    const connect = (origin: string) =>
      new Promise<"open" | "closed">((resolve) => {
        const s = new WebSocket(`ws://127.0.0.1:${d.port}/ws/17091`, { headers: { Origin: origin } } as any);
        s.onopen = () => setTimeout(() => resolve("open"), 150); // beri waktu bila upstream menolak
        s.onclose = () => resolve("closed");
      });
    try {
      expect(await connect("http://localhost:8080")).toBe("open");
      expect(events).toContain("connect");
      events.length = 0;
      expect(await connect("http://jahat.example")).toBe("closed");
      expect(events).not.toContain("connect");
    } finally {
      d.stop(true);
      gw.stop();
    }
  });
});
