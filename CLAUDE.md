# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev              # next dev (background jobs are off unless MORBIN_SCHEDULER=1)
npm run build            # next build (output: "standalone")
npm run lint             # eslint

npm run seed:dev-owner   # test accounts owner@/member@/admin@morbin.test (test/dev DBs only; reads .env.local)
npm run admin:bootstrap  # promote/create admin accounts from ADMIN_EMAILS (reads .env.local if present)
npm run db:indexes       # create Mongo indexes (also done by the scheduler at boot)
npm run db:migrate       # one-off migration of user roles
```

`db:indexes` and `db:migrate` read `MONGODB_URI` / `MORBIN_DB` from the environment only (e.g. `node --env-file=.env.local …`). In production the server itself bootstraps admins and indexes at start.

There is no test runner. Checks are standalone scripts; pure-logic modules are kept free of DB imports so the scripts can import them:

```bash
npm run test:flow            # scripts/test-flow.ts — booking-rules evaluator (lib/flow-rules.ts)
npm run check:pricing        # lib/pricing.check.mts
npm run check:invoice        # lib/invoice-rules.check.mts (WRITE_SAMPLE=out.pdf writes a sample PDF)
npm run check:bootstrap      # lib/admin-bootstrap.check.mts
npm run check:delete-plan    # lib/admin-delete-plan.check.mts
npm run check:money          # scripts/check-money.mts — integration, needs Mongo + .env.local
npm run check:force-delete   # scripts/check-force-delete.mjs — needs `npm run dev` running
```

Deployment is `scripts/deploy.sh` (ships `git archive HEAD` to the server, builds, health-checks, rolls back); see `docs/DEPLOYMENT.md`. Env vars are documented in `.env.example`; for local work copy the relevant ones to `.env.local` with `MORBIN_DB=test_morbin_db`.

## Architecture

Event-ticketing platform: Next.js 16 (App Router) + MongoDB + Auth.js + Razorpay + Amazon SES. It runs as a **single Node process** in Docker (`Dockerfile`, `docker-compose.yml`) behind Caddy (`deploy/Caddyfile`, TLS via Let's Encrypt, or the optional Cloudflare tunnel in `docker-compose.tunnel.yml`), with MongoDB as a single-node replica set and an encrypted `backup` container. All personal data stays on that one server; SES and Razorpay are the only processors.

- **Next.js here has breaking changes** (see AGENTS.md): the auth gate is `proxy.ts` (not `middleware.ts`); read `node_modules/next/dist/docs/` before using Next APIs.
- **Background jobs**: `lib/scheduler.ts`, started from `instrumentation.ts` in production (or with `MORBIN_SCHEDULER=1`), runs timer jobs in-process (expire stale orders, flush the email queue, ensure indexes). There is no cron endpoint.
- **Storage**: MongoDB via `getDb()` (`lib/db.ts`; new indexes go in `ensureIndexes`). Multi-document writes use `withTransaction` (`lib/tx.ts`). `_id` is an ObjectId but referenced as strings elsewhere; use `toObjectId`/`safeObjectIds`. Public media lives on disk under `MEDIA_DIR` (`lib/media.ts`, served by `app/media/[...key]`); private documents (statements, ticket PDFs) under `DOCUMENTS_DIR` (`lib/documents.ts`, served only through `app/api/documents/[id]` after an access check).
- **Auth**: `lib/auth.config.ts` is edge-safe (JWT sessions) and used by `proxy.ts`, which is only a UX redirect; `lib/auth.ts` adds providers and the Mongo adapter. Platform admin is the `role` field on the user; `instrumentation.ts` runs `ensureBootstrapAdmin` with a short deadline and fails closed.
- **Authorization**: every capability check goes through `can(role, capability)` in `lib/permissions.ts`. Roles are `OWNER`, `MEMBER` and `SUPPORT` (a Morbin admin working on one org's event; `lib/support.ts`, `lib/event-access.ts`). Page guards: `requireOrgSession()` (`lib/guards.ts`), `requireEventAccess()` / `eventApiAccess()` (`lib/event-access.ts`), `requireAdmin()` (`lib/admin.ts`). Action guards: `orgActor(capability)` and `eventEditor(eventId)` (`lib/action-guards.ts`). Server actions re-authorise on every call.
- **Server actions** return `Result<T>` from `lib/result.ts` (`ok()` / `err(message, fieldErrors)`) and never throw to the client. Client components get plain DTOs (ISO strings, string ids), never Mongo documents.
- **Components**: shadcn (base-nova on Base UI) in `components/ui`; generic patterns that consume `Result` in `components/patterns` (`FormDialog`, `ActionForm`, `ConfirmAction`, `PromptAction`, `DataTable`, `Money`, `StatusBadge`); domain components and their actions in `components/features/<area>`. Pages stay thin; business rules live in `lib/` modules marked `import "server-only"`. Tailwind v4, lucide-react, path alias `@/`.
- **Money**: integer paise everywhere; pricing only from `computePricing` (`lib/pricing.ts`), frozen on orders. Organisation balances are derived from the append-only ledger (`lib/ledger.ts`); payouts in `lib/payouts.ts`; GST invoices in `lib/invoices.ts` / `lib/invoice-rules.ts`.
- **Checkout funnel**: durable server-side state in `lib/checkout.ts` (hashed tokens, httpOnly resume cookie `morbin_cs`, magic links/OTP with attempt limits). Per-event booking rules: `lib/flows.ts` (published vs draft versions) and the pure `lib/flow-rules.ts`. API under `app/api/checkout/*`; UI in `app/event/[slug]/buy-drawer.tsx` and `app/checkout/verify`.
- **Payments → tickets**: `lib/razorpay.ts` + `app/api/razorpay/webhook`; `lib/fulfillment.ts` issues tickets idempotently, signs QR payloads (`lib/tickets.ts`), and queues emails that the scheduler flushes (`lib/email.ts`). Check-in at `app/dashboard/scan` / `app/api/tickets/verify`.
- **Audit**: `audit()` and `notify()` in `lib/audit.ts`. Audit meta and logs never contain personal data.
- **Route areas**: public `app/event/[slug]` (+ `/tickets`), `/apply`, organiser `app/dashboard`, platform admin `app/dashboard/admin`, docs `app/docs`, legal `app/legal`.
- `docs/REVAMP_PLAN.md` holds the product plan; `graphify-out/` is a generated code knowledge graph; `.opencode/` and `opencode.json` are OpenCode tooling config.
