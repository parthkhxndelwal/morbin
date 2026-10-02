"use client";

import { CheckCircle2Icon } from "lucide-react";
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
import { cn } from "@/lib/utils";

/**
 * The booking sheet: orchestration only.
 *
 * Every screen is a function of one server payload (`/api/checkout`). The
 * client decides *nothing* about what a buyer may do — no step is revealed
 * locally, no cap is enforced here, no audience is inferred. It renders what
 * the server resolved and posts answers back, which keeps the rules in one
 * place (`lib/flow-rules.ts`). The screens live in components/features/checkout.
 *
 * It is built to feel like one short, continuous motion: a progress header,
 * screens that slide into each other, email confirmed by a code typed right
 * here (or the emailed link, noticed automatically), a single ticket
 * pre-selected, the pay button pinned within reach, and the ticket itself
 * shown at the end.
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

/** The journey this buyer actually takes, for the progress header. */
function stagesFor(s: CheckoutState | null): { id: CheckoutScreen; label: string }[] {
  const stages: { id: CheckoutScreen; label: string }[] = [];
  if (s?.flow.steps.some((x) => x.kind === "SINGLE_CHOICE" || x.kind === "LOOKUP")) stages.push({ id: "questions", label: "Details" });
  if (s && s.identity.method !== "NONE") stages.push({ id: "identity", label: "Verify" });
  stages.push({ id: "checkout", label: "Tickets" }, { id: "done", label: "Done" });
  return stages;
}

