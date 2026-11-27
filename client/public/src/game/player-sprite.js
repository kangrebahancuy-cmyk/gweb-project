// Menggambar karakter dari bagian-bagian asli (player_head.rttex, player_eyes.rttex, dan lembar pakaian).
//
// Yang terverifikasi dari berkas aset: lembar kepala 128x64 berisi 4x2 frame 32x32 abu-abu (diwarnai kulit),
// tiap item pakaian punya lembar (item.texture) dan sel (textureX, textureY) 32x32.
// Yang masih tebakan (belum ada klien asli untuk dibandingkan): urutan frame animasi, posisi jangkar frame
// terhadap kotak tabrakan, urutan lapisan, pemilihan mata, dan arti baris kedua lembar kepala.
// Semuanya terkumpul di PLAYER_LAYOUT supaya mudah dikoreksi tanpa mengubah logika.

export const PLAYER_LAYOUT = Object.freeze({
  cell: 32,
  anchorX: -6, // frame digambar mulai dari x + anchorX relatif kotak tabrakan 20x30
  anchorY: -2,
  walkFrames: [0, 1, 2, 3], // kolom pada baris 0 lembar kepala
  idleFrame: 0,
  walkFps: 8,
  eyeCell: [0, 0],
  // urutan gambar dari belakang ke depan; "back" di belakang badan
  order: ["back", "body", "pants", "shirt", "feet", "necklace", "eyes", "face", "hair", "mask", "hand"],
  clothSlot: { back: "back", pants: "pants", shirt: "shirt", feet: "feet", necklace: "necklace", face: "face", hair: "hair", mask: "mask", hand: "hand" },
});

/** Pecah warna kulit mentah 0xBBGGRRAA (contoh bawaan 0x8295c3ff = RGB 195,149,130). */
export function skinRGB(raw) {
  const v = raw >>> 0;
  return { r: (v >> 8) & 255, g: (v >> 16) & 255, b: (v >>> 24) & 255 };
}

export class PlayerSprites {
  /** @param {(name:string)=>ImageBitmap|null} getTexture */
  constructor(getTexture, items) {
    this.tex = getTexture;
    this.items = items;
    this.tinted = new Map();
  }

  _tint(sheet, name, col, row, skin) {
    const key = `${name}:${col},${row}:${skin}`;
    let c = this.tinted.get(key);
    if (c) return c;
    const S = PLAYER_LAYOUT.cell;
    c = document.createElement("canvas");
    c.width = c.height = S;
    const x = c.getContext("2d");
    x.drawImage(sheet, col * S, row * S, S, S, 0, 0, S, S);
    const { r, g, b } = skinRGB(skin);
    x.globalCompositeOperation = "multiply";
    x.fillStyle = `rgb(${r},${g},${b})`;
    x.fillRect(0, 0, S, S);
    x.globalCompositeOperation = "destination-in";
    x.drawImage(sheet, col * S, row * S, S, S, 0, 0, S, S);
    this.tinted.set(key, c);
    return c;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number,facingLeft:boolean,moving:boolean,skin:number,clothes:object|null}} p x,y = pojok kotak tabrakan di layar
   * @param {number} timeMs
   */
  draw(ctx, p, timeMs) {
    const L = PLAYER_LAYOUT;
    const S = L.cell;
    const head = this.tex("player_head.rttex");
    if (!head) return false; // belum dimuat: pemanggil menggambar kotak pengganti
    const frame = p.moving ? L.walkFrames[Math.floor((timeMs / 1000) * L.walkFps) % L.walkFrames.length] : L.idleFrame;
    const ox = Math.round(p.x + L.anchorX);
    const oy = Math.round(p.y + L.anchorY);
    ctx.save();
    if (p.facingLeft) {
      ctx.translate(ox + S, 0);
      ctx.scale(-1, 1);
    } else ctx.translate(ox, 0);
    for (const part of L.order) {
      if (part === "body") ctx.drawImage(this._tint(head, "head", frame, 0, p.skin), 0, oy);
      else if (part === "eyes") {
        const eyes = this.tex("player_eyes.rttex");
        if (eyes) ctx.drawImage(eyes, L.eyeCell[0] * S, L.eyeCell[1] * S, S, S, 0, oy, S, S);
      } else {
        const id = p.clothes?.[L.clothSlot[part]];
        if (!id) continue;
        const it = this.items?.get(id);
        const sheet = it && this.tex(it.texture);
        if (sheet) ctx.drawImage(sheet, it.textureX * S, it.textureY * S, S, S, 0, oy, S, S);
      }
    }
    ctx.restore();
    return true;
  }
}
