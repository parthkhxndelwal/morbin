"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The booking drawer.
 *
 * Every screen here is a function of one server payload (`/api/checkout`).
 * The client decides *nothing* about what a buyer may do — no step is revealed
 * locally, no cap is enforced here, no audience is inferred. It renders what the
 * server resolved and posts answers back. That is what keeps the flow's rules in
 * one place (`lib/flows.ts`) instead of mirrored in a component that would
 * eventually disagree with it.
 *
 * The Google sign-in is a popup on purpose: the parent tab keeps its funnel
 * state, so returning from the popup resumes the drawer at the right step rather
 * than reloading the event page and losing the buyer's answers.
 */

interface OfferType {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  left: number;
  maxSelectable: number;
  quantityEditable: boolean;
}

interface Step {
  id: string;
  kind: "SINGLE_CHOICE" | "IDENTITY" | "QUANTITY" | "INFO" | "LOOKUP";
  title: string;
  description?: string | null;
  required?: boolean;
  options?: { id: string; label: string; value: string }[] | null;
  /** LOOKUP only. */
  inputHint?: string | null;
}

interface CustomField {
  id: string;
  label: string;
  type: "TEXT" | "TEL" | "EMAIL" | "TEXTAREA" | "SELECT" | "MULTI_SELECT";
  required: boolean;
  options?: string[] | null;
  placeholder?: string | null;
}

interface State {
  event: { id: string; slug: string; title: string; venue: string };
  flow: { version: number; steps: Step[] };
  answers: Record<string, string>;
  branch: { stepId: string; optionId: string; value: string } | null;
  identity: {
    method: string;
    email: string | null;
    verified: boolean;
    via: string | null;
    /** Set when an ID check derived the address: masked until verified. */
    lookupEmail: string | null;
  };
  offer: {
    ticketTypes: OfferType[];
    quantityRequired: boolean;
    forcedItems: { ticketTypeId: string; quantity: number }[] | null;
    soldOutForIdentity: boolean;
    missingRequiredSteps: string[];
    platformFeePaise: number;
  };
  branding: { accentColor: string; ctaLabel: string; customFields: CustomField[] };
  /** A builder test run: stop at the payment step. */
  testRun?: boolean;
}

type ScreenKind = "loading" | "questions" | "identity" | "checkout" | "done";
type Screen = { kind: ScreenKind };

/**
 * How long the resend button stays disabled.
 *
 * Mirrors RESEND_COOLDOWN_MS in lib/checkout. It is duplicated rather than
 * imported because the response cannot carry it: telling the client "you may
 * re-send in N seconds" would distinguish an eligible address from an
 * ineligible one, which is exactly the signal the uniform response hides.
 */
const RESEND_COOLDOWN_SECONDS = 45;

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

