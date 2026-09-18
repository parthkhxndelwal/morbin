"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewEventForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    venue: "",
    startsAt: "",
    endsAt: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          timezone: "Asia/Kolkata",
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not create event.");
        return;
      }
      router.push(`/dashboard/events/${body.event.id}`);
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-violet-400/60";
  return (
    <form onSubmit={onSubmit} className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-5">
      <input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Event title" required minLength={3} className={input} />
      <textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Description (min 10 chars)" required minLength={10} rows={3} className={input} />
      <input value={form.venue} onChange={(e) => set("venue", e.target.value)} placeholder="Venue" required minLength={2} className={input} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-neutral-400">
          Starts
          <input type="datetime-local" value={form.startsAt} onChange={(e) => set("startsAt", e.target.value)} required className={`${input} mt-1`} />
        </label>
        <label className="text-xs text-neutral-400">
          Ends
          <input type="datetime-local" value={form.endsAt} onChange={(e) => set("endsAt", e.target.value)} required className={`${input} mt-1`} />
        </label>
      </div>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <button disabled={busy} className="rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 hover:bg-violet-200 disabled:opacity-60">
        {busy ? "Creating…" : "Create draft event"}
      </button>
    </form>
  );
}
