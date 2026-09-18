"use client";

import { useState } from "react";
import { CheckoutButton } from "@/components/checkout-button";

interface TT {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  capacity: number;
  soldCount: number;
}

export function BuyBox({ eventId, types }: { eventId: string; types: TT[] }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [buyer, setBuyer] = useState({ name: "", email: "", phone: "" });
  const [error, setError] = useState("");
  const [paidOrder, setPaidOrder] = useState<string | null>(null);

  const total = types.reduce((s, t) => s + t.pricePaise * (qty[t.id] ?? 0), 0);
  const totalQty = Object.values(qty).reduce((s, n) => s + n, 0);

  async function createOrder() {
    const items = Object.entries(qty)
      .filter(([, n]) => n > 0)
      .map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId,
        items,
        buyer,
        attendees: [], // buyer details reused per ticket in MVP
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? "Could not create order.");
    return body as { keyId: string; razorpayOrderId: string; orderId: string; totalPaise: number };
  }

  if (paidOrder) {
    return (
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-6 text-center">
        <p className="font-bold text-white">Payment confirmed.</p>
        <p className="mt-1 text-sm text-neutral-300">
          Tickets are on their way to {buyer.email}. Screenshot this for the door just in case.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">Tickets</h2>
      <div className="mt-4 space-y-3">
        {types.map((t) => {
          const left = t.capacity - t.soldCount;
          const soldOut = left <= 0;
          return (
            <div key={t.id} className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-white">{t.name}</p>
                <p className="text-sm text-neutral-400">
                  ₹{(t.pricePaise / 100).toFixed(0)} · {soldOut ? "Sold out" : `${left} left`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={soldOut || (qty[t.id] ?? 0) === 0}
                  onClick={() => setQty((q) => ({ ...q, [t.id]: (q[t.id] ?? 0) - 1 }))}
                  className="h-8 w-8 rounded-full border border-white/15 text-white disabled:opacity-30"
                  aria-label={`Remove one ${t.name}`}
                >
                  −
                </button>
                <span className="w-6 text-center text-white">{qty[t.id] ?? 0}</span>
                <button
                  disabled={soldOut || (qty[t.id] ?? 0) >= Math.min(10, left)}
                  onClick={() => setQty((q) => ({ ...q, [t.id]: (q[t.id] ?? 0) + 1 }))}
                  className="h-8 w-8 rounded-full border border-white/15 text-white disabled:opacity-30"
                  aria-label={`Add one ${t.name}`}
                >
                  +
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {totalQty > 0 && (
        <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
          <input
            value={buyer.name}
            onChange={(e) => setBuyer((b) => ({ ...b, name: e.target.value }))}
            placeholder="Full name"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-neutral-500"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="email"
              value={buyer.email}
              onChange={(e) => setBuyer((b) => ({ ...b, email: e.target.value }))}
              placeholder="Email for tickets"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-neutral-500"
            />
            <input
              value={buyer.phone}
              onChange={(e) => setBuyer((b) => ({ ...b, phone: e.target.value }))}
              placeholder="Phone"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white outline-none placeholder:text-neutral-500"
            />
          </div>
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <CheckoutButton
            createOrder={createOrder}
            buyerName={buyer.name}
            buyerEmail={buyer.email}
            buyerPhone={buyer.phone}
            label={`Pay ₹${(total / 100).toFixed(0)}`}
            onPaid={(orderId) => setPaidOrder(orderId)}
            onError={(m) => setError(m)}
          />
        </div>
      )}
    </div>
  );
}
