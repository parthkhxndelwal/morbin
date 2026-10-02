"use client";

import { useCallback, useEffect, useState } from "react";
import { describeMemberRole, memberLabel, memberLabelPlural } from "@/lib/permissions";
import type { OrganizationType, OrgRole } from "@/lib/types";

interface Member {
  userId: string;
  membershipId: string;
  name: string;
  email: string;
  role: OrgRole;
  emailVerified: boolean;
  createdAt: string;
  isOwner: boolean;
}

type Loaded = { ok: true; members: Member[] } | { ok: false; error: string };

const input =
  "w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60";
const label = "mb-1.5 block text-xs font-semibold uppercase tracking-widest text-neutral-400";
const btn =
  "rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200 disabled:opacity-60";
const btnGhost =
  "rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/10 disabled:opacity-60";
const btnMini =
  "rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/10 disabled:opacity-60";
const btnMiniDanger =
  "rounded-full border border-rose-400/40 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 disabled:opacity-60";

export function Members({
  organizationId,
  type,
}: {
  organizationId: string;
  type: OrganizationType;
}) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [adding, setAdding] = useState(false);
  // At most one inline panel is open at a time, keyed by userId.
  const [editing, setEditing] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  const plural = memberLabelPlural(type);
  const singular = memberLabel(type);

  // Fetching is kept separate from applying so the initial load can settle
  // state from a promise callback rather than inside the effect body.
  const fetchMembers = useCallback(async (): Promise<Loaded> => {
    const res = await fetch(`/api/admin/organizations/${organizationId}/members`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body.error ?? "Could not load members." };
    return { ok: true, members: (body.members ?? []) as Member[] };
  }, [organizationId]);

  const apply = useCallback((result: Loaded) => {
    if (result.ok) {
      setLoadError("");
      setMembers(result.members);
    } else {
      setLoadError(result.error);
    }
  }, []);

  const load = useCallback(async () => {
    apply(await fetchMembers());
  }, [apply, fetchMembers]);

  useEffect(() => {
    let live = true;
    void fetchMembers().then((result) => {
      if (live) apply(result);
    });
    return () => {
      live = false;
    };
  }, [apply, fetchMembers]);

  function flash(message: string) {
    setOk(message);
    setError("");
    window.setTimeout(() => setOk(""), 4000);
  }

  /** Every mutation ends the same way: close the panel, refetch, report. */
  async function settle(
    userId: string,
    request: Promise<Response>,
    success: string,
  ) {
    setBusy(userId);
    const res = await request;
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      setEditing(null);
      setResetting(null);
      setConfirmRemove(null);
      setError(body.error ?? "That did not work.");
      return;
    }
    setAdding(false);
    setEditing(null);
    setResetting(null);
    setConfirmRemove(null);
    await load();
    flash(success);
  }

  return (
    <section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">
          {plural} ({members?.length ?? 0})
        </h2>
        <button onClick={() => setAdding((a) => !a)} className={btnGhost} disabled={!!loadError}>
          {adding ? "Cancel" : `Add ${singular.toLowerCase()}`}
        </button>
      </div>

      {loadError && (
        <p role="alert" className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {loadError}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </p>
      )}
      {ok && (
        <p role="status" className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
          {ok}
        </p>
      )}

      {adding && (
        <div className="mt-4">
          <AddMemberForm
            organizationId={organizationId}
            singular={singular}
            onCancel={() => setAdding(false)}
            onDone={async (userCreated) => {
              setAdding(false);
              await load();
              flash(
                userCreated
                  ? `${singular} added, and the account was provisioned.`
                  : `${singular} added.`,
              );
            }}
            onError={setError}
          />
        </div>
      )}

      <div className="mt-4 space-y-3">
        {members === null && !loadError && (
          <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-neutral-500">
            Loading {plural.toLowerCase()}…
          </p>
        )}
        {members?.length === 0 && (
          <p className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center text-sm text-neutral-500">
            No {plural.toLowerCase()} yet. The owner can add them.
          </p>
        )}
        {members?.map((m) => (
          <div key={m.userId} className="rounded-2xl border border-white/10 bg-white/5">
            <div className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold">{m.name || "Unnamed"}</p>
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-bold text-neutral-300">
                    {describeMemberRole(type, m.role)}
                  </span>
                  {m.isOwner && (
                    <span className="rounded-full bg-violet-500/20 px-2.5 py-0.5 text-xs font-bold text-violet-300">
                      Account owner
                    </span>
                  )}
                  {!m.emailVerified && (
                    <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-300">
                      Unverified email
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-sm text-neutral-400">{m.email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {editing === m.userId || resetting === m.userId || confirmRemove === m.userId ? null : (
                  <>
                    <button onClick={() => setEditing(m.userId)} className={btnMini}>
                      Edit
                    </button>
                    <button onClick={() => setResetting(m.userId)} className={btnMini}>
                      Reset password
                    </button>
                    <button
                      onClick={() => setConfirmRemove(m.userId)}
                      className={btnMiniDanger}
                      disabled={m.isOwner}
                      title={
                        m.isOwner
                          ? "An organization has exactly one owner — transfer ownership before removing anyone."
                          : undefined
                      }
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </div>

            {editing === m.userId && (
              <div className="border-t border-white/10 p-4">
                <EditMemberForm
                  member={m}
                  singular={singular}
                  busy={busy === m.userId}
                  onCancel={() => setEditing(null)}
                  onSave={(payload) =>
                    settle(
                      m.userId,
                      fetch(`/api/admin/organizations/${organizationId}/members/${m.userId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(payload),
                      }),
                      `${m.name || m.email} updated.`,
                    )
                  }
                />
              </div>
            )}

            {resetting === m.userId && (
              <div className="border-t border-white/10 p-4">
                <ResetPasswordForm
                  email={m.email}
                  busy={busy === m.userId}
                  onCancel={() => setResetting(null)}
                  onSave={(password) =>
                    settle(
                      m.userId,
                      fetch(`/api/admin/organizations/${organizationId}/members/${m.userId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        // The password only ever travels out, never back.
                        body: JSON.stringify({ password }),
                      }),
                      `Password reset for ${m.email}.`,
                    )
                  }
                />
              </div>
            )}

            {confirmRemove === m.userId && (
              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-4 py-3">
                <span className="mr-auto text-xs text-neutral-400">
                  Remove {m.name || m.email} from this organization? Their account and past orders
                  are kept.
                </span>
                <button
                  onClick={() =>
                    settle(
                      m.userId,
                      fetch(`/api/admin/organizations/${organizationId}/members/${m.userId}`, {
                        method: "DELETE",
                      }),
                      `${m.name || m.email} removed.`,
                    )
                  }
                  disabled={busy === m.userId}
                  className={btnMiniDanger}
                >
                  {busy === m.userId ? "Working…" : "Yes, remove"}
                </button>
                <button onClick={() => setConfirmRemove(null)} className={btnMini}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function AddMemberForm({
  organizationId,
  singular,
  onDone,
  onCancel,
  onError,
}: {
  organizationId: string;
  singular: string;
  onDone: (userCreated: boolean) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    onError("");
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`/api/admin/organizations/${organizationId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: fd.get("email"),
        name: fd.get("name") || undefined,
        password: fd.get("password") || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      onError(body.error ?? "Could not add that person.");
      return;
    }
    onDone(!!body.userCreated);
  }

  return (
    <form
      onSubmit={submit}
      className="grid gap-4 rounded-2xl border border-white/10 bg-white/5 p-5 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <h3 className="text-sm font-bold uppercase tracking-widest text-neutral-400">
          Add {singular.toLowerCase()}
        </h3>
      </div>
      <div>
        <label className={label}>Email</label>
        <input name="email" type="email" required className={input} placeholder="person@example.com" />
      </div>
      <div>
        <label className={label}>Name</label>
        <input
          name="name"
          maxLength={80}
          className={input}
          placeholder="Optional — used if the account is new"
        />
      </div>
      <div className="sm:col-span-2">
        <label className={label}>Password</label>
        <input
          name="password"
          type="password"
          minLength={8}
          autoComplete="new-password"
          className={input}
          placeholder="Only if this email has no account yet (8+ chars)"
        />
        <p className="mt-1.5 text-xs text-neutral-500">
          If the address already has a Morbin account the password is ignored — use{" "}
          <span className="font-semibold text-neutral-300">Reset password</span> on their row instead.
          New accounts are added as {singular.toLowerCase()}; an organization has one owner.
        </p>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={busy} className={btn}>
          {busy ? "Adding…" : `Add ${singular.toLowerCase()}`}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditMemberForm({
  member,
  singular,
  busy,
  onSave,
  onCancel,
}: {
  member: Member;
  singular: string;
  busy: boolean;
  onSave: (payload: { name: string; role: OrgRole }) => void;
  onCancel: () => void;
}) {
  // A keyed form is what lets the uncontrolled name input reset when the row
  // changes or the panel closes.
  const [form, setForm] = useState({ name: member.name, role: member.role });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(form);
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <div>
        <label className={label}>Name</label>
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          maxLength={80}
          className={input}
          placeholder="Unnamed"
        />
      </div>
      <div>
        <label className={label}>Role</label>
        {member.isOwner ? (
          <>
            <input value="Owner" disabled className={`${input} opacity-60`} />
            <p className="mt-1.5 text-xs text-neutral-500">
              The owner&apos;s role cannot be lowered — transfer ownership first.
            </p>
          </>
        ) : (
          <>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as OrgRole })}
              className={input}
            >
              <option value="MEMBER" className="bg-neutral-900">
                {singular}
              </option>
            </select>
            <p className="mt-1.5 text-xs text-neutral-500">
              An organization has exactly one owner, so this stays {singular.toLowerCase()} until
              ownership is transferred.
            </p>
          </>
        )}
      </div>
      <div className="flex items-end gap-3 sm:col-span-2">
        <button type="submit" disabled={busy} className={btn}>
          {busy ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ResetPasswordForm({
  email,
  busy,
  onSave,
  onCancel,
}: {
  email: string;
  busy: boolean;
  onSave: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(password);
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      <div className="sm:col-span-2">
        <label className={label}>New password for {email}</label>
        {/* Write-only by construction: no value is ever read back or stored
            anywhere but this field. */}
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className={input}
          placeholder="8+ characters"
        />
        <p className="mt-1.5 text-xs text-neutral-500">
          Clears the unverified flag — the admin is vouching that the address works. Share it over
          a channel you trust; it is never shown again.
        </p>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" disabled={busy || password.length < 8} className={btn}>
          {busy ? "Saving…" : "Set password"}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
