#!/usr/bin/env python3
"""Salin dan konversi aset sementara dari folder APK yang sudah di-unzip.

Pakai:
    python3 -I tools/build_assets.py <folder-apk>/assets

Hasil masuk ke public/assets/gen/ (di-gitignore, hanya untuk pengembangan lokal).
Aset itu milik pemegang hak cipta Growtopia, jadi jangan di-deploy atau di-commit.
Ganti dengan pixel art buatan sendiri lewat public/manifest.json.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from rttex2png import decode  # noqa: E402

# Daftar minimal yang dipakai manifest.json bawaan.
NEEDED = [
    "game/tiles_page1.rttex",
    "game/player_head_skin1.rttex",
]

def main(apk_assets: str):
    src = Path(apk_assets)
    out = Path(__file__).resolve().parent.parent / "public" / "assets" / "gen"
    out.mkdir(parents=True, exist_ok=True)
    for rel in NEEDED:
        f = src / rel
        if not f.exists():
            print("TIDAK ADA:", f)
            continue
        img, _ = decode(f.read_bytes())
        img.save(out / (f.stem + ".png"))
        print("ok", f.stem + ".png", img.size)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
