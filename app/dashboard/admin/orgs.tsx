"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { memberLabelPlural } from "@/lib/permissions";
import {
  ORGANIZATION_TYPES,
  type OrganizationStatus,
  type OrganizationType,
} from "@/lib/types";

type PaymentStatus = "NOT_STARTED" | "PENDING" | "VERIFIED" | "REJECTED" | "RESTRICTED";

const STATUSES: PaymentStatus[] = [
  "NOT_STARTED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "RESTRICTED",
];

interface Org {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  status: OrganizationStatus;
  onboardingStatus: string;
  paymentAccountStatus: PaymentStatus;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  createdAt: string;
  memberCount: number;
  orderCount: number;
}

interface Row {
  org: Org;
  owner: { id: string; name: string; email: string } | null;
  eventCount: number;
}

const statusTone: Record<PaymentStatus, string> = {
  VERIFIED: "bg-emerald-500/20 text-emerald-300",
  PENDING: "bg-amber-500/20 text-amber-300",
  REJECTED: "bg-rose-500/20 text-rose-300",
  RESTRICTED: "bg-orange-500/20 text-orange-300",
  NOT_STARTED: "bg-white/10 text-neutral-300",
};

/** `3 orders` / `1 order` — used for the force-delete summary. */
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The destructive/irreversible moves an admin can make on a row. */
type Action = "suspend" | "restore" | "delete" | "force";

const ACTION_VERB: Record<Action, string> = {
  suspend: "suspend",
  restore: "restore",
  delete: "delete",
  force: "delete everything",
};

const ACTION_ASK: Record<Action, string> = {
  suspend: "Suspend it? It keeps every record but can no longer publish or take orders.",
  restore: "Restore it to active?",
  delete: "Delete it permanently? This cannot be undone.",
  force:
    "Delete this organization AND its orders, tickets, events and members? There is no undo, and no way to recover the sales history afterwards.",
};

const input =
  "w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60";
const label = "mb-1.5 block text-xs font-semibold uppercase tracking-widest text-neutral-400";
const btn =
  "rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200 disabled:opacity-60";
const btnGhost =
  "rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/10 disabled:opacity-60";
// Row-level actions sit in a tighter rhythm than the page-level buttons.
const btnMini =
  "rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10 disabled:opacity-60";
const btnMiniDanger =
  "rounded-full border border-rose-400/40 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-60";

