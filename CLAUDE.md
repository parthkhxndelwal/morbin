# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev              # next dev
npm run build            # next build
npm run lint             # eslint
npm run preview          # opennextjs-cloudflare build + local preview
npm run deploy           # opennextjs-cloudflare build + deploy to Cloudflare Workers
npm run cf-typegen       # regenerate cloudflare-env.d.ts

npm run db:indexes       # create Mongo indexes (never done at import; run post-deploy)
npm run db:migrate       # migrate user roles
npm run admin:bootstrap  # promote/create admin accounts from ADMIN_EMAILS
npm run test:flow        # end-to-end checkout flow script
```

There is no test runner. "Tests" are standalone Node scripts run with `--experimental-strip-types`, which is why the pure-logic modules (`lib/flow-rules.ts`, `lib/admin-bootstrap-plan.ts`, `lib/admin-delete-plan.ts`) are kept free of DB imports so scripts can import them:

```bash
npm run check:bootstrap      # lib/admin-bootstrap.check.mts
npm run check:delete-plan    # lib/admin-delete-plan.check.mts
npm run check:force-delete   # scripts/check-force-delete.mjs
```

Env vars are documented in `.env.example` (copy to `.env.local`).

## Architecture

Event-ticketing platform: Next.js (App Router) + MongoDB + Auth.js + Razorpay + AWS SES, deployed to Cloudflare Workers via `@opennextjs/cloudflare`. Two Workers: `wrangler.jsonc` (prod, `morbin.space`, DB `morbin_db`) and `wrangler.dev.jsonc` (`dev.morbin.space` / `test.morbin.space`, DB `test_morbin_db`). The DB name comes from the `MORBIN_DB` var. Uploaded media is stored on local disk under `MEDIA_DIR` (`lib/media.ts`) and served by `app/media/[...key]`; Cloudflare R2 is no longer used. Self-hosted Docker deployment is replacing Workers — see `docs/REVAMP_PLAN.md` and `docs/DEPLOYMENT.md`.

- **Next.js here is a newer version with breaking changes** (see AGENTS.md): auth gate is `proxy.ts` (not `middleware.ts`); read `node_modules/next/dist/docs/` before using Next APIs.
- **Auth** is split: `lib/auth.config.ts` is edge-safe (no DB, JWT sessions) and used by `proxy.ts`; `lib/auth.ts` adds providers and the Mongo adapter. `proxy.ts` is only a UX redirect for `/dashboard`; real authorization happens in layouts/pages/routes via `lib/guards.ts` (`requireOrgSession`, admin guards).
- **Roles/permissions**: users are `ADMIN` or regular; orgs have `OWNER`/`MEMBER` memberships (`memberships` collection). All capability checks go through `lib/permissions.ts` (`can(role, capability)`). Admin status is the `role` field on the user doc; `ADMIN_EMAILS` only lists who may be promoted. `instrumentation.ts` runs `ensureBootstrapAdmin` at server start with a short deadline and swallows failures (fails closed: no admin).
- **Data layer**: `lib/db.ts` exposes `getDb()` with a shared client on `globalThis`. `_id` is an ObjectId but referenced as strings elsewhere; use `toObjectId`/`safeObjectIds`. Domain modules in `lib/` (`events`, `organizations`, `orders`, `tickets`, `admin`, …) wrap collections; shared types in `lib/types.ts`.
- **Checkout funnel**: durable server-side state in `lib/checkout.ts` (`CheckoutSession`, tokens stored only as hashes, httpOnly resume cookie `morbin_cs`, emailed magic links/OTP with attempt limits and resend cooldown). Per-event configurable flows (`lib/flows.ts` persistence, `lib/flow-rules.ts` pure rules, published vs DRAFT versions, `permissiveFlow` fallback). API under `app/api/checkout/*`; UI is `app/event/[slug]/buy-drawer.tsx` and `app/checkout/verify`.
- **Payments → tickets**: `lib/razorpay.ts` + `app/api/razorpay/webhook`; `lib/fulfillment.ts` builds tickets (idempotent), signs QR payloads (`lib/tickets.ts`), and queues emails flushed by `app/api/cron/flush-emails`. Check-in scanning at `app/dashboard/scan` / `app/api/tickets/verify`.
- **Route areas**: public `app/event/[slug]` (+ `/tickets` lookup), organizer `app/dashboard` (events, appearance/branding, flow, insights, scan), platform admin `app/dashboard/admin`, docs `app/docs`, legal `app/legal`. Per-event branding in `lib/branding.ts`.
- UI uses Tailwind v4 + shadcn (`components.json`, `components/ui`), lucide-react. Path alias `@/`.
- `graphify-out/` is a generated code knowledge graph (`GRAPH_REPORT.md` gives an overview); `.opencode/` and `opencode.json` are OpenCode tooling config.
