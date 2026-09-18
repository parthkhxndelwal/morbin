"use client";

import { useEffect, useRef, useState } from "react";

interface CreatedOrder {
  keyId: string;
  razorpayOrderId: string;
  orderId: string;
  totalPaise: number;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadCheckout(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Razorpay Checkout"));
    document.body.appendChild(script);
  });
}

export function CheckoutButton({
  createOrder,
  buyerName,
  buyerEmail,
  buyerPhone,
  label = "Pay now",
  onPaid,
  onError,
}: {
  createOrder: () => Promise<CreatedOrder>;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  label?: string;
  onPaid: (orderId: string) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
    },
    [],
  );

  async function poll(orderId: string) {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/orders/${orderId}`);
        const body = await res.json().catch(() => ({}));
        if (body.status === "PAID") {
          if (pollRef.current) clearInterval(pollRef.current);
          onPaid(orderId);
          return;
        }
        if (body.status === "FAILED" || body.status === "EXPIRED") {
          if (pollRef.current) clearInterval(pollRef.current);
          onError("Payment did not complete. Please try again.");
          return;
        }
      } catch {
        /* keep polling */
      }
    }
    onError("Still confirming payment — check your email shortly.");
  }

  async function onClick() {
    setBusy(true);
    try {
      await loadCheckout();
      const order = await createOrder();
      if (!window.Razorpay) throw new Error("Checkout unavailable");
      const rzp = new window.Razorpay({
        key: order.keyId,
        order_id: order.razorpayOrderId,
        amount: order.totalPaise,
        currency: "INR",
        name: "Morbin",
        prefill: { name: buyerName, email: buyerEmail, contact: buyerPhone },
        theme: { color: "#7c3aed" },
        handler: () => {
          void poll(order.orderId);
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
            onError("Payment window closed before completion.");
          },
        },
      });
      rzp.open();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to start payment.");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="w-full rounded-full bg-white px-5 py-3.5 text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200 disabled:opacity-60"
    >
      {busy ? "Waiting for payment…" : label}
    </button>
  );
}
