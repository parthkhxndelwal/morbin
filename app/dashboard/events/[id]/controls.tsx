"use client";

import { useState } from "react";

export function PublishBar({ eventId, status }: { eventId: string; status: string }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function setStatus(next: string) {
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/events/${eventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(body.error ?? "Could not update.");
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-neutral-400">Status: {status}</span>
      {status === "DRAFT" && (
        <button
          disabled={busy}
          onClick={() => setStatus("PUBLISHED")}
          className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-neutral-950 hover:bg-violet-200 disabled:opacity-60"
        >
          Publish
        </button>
      )}
      {status === "PUBLISHED" && (
        <button
          disabled={busy}
          onClick={() => setStatus("CANCELLED")}
          className="rounded-full border border-rose-400/40 px-4 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-60"
        >
          Cancel event
        </button>
      )}
      {msg && <p className="w-full text-sm text-rose-300">{msg}</p>}
    </div>
  );
}

export function TicketTypeForm({ eventId }: { eventId: string }) {
  const [form, setForm] = useState({ name: "", price: "", capacity: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const res = await fetch(`/api/events/${eventId}/ticket-types`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: "",
        pricePaise: Math.round(parseFloat(form.price || "0") * 100),
        capacity: parseInt(form.capacity || "0", 10),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(body.error ?? "Could not add ticket type.");
      return;
    }
    window.location.reload();
  }

  const input =
    "rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-violet-400/60";
  return (
    <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-4">
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. General)" required minLength={2} className={input} />
      <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="Price ₹" required inputMode="decimal" className={input} />
      <input value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} placeholder="Capacity" required inputMode="numeric" className={input} />
      <button disabled={busy} className="rounded-full bg-white px-4 py-2 text-xs font-bold text-neutral-950 hover:bg-violet-200 disabled:opacity-60">
        Add
      </button>
      {msg && <p className="text-sm text-rose-300 sm:col-span-4">{msg}</p>}
    </form>
  );
}

export function CheckinBox() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult("");
    const res = await fetch("/api/tickets/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setResult(`✗ ${body.error ?? "Invalid"}`);
      return;
    }
    setResult(`✓ ${body.attendeeName} — ${body.eventTitle}`);
    setInput("");
  }

  return (
    <form onSubmit={onSubmit} className="flex gap-2">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ticket code or QR payload"
        className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-violet-400/60"
      />
      <button disabled={busy} className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 hover:bg-violet-200 disabled:opacity-60">
        Check in
      </button>
      {result && <p className="w-full text-sm text-neutral-200">{result}</p>}
    </form>
  );
}
