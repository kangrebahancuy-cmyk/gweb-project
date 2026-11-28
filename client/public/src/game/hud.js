// HUD dan konsol chat. Ukuran, warna, dan aset mengikuti tata letak asli klien
// (GameData/UI/WorldUI/WorldUI.rcss, RightMenuPanel.rcss, Windows/Console/Console.rcss).
// Yang tidak ada di berkas itu (isi menu, backpack, tombol friend/shop yang bergantung flag server)
// sengaja belum dibuat daripada ditebak.
import { decodeRttex } from "./rttex.js";
import { cleanChat } from "./game-session.js";

const FILTERS = [
  { id: "all", label: "All", color: "rgba(135,184,204,.5)" },
  { id: "world", label: "World", color: "rgba(254,186,70,.5)" },
  { id: "private", label: "Private", color: "rgba(75,255,255,.5)" },
  { id: "system", label: "System", color: "rgba(166,166,166,.5)" },
];
const MAX_LINES = 300;
const SAFE_PATH = /^[\w\-/]+\.rttex$/;

/** Klasifikasi baris OnConsoleMessage: chat dunia/pribadi membawa awalan "CP:...CT:[W]_" atau "[P]". */
export function classifyConsole(raw) {
  const s = String(raw);
  const m = /^CP:_PL:\d+_OID:_CT:\[([A-Z])\]_/.exec(s);
  if (m) return { kind: m[1] === "P" ? "private" : "world", text: cleanChat(s), chat: true };
  return { kind: "system", text: cleanChat(s), chat: false };
}

export class Hud {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root wadah (position:relative) di atas kanvas
   * @param {import('./game-session.js').GameSession} o.session
   * @param {string} o.assetBase mis. "/cdn/growtopia/" (berakhir slash)
   * @param {(text:string)=>void} o.onSay
   * @param {()=>void} o.onLeave
   */
  constructor(o) {
    this.root = o.root;
    this.s = o.session;
    this.base = o.assetBase;
    this.onSay = o.onSay;
    this.onLeave = o.onLeave;
    this.images = new Map();
    this.lines = [];
    this.filter = "all";
    this.unread = 0;
    this.chatOpen = true;
    this._build();
    const s = this.s;
    s.on("gems", (g) => this.setGems(g));
    s.on("players", () => this._renderName());
    s.on("console", (t) => this._onConsole(t));
    // chat masuk lewat OnConsoleMessage (baris konsol); OnTalkBubble hanya untuk bubble di kanvas
  }

