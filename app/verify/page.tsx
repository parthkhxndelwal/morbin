"use client";

import { useState } from "react";

export default function VerifyPage() {
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
    <div className="min-h-dvh bg-[#060614] px-6 py-12 font-sans text-white antialiased">
      <div className="mx-auto w-full max-w-xl text-center">
        <h1 className="text-2xl font-bold tracking-tight">Check-in desk</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Type or paste a ticket code (or QR payload).
        </p>
        <form onSubmit={onSubmit} className="mt-6 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="MRB-XXXXXXXX"
            autoComplete="off"
            className="flex-1 rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-center font-mono text-sm uppercase outline-none placeholder:text-neutral-500 focus:border-violet-400/60"
          />
          <button
            disabled={busy}
            className="rounded-full bg-white px-6 py-3 text-sm font-bold text-neutral-950 hover:bg-violet-200 disabled:opacity-60"
          >
            Verify
          </button>
        </form>
        {result && (
          <p
            className={`mt-6 rounded-2xl border p-5 text-lg font-bold ${
              result.startsWith("✓")
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                : "border-rose-400/30 bg-rose-500/10 text-rose-200"
            }`}
          >
            {result}
          </p>
        )}
      </div>
    </div>
  );
}
