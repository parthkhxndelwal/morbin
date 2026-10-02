"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Logo } from "@/components/logo";

interface FoundTicket {
  code: string;
  qrPayload: string;
  attendeeName: string;
  status: string;
  eventTitle: string;
  venue: string;
  startsAt: string | null;
}

/**
 * The buyer's own tickets, read from their session.
 *
 * The QR is rendered here rather than only in the email, so a buyer who opens the
 * link on a different device — or forwards the email to a friend attending on
 * their behalf — can still get in. The code shown is the signed payload, which is
 * exactly what the door scanner verifies.
 */
export function TicketLookup() {
  const [tickets, setTickets] = useState<FoundTicket[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/my-tickets", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not load your tickets.");
        setTickets(null);
        return;
      }
      setTickets(Array.isArray(body.tickets) ? body.tickets : []);
    } catch {
      setError("Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-dvh bg-[#060614] px-6 py-12 font-sans text-white antialiased">
      <div className="mx-auto w-full max-w-xl">
        <Logo height={24} />
        <h1 className="mt-8 text-2xl font-bold tracking-tight">Your tickets</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Signed in with the email you booked with.
        </p>

        {error && (
          <div className="mt-5 rounded-2xl border border-white/15 bg-white/5 p-5">
            <p className="text-sm text-neutral-300">{error}</p>
            <Link
              href="/auth"
              className="mt-4 inline-block rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 hover:bg-violet-200"
            >
              Sign in
            </Link>
          </div>
        )}

        {busy && <p className="mt-6 text-sm text-neutral-400">Loading…</p>}

        {!busy && tickets && tickets.length === 0 && !error && (
          <p className="mt-6 text-sm text-neutral-500">
            No tickets on this account yet.
          </p>
        )}

        <div className="mt-6 space-y-3">
          {(tickets ?? []).map((t) => (
            <div key={t.code} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{t.eventTitle}</p>
                  <p className="text-sm text-neutral-400">
                    {t.attendeeName}
                    {t.venue ? ` · ${t.venue}` : ""}
                  </p>
                  {t.startsAt && (
                    <p className="text-xs text-neutral-500">
                      {new Date(t.startsAt).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                    t.status === "USED"
                      ? "border-neutral-400/40 text-neutral-400"
                      : "border-emerald-400/40 text-emerald-300"
                  }`}
                >
                  {t.status === "USED" ? "Checked in" : "Valid"}
                </span>
              </div>

              <p className="mt-3 font-mono text-sm tracking-widest">{t.code}</p>

              {t.status !== "USED" && (
                <>
                  <button
                    onClick={() => setOpen(open === t.code ? null : t.code)}
                    className="mt-3 text-xs font-semibold text-violet-300 underline"
                  >
                    {open === t.code ? "Hide" : "Show"} QR code
                  </button>
                  {open === t.code && <TicketQr payload={t.qrPayload} />}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a QR client-side.
 *
 * Drawn on a canvas from the `qrcode` package rather than shipped as an SVG
 * string, so the payload never has to round-trip through the server. The door
 * scanner accepts the bare code too, so a buyer with no camera can always read
 * the text above.
 */
function TicketQr({ payload }: { payload: string }) {
  return (
    <div className="mt-3 flex flex-col items-center gap-2">
      <canvas ref={paint} data-payload={payload} className="rounded-lg bg-white p-2" />
      <p className="text-[10px] text-neutral-500">Show this at the door</p>
    </div>
  );
}

function paint(node: HTMLCanvasElement | null) {
  if (!node) return;
  const payload = node.dataset.payload ?? "";
  void (async () => {
    try {
      const QR = (await import("qrcode")).default;
      await QR.toCanvas(node, payload, { margin: 1, width: 220 });
    } catch {
      /* the code is still readable as text */
    }
  })();
}
