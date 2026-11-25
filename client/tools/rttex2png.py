#!/usr/bin/env python3
"""Konversi .rttex (RTPACK/zlib + RTTXTR, RGBA8) ke PNG.
Pakai: python3 -I rttex2png.py <file-atau-folder-masukan> <folder-keluaran>
"""
import struct, sys, zlib
from pathlib import Path
from PIL import Image

def decode(data: bytes):
    if data[:6] == b"RTPACK":
        data = zlib.decompress(data[32:])
    if data[:6] != b"RTTXTR":
        raise ValueError("bukan RTTEX")
    h, w, fmt, oh, ow = struct.unpack("<iiiii", data[8:28])
    if fmt != 5121:
        raise ValueError(f"format {fmt} belum didukung")
    px = data[len(data) - w * h * 4:]
    img = Image.frombytes("RGBA", (w, h), px).transpose(Image.FLIP_TOP_BOTTOM)
    return img, (ow, oh)

def main(src, dst):
    src, dst = Path(src), Path(dst)
    dst.mkdir(parents=True, exist_ok=True)
    files = [src] if src.is_file() else sorted(src.rglob("*.rttex"))
    ok = bad = 0
    for f in files:
        try:
            img, orig = decode(f.read_bytes())
            img.save(dst / (f.stem + ".png"))
            ok += 1
        except Exception as e:
            bad += 1
            print("lewati", f.name, e)
    print(f"selesai: {ok} berhasil, {bad} dilewati")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
