// Halaman login: POST kredensial ke endpoint login GrowServer, lalu jalankan LoginSession.
//
// Konfigurasi lewat query string (untuk pengembangan lokal):
//   ?ws=ws://localhost:17903     alamat gateway WebSocket (default: host yang sama)
//   ?login=http://localhost:17901 alamat server login HTTP (default: host yang sama)
//   ?port=17091                  port game server awal
// Di produksi, layani semuanya dari satu domain lewat reverse proxy (lihat docs/DEPLOY.md).

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

async function fetchLoginToken(growId, password) {
  const res = await fetch(`${loginBase}/player/growid/login/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ growId, password, data: "" }),
    credentials: "omit",
  });
  let body;
  try {
    body = JSON.parse(await res.text());
  } catch {
    throw new Error("respons login bukan JSON (cek alamat server login)");
  }
  if (body.status !== "success" || typeof body.token !== "string" || !body.token) {
    throw new Error(body.message || "login gagal");
  }
  return body.token; // sudah berbentuk ltoken (base64) yang dipakai paket login
}

let session = null;

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const growId = $("growid").value.trim();
  const password = $("password").value;
  $("go").disabled = true;
  $("log").textContent = "";
  session?.close();
  try {
    status("Memeriksa akun...");
    const ltoken = await fetchLoginToken(growId, password);
    $("password").value = "";
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
        log(`siap (userID ${r.userID}). Langkah berikutnya: parse SEND_MAP_DATA dan render dunia.`, "ok");
        window.gtSession = session; // untuk eksperimen dari console
      })
      .start();
  } catch (err) {
    status("Gagal", "err");
    log(err.message, "err");
    $("go").disabled = false;
  }
});
