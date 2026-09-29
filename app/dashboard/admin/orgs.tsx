"use client";

import { useCallback, useState } from "react";

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
  onboardingStatus: string;
  paymentAccountStatus: PaymentStatus;
  razorpayAccountId: string | null;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  createdAt: string;
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

const input =
  "w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60";
const label = "mb-1.5 block text-xs font-semibold uppercase tracking-widest text-neutral-400";
const btn =
  "rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200 disabled:opacity-60";
const btnGhost =
  "rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/10 disabled:opacity-60";

export function AdminOrgs({ initialRows }: { initialRows: Row[] }) {
  // Seeded server-side; refetched only after a mutation.
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

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
          {rows.map((row) => (
            <div key={row.org.id} className="rounded-2xl border border-white/10 bg-white/5">
              <button
                onClick={() => setEditing(editing === row.org.id ? null : row.org.id)}
                className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{row.org.name}</p>
                  <p className="mt-0.5 truncate text-sm text-neutral-400">
                    {row.owner?.email ?? "no owner"} · {row.eventCount} event
                    {row.eventCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {row.org.razorpayAccountId && (
                    <span className="hidden font-mono text-xs text-neutral-500 sm:inline">
                      {row.org.razorpayAccountId}
                    </span>
                  )}
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${statusTone[row.org.paymentAccountStatus]}`}
                  >
                    {row.org.paymentAccountStatus}
                  </span>
                </div>
              </button>
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
          ))}
        </div>
      </section>
    </div>
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
        razorpayAccountId: fd.get("razorpayAccountId") || undefined,
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
        <label className={label}>Razorpay linked account ID</label>
        <input name="razorpayAccountId" className={input} placeholder="acc_xxxxxxxx" />
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
        razorpayAccountId: fd.get("razorpayAccountId"),
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
      <div className="sm:col-span-2">
        <label className={label}>Razorpay linked account ID</label>
        <input
          name="razorpayAccountId"
          defaultValue={row.org.razorpayAccountId ?? ""}
          className={input}
          placeholder="acc_xxxxxxxx — leave blank to clear"
        />
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
        and lets this organization publish paid events. Any other status disables them.
      </p>
    </form>
  );
}
