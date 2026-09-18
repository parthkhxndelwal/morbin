"use client";

import { useState } from "react";

export function OnboardingActions({ hasOrg }: { hasOrg: boolean }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(path: string) {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(path, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(body.error ?? "Something went wrong.");
      } else {
        setMsg(body.message ?? `Status: ${body.status ?? "ok"}`);
        if (body.status === "VERIFIED") window.location.reload();
      }
    } catch {
      setMsg("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!hasOrg) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button
        disabled={busy}
        onClick={() => call("/api/onboarding/payment/start")}
        className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200 disabled:opacity-60"
      >
        Start Razorpay verification
      </button>
      <button
        disabled={busy}
        onClick={() => call("/api/onboarding/payment/sync")}
        className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/10 disabled:opacity-60"
      >
        Sync verification status
      </button>
      {msg && <p className="w-full text-sm text-neutral-300">{msg}</p>}
    </div>
  );
}

export function OrgForm({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const creating = !initialName;
      const res = await fetch(
        creating ? "/api/organizations" : "/api/organizations/self",
        {
          method: creating ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(body.error ?? "Could not save.");
      } else {
        window.location.reload();
      }
    } catch {
      setMsg("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your organization name"
        required
        minLength={2}
        maxLength={80}
        className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200 disabled:opacity-60"
      >
        Save
      </button>
      {msg && <p className="w-full text-sm text-rose-300">{msg}</p>}
    </form>
  );
}
