#!/usr/bin/env bash
# Back up Yapp's data/ directory: a consistent SQLite snapshot + audio + certs (root CA!).
# Usage: scripts/backup.sh [dest-dir]      (default: ./backups)
# Restore: stop the stack, extract the archive over ./data, start the stack.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
data="${DATA_DIR:-$root/data}"
dest="${1:-$root/backups}"
stamp="$(date +%Y%m%d-%H%M%S)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

mkdir -p "$dest" "$work/data"
if [ -f "$data/yapp.db" ]; then
  if command -v sqlite3 >/dev/null; then
    sqlite3 "$data/yapp.db" ".backup '$work/data/yapp.db'"
  elif command -v python3 >/dev/null; then
    # Online backup API (safe while the app is writing).
    python3 -c 'import sqlite3,sys; s=sqlite3.connect(sys.argv[1]); d=sqlite3.connect(sys.argv[2]); s.backup(d); d.close()' \
      "$data/yapp.db" "$work/data/yapp.db"
  else
    # Use the running container's better-sqlite3.
    docker compose -f "$root/docker-compose.yml" exec -T web \
      node -e "require('better-sqlite3')('/data/yapp.db').backup('/data/.backup.db').then(()=>process.exit(0))"
    mv "$data/.backup.db" "$work/data/yapp.db"
  fi
fi
for d in audio certs; do
  if [ -d "$data/$d" ]; then cp -a "$data/$d" "$work/data/"; fi
done
tar -C "$work" -czf "$dest/yapp-$stamp.tar.gz" data
echo "Backup written to $dest/yapp-$stamp.tar.gz ($(du -h "$dest/yapp-$stamp.tar.gz" | cut -f1))"
# Keep the 14 most recent backups.
ls -1t "$dest"/yapp-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm --
