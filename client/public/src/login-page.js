// Halaman login: POST kredensial ke endpoint login GrowServer, lalu jalankan LoginSession.
//
// Secara bawaan semua permintaan (login dan WebSocket) memakai host yang sama dengan halaman ini.
// Lokal: jalankan `bun client/tools/dev-server.ts`. Produksi: reverse proxy (docs/DEPLOY.md).
// Server login GrowServer tidak mengirim CORS, jadi ?login= ke origin lain hanya berfungsi kalau
// Anda menambahkan CORS sendiri. Query string (opsional):
//   ?ws=ws://host:17903   alamat gateway WebSocket
//   ?login=http://host    alamat server login HTTP
//   ?port=17091           port game server awal

import { LoginSession } from "./protocol/session.js";

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const wsBase = q.get("ws") || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
const loginBase = (q.get("login") || "").replace(/\/+$/, "");
const startPort = Number(q.get("port")) || 17091;

function log(text, cls = "") {
  const line = document.createElement("div"); // textContent: pesan server tidak pernah dianggap HTML
  if (cls) line.className = cls;
  line.textContent = text;
  $("log").appendChild(line);
  $("log").scrollTop = $("log").scrollHeight;
}
const status = (t, cls = "") => {
  $("status").textContent = t;
  $("status").className = cls;
};

async function postJson(path, payload) {
  const res = await fetch(`${loginBase}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    credentials: "omit",
  });
  let body;
  try {
    body = JSON.parse(await res.text());
  } catch {
    throw new Error("respons server bukan JSON (cek alamat server login)");
  }
  if (body.status !== "success") throw new Error(body.message || "permintaan ditolak oleh server");
  return body;
}

async function fetchLoginToken(growId, password) {
  const body = await postJson("/player/growid/login/validate", { growId, password, data: "" });
  if (typeof body.token !== "string" || !body.token) throw new Error("server tidak mengirim token");
  return body.token; // sudah berbentuk ltoken (base64) yang dipakai paket login
}

// Pemeriksaan yang sama dengan server (login-server.ts), supaya salah ketik langsung terlihat.
export function validateRegistration(growId, password, confirm) {
  if (growId.length < 3 || growId.length > 18) return "GrowID harus 3-18 karakter";
  if (!/^[a-zA-Z0-9_]+$/.test(growId)) return "GrowID hanya boleh huruf, angka, dan _";
  if (password.length < 6) return "Kata sandi minimal 6 karakter";
  if (password.length > 128) return "Kata sandi maksimal 128 karakter";
  if (password !== confirm) return "Kata sandi tidak sama";
  return null;
}

async function registerAccount(growId, password, confirmPassword) {
  await postJson("/player/growid/register/validate", { growId, password, confirmPassword, data: "" });
}

// ---- mode Masuk / Buat akun ----
let mode = "login";
function setMode(next, keepLog = false) {
  mode = next;
  const reg = mode === "register";
  $("tab-login").setAttribute("aria-selected", String(!reg));
  $("tab-register").setAttribute("aria-selected", String(reg));
  $("confirm").hidden = !reg;
  $("confirm").required = reg;
  $("hint").hidden = !reg;
  $("go").textContent = reg ? "Buat akun dan masuk" : "Masuk";
  $("title").textContent = reg ? "Buat akun baru" : "Masuk ke server";
  $("password").autocomplete = reg ? "new-password" : "current-password";
  if (!keepLog) {
    status("");
    $("log").textContent = "";
  }
}
$("tab-login").addEventListener("click", () => setMode("login"));
$("tab-register").addEventListener("click", () => setMode("register"));

let session = null;

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const growId = $("growid").value.trim();
  const password = $("password").value;
  $("go").disabled = true;
  $("log").textContent = "";
  session?.close();
  try {
    if (mode === "register") {
      const problem = validateRegistration(growId, password, $("confirm").value);
      if (problem) throw new Error(problem);
      status("Membuat akun...");
      await registerAccount(growId, password, $("confirm").value);
      log(`akun ${growId} dibuat`, "ok");
      setMode("login", true); // kalau langkah berikutnya gagal, klik ulang cukup untuk masuk
    }
    status("Memeriksa akun...");
    const ltoken = await fetchLoginToken(growId, password);
    $("password").value = "";
    $("confirm").value = "";
    log("akun valid, membuka koneksi game", "ok");

    session = new LoginSession({ wsBase, ltoken, name: growId.toLowerCase(), port: startPort });
    session
      .on("state", (s) => status(`Status: ${s}`))
      .on("supermain", (i) => log(`server menerima login (items.dat hash ${i.itemsHash}, cdn ${i.cdnHost})`))
      .on("redirect", (r) => log(`dialihkan ke port ${r.port}`))
      .on("console", (m) => log(`[server] ${m}`))
      .on("warning", (m) => log(m, "err"))
      .on("failed", (err) => {
        status("Gagal", "err");
        log(err.message, "err");
        $("go").disabled = false;
      })
      .on("ready", (r) => {
        status(`Terhubung sebagai ${r.name}`, "ok");
        log(`siap (userID ${r.userID}), membuka permainan`, "ok");
        window.gtSession = session; // untuk eksperimen dari console
        startGame(session, r).catch((e) => {
          status("Gagal memulai permainan", "err");
          log(e.message, "err");
        });
      })
      .start();
  } catch (err) {
    status("Gagal", "err");
    log(err.message, "err");
    $("go").disabled = false;
  }
});

/** Setelah login: ambil items.dat, tampilkan kanvas, hubungkan tombol dunia dan chat. */
async function startGame(login, ready) {
  const [{ GameSession }, { GameView }] = await Promise.all([import("./game/game-session.js"), import("./game/game-view.js")]);
  const g = new GameSession({ send: (b) => login.send(b), name: ready.name });
  g.attach(login);
  const { Hud } = await import("./game/hud.js");
  const cdn = /^[\w\-/]+\/$/.test(ready.info?.cdnPath ?? "") ? ready.info.cdnPath : "growtopia/";
  const hud = new Hud({
    root: $("hud"),
    session: g,
    assetBase: `/cdn/${cdn}`,
    onSay: (text) => g.say(text),
    onLeave: () => g.leaveWorld(),
  });
  const say = (line, cls) => hud.note(line, cls);
  g.on("error", (e) => say(`galat: ${e.message}`, "err"))
    .on("joinfailed", () => say("gagal masuk dunia", "err"))
    .on("disconnect", () => {
      status("Terputus dari server", "err");
      view.stop();
    })
    .on("world", (w) => say(`masuk dunia ${w.name} (${w.width}x${w.height})`, "ok"));

  const view = new GameView({ canvas: $("screen"), session: g, hotbar: $("hotbar"), cdnBase: `/cdn/${cdn}game/` });
  document.querySelector("main").hidden = true;
  $("game").hidden = false;
  view.resize();
  window.gtView = view; // untuk eksperimen dan uji e2e
  view.start();

  $("join").addEventListener("click", () => {
    try {
      g.joinWorld($("world").value);
    } catch (e) {
      say(e.message, "err");
    }
  });
  $("world").addEventListener("keydown", (e) => e.key === "Enter" && $("join").click());
  $("leave").addEventListener("click", () => g.leaveWorld());

  try {
    const db = await g.start();
    say(`items.dat dimuat: ${db.count} item. Masukkan nama dunia.`, "ok");
  } catch (e) {
    say(`items.dat gagal: ${e.message}`, "err");
  }
}
