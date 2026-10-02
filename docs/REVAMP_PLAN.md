# Morbin revamp plan

Status: **draft, in progress** (rev 4: keep SES + Razorpay, drop R2; admin-driven payouts with statements; component-driven architecture; GST-inclusive convenience fee with configurable bearer. rev 5: booking flow v2, organisation datasets, templated identity, filterable exports. rev 6: admin support mode for booking flows. rev 7: convenience fee always GST-inclusive and never refunded. rev 8: refunds are requested, approved and settled manually, funded from the unpaid balance. rev 9: refunds via Razorpay Refund API with costs charged to the organisation upfront; GST tax invoice as the last page of the ticket PDF; GST details configurable in admin. rev 10: owner Q&A answers applied; deployment target oci2 + morbin.space with optional Cloudflare Tunnel) · Owner: Parth Khandelwal · Started 2026-10-02

Morbin onboards organisations (colleges, event companies, corporates), sells
tickets for them through Razorpay as merchant of record, keeps a platform fee,
and settles the remainder to each organisation. This plan takes the current
codebase (Next 16, MongoDB, Auth.js, Razorpay, Cloudflare Workers + R2 + SES)
to a self-hosted, single-server, DPDP-ready product with one coherent design
language.

---

## 0. What exists today (audit summary)

| Area | State | Problems found |
|---|---|---|
| UI primitives | 5 hand-written "shadcn-like" files in `components/ui` | Not real shadcn; no tailwind-merge; every page styles raw `<div>`s with hard-coded `#060614`, `white/10`, `violet-300` |
| Dashboard shell | Top nav bar in `app/dashboard/layout.tsx` | No sidebar, no org switcher, no breadcrumbs, admin and organiser share chrome |
| Public event page | Plain page + hand-rolled drawer (918 lines) | CTA is a plain button; no glass CTA; drawer has no shadcn parts |
| Money | `PLATFORM_FEE_BPS = 500` hard-coded in **two** routes | No ledger, no settlement, no payout records, no per-org fee, refunds don't touch settlement |
| Orders | Two order-creation routes (`/api/orders` legacy and `/api/checkout/order`) | Duplicate inventory/fee logic; legacy route trusts client buyer details |
| Organiser features | Create event, add ticket type, publish, flow builder, appearance, insights, scan | Can't edit event details, can't edit/disable ticket types, no orders list, no refunds UI, no attendee export, no team page, no payout view |
| Admin features | Org CRUD, members, suspend, force-delete | No platform overview, no fee config, no settlement runs, no audit log, no applications queue |
| Background work | Email flush via cron endpoint, order expiry only opportunistic | FAILED emails never retried; holds can leak if no one calls the legacy route |
| Hosting | Cloudflare Workers (OpenNext) + R2 + SES | Records and media sit on Cloudflare's edge/R2, not on our server — incompatible with the DPDP brief. SES and Razorpay stay as documented processors |
| Data integrity | Sequential writes, no transactions ("standalone-capable") | Crash between seat hold / order insert / ticket insert can leave inconsistent state |

---

## 1. Decisions (resolving ambiguity)

These are the defaults the build follows. Each is reversible; flag any you disagree with.

1. **Component system** — real shadcn/ui via the CLI, style already set in
   `components.json` (`base-nova`, neutral, CSS variables). Every UI element is
   composed from `components/ui/*`. Hand-rolled primitives are deleted.
   Third-party visual effects (GlassSurface) are pulled through the shadcn CLI
   from the React Bits registry so they live in the same tree.
2. **Dashboard shell** — `npx shadcn@latest add sidebar-08` used verbatim
   (inset sidebar, `NavMain` / `NavProjects` / `NavSecondary` / `NavUser`),
   then wired to real data. Admin and organiser share the shell; the nav items
   differ by role.
3. **Theme** (confirmed) — light + dark, system default, toggle in `NavUser` menu. Neutral
   base, one brand accent (violet `oklch` scale) used sparingly: primary
   buttons, focus rings, charts. The public event page keeps the organiser's
   `accentColor`.
