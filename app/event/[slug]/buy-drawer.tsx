"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { DetailsFields, TicketPicker } from "@/components/features/checkout/ticket-picker";
import { DoneStep } from "@/components/features/checkout/done-step";
import { IdentityStep } from "@/components/features/checkout/identity-step";
import { PaymentStep } from "@/components/features/checkout/payment-step";
import { QuestionStep } from "@/components/features/checkout/question-step";
import type { CheckoutScreen, CheckoutState } from "@/components/features/checkout/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * The booking drawer: orchestration only.
 *
 * Every screen is a function of one server payload (`/api/checkout`). The
 * client decides *nothing* about what a buyer may do — no step is revealed
 * locally, no cap is enforced here, no audience is inferred. It renders what
 * the server resolved and posts answers back, which keeps the rules in one
 * place (`lib/flow-rules.ts`). The screens live in components/features/checkout.
 *
 * The Google sign-in is a popup on purpose: this tab keeps its funnel state, so
 * returning from the popup resumes the drawer at the right step rather than
 * reloading the event page and losing the buyer's answers.
 */

/**
 * How long the resend button stays disabled.
 *
 * Mirrors RESEND_COOLDOWN_MS in lib/checkout. It is duplicated rather than
 * imported because the response cannot carry it: telling the client "you may
 * re-send in N seconds" would distinguish an eligible address from an
 * ineligible one, which is exactly the signal the uniform response hides.
 */
const RESEND_COOLDOWN_SECONDS = 45;

const SCREEN_TITLES: Record<CheckoutScreen, string> = {
  loading: "Opening checkout",
  questions: "A quick question",
  identity: "Confirm it's you",
  checkout: "Your tickets",
  done: "Booking complete",
};

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

