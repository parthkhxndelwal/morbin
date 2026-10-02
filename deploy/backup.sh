#!/bin/bash
# Nightly encrypted backup of the database and uploaded media, kept on this
# server only. Restore: see docs/DEPLOYMENT.md.
set -euo pipefail


backup_once() {
  local stamp dir
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dir="$(mktemp -d)"
  mongodump --quiet --host mongo --username "$MONGO_ROOT_USER" --password "$MONGO_ROOT_PASSWORD" \
    --authenticationDatabase admin --archive="$dir/db.archive" --gzip
  tar -C /data -czf "$dir/media.tgz" media documents
  tar -C "$dir" -cf - db.archive media.tgz \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE \
    > "/backups/morbin-$stamp.tar.enc"
  rm -rf "$dir"
  find /backups -name 'morbin-*.tar.enc' -mtime "+${BACKUP_RETENTION_DAYS}" -delete
  echo "[backup] wrote morbin-$stamp.tar.enc"
}

while true; do
  backup_once || echo "[backup] FAILED at $(date -u)"
  sleep 86400
done