export function BuyDrawer({
  eventId,
  slug,
  title,
  accentColor = "#7c3aed",
  ctaLabel,
  utm,
  autoOpen = false,
  testToken = null,
}: {
  /** Signed by "Run through checkout as a buyer"; opens a test-mode checkout with the draft rules. */
  testToken?: string | null;
  eventId: string;
  slug: string;
  title: string;
  accentColor?: string;
  ctaLabel: string;
  utm?: { source?: string; medium?: string; campaign?: string } | null;
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [state, setState] = useState<State | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [qty, setQty] = useState<Record<string, number>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [email, setEmail] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paymentCancelled, setPaymentCancelled] = useState(false);
  const [paid, setPaid] = useState(false);

  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const read = useCallback(async () => {
    const res = await fetch("/api/checkout", { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Could not start checkout");
    return (await res.json()) as State;
  }, []);

  const start = useCallback(async () => {
    setScreen({ kind: "loading" });
    setError("");
    setOpen(true);
    try {
      const next = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId,
          utm_source: utm?.source,
          utm_medium: utm?.medium,
          utm_campaign: utm?.campaign,
          ...(testToken ? { testToken } : {}),
        }),
      });
      if (!next.ok) {
        const b = await next.json().catch(() => ({}));
        setError(b.error ?? "Could not start checkout.");
        return;
      }
      const s = (await next.json()) as State;
      setState(s);
      apply(s);
    } catch {
      setError("Something went wrong. Please try again.");
    }
  }, [eventId, utm, testToken]);

  /**
   * Pick the screen from the resolved state. Kept as one function so every
   * transition agrees on the ordering: questions before identity before
   * checkout, and never backwards past a requirement the server still reports.
   */
  const apply = useCallback((s: State) => {
    setState(s);
    if (s.offer.missingRequiredSteps.length > 0) {
      setScreen({ kind: "questions" });
      return;
    }
    if (s.identity.method !== "NONE" && !s.identity.verified) {
      setScreen({ kind: "identity" });
      return;
    }
    setScreen({ kind: "checkout" });
  }, []);

  // Resuming after the magic link: the cookie now carries a verified session, so
  // the drawer opens already past the auth step.
  useEffect(() => {
    if (!autoOpen) return;
    (async () => {
      try {
        const s = await read();
        if (s) {
          apply(s);
          setOpen(true);
          return;
        }
      } catch {
        /* fall through to a fresh start */
      }
      void start();
    })();
    // Intentionally once per mount: this is a resume, not a watcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Countdown for the resend link.
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  async function answer(stepId: string, value: string) {
    setError("");
    const res = await fetch("/api/checkout", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "answer", stepId, value }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Could not save that answer.");
      return;
    }
    apply(body as State);
  }

  async function bindGoogleIdentity() {
    setError("");
    const res = await fetch("/api/checkout/identity", { method: "GET" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Sign-in did not complete.");
      return;
    }
    const s = await read();
    if (s) apply(s);
  }

  /**
   * Open the Google popup, then wait for the session to appear.
   *
   * Polling `/api/checkout/identity` beats trusting the popup's own message:
   * the cookie is the ground truth, so this also covers the case where the
   * popup is closed by the browser, by the buyer, or by a strict settings mode
   * that never shows it. Cancelling simply never yields a session, and the
   * drawer stays put with the option to try again.
   */
  function openGoogle() {
    setError("");
    setAuthBusy(true);
    const width = 520;
    const height = 640;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const popup = window.open(
      "/api/auth/signin/google?callbackUrl=%2Fauth%2Fpopup-complete",
      "morbin-google",
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
    popupRef.current = popup;
    if (!popup) {
      setAuthBusy(false);
      setError("Your browser blocked the sign-in window. Allow popups and try again.");
      return;
    }

    // Cancel path: the popup closing without a session is a normal outcome, not
    // an error. Stop polling and leave the button available.
    const watchClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(watchClosed);
        if (pollRef.current) clearInterval(pollRef.current);
        setAuthBusy(false);
      }
    }, 400);

    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      if (attempts > 150) {
        // ~3 minutes. The buyer simply never finished.
        clearInterval(pollRef.current!);
        setAuthBusy(false);
        return;
      }
      const res = await fetch("/api/checkout/identity", { cache: "no-store" });
      if (res.ok) {
        clearInterval(pollRef.current!);
        clearInterval(watchClosed);
        setAuthBusy(false);
        try {
          popup.close();
        } catch {
          /* already gone */
        }
        await bindGoogleIdentity();
      }
    }, 1200);
  }

  async function requestLink(address: string) {
    setError("");
    const res = await fetch("/api/checkout/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // With an ID-derived address the server decides where the link goes.
      body: JSON.stringify(address ? { email: address } : {}),
    });
    const body = await res.json().catch(() => ({}));
    // A test run confirms the address without sending anything.
    if (res.ok && body.testVerified) {
      const s = await read();
      if (s) apply(s);
      return;
    }
    // 202 either way: the response never reveals whether the address qualifies.
    if (res.status === 202) {
      setLinkSent(true);
      // The server deliberately does not say whether this address qualifies, and
      // does not echo a retry hint — so the countdown is ours, started here.
      setResendIn(RESEND_COOLDOWN_SECONDS);
      return;
    }
    setError(body.error ?? "Could not send the link.");
  }

  async function saveFields() {
    const res = await fetch("/api/checkout", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "customFields", customFields: fields }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Please check the highlighted fields.");
      return false;
    }
    setState(body as State);
    return true;
  }

  /**
   * Persist the cart alongside the answers.
   *
   * Saving on every stepper press rather than at checkout is what lets a refresh,
   * a second tab, or the magic-link hand-off preserve the selection. The stored
   * numbers are re-validated by the order route.
   */
  async function saveQty(next: Record<string, number>) {
    setQty(next);
    await fetch("/api/checkout", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "quantity", quantity: next }),
    });
  }

  const total = state
    ? state.offer.ticketTypes.reduce((s, t) => s + t.pricePaise * (qty[t.id] ?? 0), 0)
    : 0;
  const totalQty = Object.values(qty).reduce((s, n) => s + n, 0);
  const requiredFields = (state?.branding.customFields ?? []).filter((f) => f.required);

  /**
   * Create the order, then open Razorpay.
   *
   * The order comes from the stored session, so the browser sends no prices, no
   * ticket ids and no buyer details. A free order is already fulfilled by then
   * and skips Razorpay entirely.
   */
  async function pay() {
    setError("");
    setPaying(true);
    if (requiredFields.some((f) => !fields[f.id]?.trim())) {
      setError("Please fill in the required details.");
      setPaying(false);
      return;
    }
    if (!(await saveFields())) {
      setPaying(false);
      return;
    }
    try {
      const res = await fetch("/api/checkout/order", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not start the payment.");
        setPaying(false);
        return;
      }
      setOrderId(body.orderId);
      if (body.free) {
        setScreen({ kind: "done" });
        setPaying(false);
        return;
      }
      const checkout = await openRazorpay();
      if (!checkout) {
        setPaying(false);
        return;
      }
      setScreen({ kind: "done" });
    } catch {
      setError("Could not reach the payment step.");
      setPaying(false);
    }
  }

  /** Load checkout.js once and open the modal. Returns false if unavailable. */
  async function openRazorpay(): Promise<boolean> {
    if (typeof window === "undefined") return false;
    if (!window.Razorpay) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Could not load payment"));
        document.body.appendChild(script);
      }).catch(() => setError("Could not load the payment window."));
    }
    if (!window.Razorpay) return false;

    const res = await fetch("/api/checkout/payment", { cache: "no-store" });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "Could not start payment.");
      return false;
    }
    const p = await res.json();

    // Only context is passed. No theme, no brand colour — the checkout's
    // appearance is owned by the Razorpay dashboard.
    const rzp = new window.Razorpay({
      key: p.keyId,
      order_id: p.razorpayOrderId,
      amount: p.amountPaise,
      currency: p.currency,
      name: "Morbin",
      description: p.description,
      prefill: p.prefill,
      handler: () => {
        setPaying(false);
        setScreen({ kind: "done" });
        void pollPaid();
      },
      modal: {
        ondismiss: () => {
          // Cancelling is not a failure. The drawer stays exactly where it was so
          // the buyer can pay again, or re-authenticate as somebody else.
          setPaying(false);
          setError("");
          setPaymentCancelled(true);
        },
      },
    });
    rzp.open();
    return true;
  }

  /** The webhook is the source of truth; this only refreshes the receipt view. */
  async function pollPaid() {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const res = await fetch("/api/checkout/payment", {
        method: "PATCH",
        cache: "no-store",
      });
      if (!res.ok) continue;
      const body = await res.json();
      if (body.status === "PAID") {
        setPaid(true);
        return;
      }
    }
  }

  /**
   * Forget the verified identity and start the auth step again.
   *
   * Needed because a session cookie outlives a single purchase: without this, a
   * shared device would silently charge the second buyer to the first buyer's
   * email. The checkout session is dropped too, so the cart cannot leak across.
   */
  async function resetIdentity() {
    setError("");
    setPaymentCancelled(false);
    setPaid(false);
    setFields({});
    setQty({});
    await fetch("/api/checkout/identity", { method: "DELETE" });
    await fetch("/api/checkout", { method: "DELETE" });
    setState(null);
    await start();
  }

  if (!open) {
    return (
      <button
        onClick={start}
        className="w-full rounded-full px-6 py-4 text-sm font-bold text-white shadow-lg transition-transform active:scale-[0.99]"
        style={{ backgroundColor: accentColor }}
      >
        {ctaLabel}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        aria-label="Close"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Book tickets for ${title}`}
        className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b0b1c] p-6 shadow-2xl sm:rounded-3xl"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-bold tracking-tight">{title}</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
          >
            Close
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
            {error}
          </p>
        )}

        {screen.kind === "loading" && (
          <p className="mt-6 text-sm text-neutral-400">Opening…</p>
        )}

        {screen.kind === "questions" && state && (
          <QuestionScreen
            state={state}
            onAnswer={answer}
            busy={false}
          />
        )}

        {screen.kind === "identity" && state && (
          <IdentityScreen
            state={state}
            email={email}
            setEmail={setEmail}
            linkSent={linkSent}
            resendIn={resendIn}
            busy={authBusy}
            onGoogle={openGoogle}
            onRequestLink={requestLink}
            googleAvailable={state.identity.method === "GOOGLE"}
          />
        )}

        {screen.kind === "checkout" && state && (
          <>
            <QuantitySection
              state={state}
              qty={qty}
              onQty={(id, n) => void saveQty({ ...qty, [id]: n })}
              total={total}
              totalQty={totalQty}
            />
            <FieldsSection
              fields={state.branding.customFields}
              values={fields}
              setValues={setFields}
            />
            {paymentCancelled && (
              <div className="mt-4 rounded-xl border border-white/15 bg-white/5 p-4">
                <p className="text-sm text-neutral-300">Payment window closed.</p>
                <p className="mt-1 text-xs text-neutral-500">
                  Nothing was charged. You can pay again, or continue as a different person.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={pay}
                    disabled={paying}
                    className="rounded-full px-4 py-2 text-xs font-bold text-white disabled:opacity-50"
                    style={{ backgroundColor: accentColor }}
                  >
                    {paying ? "Opening…" : "Pay again"}
                  </button>
                  <button
                    onClick={resetIdentity}
                    className="rounded-full border border-white/15 px-4 py-2 text-xs font-semibold hover:bg-white/10"
                  >
                    Sign in as someone else
                  </button>
                </div>
              </div>
            )}

            {state.testRun ? (
              <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                <p className="font-semibold">This is where the buyer would pay</p>
                <p className="mt-1 text-amber-100/80">
                  {totalQty > 0 || state.offer.forcedItems
                    ? `They'd pay for ${state.offer.forcedItems ? 1 : totalQty} ticket${(state.offer.forcedItems ? 1 : totalQty) === 1 ? "" : "s"} and get them by email.`
                    : "They'd choose tickets here first."}{" "}
                  Test runs never create orders, hold seats or send email.
                </p>
              </div>
            ) : (
            <button
              onClick={pay}
              disabled={paying || totalQty === 0 || state.offer.soldOutForIdentity}
              className="mt-5 w-full rounded-full px-5 py-4 text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: accentColor }}
            >
              {state.offer.soldOutForIdentity
                ? "Not available for you"
                : paying
                  ? "Opening payment…"
                  : totalQty === 0
                    ? "Select tickets"
                    : `Continue to payment · ₹${(total / 100).toFixed(0)}`}
            </button>
            )}
          </>
        )}

        {screen.kind === "done" && (
          <SuccessPanel
            email={state?.identity.email ?? ""}
            slug={slug}
            paid={paid}
            onRetry={() => {
              setPaid(false);
              setPaymentCancelled(false);
              setScreen({ kind: "checkout" });
            }}
          />
        )}
      </div>
    </div>
  );
}

