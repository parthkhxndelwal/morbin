#!/bin/bash
# Generates the replica-set keyfile (required when auth and --replSet are both
# on) and then hands off to the official MongoDB entrypoint.
set -euo pipefail

mkdir -p /etc/mongo
if [ ! -s /etc/mongo/keyfile ]; then
  # Single-member set: the key only has to agree with itself, so a fresh one
  # per container start is fine and never leaves the container.
  head -c 756 /dev/urandom | base64 -w0 > /etc/mongo/keyfile
fi
chmod 400 /etc/mongo/keyfile
chown 999:999 /etc/mongo/keyfile

exec /usr/local/bin/docker-entrypoint.sh "$@"