  /** Muat .rttex dari CDN menjadi data URL (di-cache). */
  async image(path) {
    if (!SAFE_PATH.test(path)) throw new Error("path aset tidak valid");
    let p = this.images.get(path);
    if (!p) {
      p = fetch(this.base + path)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.arrayBuffer();
        })
        .then((b) => decodeRttex(new Uint8Array(b)))
        .then((d) => {
          const c = document.createElement("canvas");
          c.width = d.width;
          c.height = d.height;
          c.getContext("2d").putImageData(new ImageData(d.rgba, d.width, d.height), 0, 0);
          return c.toDataURL("image/png");
        });
      this.images.set(path, p);
    }
    return p;
  }

  _img(el, path) {
    this.image(path).then((u) => (el.style.backgroundImage = `url(${u})`)).catch(() => {});
  }

  _el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    parent?.append(e);
    return e;
  }

  _build() {
    const r = this.root;
    r.textContent = "";

    // panel kiri atas: 250x75, avatar 65x65, nama 20px tebal, panel gem
    const top = this._el("div", "hud-top", r);
    const avatarBox = this._el("div", "hud-avatar", top);
    this.avatar = this._el("canvas", "", avatarBox);
    this.avatar.width = this.avatar.height = 65;
    const right = this._el("div", "hud-topright", top);
    this.nameEl = this._el("div", "hud-name", right, this.s.name || "");
    const gems = this._el("div", "hud-gems", right);
    const gl = this._el("div", "hud-gem-left", gems);
    this.gemIcon = this._el("div", "hud-gem-icon", gl);
    this._img(this.gemIcon, "interface/cash_icon_overlay.rttex");
    this.gemText = this._el("div", "hud-gem-text", gems, "0");

    // menu kanan: tombol 76x76 berjarak 12
    const menu = this._el("div", "hud-menu", r);
    const menuBtn = this._el("button", "hud-btn", menu);
    menuBtn.type = "button";
    menuBtn.title = "Menu";
    this._img(menuBtn, "interface/large/menu_button.rttex");
    this.chatBtn = this._el("button", "hud-btn", menu);
    this.chatBtn.type = "button";
    this.chatBtn.title = "Chat";
    this._img(this.chatBtn, "interface/large/chat_button.rttex");
    this.badge = this._el("div", "hud-badge", this.chatBtn);
    this.badge.hidden = true;
    this.menuPop = this._el("div", "hud-pop", menu);
    this.menuPop.hidden = true;
    const leave = this._el("button", "hud-popbtn", this.menuPop, "Keluar dunia");
    leave.type = "button";
    leave.addEventListener("click", () => {
      this.menuPop.hidden = true;
      this.onLeave?.();
    });
    menuBtn.addEventListener("click", () => (this.menuPop.hidden = !this.menuPop.hidden));
    this.chatBtn.addEventListener("click", () => this.toggleChat());

    // konsol: input di atas, log di bawah, tab filter di atas keduanya
    this.console = this._el("div", "hud-console", r);
    const tabs = this._el("div", "hud-tabs", this.console);
    this.tabEls = new Map();
    for (const f of FILTERS) {
      const b = this._el("button", "hud-tab", tabs, f.label);
      b.type = "button";
      b.style.background = f.color;
      b.addEventListener("click", () => this.setFilter(f.id));
      this.tabEls.set(f.id, b);
    }
    const form = this._el("form", "hud-input", this.console);
    this.input = this._el("input", "", form);
    this.input.placeholder = "Enter Message Here";
    this.input.maxLength = 120;
    this.input.autocomplete = "off";
    this.input.id = "chatinput";
    this.count = this._el("span", "hud-count", form, "0/120");
    this.input.addEventListener("input", () => (this.count.textContent = `${this.input.value.length}/120`));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.onSay?.(this.input.value);
      this.input.value = "";
      this.count.textContent = "0/120";
    });
    this.log = this._el("div", "hud-log", this.console);
    this.log.id = "chat";
    this.setFilter("all");
    this._renderName();
  }

  setGems(g) {
    this.gemText.textContent = Number(g).toLocaleString("en-US");
  }

  _renderName() {
    const me = this.s.me;
    this.nameEl.textContent = (me?.name || this.s.name || "").replace(/`./g, "");
  }

  toggleChat() {
    this.chatOpen = !this.chatOpen;
    this.console.hidden = !this.chatOpen;
    if (this.chatOpen) {
      this.unread = 0;
      this.badge.hidden = true;
    }
  }

  setFilter(id) {
    this.filter = id;
    for (const [k, b] of this.tabEls) b.classList.toggle("on", k === id);
    this._renderLog();
  }

  _onConsole(raw) {
    const c = classifyConsole(raw);
    this.add(c);
  }

  /** @param {{kind:'world'|'private'|'system', text:string, cls?:string}} line */
  add(line) {
    this.lines.push(line);
    if (this.lines.length > MAX_LINES) this.lines.shift();
    if (!this.chatOpen) {
      this.unread++;
      this.badge.hidden = false;
      this.badge.textContent = String(Math.min(99, this.unread));
    }
    if (this.filter === "all" || this.filter === line.kind) this._append(line);
  }

  /** Baris sistem dari klien sendiri (bukan dari server). */
  note(text, cls) {
    this.add({ kind: "system", text, cls });
  }

  _append(line) {
    const near = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 30;
    const d = document.createElement("div");
    d.className = "hud-line" + (line.cls ? " " + line.cls : "");
    d.textContent = line.text;
    this.log.append(d);
    if (near) this.log.scrollTop = this.log.scrollHeight;
  }

  _renderLog() {
    this.log.textContent = "";
    for (const l of this.lines) if (this.filter === "all" || this.filter === l.kind) this._append(l);
    this.log.scrollTop = this.log.scrollHeight;
  }
}
