"use client";

import { useState } from "react";

interface FoundTicket {
  code: string;
  attendeeName: string;
  status: string;
  eventTitle: string;
  venue: string;
  startsAt: string | null;
}

export default function MyTicketsPage() {
  const [email, setEmail] = useState("");
  const [tickets, setTickets] = useState<FoundTicket[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/my-tickets?email=${encodeURIComponent(email)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Lookup failed.");
        setTickets(null);
        return;
      }
      setTickets(body.tickets);
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-[#060614] px-6 py-12 font-sans text-white antialiased">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="text-2xl font-bold tracking-tight">Find my tickets</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Enter the email you used at checkout.
        </p>
        <form onSubmit={onSubmit} className="mt-5 flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60"
          />
          <button
            disabled={busy}
            className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 hover:bg-violet-200 disabled:opacity-60"
          >
            Find
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
        {tickets && (
          <div className="mt-6 space-y-3">
            {tickets.length === 0 && (
              <p className="text-sm text-neutral-500">No tickets found for this email.</p>
            )}
            {tickets.map((t) => (
              <div key={t.code} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="font-semibold">{t.eventTitle}</p>
                <p className="text-sm text-neutral-400">
                  {t.attendeeName} · {t.venue}
                </p>
                <p className="mt-2 font-mono text-sm tracking-widest">{t.code}</p>
                <p className="text-xs text-neutral-500">{t.status}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
