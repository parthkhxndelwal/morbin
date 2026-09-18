"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";

export function EarlyAccessForm({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/early-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
      setMessage("Something went wrong. Please try again.");
    }
  }

  if (status === "done") {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/5 px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
          <Check className="h-5 w-5 text-emerald-400" />
        </span>
        <div>
          <p className="text-sm font-semibold text-white">You&apos;re on the list.</p>
          <p className="text-sm text-neutral-400">We&apos;ll reach out when early access opens.</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:rounded-full sm:border sm:border-white/15 sm:bg-white/5 sm:p-1.5 sm:pl-5 sm:backdrop-blur">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          aria-label="Email address"
          className="w-full rounded-full border border-white/15 bg-white/5 px-5 py-3.5 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-violet-400/60 sm:border-0 sm:bg-transparent sm:p-0"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-xs font-bold uppercase tracking-widest text-neutral-950 transition-colors hover:bg-violet-200 disabled:opacity-60"
        >
          {status === "loading" ? "Joining…" : "Get early access"}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
      {status === "error" && <p className="mt-3 text-sm text-rose-300">{message}</p>}
      {!compact && (
        <p className="mt-3 text-xs text-neutral-500">
          One email when we launch. No spam, ever.
        </p>
      )}
    </form>
  );
}
