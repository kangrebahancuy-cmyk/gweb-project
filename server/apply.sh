#!/usr/bin/env bash
# Memasang gateway WebSocket ke salinan GrowServer.
#
#   ./server/apply.sh /path/ke/GrowServer [--no-auth-fix]
#
# - menyalin overlay/src/services/ws-gateway.ts
# - menerapkan patches/*.patch (aman dijalankan ulang: patch yang sudah terpasang dilewati)
# - --no-auth-fix melewati 0002 (perbaikan token transfer), lihat docs/SECURITY-NOTES.md
set -euo pipefail

TARGET="${1:-}"
SKIP_AUTH_FIX=0
[[ "${2:-}" == "--no-auth-fix" ]] && SKIP_AUTH_FIX=1

if [[ -z "$TARGET" || ! -f "$TARGET/src/game/index.ts" ]]; then
  echo "pakai: $0 /path/ke/GrowServer [--no-auth-fix]" >&2
  echo "folder itu harus berisi src/game/index.ts" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$(cd "$TARGET" && pwd)"

install -D -m 0644 "$HERE/overlay/src/services/ws-gateway.ts" "$TARGET/src/services/ws-gateway.ts"
echo "ok   src/services/ws-gateway.ts"

for p in "$HERE"/patches/*.patch; do
  name="$(basename "$p")"
  if [[ $SKIP_AUTH_FIX -eq 1 && "$name" == 0002-* ]]; then
    echo "skip $name (--no-auth-fix)"
    continue
  fi
  if git -C "$TARGET" apply --reverse --check "$p" >/dev/null 2>&1; then
    echo "skip $name (sudah terpasang)"
  elif git -C "$TARGET" apply --check "$p" >/dev/null 2>&1; then
    git -C "$TARGET" apply "$p"
    echo "ok   $name"
  else
    echo "GAGAL $name: tidak cocok dengan versi GrowServer ini (kode upstream berubah?)" >&2
    exit 2
  fi
done

cat <<'EOF'

Selesai. Atur lewat environment variable saat menjalankan GrowServer:
  WS_GATEWAY_PORT=17903                   (0 = nonaktif)
  WS_ALLOWED_ORIGINS=https://game.contoh.com
  WS_TRUST_PROXY=1                        (hanya kalau di belakang reverse proxy sendiri)
EOF