export function BuyDrawer({
  eventId,
  title,
  accentColor = "#7c3aed",
  ctaLabel,
  utm,
  autoOpen = false,
  autoStart = false,
  testToken = null,
  trigger,
}: {
  eventId: string;
  /** The event's slug (links on the done screen come from the server's state). */
  slug: string;
  title: string;
  accentColor?: string;
  ctaLabel: string;
  utm?: { source?: string; medium?: string; campaign?: string } | null;
  /** Resume a session from the cookie (back from an emailed link). */
  autoOpen?: boolean;
  /** Open and start checkout on mount — the caller loaded this on a click. */
  autoStart?: boolean;
  /** Signed by "Run through checkout as a buyer"; opens a test-mode checkout with the draft rules. */
  testToken?: string | null;
  /** Custom call to action (e.g. the event page's Book-now dock). Defaults to a solid accent button. */
  trigger?: (props: { onClick: () => void; label: string }) => React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(autoOpen || autoStart);
  const [state, setState] = useState<CheckoutState | null>(null);
  const [screen, setScreen] = useState<CheckoutScreen>("loading");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [paying, setPaying] = useState(false);
  const [paymentCancelled, setPaymentCancelled] = useState(false);
  /** Where tickets go when the buyer's group verifies nobody (identity NONE). */
  const [contact, setContact] = useState("");

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function apply(s: CheckoutState) {
    setState(s);
    setScreen(screenFor(s));
    setError("");
    // One thing to buy, and the stepper is the buyer's: start them at 1.
    const buyable = s.offer.ticketTypes.filter((t) => t.maxSelectable > 0);
    if (screenFor(s) === "checkout" && !s.offer.forcedItems && buyable.length === 1) {
      setQty((q) => (Object.values(q).some((n) => n > 0) ? q : { [buyable[0].id]: 1 }));
      void fetch("/api/checkout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "quantity", quantity: { [buyable[0].id]: 1 } }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((next) => next && setState(next));
    }
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

  // Resume after an emailed link, or start straight away when the page loaded
  // this component on a click. A timer, so React's dev double-run reads once.
  const boot = useEffectEvent(async () => {
    if (autoOpen) {
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
    }
    void start();
  });
  useEffect(() => {
    if (!autoOpen && !autoStart) return;
    const t = setTimeout(() => void boot(), 0);
    return () => clearTimeout(t);
  }, [autoOpen, autoStart]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Countdown for "send a new code".
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // While waiting for a code, notice a tap on the emailed link in another tab.
  const checkVerified = useEffectEvent(async () => {
    const s = await read().catch(() => null);
    if (s?.identity.verified) {
      setSentTo(null);
      apply(s);
    }
  });
  useEffect(() => {
    if (!open || screen !== "identity" || !sentTo) return;
    const t = setInterval(() => void checkVerified(), 3000);
    return () => clearInterval(t);
  }, [open, screen, sentTo]);

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
   * Open the Google popup, then wait for the session to appear. Polling the
   * cookie-backed identity route covers a popup closed by the buyer, the
   * browser, or a strict settings mode; cancelling simply never yields one.
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

  /** Email a code (and link). A test run confirms straight away and sends nothing. */
  async function sendCode(address: string) {
    setError("");
    const res = await fetch("/api/checkout/magic-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(address ? { email: address } : {}),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.testVerified) {
      const s = await read();
      if (s) apply(s);
      return;
    }
    // 202 either way: the response never reveals whether the address qualifies.
    if (res.status === 202) {
      setSentTo(address || state?.identity.lookupEmail || "your email");
      setResendIn(RESEND_COOLDOWN_SECONDS);
      return;
    }
    setError(body.error ?? "Could not send the code.");
  }

  async function verifyCode(code: string): Promise<boolean> {
    setError("");
    const res = await fetch("/api/checkout/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "That code didn't work.");
      if (body.reason === "attempts" || body.reason === "expired") setResendIn(0);
      return false;
    }
    const s = await read();
    if (s) {
      setSentTo(null);
      apply(s);
    }
    return true;
  }

  /**
   * Persist the cart and refresh the priced state: the returned state carries
   * the server's price breakdown for exactly this cart. The order route re-checks.
   */
  async function changeQty(ticketTypeId: string, n: number) {
    const next = { ...qty, [ticketTypeId]: n };
    setQty(next);
    const s = await patch({ action: "quantity", quantity: next });
    if (s) setState(s);
  }

  async function saveFields(): Promise<boolean> {
    if ((state?.branding.customFields.length ?? 0) === 0) return true;
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
      if (body.free) {
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
      },
      modal: {
        ondismiss: () => {
          // Cancelling is not a failure: the sheet stays where it was.
          setPaying(false);
          setError("");
          setPaymentCancelled(true);
        },
      },
    });
    rzp.open();
    return true;
  }

  /**
   * Forget the answers and identity and start again ("Change"). A session
   * cookie outlives a purchase, so this is also how a shared device switches
   * buyer without booking under the previous person's email.
   */
  async function restart() {
    setError("");
    setPaymentCancelled(false);
    setFields({});
    setQty({});
    setSentTo(null);
    setContact("");
    await fetch("/api/checkout/identity", { method: "DELETE" });
    await fetch("/api/checkout", { method: "DELETE" });
    setState(null);
    await start();
  }

  const label = ctaLabel || "Book now";
  const stages = stagesFor(state);
  const current = stages.findIndex((s) => s.id === screen);
  const branchLabel =
    state?.branch &&
    state.flow.steps.find((s) => s.id === state.branch!.stepId)?.options?.find((o) => o.value === state.branch!.value)?.label;

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
          className="max-h-[94dvh] gap-0 overflow-y-auto data-[side=bottom]:rounded-t-3xl data-[side=right]:max-h-none data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        >
          <SheetHeader className="gap-3 pb-3">
            {isMobile && <div aria-hidden className="mx-auto -mt-1 mb-1 h-1 w-10 rounded-full bg-muted-foreground/30" />}
            <SheetTitle className="pr-8 text-lg">{title}</SheetTitle>
            <SheetDescription className="sr-only">Book tickets in a few steps</SheetDescription>
            {/* Where you are, and how little is left. */}
            <ol className="flex gap-1.5" aria-label="Booking progress">
              {stages.map((s, i) => (
                <li key={s.id} className="flex-1 space-y-1" aria-current={i === current ? "step" : undefined}>
                  <div
                    className={cn(
                      "h-1 rounded-full transition-colors duration-300",
                      i <= current ? "bg-primary" : "bg-muted",
                    )}
                    style={i <= current ? { backgroundColor: accentColor } : undefined}
                  />
                  <p className={cn("text-[11px]", i === current ? "font-medium text-foreground" : "text-muted-foreground")}>
                    {s.label}
                  </p>
                </li>
              ))}
            </ol>
          </SheetHeader>
          {/* Screen readers hear each step change, not just sighted buyers. */}
          <p className="sr-only" aria-live="polite">
            {current >= 0 ? `Step ${current + 1} of ${stages.length}: ${stages[current].label}` : "Loading"}
          </p>

          <div
            key={`${screen}:${state?.offer.missingRequiredSteps[0] ?? ""}`}
            className="space-y-5 p-4 pt-1 animate-in fade-in slide-in-from-right-3 duration-300 motion-reduce:animate-none"
          >
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {screen === "loading" && !error && (
              <div className="space-y-3" aria-busy>
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {screen === "questions" && state && <QuestionStep state={state} onAnswer={answer} />}

            {screen === "identity" && state && (
              <IdentityStep
                state={state}
                googleBusy={googleBusy}
                sentTo={sentTo}
                resendIn={resendIn}
                onGoogle={openGoogle}
                onSend={sendCode}
                onCode={verifyCode}
              />
            )}

            {screen === "checkout" && state && (
              <>
                {(branchLabel || state.identity.verified) && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                    <p className="flex min-w-0 items-center gap-2">
                      <CheckCircle2Icon className="size-4 shrink-0 text-primary" style={{ color: accentColor }} />
                      <span className="truncate">
                        {[branchLabel, state.identity.verified ? state.identity.email : null].filter(Boolean).join(" · ")}
                      </span>
                    </p>
                    <button type="button" onClick={() => void restart()} className="shrink-0 text-xs underline underline-offset-4">
                      Change
                    </button>
                  </div>
                )}
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
                      className="h-11"
                      required
                    />
                    <FieldDescription>Your tickets are shown here and emailed to this address.</FieldDescription>
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
                  onSwitchPerson={() => void restart()}
                  accentColor={accentColor}
                />
              </>
            )}

            {screen === "done" && state && (
              <DoneStep
                state={state}
                email={state.identity.email ?? contact}
                onRetry={() => {
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