export function AdminOrgs({ initialRows }: { initialRows: Row[] }) {
  // Seeded server-side; refetched only after a mutation.
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  // The row waiting on a confirmation, and the row whose request is in flight.
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/organizations");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Could not load organizations.");
      return;
    }
    setRows(body.organizations as Row[]);
  }, []);

  function flash(message: string) {
    setOk(message);
    setError("");
    window.setTimeout(() => setOk(""), 4000);
  }

  /**
   * Suspend, restore, delete and force delete all go through here.
   *
   * Both deletes can be refused server-side, and their 409 messages say exactly
   * what is standing in the way ("refund these first", "these are still inside
   * the checkout hold"), so the error is surfaced verbatim rather than replaced
   * with a generic failure. Force delete stays an explicit opt-in rather than
   * an automatic retry of a failed delete — an operator should have to mean it.
   */
  async function runAction(target: { id: string; action: Action }) {
    const { id, action } = target;
    const org = rows.find((r) => r.org.id === id);
    if (!org) return;

    setBusyId(id);
    setError("");
    setOk("");
    const res =
      action === "delete" || action === "force"
        ? await fetch(
            `/api/admin/organizations/${id}${action === "force" ? "?force=1" : ""}`,
            { method: "DELETE" },
          )
        : await fetch(`/api/admin/organizations/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: action === "suspend" ? "SUSPENDED" : "ACTIVE" }),
          });
    const body = await res.json().catch(() => ({}));
    setBusyId(null);
    setConfirm(null);
    setEditing(null);

    if (!res.ok) {
      setError(body.error ?? "Could not update the organization.");
      return;
    }
    if (action === "force") {
      const c = body.counts;
      flash(
        `Deleted ${org.org.name} and everything under it: ${plural(c.orders, "order")}, ${plural(c.tickets, "ticket")}, ${plural(c.events, "event")}, ${plural(c.memberships, "member")}.`,
      );
      return;
    }
    if (action === "delete") {
      flash("Organization deleted.");
      return;
    }
    await load();
    flash(action === "suspend" ? "Organization suspended." : "Organization restored.");
  }

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </p>
      )}
      {ok && (
        <p role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {ok}
        </p>
      )}

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">
            All organizations ({rows.length})
          </h2>
          <button onClick={() => setCreating((c) => !c)} className={btnGhost}>
            {creating ? "Cancel" : "New organization"}
          </button>
        </div>

        {creating && (
          <div className="mt-4">
            <CreateForm
              onDone={async (ownerCreated) => {
                setCreating(false);
                await load();
                flash(
                  ownerCreated
                    ? "Organization created, and the owner account was provisioned."
                    : "Organization created.",
                );
              }}
              onError={setError}
            />
          </div>
        )}

        <div className="mt-4 space-y-3">
          {rows.length === 0 && (
            <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-neutral-500">
              No organizations yet. Create the first one.
            </p>
          )}
          {rows.map((row) => {
            const asking = confirm?.id === row.org.id ? confirm : null;
            const busy = busyId === row.org.id;
            return (
              <div key={row.org.id} className="rounded-2xl border border-white/10 bg-white/5">
                <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <button
                    onClick={() => setEditing(editing === row.org.id ? null : row.org.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold">{row.org.name}</p>
                      {row.org.status === "SUSPENDED" && (
                        <span className="rounded-full bg-rose-500/20 px-2.5 py-0.5 text-xs font-bold text-rose-300">
                          SUSPENDED
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-neutral-400">
                      {row.owner?.email ?? "no owner"} · {row.org.type} ·{" "}
                      {row.org.memberCount} {memberLabelPlural(row.org.type)} · {row.eventCount} event
                      {row.eventCount === 1 ? "" : "s"}
                    </p>
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${statusTone[row.org.paymentAccountStatus]}`}
                    >
                      {row.org.paymentAccountStatus}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
                  {asking ? (
                    <>
                      <span className="mr-auto text-xs text-neutral-400">{ACTION_ASK[asking.action]}</span>
                      <button
                        onClick={() => runAction(asking)}
                        disabled={busy}
                        className={btnMiniDanger}
                      >
                        {busy ? "Working…" : `Yes, ${ACTION_VERB[asking.action]}`}
                      </button>
                      <button onClick={() => setConfirm(null)} className={btnMini} disabled={busy}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <Link href={`/dashboard/admin/${row.org.id}`} className={btnMini}>
                        Details
                      </Link>
                      {row.org.status === "SUSPENDED" ? (
                        <button
                          onClick={() => setConfirm({ id: row.org.id, action: "restore" })}
                          className={btnMini}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => setConfirm({ id: row.org.id, action: "suspend" })}
                          className={btnMini}
                        >
                          Suspend
                        </button>
                      )}
                      <button
                        onClick={() => setConfirm({ id: row.org.id, action: "delete" })}
                        className={btnMiniDanger}
                      >
                        Delete
                      </button>
                      {/* Only offered when plain delete would be refused, so the
                          destructive cascade is never one click away from an org
                          that has nothing to lose. */}
                      {(row.org.orderCount > 0 || row.org.memberCount > 0) && (
                        <button
                          onClick={() => setConfirm({ id: row.org.id, action: "force" })}
                          className={btnMiniDanger}
                        >
                          Force delete
                        </button>
                      )}
                    </>
                  )}
                </div>

                {editing === row.org.id && (
                  <div className="border-t border-white/10 p-4">
                    <EditForm
                      row={row}
                      onSaved={async () => {
                        setEditing(null);
                        await load();
                        flash("Organization updated.");
                      }}
                      onError={setError}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function TypeSelect({ defaultValue }: { defaultValue: OrganizationType }) {
  return (
    <select name="type" defaultValue={defaultValue} className={input}>
      {ORGANIZATION_TYPES.map((t) => (
        <option key={t} value={t} className="bg-neutral-900">
          {t}
        </option>
      ))}
    </select>
  );
}

function CreateForm({
  onDone,
  onError,
}: {
  onDone: (ownerCreated: boolean) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    onError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        ownerName: fd.get("ownerName"),
        ownerEmail: fd.get("ownerEmail"),
        ownerPassword: fd.get("ownerPassword") || undefined,
        type: fd.get("type"),
        paymentAccountStatus: fd.get("paymentAccountStatus") || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onError(body.error ?? "Could not create the organization.");
      return;
    }
    onDone(!!body.ownerCreated);
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400">
          New organization
        </h3>
      </div>
      <div className="sm:col-span-2">
        <label className={label}>Organization name</label>
        <input name="name" required minLength={2} maxLength={80} className={input} placeholder="Sunset Cinema Club" />
      </div>
      <div>
        <label className={label}>Type</label>
        <TypeSelect defaultValue="EVENT" />
        <p className="mt-1.5 text-xs text-neutral-500">
          Decides what non-owners are called — Students or Staff.
        </p>
      </div>
      <div>
        <label className={label}>Owner email</label>
        <input
          name="ownerEmail"
          type="email"
          required
          className={input}
          placeholder="owner@example.com"
        />
      </div>
      <div>
        <label className={label}>Owner name</label>
        <input name="ownerName" maxLength={80} className={input} placeholder="Optional" />
      </div>
      <div className="sm:col-span-2">
        <label className={label}>Owner password</label>
        <input
          name="ownerPassword"
          type="password"
          minLength={8}
          autoComplete="new-password"
          className={input}
          placeholder="Only if this email has no account yet (8+ chars)"
        />
      </div>
      <div>
        <label className={label}>Payment status</label>
        <select name="paymentAccountStatus" defaultValue="NOT_STARTED" className={input}>
          {STATUSES.map((s) => (
            <option key={s} value={s} className="bg-neutral-900">
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={busy} className={btn}>
          {busy ? "Creating…" : "Create organization"}
        </button>
      </div>
    </form>
  );
}

function EditForm({
  row,
  onSaved,
  onError,
}: {
  row: Row;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    onError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`/api/admin/organizations/${row.org.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fd.get("name"),
        type: fd.get("type"),
        paymentAccountStatus: fd.get("paymentAccountStatus"),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onError(body.error ?? "Could not update the organization.");
      return;
    }
    onSaved();
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label className={label}>Organization name</label>
        <input name="name" defaultValue={row.org.name} required minLength={2} maxLength={80} className={input} />
      </div>
      <div>
        <label className={label}>Type</label>
        <TypeSelect defaultValue={row.org.type} />
      </div>
      <div>
        <label className={label}>Payment status</label>
        <select
          name="paymentAccountStatus"
          defaultValue={row.org.paymentAccountStatus}
          className={input}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s} className="bg-neutral-900">
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-3">
        <button type="submit" disabled={busy} className={btn}>
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
      <p className="text-xs text-neutral-500 sm:col-span-2">
        Setting <span className="font-semibold text-neutral-300">VERIFIED</span> enables payouts
        and lets this organization publish paid events. Any other status disables them. Changing the
        type only relabels members — it never changes what a role can do.
      </p>
    </form>
  );
}
