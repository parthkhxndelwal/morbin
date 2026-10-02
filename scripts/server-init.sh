#!/usr/bin/env bash
# One-time server preparation, run from the dev machine:
#
#   scripts/server-init.sh
#
# Creates /opt/morbin (owned by the SSH user), and an /opt/morbin/.env built
# from .env.example with every internal secret freshly generated ON the
# server. Provider credentials (Razorpay, SES, Google) are left blank for the
# owner to fill in. An existing .env is never overwritten.
set -euo pipefail

REMOTE="${MORBIN_SSH:-oci2}"
BASE="/opt/morbin"

cd "$(git rev-parse --show-toplevel)"

ssh "$REMOTE" "sudo mkdir -p '$BASE/releases' '$BASE/backups' && sudo chown -R \"\$(id -un):\$(id -gn)\" '$BASE'"

if ssh "$REMOTE" "test -f '$BASE/.env'"; then
  echo "$BASE/.env already exists on $REMOTE; leaving it untouched."
  exit 0
fi

# The template carries no secrets; the values below are generated remotely.
tr -d '\r' < .env.example | ssh "$REMOTE" "cat > '$BASE/.env.template'"
ssh "$REMOTE" "bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail
BASE=/opt/morbin
gen() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48; }
umask 077
sed \
  -e "s|^MORBIN_DOMAIN=.*|MORBIN_DOMAIN=morbin.space|" \
  -e "s|^ACME_EMAIL=.*|ACME_EMAIL=|" \
  -e 's|^EMAIL_FROM=.*|EMAIL_FROM="Morbin <no-reply@morbin.space>"|' \
  -e "s|^MONGO_ROOT_PASSWORD=.*|MONGO_ROOT_PASSWORD=$(gen)|" \
  -e "s|^MONGO_APP_PASSWORD=.*|MONGO_APP_PASSWORD=$(gen)|" \
  -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(gen)|" \
  -e "s|^TICKET_SECRET=.*|TICKET_SECRET=$(gen)|" \
  -e "s|^CRON_SECRET=.*|CRON_SECRET=$(gen)|" \
  -e "s|^BACKUP_PASSPHRASE=.*|BACKUP_PASSPHRASE=$(gen)|" \
  -e "s|^BACKUP_DIR=.*|BACKUP_DIR=$BASE/backups|" \
  "$BASE/.env.template" > "$BASE/.env"
rm "$BASE/.env.template"
chmod 600 "$BASE/.env"
echo "Created $BASE/.env (mode 600). Fill in the blank provider values before deploying."
echo "Blank keys:"; grep -E '^[A-Z_]+=$' "$BASE/.env" | cut -d= -f1 | sed 's/^/  /'
REMOTE_SCRIPT
