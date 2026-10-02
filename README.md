# Morbin

Event ticketing for organisations: public event pages and checkout, organiser dashboard, check-in, payouts and GST invoices. Built with Next.js, MongoDB, Auth.js, Razorpay and Amazon SES, self-hosted on a single server with Docker.

## Local development

```bash
npm ci
cp .env.example .env.local   # then set MONGODB_URI, MORBIN_DB=test_morbin_db, AUTH_SECRET, TICKET_SECRET, …
npm run seed:dev-owner       # owner@ / member@ / admin@morbin.test, password DEV_OWNER_PASSWORD
npm run dev
```

MongoDB must be a replica set (transactions are used), e.g. `mongodb://localhost:27017/?replicaSet=rs0`. See `CLAUDE.md` for the full command list and an architecture overview.

## Deployment

Production runs as Docker Compose (Caddy, the app, MongoDB, encrypted backups). Deploy with `scripts/deploy.sh`; setup, backups and restore are documented in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