/** The screen for a resolved state: questions, then identity, then checkout — never backwards. */
function screenFor(s: CheckoutState): CheckoutScreen {
  if (s.offer.missingRequiredSteps.length > 0) return "questions";
  if (s.identity.method !== "NONE" && !s.identity.verified) return "identity";
  return "checkout";
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
  trigger,
}: {
  eventId: string;
  slug: string;
  title: string;
  accentColor?: string;
  ctaLabel: string;
  utm?: { source?: string; medium?: string; campaign?: string } | null;
  autoOpen?: boolean;
  /** Signed by "Run through checkout as a buyer"; opens a test-mode checkout with the draft rules. */
  testToken?: string | null;
  /** Custom call to action (e.g. the event page's Book-now button). Defaults to a solid accent button. */
  trigger?: (props: { onClick: () => void; label: string }) => React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(autoOpen);
  const [state, setState] = useState<CheckoutState | null>(null);
  const [screen, setScreen] = useState<CheckoutScreen>("loading");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [paymentCancelled, setPaymentCancelled] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  /** Where tickets go when the buyer's group verifies nobody (identity NONE). */
  const [contact, setContact] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function apply(s: CheckoutState) {
    setState(s);
    setScreen(screenFor(s));
  }

  async function read(): Promise<CheckoutState | null> {
    const res = await fetch("/api/checkout", { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error("Could not start checkout");
    return (await res.json()) as CheckoutState;
  }

  async function start() {
    setScreen("loading");
    setError("");
    setOpen(true);
    try {
      const res = await fetch("/api/checkout", {
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
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not start checkout.");
        return;
      }
      apply(body as CheckoutState);
    } catch {
      setError("Something went wrong. Please try again.");
    }
  }

  // Resuming after the magic link: the cookie now carries a verified session,
  // so the drawer opens already past the identity step.
  const resume = useEffectEvent(async () => {
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
  });
  useEffect(() => {
    if (!autoOpen) return;
    // A callback rather than a direct call: React's dev double-run of effects
    // clears the first timer, so the session is read once.
    const t = setTimeout(() => void resume(), 0);
    return () => clearTimeout(t);
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

  async function patch(body: Record<string, unknown>): Promise<CheckoutState | null> {
    const res = await fetch("/api/checkout", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Something went wrong. Please try again.");
      return null;
    }
    return data as CheckoutState;
  }

  async function answer(stepId: string, value: string) {
    setError("");
    const s = await patch({ action: "answer", stepId, value });
    if (s) apply(s);
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
   * that never shows it. Cancelling simply never yields a session.
   */
  function openGoogle() {
    setError("");
    setGoogleBusy(true);
    const width = 520;
    const height = 640;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const popup = window.open(
      "/api/auth/signin/google?callbackUrl=%2Fauth%2Fpopup-complete",
      "morbin-google",
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
    if (!popup) {
      setGoogleBusy(false);
      setError("Your browser blocked the sign-in window. Allow popups and try again.");
      return;
    }
    // Cancel path: the popup closing without a session is a normal outcome.
    const watchClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(watchClosed);
        if (pollRef.current) clearInterval(pollRef.current);
        setGoogleBusy(false);
      }
    }, 400);
    let attempts = 0;
    pollRef.current = setInterval(async () => {
      attempts += 1;
      if (attempts > 150) {
        // ~3 minutes. The buyer simply never finished.
        clearInterval(pollRef.current!);
        setGoogleBusy(false);
        return;
      }
      const res = await fetch("/api/checkout/identity", { cache: "no-store" });
      if (res.ok) {
        clearInterval(pollRef.current!);
        clearInterval(watchClosed);
        setGoogleBusy(false);
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
      // The countdown is ours, started here: the server deliberately sends none.
      setResendIn(RESEND_COOLDOWN_SECONDS);
      return;
    }
    setError(body.error ?? "Could not send the link.");
  }

  /**
   * Persist the cart and refresh the priced state.
   *
   * Saving on every stepper press lets a refresh, a second tab, or the
   * magic-link hand-off preserve the selection; the returned state carries the
   * server's price breakdown for exactly this cart. The order route re-checks.
   */
  async function changeQty(ticketTypeId: string, n: number) {
    const next = { ...qty, [ticketTypeId]: n };
    setQty(next);
    const s = await patch({ action: "quantity", quantity: next });
    if (s) setState(s);
  }

  async function saveFields(): Promise<boolean> {
    const s = await patch({ action: "customFields", customFields: fields });
    if (!s) return false;
    setState(s);
    return true;
  }

  const hasItems = !!state && (!!state.offer.forcedItems || Object.values(qty).some((n) => n > 0));

  /**
   * Create the order, then open Razorpay. The order comes from the stored
   * session, so the browser sends no prices, ticket ids or buyer details. A
   * free order is already fulfilled by then and skips Razorpay entirely.
   */
  async function pay() {
    setError("");
    setPaying(true);
    const missing = (state?.branding.customFields ?? []).filter((f) => f.required && !fields[f.id]?.trim());
    if (missing.length) {
      setError(`Please fill in: ${missing.map((f) => f.label).join(", ")}.`);
      setPaying(false);
      return;
    }
    if (state?.identity.method === "NONE" && !state.identity.verified) {
      if (!contact.includes("@")) {
        setError("Enter the email address your tickets should go to.");
        setPaying(false);
        return;
      }
      if (!(await patch({ action: "contact", email: contact }))) {
        setPaying(false);
        return;
      }
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
        setConfirmed(true);
        setScreen("done");
        setPaying(false);
        return;
      }
      if (!(await openRazorpay())) setPaying(false);
    } catch {
      setError("Could not reach the payment step.");
      setPaying(false);
    }
  }

  /** Load checkout.js once and open the modal. Returns false if unavailable. */
  async function openRazorpay(): Promise<boolean> {
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
    // Only context is passed; the checkout's look is owned by the Razorpay dashboard.
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
        setScreen("done");
        void pollPaid();
      },
      modal: {
        ondismiss: () => {
          // Cancelling is not a failure: the drawer stays where it was.
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
      const res = await fetch("/api/checkout/payment", { method: "PATCH", cache: "no-store" });
      if (!res.ok) continue;
      const body = await res.json();
      if (body.status === "PAID") {
        setConfirmed(true);
        return;
      }
    }
  }

  /**
   * Forget the verified identity and start again. A session cookie outlives a
   * single purchase: without this, a shared device would silently book the
   * second buyer under the first buyer's email.
   */
  async function resetIdentity() {
    setError("");
    setPaymentCancelled(false);
    setConfirmed(false);
    setFields({});
    setQty({});
    setLinkSent(false);
    await fetch("/api/checkout/identity", { method: "DELETE" });
    await fetch("/api/checkout", { method: "DELETE" });
    setState(null);
    await start();
  }

  const label = ctaLabel || "Book now";

  return (
    <>
      {trigger ? (
        trigger({ onClick: () => void start(), label })
      ) : (
        <Button
          size="lg"
          className="h-12 w-full rounded-full text-base font-semibold text-white"
          style={{ backgroundColor: accentColor }}
          onClick={() => void start()}
        >
          {label}
        </Button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className="max-h-[92dvh] gap-0 overflow-y-auto data-[side=bottom]:rounded-t-2xl data-[side=right]:max-h-none data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <SheetHeader className="border-b">
            <SheetTitle className="pr-8">{title}</SheetTitle>
            <SheetDescription>{SCREEN_TITLES[screen]}</SheetDescription>
          </SheetHeader>
          {/* Screen readers hear each step change, not just sighted buyers. */}
          <p className="sr-only" aria-live="polite">
            {SCREEN_TITLES[screen]}
          </p>

          <div className="space-y-5 p-4">
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {screen === "loading" && !error && (
              <div className="space-y-3" aria-busy>
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            )}

            {screen === "questions" && state && <QuestionStep state={state} onAnswer={answer} />}

            {screen === "identity" && state && (
              <IdentityStep
                state={state}
                googleBusy={googleBusy}
                linkSent={linkSent}
                resendIn={resendIn}
                onGoogle={openGoogle}
                onRequestLink={requestLink}
              />
            )}

            {screen === "checkout" && state && (
              <>
                <TicketPicker state={state} qty={qty} onQty={(id, n) => void changeQty(id, n)} />
                {state.identity.method === "NONE" && !state.identity.verified && (
                  <Field>
                    <FieldLabel htmlFor="checkout-contact">Email for your tickets</FieldLabel>
                    <Input
                      id="checkout-contact"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      placeholder="you@example.com"
                      required
                    />
                    <FieldDescription>Your tickets and receipt are emailed here.</FieldDescription>
                  </Field>
                )}
                {state.branding.customFields.length > 0 && (
                  <>
                    <Separator />
                    <DetailsFields
                      fields={state.branding.customFields}
                      values={fields}
                      onChange={(id, value) => setFields((v) => ({ ...v, [id]: value }))}
                    />
                  </>
                )}
                <Separator />
                <PaymentStep
                  state={state}
                  hasItems={hasItems}
                  paying={paying}
                  cancelled={paymentCancelled}
                  onPay={() => void pay()}
                  onSwitchPerson={() => void resetIdentity()}
                  accentColor={accentColor}
                />
              </>
            )}

            {screen === "done" && (
              <DoneStep
                email={state?.identity.email ?? ""}
                slug={slug}
                orderId={orderId}
                confirmed={confirmed}
                onRetry={() => {
                  setConfirmed(false);
                  setPaymentCancelled(false);
                  setScreen("checkout");
                }}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
