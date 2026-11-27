// Dekoder .rttex di browser: RTPACK (zlib) + RTTXTR, piksel RGBA8 tersimpan terbalik vertikal.
// Format sama dengan client/tools/rttex2png.py (yang dipakai untuk aset lokal).
import { inflateZlib } from "./items.js";

const MAX_PIXELS = 64 * 1024 * 1024;

/** @returns {Promise<{width:number,height:number,rgba:Uint8ClampedArray}>} */
export async function decodeRttex(bytes) {
  let data = bytes;
  const tag = (b, o, s) => String.fromCharCode(...b.subarray(o, o + s.length)) === s;
  if (tag(data, 0, "RTPACK")) {
    if (data.length < 33) throw new RangeError("RTPACK terpotong");
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const size = v.getUint32(12, true); // panjang hasil dekompresi
    data = await inflateZlib(data.subarray(32), size > 0 ? size : undefined);
  }
  if (!tag(data, 0, "RTTXTR") || data.length < 28) throw new RangeError("bukan RTTEX");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const height = v.getInt32(8, true);
  const width = v.getInt32(12, true);
  const format = v.getInt32(16, true);
  if (format !== 5121) throw new RangeError(`format RTTEX ${format} belum didukung`);
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) throw new RangeError("ukuran tekstur tidak masuk akal");
  const need = width * height * 4;
  if (data.length < need) throw new RangeError("data piksel terpotong");
  const src = data.subarray(data.length - need);
  const rgba = new Uint8ClampedArray(need);
  const stride = width * 4;
  for (let y = 0; y < height; y++) rgba.set(src.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  return { width, height, rgba };
}
