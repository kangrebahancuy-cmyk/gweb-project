// Memuat manifest.json dan gambar. Kalau sebuah gambar gagal dimuat, game tetap
// jalan dengan kotak warna pengganti, jadi Anda bisa mulai tanpa aset apa pun.

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn("[aset] gagal memuat", src, "-> pakai pengganti");
      resolve(null);
    };
    img.src = src;
  });
}

export async function loadAssets(manifestUrl = "manifest.json") {
  const manifest = await (await fetch(manifestUrl)).json();
  const images = {};
  await Promise.all(
    Object.entries(manifest.atlases).map(async ([k, src]) => {
      images[k] = await loadImage(src);
    }),
  );
  const playerImg = manifest.player?.image ? await loadImage(manifest.player.image) : null;
  return { manifest, images, playerImg, tintedPlayer: tintPlayer(playerImg, manifest.player) };
}

// Sprite pemain bawaan berwarna abu-abu, jadi diberi warna kulit sekali saja di kanvas luar layar.
function tintPlayer(img, cfg) {
  if (!img || !cfg?.tint) return img;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = "multiply";
  g.fillStyle = cfg.tint;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "destination-in"; // pertahankan transparansi asli
  g.drawImage(img, 0, 0);
  return c;
}

const FALLBACK = ["#888", "#8b5a2b", "#a0784a", "#999", "#777", "#c0522d", "#7a5c8a", "#c0392b", "#222"];

/** Gambar satu tile id ke kanvas pada (dx,dy) dengan ukuran size. */
export function drawTile(ctx, assets, id, dx, dy, size) {
  const def = assets.manifest.tiles[id];
  const ts = assets.manifest.tileSize;
  const img = def && assets.images[def.atlas];
  if (img) {
    ctx.drawImage(img, def.col * ts, def.row * ts, ts, ts, dx, dy, size, size);
  } else {
    ctx.fillStyle = FALLBACK[id % FALLBACK.length];
    ctx.fillRect(dx, dy, size, size);
  }
}
