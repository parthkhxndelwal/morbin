# Deploying Morbin on a single server

Everything — application, database, uploaded media, backups and TLS keys —
runs on one host under Docker Compose. Personal data is stored only in the
named volumes on that host.

## Requirements

- Linux host with Docker Engine 24+ and the Compose plugin
- A DNS `A`/`AAAA` record for your domain pointing at the host
- Ports 80 and 443 open (Caddy obtains the TLS certificate automatically)
- Disk encryption on the host volume (LUKS or the provider's encrypted disk) —
  MongoDB Community does not encrypt at rest by itself

## First deploy

```bash
git clone <repo> morbin && cd morbin
cp .env.example .env        # fill every blank value
docker compose up -d --build
docker compose logs -f app  # watch for "[admin-bootstrap]" lines
```

On first start the app creates database indexes, promotes `ADMIN_EMAILS`
accounts to admin, and starts the background jobs (order-hold expiry, email
queue). Sign in, change the bootstrap password, then remove
`ADMIN_BOOTSTRAP_PASSWORD` from `.env` and `docker compose up -d`.

Set the Razorpay webhook URL to `https://<domain>/api/razorpay/webhook`.

## Where data lives

| Volume | Contents |
|---|---|
| `mongo_data` | All application records |
| `media` | Event banners and share images (public) |
| `documents` | Payout statements and breakdowns (private, authorised download only) |
| `caddy_data` | TLS certificates |
| `${BACKUP_DIR}` (bind mount) | Encrypted nightly backups |

Only Caddy publishes ports. MongoDB sits on an `internal` network with no
outbound route.

## Outbound connections (data processors)

The app makes outbound calls only to:

1. **Razorpay** — order creation, payment verification, refunds. Only order
   ids and amounts are sent; card/UPI details are entered on Razorpay's own
   checkout and never reach this server.
2. **Amazon SES** — ticket and verification emails necessarily carry the
   recipient's address. Use `AWS_REGION=ap-south-1` to keep processing in
   India, and an IAM user limited to `ses:SendEmail`.
3. **Google** — only if `AUTH_GOOGLE_ID` is set.

List these in the privacy notice as processors.

## Backups and restore

Backups are written daily to `BACKUP_DIR` as `morbin-<timestamp>.tar.enc`,
encrypted with `BACKUP_PASSPHRASE`. Keep a copy of the passphrase offline.

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE \
  -in backups/morbin-<stamp>.tar.enc | tar -x -C /tmp/restore
docker compose exec -T mongo mongorestore --drop --gzip \
  -u "$MONGO_ROOT_USER" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin \
  --archive < /tmp/restore/db.archive
```

## Updating

```bash
git pull && docker compose up -d --build app
```