4. **Money model** — Morbin is merchant of record.
   - **Who sets what.** The **admin** sets each organisation's platform fee as
     a percentage that is **always inclusive of GST**: GST is carved out of the
     fee, never added on top of it. Example: base price ₹500 and a 7% fee →
     fee ₹35.00 (₹29.66 base + ₹5.34 GST) → the customer pays **₹535.00**,
     never more. The **organisation owner** sets the
     ticket base prices and chooses **who bears the fee**: the customer
     (added on top as a "Convenience fee") or the organisation (deducted from
     its payout). The bearer is an org-level default, overridable per event.
   - **Formula** (all in integer paise, per order):
     ```
     ticketTotal  = Σ unitPrice × qty                      // set by the organiser
     fee          = round(ticketTotal × feeBps / 10000)     // GST-inclusive
     feeGst       = round(fee × gstBps / (10000 + gstBps))  // e.g. 18/118 of fee
     feeBase      = fee − feeGst                            // Morbin's revenue
     if bearer = CUSTOMER:   orderTotal = ticketTotal + fee;  organiserNet = ticketTotal
     if bearer = ORGANISER:  orderTotal = ticketTotal;        organiserNet = ticketTotal − fee
     ```
     Free orders carry no fee. `gstBps` is a platform setting (default 1800)
     and the GST label (IGST vs CGST + SGST) is a platform setting too.
     Invariant checked by `lib/pricing.ts` tests: `orderTotal ≤ ticketTotal ×
     (1 + feeBps / 10000)` and `feeBase + feeGst = fee` exactly, so rounding can
     never push the customer above the advertised price.
   - **Refunds never include the convenience fee.** A refund returns only the
     ticket value (`ticketTotal`, or the refunded tickets' share of it). The
     fee and its GST are retained by Morbin in both modes:
     - *Customer pays fee:* ₹535 paid → ₹500 refunded; the ₹35 fee is kept.
     - *Organisation absorbs fee:* ₹500 paid → ₹500 refunded; the ₹35 fee the
       organisation absorbed is still charged, so the order nets the
       organisation −₹35 on its ledger (shown clearly on the refund
       request dialog before the owner submits).
     The refund request dialog, the refund emails, the buyer's order page and the terms
     shown at checkout all state that convenience fees are non-refundable.
   - **GST tax invoice for the convenience fee.** When the customer pays the
     fee, Morbin supplies them a service and issues a tax invoice. Tickets are
     emailed as a **PDF ticket document**: one page per ticket (QR code,
     attendee, event, seat type), then the **tax invoice as the final page**.
     The same PDF is downloadable from the buyer's tickets page.
     - Generated on the server (no external service), stored immutably in the
       private documents volume, and attached to the SES email (raw MIME).
     - Invoice number: gapless, sequential per financial year from an atomic
       counter, format `<prefix>/<FY>/<seq>` (e.g. `MRB/26-27/000123`, at most
       16 characters as GST rules require).
     - Checkout and the ticket page show one line, "GST @ 18%" (a price
       summary, not an invoice). The **invoice** must split the tax: buyers
       are not asked for their state, so for unregistered buyers with no
       address on record the place of supply is Morbin's own state and the
       invoice shows **CGST 9% + SGST 9%** (CA to confirm).
     - Contents: Morbin's legal name, address, GSTIN and state; invoice number
       and date; customer name and email; place of supply; SAC code; description ("Convenience fee — order #…, event
       …"); taxable value (fee base); CGST + SGST or IGST with rate and
       amount; total; amount in words; "computer-generated invoice" footer.
     - Refunds never touch the invoice (the fee is non-refundable), so no
       credit notes are needed.
     - When the **organisation** absorbs the fee, the customer gets no fee
       invoice; Morbin's fees are invoiced to the organisation on each payout
       statement instead (one invoice per payout, using the org's GSTIN if it
       has one).
     - Invoices are kept for 8 years (GST record-keeping), overriding the
       shorter PII retention for that document only.
   - **Frozen on the order.** `feeBps`, `gstBps`, `bearer`, `fee`, `feeBase`,
     `feeGst`, `orderTotal`, `organiserNet` are written onto the order when it
     is created, so changing an org's fee later never changes a past order or
     its refund. The Razorpay amount is always `orderTotal`, and the webhook
     verifies the captured amount against it.
   - **One calculator.** `lib/pricing.ts` is a pure function (no DB, unit-tested
     by a check script) used by the checkout API to charge, by the drawer to
     display (via the server's offer), and by refunds and payouts. The browser
     never computes a price.
   - Every money movement writes an immutable **ledger entry**; balances are
     always *derived* from the ledger, never stored as a mutable number.
5. **Payouts (admin-driven, no fixed cadence)** — the admin decides when an
   organisation is paid. There is no automatic schedule.
   1. Admin opens an org's **Balance** and sees unsettled ledger entries,
      grouped by event, with gross / platform fee / refunds / net.
   2. Admin clicks **Issue payout**: picks a cut-off date (or specific events),
      reviews the computed net amount, and creates a payout in `DRAFT`. The
      included ledger entries are locked to it in a transaction, so no entry
      can ever be paid twice.
   3. Admin makes the bank transfer outside Morbin, then marks the payout
      `PAID` with the UTR/bank reference and transfer date, and **attaches the
      settlement statement** (PDF, required before `PAID`). Morbin also
      generates a system breakdown (CSV of every included order) next to it.
   4. The organisation owner sees the payout on **Payouts**, downloads the
      statement, and either **Acknowledges** it or **Raises a query** with a
      note. A query notifies the admin (SES email + dashboard badge) and keeps
      the payout `DISPUTED` until the admin resolves it (reply, corrected
      statement, or an `ADJUSTMENT` ledger entry carried into the next payout).
   States: `DRAFT → PAID → ACKNOWLEDGED`, with `PAID → DISPUTED → RESOLVED`
   and `DRAFT → CANCELLED` (releases its ledger entries).
   Completed refunds (ticket value only, never the fee) are deducted from the
   next payout; open refund holds are excluded from what can be paid out.
   Statements are private documents: stored on local disk outside the public
   media path, served only to the org's owner and admins through an
   authorised route.
5a. **Refunds (requested by the organisation, approved by Morbin, paid
   through Razorpay's Refund API)**
   Each refund is a **refund case**, per ticket (an order's tickets can be
   refunded individually), for the ticket's price only, never the convenience
   fee. The money goes back to the customer's **original payment method**
   through Razorpay, so no bank details are ever collected.

   **What a refund costs** (Razorpay docs and pricing page, checked
   2026-10-02; re-check against Morbin's own Razorpay contract):
   | Cost | Amount | Notes |
   |---|---|---|
   | Normal refund (5–7 working days) | ₹0 | Razorpay charges no processing fee |
   | Gateway fee on the original payment | Not returned | Razorpay keeps the transaction fee **and its GST** charged at capture (standard plan: 2% + 18% GST = 2.36% of the amount paid) |
   | Instant refund (optional, minutes) | ₹7.99 up to ₹1,000 · ₹11.99 up to ₹25,000 · ₹14.99 above | Per refund, plus GST as billed by Razorpay; credited back if the instant refund fails and falls back to normal speed |

   **The organisation bears these costs, upfront, in every case:**
   - `refundCost = gatewayFeeShare + instantFee`. `gatewayFeeShare` is
     charged **only when the organisation absorbed the convenience fee** on
     that order (when the customer paid it, Morbin's fee already covered the
     gateway cost, so it is not charged again). It is the refunded tickets'
     pro-rata share of the **actual** fee + tax Razorpay charged on that
     payment. That figure is read from the payment
     (`fee`, `tax`) at capture and stored on the order, not estimated.
     `instantFee` applies only if instant speed is chosen (organisation's
     choice when requesting; default normal).
   - "Upfront" means the cost is deducted from the organisation's unpaid
     balance when the request is submitted (as part of the hold), and is
     **not returned** if the customer later disputes it. It is returned only if
     Morbin rejects the request or the owner withdraws it before approval.
   - The request dialog shows the full breakdown before submitting. Example,
     organisation absorbed the fee (customer paid ₹500): "Refund to customer
     ₹500.00 · Razorpay fee not returned ₹11.80 · Instant refund fee ₹7.99 +
     ₹1.44 GST · **Deducted from your balance ₹521.23**". If the customer had
     paid the fee (₹535), the same refund at normal speed deducts exactly
     ₹500.00.

   **Steps**
   1. **Request.** Only the **owner** can request refunds. They select tickets on Event › Orders → **Request
      refund**, gives a reason, and chooses normal or instant speed (or *We'll
      settle it ourselves*, step 5).
   2. **Funding check.** The organisation's unpaid balance (earned, not yet in
      a payout, minus other open holds) must be at least *refund amount +
      refund cost*. If it is, that total is **held** immediately and can't be
      paid out. If not, the button is disabled with the shortfall shown and a
      link to contact support.
   3. **Approval.** A Morbin admin approves or rejects every request, with a
      note. Rejection releases the hold; tickets stay valid.
   4. **Refund through Razorpay.** On approval the server calls Razorpay's
      Refund API for the exact ticket amount with the chosen speed, using an
      idempotency key (the refund case item id) so a retry can never refund
      twice. Tickets are voided and seats returned to sale in the same
      transaction that records the call. The case moves to `PROCESSING`;
      Razorpay's `refund.processed` webhook moves it to `COMPLETED` and stores
      the ARN/RRN, and `refund.failed` moves it to `FAILED` for the admin.
      The customer gets an SES email with the amount, the ARN to track it
      with their bank, the expected time, and the note that convenience fees
      are non-refundable. The hold becomes `REFUND` + `REFUND_COST` ledger
      entries deducted from the next payout.
      Before calling, the server checks Morbin's Razorpay account balance can
      cover the refund; if not, the case waits in `APPROVED` with an alert to
      the admin rather than failing.
   5. **Settlement by the organisation** (unchanged from rev 8). The owner may
      choose to refund the customer themselves; the admin must approve **per
      ticket**. No Razorpay call is made, so there is no refund cost and no
      balance hold. Once approved, the tickets are voided and the
      organisation marks each ticket **Settled by organisation** with its own
      reference and optional proof.
   6. **When Razorpay can't refund** (e.g. the payment is older than
      Razorpay's refund window, or the refund fails permanently): the admin
      sees the failure reason and resolves it manually. They contact the
      customer by email from the case, pay by bank transfer outside Morbin,
      then mark the case **Completed manually** with the transfer reference.
      The hold is applied the same way. This is the only path where the admin
      collects payment details, and only in the email thread, not stored in
      Morbin.
   States: `REQUESTED → APPROVED → PROCESSING → COMPLETED`, with
   `PROCESSING → FAILED → COMPLETED_MANUALLY`, `REQUESTED → APPROVED →
   COMPLETED_BY_ORG` (self-settled), `REJECTED`, and `CANCELLED` (withdrawn
   before approval; releases the hold).
   Checked-in tickets can be requested but show a warning to the admin.
   **Event cancellation:** cancelling a published event with sold tickets
   stops sales, emails every buyer immediately, and automatically opens one
   refund request per order (normal speed, Morbin settles) for the admin to
   approve. The funding check still applies; if the balance can't cover
   them all, the cancellation dialog shows the shortfall before confirming
   and the uncovered requests wait for the admin.
6. **DPDP "data never leaves the server"** — interpreted as: *all personal data
   is stored and processed only on this server.* Exceptions that are
   unavoidable and will be documented as data processors in the privacy notice:
   - **Razorpay** (payment processing — card/UPI data never touches our server;
     we send only amount + order id + minimal notes, no buyer PII).
   - **Amazon SES** (transactional email — kept, by owner decision). Only the
     recipient address and the message itself are sent; templates carry no
     data beyond what the email needs. Use an AWS region in India
     (`ap-south-1`) so mail processing stays in-country.
   - **Google sign-in** becomes opt-in (off unless `AUTH_GOOGLE_*` is set).
   Removed: Cloudflare R2 (media moves to local disk), Cloudflare Workers /
   OpenNext / Wrangler, any remote fonts at runtime (next/font already
   self-hosts), any analytics.
   Kept (owner decision): **Razorpay** for payments, **Amazon SES** for email.
7. **Database** — MongoDB 7 in Docker as a **single-node replica set** so
   multi-document transactions are available. Order creation, payment capture,
   refund and payouts become transactional.
8. **Media** — uploaded images stored on a Docker volume (`/data/media`),
   served by an authenticated-free but unguessable path through a Next route
   with strict content-type and `X-Content-Type-Options: nosniff`.
9. **Background jobs** — an in-process scheduler started from
   `instrumentation.ts` (single server, single instance): expire stale holds
   every minute, flush email every 30 s with exponential backoff, purge expired
   checkout sessions, apply retention policy nightly.

---

## 2. Design language

- **Type**: Geist Sans / Geist Mono (already self-hosted). Scale: `text-2xl`
  page titles, `text-base` section titles, `text-sm` body, `text-xs` meta.
- **Layout**: sidebar-08 inset shell; page = `PageHeader` (title, description,
  actions) + content in `Card`s. Max content width `max-w-6xl`. 16px gutters
  on mobile.
- **Data display**: `Table` for lists (with empty states, skeletons, pagination),
  `Badge` for statuses (one mapping, `components/status-badge.tsx`, so
  "PUBLISHED" is styled the same everywhere), `Card` + KPI for numbers,
  shadcn `Chart` (Recharts) for time series.
- **Forms**: shadcn `Form`-style composition with `Field`, `Input`, `Select`,
  `Textarea`, `Switch`; zod schemas shared between client and server
  (`lib/validations.ts`). Errors inline under each field + `Sonner` toast for
  the outcome.
- **Feedback**: every mutation shows a pending state, a toast on success, and
  an inline error on failure. Destructive actions use `AlertDialog`.
- **Copy**: one vocabulary — *Organisation*, *Event*, *Ticket type*, *Order*,
  *Attendee*, *Check-in*, *Payout*. Money always `₹1,234.00` via one
  `formatINR()`; dates via one `formatDateTime(tz)` in the event's timezone.
- **Accessibility**: focus rings from `--ring`, all icons with labels, colour
  never the only status signal, keyboard-operable scanner page.

---

## 2a. Component-driven architecture

Yes, this is the right approach for this codebase, with one boundary: **UI
edge cases live in components; business rules stay on the server.** A
component renders "sold out" or "this order can't be refunded" consistently,
but the rule that decides it is enforced in `lib/` and the API, and the
component is fed that decision. Otherwise the same rule gets written twice
and drifts (the checkout drawer already follows this pattern).

Layers, each importing only from the layer below:

| Layer | Location | Owns |
|---|---|---|
| Primitives | `components/ui/*` | shadcn components, changed only via the CLI |
| Patterns | `components/patterns/*` | Reusable compositions with **every state built in**: `DataTable` (loading skeleton, empty, error, no results for filter, pagination), `PageHeader`, `StatCard`, `StatusBadge`, `Money`, `DateTime`, `ConfirmAction` (AlertDialog + pending + error), `FormDialog`, `FileUpload` (type/size limits, progress, failure), `EmptyState`, `ErrorState`, `PermissionGate`, `CopyButton`, `QrCode` |
| Features | `components/features/<domain>/*` | Domain components: `EventStatusActions`, `TicketTypeTable`, `OrdersTable`, `RefundButton`, `AttendeesTable`, `PayoutCard`, `StatementViewer`, `MemberTable`, `CheckinScanner`, `BookNowButton`… Each takes a view-model plus capability flags and handles its own edge cases (sold out, sale not started, suspended org, payout disputed, member vs owner) |
| Pages | `app/**/page.tsx` | Thin: authorise, load data, map to view-models, place feature components. No inline styling decisions, no conditional UI rules |

Conventions:
- **One source per status**: every enum (event, order, ticket, payout, org)
  has one `statusMeta` map (label, badge variant, description) used by
  `StatusBadge` everywhere.
- **Capabilities, not roles, as props**: pages pass `can={{ refund, manage }}`
  computed by `lib/permissions.ts`; components never read the session.
- **Server actions per feature** live beside the feature
  (`components/features/orders/actions.ts`), each re-checking authorisation
  and returning a typed `Result<T>` that `ConfirmAction` / `FormDialog` render
  uniformly (success toast, field errors, or a general error).
- **Every async boundary** gets `loading.tsx` + `error.tsx` + `not-found.tsx`
  built from the shared `Skeleton` / `ErrorState` / `EmptyState` patterns.

---

## 3. Information architecture

### Organiser (`/dashboard`)
- **Overview** — KPIs (gross, net, tickets, check-in rate), sales chart (30 d),
  upcoming events, recent orders.
- **Events** — table with status filter; **New event** dialog.
  - Event › **Overview** (KPIs, public link + QR download, publish/cancel)
  - Event › **Details** (edit title, description, venue, dates, slug)
  - Event › **Tickets** (ticket types: create / edit / pause / capacity)
  - Event › **Booking flow** (existing builder, reskinned)
  - Event › **Appearance** (existing editor, reskinned)
  - Event › **Orders** (search, filter, request refund, CSV export)
  - Event › **Attendees** (search, check-in status, CSV export)
  - Event › **Insights** (audiences, UTM sources)
- **Check-in** — full-screen scanner (camera + manual), event selector.
- **Orders** — all orders across events, with filters, saved views and export.
- **Refunds** — all refund cases with status, speed, amount, refund cost,
  held balance, Razorpay ARN and the case thread; actions: withdraw a pending
  request, mark an approved self-settled ticket as *Settled by organisation*.
- **Datasets** — organisation-wide lists (e.g. student rolls) used to validate
  booking answers: import CSV, edit rows, export (see §3a).
- **Payouts** — unsettled balance (gross, fees, refunds, net), payout history
  with status, statement download, **Acknowledge** / **Raise a query**, and
  payout bank details (encrypted at rest). Owner-only; members don't see it.
- **Team** — members list (owner can invite / remove staff).
- **Settings** — organisation profile, and **Fees**: shows the admin-set fee
  percentage (read-only) and lets the owner choose *Customer pays convenience
  fee* or *Organisation absorbs fee*, with a live example ("₹500 ticket at
  7% → buyer pays ₹535.00, you receive ₹500.00" vs "buyer pays ₹500.00, you
  receive ₹465.00"). Event › Details can override it
  for that event.

### Admin (`/dashboard/admin`)
- **Overview** — platform GMV, platform fee earned, outstanding liabilities,
  orgs by status.
- **Organisations** — table; org detail with tabs: Profile, Members, Fees
  (fee % inclusive of GST, effective from now; history of past rates),
  Events, Datasets, Balance & ledger, Payouts. From **Events**, the admin can
  open any event's **Booking flow** in support mode (see §3a "Admin support").
- **Payouts** — all payouts across orgs; **Issue payout** (choose org, cut-off
  or events, review amount), **Mark paid** (UTR, date, statement upload),
  queries inbox, resolve.
- **Refunds** — queue of refund cases across organisations: approve / reject
  (approval triggers the Razorpay refund), watch processing status and ARN,
  handle failures (email the customer from the case, mark **Completed
  manually** with a reference), and approve self-settlement per ticket.
  Shows Morbin's Razorpay balance so a refund isn't approved into a shortfall.
- **Settings → GST & invoicing** — legal name, trade name, GSTIN, PAN,
  registered address, state and state code, SAC code, GST rate, how tax is
  split on invoices (default CGST + SGST with Morbin's state as place of
  supply; IGST available if your CA advises it),
  invoice prefix and next number (read-only once used), signature/footer
  text, and a **preview invoice** button. Changes are audit-logged and apply
  only to invoices issued afterwards.
- **Applications** — organisations apply through a public **"List your
  event"** form (organisation name, type, contact, expected events, GSTIN if
  any). The admin reviews, asks for more information, rejects, or **approves**,
  which creates the organisation and its owner account (owner gets a set-password
  email via SES). This replaces the early-access list.
- **Audit log** — every admin and money action.
- **Data requests** — DPDP access / erasure requests.

### Public
- `/` landing, `/event/[slug]` with GlassSurface **Book now** CTA opening the
  checkout drawer (shadcn `Drawer`/`Sheet`). The drawer's summary step uses a
  `PriceBreakdown` component modelled on the reference screenshot:
  ```
  Ticket(s) price                     ₹500.00
  Convenience fees ⌃                   ₹35.00   ← only when the customer bears it
    Base amount                        ₹29.66
    GST @ 18%                           ₹5.34
  ─────────────────────────────────────────────
  Order total                         ₹535.00
  ```
  Below the total: "Convenience fees are non-refundable." The fee row is
  collapsible; when the organisation absorbs the fee the row
  is not shown and the total equals the ticket price. Every figure comes from
  the server's offer. `/event/[slug]/tickets`,
  `/my-tickets`, `/legal/*`, `/docs/*`, `/privacy/request` (DPDP rights form).

---

## 3a. Booking flow v2, datasets and exports

### Problems with today's flow
- Questions live in **Booking flow**, but the fields buyers fill in live in
  **Appearance**. An organiser configures one journey in two places.
- Branching exists only through choice options, and identity is limited to
  "email must end in @domain" or Google. Nothing can check that a roll number
  is real, or derive the email to verify from it.
- The builder is a list editor with no live preview and no checks before
  publishing, so a broken flow is discovered by buyers.

### Concepts the organiser sees
The builder is organised around words an organiser already uses:

1. **Audiences.** *Who* can book: e.g. "KRMU student" and "Outsider". Each
   audience has:
   - **How they prove who they are** (identity): *No check* · *Email link* ·
     *Google* · *Email from template* (see below) · *Email must be on a
     domain*.
   - **What they may buy**: allowed ticket types, max per person, total seats
     reserved for this audience, and whether quantity is fixed at 1.
   - **What we ask them**: which questions apply to this audience.
   A first question ("Are you a KRMU student?") picks the audience. Events
   with a single audience skip it automatically.
2. **Questions.** Everything the buyer types or picks. Types: short text,
   long text, number, email, phone, date, dropdown, multi-select, checkbox /
   consent, **lookup from a dataset**, and "info" text. Each has a label, help
   text, required flag, validation (length, pattern presets such as "digits
   only"), and **when it's shown** ("Only for: KRMU student", or "Show when
   *Year* is *Final*"). Questions can be asked **once per order** or **once per
   ticket** (attendee details for each seat).
3. **Tickets step.** Generated from the audience's rules; organisers don't
   build it by hand.
4. **Review & pay.** The `PriceBreakdown` summary, terms consent, and payment.

Under the hood this compiles to the existing versioned flow document and the
pure evaluator in `lib/flow-rules.ts` (extended with conditions, lookups and
templates). The server still decides every rule; the drawer only renders it.
Custom fields move out of Appearance into the flow, and existing events are
migrated automatically (`scripts/migrate-flow-v2.ts`).

### Builder UX
- **Three panes.** On the left, an outline (Audiences → Questions → Tickets →
  Review) with drag-to-reorder. In the middle, an editor for the selected
  item. On the right, a **live phone preview** that renders the real drawer
  components with a "Preview as: KRMU student / Outsider" switch.
- **Start from a template:** *Open to everyone* · *Students verified by roll
  number + paid outsiders* · *Invite list only (dataset)* · *Company employees
  (email domain)*. Every template is a fully editable starting point.
- **Plain-language conditions:** "Show this question when [question] is
  [answer]", picked from dropdowns. No expressions to type.
- **Checks before publishing** (a panel listing problems; errors block
  publishing, warnings don't): an audience with no ticket types; a question
  that can never be shown; a template using a variable that doesn't exist; a
  lookup pointing at an empty or deleted dataset; audience seats exceeding
  ticket capacity; a required question hidden from an audience that needs it.
- **Test run:** walk the flow as a chosen audience, including a simulated
  email check and lookup, without creating an order or sending email.
- **Versions:** Save draft / Publish (as today; buyers mid-checkout keep their
  version). Plus a "what changed" summary before publishing and **restore a
  previous version**. Each version records who saved/published it and in what
  capacity (owner or Morbin support).

### Admin support for an organisation's events
Platform admins can configure the booking flow of any event, as support for
the organisation:

- **Where:** Admin → Organisations → *org* → Events → *event* → **Booking
  flow** (`/dashboard/admin/orgs/[orgId]/events/[eventId]/flow`). It renders
  the **same `FlowBuilder` feature component** the owner uses, with an
  `actor: "SUPPORT"` prop, so there is one builder to maintain.
- **What they can do:** everything the owner can in the builder (edit
  audiences and questions, save drafts, test run, publish, restore versions),
  and also, in support mode, the event's **details**, **ticket types and
  prices**, **appearance**, and **publish / cancel**. Each of these screens
  is the same feature component the owner uses, behind the same
  `requireEventEditor` guard, with the support banner, audit log entries and
  owner notifications. Cancelling as support triggers the same bulk refund
  requests as an owner cancellation. To wire lookups they can see the organisation's datasets, and
  import or edit dataset rows on the org's behalf (e.g. loading a student list
  the org emailed in).
- **Visible to everyone involved:**
  - The admin sees a persistent banner: "Editing as Morbin support for
    *Org name*. Changes are visible to the organisation."
  - Version history shows "Published by Morbin support (admin name)".
  - The owner gets an email and a dashboard notification on each support
    publish, with the "what changed" summary.
  - Every support action is written to the audit log with the admin as actor
    and the organisation as target.
- **Not impersonation:** the admin never signs in as the owner and never
  borrows their session. Access comes from the admin's own role, through one
  guard, `requireEventEditor(eventId)`, that admits the event org's OWNER or a
  platform ADMIN and returns which one it was. The builder API routes use only
  this guard.
- **Optional safety switch** (org setting, default off): *Support changes need
  my approval*. When it's on, a support publish becomes a **proposed version**
  that the owner reviews (diff + preview) and publishes or rejects.

### Organisation datasets
Reusable lists owned by the organisation (not by one event), such as "KRMU
students 2026–27" or "Staff list". Kept under **Dashboard → Datasets**.

- **Create:** name, description, and columns. One column is the **key** (e.g.
  `roll_number`), and each column has a type (text, number, email, date) and a
  normalisation rule (trim, ignore case, digits only).
- **Import CSV** (XLSX in a later pass): upload, map file columns to dataset
  columns, then preview with row-level problems flagged (missing key,
  duplicate key, bad email, wrong type) before anything is written. Import
  modes: **add and update by key** (default), **replace everything**, or **add
  only**. Every import is recorded (who, when, rows added / updated /
  removed / rejected) and its error rows can be downloaded.
- **Edit in place:** a searchable, filterable table with add, edit,
  deactivate and delete for individual rows. Deactivating keeps history (a
  roll number that already bought a ticket stays traceable) but stops it
  matching.
- **Export** the dataset as CSV at any time.
- **Privacy:** rows never go to the browser during checkout. A lookup is a
  server call that answers "found / not found / already used" and returns only
  the columns the organiser marked as *shown to the buyer*, masked by default
  (e.g. `A**** S****`) so the endpoint can't be used to harvest names.
  Lookups are rate-limited per checkout session and per IP.

**Lookup question settings** (e.g. "Roll number"):
- Dataset and key column; normalisation is inherited from the column.
- **Must exist in the dataset** (on by default) and/or **one booking per
  value per event** (enforced by a unique database index on tickets, not just
  a check, so two simultaneous buyers can't both use 23013).
- **Fill in from the matched row:** other columns can prefill or lock later
  answers (name, programme) or feed the email template.
- Custom messages for *not found* and *already used*.

### Email from a template (verified identity)
For an audience, the organiser can set identity to **"Email from template"**:

```
{{roll_number}}@krmu.edu.in
```

- Variables are any earlier answer (`{{roll_number}}`), any column of the
  matched dataset row (`{{row.email}}`, `{{row.programme}}`), and a few
  modifiers: `|lower`, `|upper`, `|trim`, `|digits`.
- The builder autocompletes variable names and shows a live example
  ("23013 → 23013@krmu.edu.in"), flagging unknown variables.
- At checkout the buyer sees the address being verified but **cannot edit
  it**. The server renders the template from stored answers, checks it's a
  valid email, and sends the magic link there. Tickets are issued to that
  verified address, so "one booking per roll number" and "one per email"
  both hold.
- Option: verify against the dataset's own email column instead of a
  template (`{{row.email}}`), for lists where emails aren't predictable.

### Exports and filters (organisation side)
Every list in the dashboard (orders, attendees, check-ins, payouts, dataset
rows) uses the same `DataTable` pattern with:
- **Filters:** status, event, ticket type, audience, date ranges (ordered,
  checked in), payment status, identity method, UTM source/campaign, and
  **any flow answer** (e.g. Programme = B.Tech).
- **Search**, **sorting**, **column chooser**, and **saved views** ("Unchecked-in
  students").
- **Export current view** as CSV with exactly the visible filters and columns,
  including flow answers as columns. Generated and streamed on the server,
  scoped to the organisation.
- Exports are owner-only by default (an `export` capability that the owner can
  grant to staff), and every export is written to the audit log with its
  filters and row count (DPDP accountability).

---

## 4. Data model changes

New collections (all with indexes in `ensureIndexes`):

- `ledgerEntries` — `{ organizationId, eventId, orderId, type: SALE | PLATFORM_FEE | REFUND_HOLD | REFUND_HOLD_RELEASE | REFUND (ticket value only) | REFUND_COST | ADJUSTMENT | PAYOUT, amountPaise (signed, org-perspective), payoutId|null, createdAt, createdBy }`. Unique `{ orderId, type }` for SALE/FEE/REFUND to make writes idempotent.
- `payouts` — `{ organizationId, status: DRAFT|PAID|ACKNOWLEDGED|DISPUTED|RESOLVED|CANCELLED, cutoffAt, eventIds?, grossPaise, feePaise, refundPaise, adjustmentPaise, netPaise, entryCount, bankReference, transferredAt, statementDocId, breakdownDocId, createdBy, paidBy, acknowledgedBy, acknowledgedAt, createdAt }`.
- `payoutQueries` — `{ payoutId, organizationId, authorId, authorRole, message, createdAt }` (thread between owner and admin).
- `documents` — `{ organizationId, kind: PAYOUT_STATEMENT|PAYOUT_BREAKDOWN, storageKey, fileName, contentType, bytes, sha256, uploadedBy, createdAt }`. Files live under `DOCUMENTS_DIR` (a separate private volume); statements are PDF only, magic-byte checked, and served through an authorised route with `Content-Disposition: attachment`.
- `payoutAccounts` — `{ organizationId, accountName, ifsc, accountNumberEnc, last4, verifiedAt }` (AES-256-GCM, key from `DATA_ENCRYPTION_KEY`).
- `auditLogs` — `{ actorId, actorRole, action, targetType, targetId, organizationId, meta, ip, at }`.
- `dataRequests` — DPDP access/erasure/correction requests and their resolution.
- `applications` — organiser sign-up requests.
- `datasets` — `{ organizationId, name, description, columns: [{ key, label, type, normalise, isKey, shownToBuyer, mask }], rowCount, status: ACTIVE|ARCHIVED, createdBy, createdAt, updatedAt }`.
- `datasetRows` — `{ datasetId, organizationId, keyNorm, values: {…}, active, createdAt, updatedAt, updatedBy }`. Unique `{ datasetId, keyNorm }`.
- `datasetImports` — `{ datasetId, mode: UPSERT|REPLACE|INSERT_ONLY, fileName, added, updated, removed, rejected, errorDocId, importedBy, createdAt }`.
- `refundCases` — `{ organizationId, eventId, orderId, items: [{ ticketId, amountPaise, status }], amountPaise, speed: NORMAL|INSTANT, costPaise: { gatewayFeeShare, instantFee, instantFeeGst }, holdPaise, settledBy: MORBIN|ORGANISATION, status, reason, requestedBy, decidedBy, decisionNote, razorpayRefundIds, arn, failureReason, manualReference, completedBy, completedAt, createdAt }`.
- `refundMessages` — `{ refundCaseId, direction: OUTBOUND|NOTE, authorId, subject, body, sesMessageId, createdAt }` (used for customer emails and admin notes, mainly on the manual fallback path).
- `invoices` — `{ number, financialYear, kind: CUSTOMER_FEE|ORG_FEE, orderId|payoutId, organizationId, recipient: { name, email, gstin?, state? }, placeOfSupply, sac, taxablePaise, cgstPaise, sgstPaise, igstPaise, totalPaise, supplierSnapshot, documentId, issuedAt }`. Unique `{ number }`. The supplier's GST details are copied in (`supplierSnapshot`) so later settings changes never alter an issued invoice.
- `counters` — `{ _id: "invoice:26-27", seq }`, incremented atomically with `findOneAndUpdate` inside the invoice transaction (gapless numbering).
- `savedViews` — `{ organizationId, userId, table, name, filters, columns, sort }`.
- `exportsLog` — `{ organizationId, userId, table, filters, rowCount, createdAt }` (also mirrored to `auditLogs`).

Changed:
- `organizations` + `feeBps` (admin-set, GST-inclusive), `feeBearer: CUSTOMER | ORGANISER` (owner-set), `contactEmail`, `contactPhone`, `gstin?`, `address?`.
- `events` + `feeBearer?` (per-event override; null = org default).
- `platformSettings` (single doc, edited in Admin → Settings → GST & invoicing) — `{ gst: { legalName, tradeName, gstin, pan, address, state, stateCode, sac, rateBps: 1800, splitRule: SUPPLIER_STATE (default: CGST + SGST) | ALWAYS_IGST, invoicePrefix, footerText }, updatedBy, updatedAt }`.
- `feeRateHistory` — `{ organizationId, feeBps, changedBy, effectiveFrom }` so the admin can see what rate applied when.
- `ticketTypes` + `status: ACTIVE | PAUSED | HIDDEN`, `sortOrder`.
- `checkoutFlows` → v2 shape: `{ audiences: [...], questions: [...], audienceQuestionId, version, status }`; each question may carry `showWhen`, `lookup: { datasetId, unique, fill }`, `scope: ORDER|TICKET`; each audience carries `identity: { method, emailDomain?, emailTemplate? }`. `eventBranding.customFields` is migrated into questions and removed.
- `tickets` + `lookupKey` (normalised dataset key) with a partial unique index `{ eventId, lookupKey }` where the question demands one booking per value.
- `checkoutSessions` + `lookups: { questionId: { keyNorm, rowId } }` so the server, not the browser, remembers what matched.
- `checkoutFlows` + `savedBy`, `publishedBy: { userId, capacity: OWNER|SUPPORT }`, and status `PROPOSED` for support versions awaiting owner approval.
- `organizations` + `requireApprovalForSupportChanges: boolean` (default false), `retentionMonths` (admin-set, default 24).
- `notifications` — `{ organizationId, userId?, kind, title, body, link, readAt, createdAt }` for in-dashboard alerts (support publishes, payout queries, payouts marked paid).
- `orders` + `gateway: { feePaise, taxPaise, method }` read from the Razorpay payment at capture (used for exact refund costs), + `invoiceId`.
- `orders` + a frozen `pricing` block: `{ ticketTotalPaise, feeBps, gstBps, feeBearer, feePaise, feeBasePaise, feeGstPaise, orderTotalPaise, organiserNetPaise }`, plus `refundedAt`, `refundedBy`, `refundReason`. The old `platformFeePaise` / `organizerAmountPaise` / `totalPaise` fields are migrated into it.
- `emailDeliveries` + `nextAttemptAt`, max attempts 6, backoff.

Removed: legacy `POST /api/orders` (folded into `/api/checkout/order`).

---

## 5. Data-flow guarantees ("no leaks")

1. **Single path per mutation.** One order route, one capture path (webhook +
   client-verify both call `capturePayment()`), and one refund-case service
   (`lib/refunds.ts`) through which every refund state change passes.
2. **Transactions** around: seat hold + order insert; capture + tickets +
   ledger; refund request + balance check + hold; refund approval + ticket void
   + inventory release; refund completion + ledger; payout creation
   (locking ledger entries) and cancellation (releasing them).
3. **Idempotency** on every external callback (webhook event id, unique ledger
   keys, ticket fulfilment by order id).
4. **Server-only modules** — `import "server-only"` in every `lib/*` file that
   touches the DB or secrets, so they can never be bundled to the browser.
5. **DTOs** — pages pass plain serialisable view models to client components;
   never raw Mongo documents (prevents leaking `passwordHash`, token hashes,
   internal ids).
6. **Tenant scoping** — every organiser query goes through
   `requireOrgSession()` and filters by `organizationId`; event/order/ticket
   lookups always include the org id in the filter, not just a post-check.
   Cross-organisation access exists only for platform admins, only through
   `requireAdmin()` / `requireEventEditor()`, and is always audit-logged.
7. **PII minimisation** — Razorpay notes carry ids only; logs never print
   emails or phone numbers; QR SVG not stored in the email queue after send.
8. **Retention** — checkout sessions purged after 7 days, email queue bodies
   after 30 days. Attendee PII (names, emails, flow answers) is anonymised
   automatically once an event has been over for the organisation's
   **retention period**, set by the admin per organisation (default 24
   months; shown read-only to the owner). Orders keep amounts and ids;
   invoices keep what GST law requires for 8 years.
9. **Security headers** — CSP (self + Razorpay checkout), HSTS (behind proxy),
   `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` (camera only on
   scanner).
10. **Rate limiting** — in-memory token bucket (single instance) on auth,
    magic-link, check-in and public checkout endpoints; Caddy limits on top.

---

## 6. Docker / single-server deployment

```
docker-compose.yml
  caddy   — reverse proxy, security headers, gzip; TLS via Let's Encrypt in `direct` mode
  cloudflared — (profile `tunnel`) outbound-only Cloudflare Tunnel to caddy
  app     — Next standalone (node:22-alpine, non-root, read-only FS + /data/media volume)
  mongo   — mongo:7, single-node replica set, auth enabled, volume, no published port
  backup  — nightly mongodump + media + documents tar to a local directory (AES-256 encrypted), 14-day rotation
```
- Only Caddy publishes ports (80/443). Mongo is reachable on the internal
  network only.
- Secrets via `.env` (template `.env.example`), never baked into the image.
- `npm run db:indexes` runs automatically on app start (idempotent).
- Healthcheck endpoint `/api/health` (DB ping).
- Cloudflare Workers/OpenNext/Wrangler config and deps removed.
- **Target server:** SSH alias `oci2` (`opc@140.245.231.7`, Oracle Cloud).
  Deploys run over SSH from the dev machine: `scripts/deploy.sh` syncs the
  repo (git archive of the deployed commit, never `.env`), runs `docker
  compose build && up -d` on the server, waits for `/api/health`, and rolls
  back to the previous image tag if it fails. `.env` lives only on the
  server.
- **Domain:** `morbin.space` (DNS on the owner's Cloudflare account). Two
  ingress modes, chosen by a Compose profile:
  - `direct` — Caddy on 80/443 with Let's Encrypt; Cloudflare DNS record
    points at the server (grey cloud / DNS-only). TLS terminates on our
    server, so Cloudflare never sees request contents.
  - `tunnel` — a `cloudflared` container runs a Cloudflare Tunnel (token in
    `.env`); no inbound ports are opened on the server, and Caddy listens
    only on the internal network. **DPDP note:** in this mode (and with the
    orange-cloud proxy) TLS terminates at Cloudflare, so requests, including
    personal data in transit, pass through Cloudflare's network. Nothing is
    stored there, but Cloudflare becomes a processor to list in the privacy
    notice.
  - Oracle Cloud specifics: open 80/443 in the VCN security list and the
    host firewall (`firewalld`) for `direct`; nothing to open for `tunnel`.

---

## 7. Phases & order of work

Git: the pre-existing uncommitted work on `dev` is left uncommitted (owner
decision); the revamp is committed per phase on a separate branch, each phase
reviewed before push.

| # | Phase | Output |
|---|---|---|
| 1 | **Foundation** | Real shadcn install (all needed components), tokens + light/dark theme, the `components/patterns` layer (DataTable, StatusBadge + statusMeta, Money, DateTime, ConfirmAction, FormDialog, FileUpload, Empty/Error states), `Result<T>` action convention, server-only guards |
| 2 | **Dashboard shell** | sidebar-08 installed verbatim and wired: role-aware nav, org identity, `NavUser` (theme, sign-out), breadcrumbs |
| 3 | **Self-hosting** | Remove Cloudflare Workers + R2; standalone build; local media store (done); SES kept with retry/backoff; Dockerfile + compose + Caddy + backups; health route; scheduler |
| 4 | **Money core** | `lib/pricing.ts` + check script, admin fee % (GST-inclusive) per org, owner fee-bearer setting, frozen pricing on orders, `PriceBreakdown` component, ledger, transactional capture, single order route, refund cases (request with cost breakdown, balance check and hold, admin approval, Razorpay Refund API with idempotency + webhooks, manual fallback, per-ticket self-settlement approval), PDF ticket document with GST invoice as last page, invoice numbering, admin GST & invoicing settings, payouts (issue / mark paid / statement upload / acknowledge / query), private document store, payout account |
| 4b | **Flow v2 + datasets** | Datasets (CRUD, CSV import with preview/mapping, row editing, export), flow v2 model + evaluator + migration, lookup questions with uniqueness, email templates, three-pane builder with live preview, templates, pre-publish checks, test run, version restore |
| 5 | **Organiser features** | Event edit, ticket type edit/pause, orders and attendees with filters, saved views and CSV export, refund requests and refunds page, payouts page, team page, settings |
| 6 | **Admin features** | Platform overview, org detail tabs, fee editor, support mode for event booking flows and org datasets (shared builder, banner, owner notification, optional approval), payouts desk + queries inbox, applications, audit log, data requests |
| 7 | **Public experience** | Event page redesign, GlassSurface Book-now CTA (exact settings), drawer reskin with shadcn, tickets page, auth pages |
| 8 | **DPDP & hardening** | Consent notice at checkout, privacy request flow, retention jobs, encryption, CSP/headers, rate limits, audit |
| 9 | **Verification** | Typecheck, lint, existing check scripts, flow test, Docker build + smoke test, visual pass in light/dark/mobile |

GlassSurface CTA settings (exact): `saturation 1.6, opacity 0.9,
distortionScale 130, blueOffset 2, borderRadius 49, borderWidth 0.08, blur 8,
redOffset 14, backgroundOpacity 0.45, displace 2.9, brightness 48,
greenOffset 16`.

---

## 8. Open questions for the owner

1. ~~Settlement cadence~~ — resolved: admin-driven, no fixed schedule; the admin issues payouts and attaches the statement.
2. ~~Who pays the platform fee~~ — resolved: admin sets a GST-inclusive %
   per organisation; the owner chooses customer-pays or organisation-absorbs.
3. ~~Email provider~~ — resolved: Amazon SES stays (region `ap-south-1`
   recommended), listed as a processor in the privacy notice.
4. ~~Retention~~ — resolved: per organisation, set by the admin (default 24 months).
5. ~~Refunds and the convenience fee~~ — resolved: refunds return only the
   ticket value; the convenience fee (always GST-inclusive) is never refunded.
6. ~~GST invoice~~ — resolved: attached as the last page of the PDF ticket
   document in the ticket email; GST details configurable in Admin →
   Settings. Still for your CA: the SAC code, and whether to ask buyers for
   their state at checkout (needed to choose IGST vs CGST + SGST correctly).
7. ~~Dataset write-back~~ — resolved: no write-back; datasets change only
   through the organisation's (or support's) edits and imports.
8. ~~Refund funding check~~ — resolved: Morbin-settled refunds need the
   unpaid balance to cover *refund amount + refund cost*; it is held then
   deducted. Self-settled refunds don't touch the balance.
9. ~~Refund method~~ — resolved: Razorpay Refund API to the original
   payment method; all refund costs borne by the organisation upfront. See
   the note in 5a about recovering the gateway fee twice on customer-pays
   orders.
10. ~~Support scope~~ — resolved: support can edit flow, datasets, event
    details, ticket types and prices, appearance, and publish/cancel.
11. ~~Onboarding~~ — resolved: public application, admin approves.
12. ~~Theme~~ — resolved: light + dark, system default.
13. ~~Who requests refunds~~ — resolved: owner only.
14. ~~Event cancellation~~ — resolved: automatic bulk refund requests.