function QuestionScreen({
  state,
  onAnswer,
}: {
  state: State;
  onAnswer: (stepId: string, value: string) => void;
  busy: boolean;
}) {
  const nextStepId = state.offer.missingRequiredSteps[0];
  const step = state.flow.steps.find((s) => s.id === nextStepId);
  if (!step) return <p className="mt-6 text-sm text-neutral-400">Loading…</p>;
  if (step.kind === "LOOKUP") {
    return <LookupScreen key={step.id} state={state} step={step} onAnswer={onAnswer} />;
  }

  return (
    <div className="mt-5">
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
        Step {state.flow.steps.findIndex((s) => s.id === step.id) + 1}
      </p>
      <h3 className="mt-1.5 text-base font-semibold">{step.title}</h3>
      {step.description && (
        <p className="mt-1 text-sm text-neutral-400">{step.description}</p>
      )}
      <div className="mt-4 space-y-2">
        {(step.options ?? []).map((o) => (
          <button
            key={o.id}
            onClick={() => onAnswer(step.id, o.value)}
            className="flex w-full items-center justify-between rounded-xl border border-white/15 bg-white/5 px-4 py-3.5 text-left text-sm font-semibold hover:border-white/30"
          >
            {o.label}
            <span aria-hidden className="text-neutral-500">→</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Enter your roll number": checked on the server, which only ever says match or not. */
function LookupScreen({
  state,
  step,
  onAnswer,
}: {
  state: State;
  step: Step;
  onAnswer: (stepId: string, value: string) => Promise<void> | void;
}) {
  const [value, setValue] = useState(state.answers[step.id] ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim() || busy) return;
        setBusy(true);
        await onAnswer(step.id, value.trim());
        setBusy(false);
      }}
    >
      <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
        Step {state.flow.steps.findIndex((s) => s.id === step.id) + 1}
      </p>
      <label htmlFor={`lookup-${step.id}`} className="mt-1.5 block text-base font-semibold">
        {step.title}
      </label>
      {step.description && <p className="mt-1 text-sm text-neutral-400">{step.description}</p>}
      <input
        id={`lookup-${step.id}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={step.inputHint ?? undefined}
        autoComplete="off"
        maxLength={100}
        className="mt-4 w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-neutral-500"
      />
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="mt-3 w-full rounded-full bg-white px-5 py-3.5 text-sm font-bold text-neutral-950 disabled:opacity-50"
      >
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

function IdentityScreen({
  state,
  email,
  setEmail,
  linkSent,
  resendIn,
  busy,
  onGoogle,
  onRequestLink,
  googleAvailable,
}: {
  state: State;
  email: string;
  setEmail: (v: string) => void;
  linkSent: boolean;
  resendIn: number;
  busy: boolean;
  onGoogle: () => void;
  onRequestLink: (address: string) => void;
  googleAvailable: boolean;
}) {
  const wantsGoogle = state.identity.method === "GOOGLE";
  const derived = state.identity.lookupEmail;
  if (derived) {
    return (
      <div className="mt-5">
        <h3 className="text-base font-semibold">Confirm it&apos;s you</h3>
        <p className="mt-1 text-sm text-neutral-400">
          We&apos;ll send a one-time link to <span className="font-semibold text-white">{derived}</span>, the address
          on file for your ID. Your ticket goes there too.
        </p>
        <button
          onClick={() => onRequestLink("")}
          disabled={busy || resendIn > 0}
          className="mt-4 w-full rounded-full bg-white px-5 py-3.5 text-sm font-bold text-neutral-950 disabled:opacity-50"
        >
          {linkSent && resendIn > 0 ? `Resend in ${resendIn}s` : linkSent ? "Resend the link" : "Send me the link"}
        </button>
        {linkSent && (
          <p className="mt-3 text-center text-xs text-neutral-400">
            Check your inbox. The link works once and expires in 15 minutes.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="mt-5">
      <h3 className="text-base font-semibold">Confirm it&apos;s you</h3>
      <p className="mt-1 text-sm text-neutral-400">
        {wantsGoogle
          ? "Your ticket and QR code go to the email on your Google account."
          : "Use your college email address. We'll send a one-time link — your ticket goes there."}
      </p>

      {wantsGoogle ? (
        <>
          <button
            onClick={onGoogle}
            disabled={busy}
            className="mt-4 w-full rounded-full border border-white/15 bg-white/5 px-5 py-3.5 text-sm font-semibold hover:bg-white/10 disabled:opacity-60"
          >
            {busy ? "Waiting for Google…" : "Continue with Google"}
          </button>
          {busy && (
            <p className="mt-2 text-center text-xs text-neutral-500">
              Closed the window by mistake?{" "}
              <button onClick={onGoogle} className="underline">
                Try again
              </button>
            </p>
          )}
        </>
      ) : (
        <div className="mt-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@krmu.edu.in"
            autoComplete="email"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-neutral-500"
          />
          <button
            onClick={() => onRequestLink(email)}
            disabled={busy || !email.includes("@") || resendIn > 0}
            className="mt-3 w-full rounded-full bg-white px-5 py-3.5 text-sm font-bold text-neutral-950 disabled:opacity-50"
          >
            {linkSent && resendIn > 0 ? `Resend in ${resendIn}s` : "Send me a link"}
          </button>
          {linkSent && (
            <p className="mt-3 text-center text-xs text-neutral-400">
              Check your inbox. The link works once and expires in 15 minutes.
            </p>
          )}
        </div>
      )}
      {!wantsGoogle && googleAvailable && (
        <p className="mt-4 text-center text-xs text-neutral-500">
          Not a student? Close this and pick the other option.
        </p>
      )}
    </div>
  );
}

function QuantitySection({
  state,
  qty,
  onQty,
  total,
  totalQty,
}: {
  state: State;
  qty: Record<string, number>;
  onQty: (id: string, n: number) => void;
  total: number;
  totalQty: number;
}) {
  const forced = state.offer.forcedItems;
  if (!state.offer.quantityRequired && forced) {
    const type = state.offer.ticketTypes.find((t) => t.id === forced[0].ticketTypeId);
    return (
      <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="text-sm font-semibold">{type?.name ?? "Ticket"}</p>
        <p className="text-sm text-neutral-400">
          1 × ₹{((type?.pricePaise ?? 0) / 100).toFixed(0)}
        </p>
        <p className="mt-1 text-xs text-neutral-500">One ticket per verified account.</p>
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-3">
      {state.offer.ticketTypes.map((t) => {
        const n = qty[t.id] ?? 0;
        return (
          <div key={t.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">{t.name}</p>
              <p className="text-xs text-neutral-400">
                ₹{(t.pricePaise / 100).toFixed(0)} ·{" "}
                {t.left === 0 ? "Sold out" : `${t.left} left`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={n === 0}
                onClick={() => onQty(t.id, n - 1)}
                className="h-8 w-8 rounded-full border border-white/15 disabled:opacity-30"
                aria-label={`Remove one ${t.name}`}
              >
                −
              </button>
              <span className="w-6 text-center text-sm">{n}</span>
              <button
                disabled={n >= t.maxSelectable}
                onClick={() => onQty(t.id, n + 1)}
                className="h-8 w-8 rounded-full border border-white/15 disabled:opacity-30"
                aria-label={`Add one ${t.name}`}
              >
                +
              </button>
            </div>
          </div>
        );
      })}
      {totalQty > 0 && (
        <div className="flex items-center justify-between border-t border-white/10 pt-3 text-sm">
          <span className="text-neutral-400">
            {totalQty} ticket{totalQty > 1 ? "s" : ""}
          </span>
          <span className="font-bold">₹{(total / 100).toFixed(0)}</span>
        </div>
      )}
    </div>
  );
}

function FieldsSection({
  fields,
  values,
  setValues,
}: {
  fields: CustomField[];
  values: Record<string, string>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  if (fields.length === 0) return null;
  const input =
    "w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-neutral-500";
  return (
    <div className="mt-5 space-y-3">
      {fields.map((f) => (
        <div key={f.id}>
          <label className="text-xs text-neutral-400">
            {f.label}
            {f.required ? " *" : ""}
          </label>
          {f.type === "TEXTAREA" ? (
            <textarea
              rows={2}
              value={values[f.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
              placeholder={f.placeholder ?? undefined}
              className={`${input} mt-1`}
            />
          ) : f.type === "SELECT" ? (
            <select
              value={values[f.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
              className={`${input} mt-1`}
            >
              <option value="">Select…</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o} className="bg-[#0b0b1c]">
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type === "TEL" ? "tel" : f.type === "EMAIL" ? "email" : "text"}
              value={values[f.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
              placeholder={f.placeholder ?? undefined}
              className={`${input} mt-1`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function SuccessPanel({
  email,
  slug,
  paid,
  onRetry,
}: {
  email: string;
  slug: string;
  paid: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="mt-5 text-center">
      {paid ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-6">
          <p className="font-bold">Payment confirmed</p>
          <p className="mt-1 text-sm text-neutral-300">
            Your ticket{email ? ` is on its way to ${email}` : " is on its way"}.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-white/15 bg-white/5 p-6">
          <p className="font-bold">Waiting for your payment…</p>
          <p className="mt-1 text-sm text-neutral-300">
            This updates the moment Razorpay confirms. Your ticket goes to{" "}
            {email || "your email"} either way.
          </p>
        </div>
      )}
      <Link
        href={`/event/${slug}/tickets`}
        className="mt-4 inline-block text-sm underline"
      >
        View my tickets
      </Link>
      {!paid && (
        <button onClick={onRetry} className="mt-3 block w-full text-xs text-neutral-500 underline">
          Not working? Try paying again
        </button>
      )}
    </div>
  );
}
