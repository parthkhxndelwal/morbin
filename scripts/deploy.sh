#!/usr/bin/env bash
# Deploy the committed HEAD to the production server over SSH.
#
#   scripts/deploy.sh            # direct mode (Caddy on 80/443, TLS on our server)
#   scripts/deploy.sh tunnel     # Cloudflare Tunnel mode (see docker-compose.tunnel.yml)
#
# Only committed code is shipped (git archive), never the local .env. The
# server keeps its own /opt/morbin/.env. Each deploy is unpacked into
# /opt/morbin/releases/<sha>; /opt/morbin/current points at the live one.
# If the new app container does not become healthy, the previous release is
# restarted.
set -euo pipefail

REMOTE="${MORBIN_SSH:-oci2}"
BASE="/opt/morbin"
MODE="${1:-direct}"

case "$MODE" in
  direct) COMPOSE_FILES="-f docker-compose.yml" ;;
  tunnel) COMPOSE_FILES="-f docker-compose.yml -f docker-compose.tunnel.yml" ;;
  *) echo "usage: $0 [direct|tunnel]" >&2; exit 2 ;;
esac

cd "$(git rev-parse --show-toplevel)"
SHA="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "note: uncommitted changes are NOT deployed; shipping commit $SHA" >&2
fi

echo "==> Uploading $SHA to $REMOTE:$BASE/releases/$SHA"
git archive --format=tar HEAD | ssh "$REMOTE" "
  set -e
  test -f '$BASE/.env' || { echo 'missing $BASE/.env — run scripts/server-init.sh first' >&2; exit 1; }
  rm -rf '$BASE/releases/$SHA' && mkdir -p '$BASE/releases/$SHA'
  tar -x -C '$BASE/releases/$SHA'
  ln -sfn '$BASE/.env' '$BASE/releases/$SHA/.env'
"

echo "==> Building and starting ($MODE mode)"
ssh "$REMOTE" "bash -s" <<REMOTE_SCRIPT
set -euo pipefail
cd '$BASE/releases/$SHA'
PREVIOUS="\$(readlink -f '$BASE/current' 2>/dev/null || true)"

# Keep the running image so a failed deploy can fall back to it.
docker image inspect morbin-app:latest >/dev/null 2>&1 && docker tag morbin-app:latest morbin-app:previous || true

docker compose -p morbin $COMPOSE_FILES build
docker tag morbin-app:latest morbin-app:$SHA
docker compose -p morbin $COMPOSE_FILES up -d --remove-orphans

echo "==> Waiting for the app to report healthy"
for i in \$(seq 1 60); do
  status="\$(docker inspect -f '{{.State.Health.Status}}' morbin-app-1 2>/dev/null || echo missing)"
  if [ "\$status" = healthy ]; then
    ln -sfn '$BASE/releases/$SHA' '$BASE/current'
    ls -1dt '$BASE'/releases/* | tail -n +6 | xargs -r rm -rf
    docker image prune -f >/dev/null
    echo "==> Deployed $SHA"
    exit 0
  fi
  sleep 5
done

echo "!! App did not become healthy; recent logs:" >&2
docker compose -p morbin $COMPOSE_FILES logs --tail=80 app >&2 || true
if [ -n "\$PREVIOUS" ] && docker image inspect morbin-app:previous >/dev/null 2>&1; then
  echo "==> Rolling back to \$PREVIOUS" >&2
  docker tag morbin-app:previous morbin-app:latest
  cd "\$PREVIOUS" && docker compose -p morbin $COMPOSE_FILES up -d --no-build --remove-orphans
fi
exit 1
REMOTE_SCRIPT
