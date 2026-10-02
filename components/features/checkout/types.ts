/**
 * What `/api/checkout` returns, as the drawer reads it. The server resolves
 * everything; these components only render it and post answers back.
 */

export interface OfferType {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  left: number;
  maxSelectable: number;
  quantityEditable: boolean;
}

export interface CheckoutStep {
  id: string;
  /** Unknown kinds render nothing and fall through — add a screen for a new kind in QuestionStep. */
  kind: "SINGLE_CHOICE" | "IDENTITY" | "QUANTITY" | "INFO" | "LOOKUP";
  title: string;
  description?: string | null;
  required?: boolean;
  options?: { id: string; label: string; value: string }[] | null;
  /** LOOKUP only. */
  inputHint?: string | null;
}

export interface CheckoutCustomField {
  id: string;
  label: string;
  type: "TEXT" | "TEL" | "EMAIL" | "TEXTAREA" | "SELECT" | "MULTI_SELECT";
  required: boolean;
  options?: string[] | null;
  placeholder?: string | null;
}

/** The `pricing` object from GET /api/checkout, computed by computePricing. */
export interface CheckoutPricing {
  feeBps: number;
  gstBps: number;
  bearer: "CUSTOMER" | "ORGANISER";
  gstLabel: string;
  quote: {
    ticketTotalPaise: number;
    feePaise: number;
    feeBasePaise: number;
    feeGstPaise: number;
    orderTotalPaise: number;
  };
}

export interface CheckoutState {
  event: { id: string; slug: string; title: string; venue: string; startsAt: string; endsAt: string; timezone: string };
  flow: { version: number; steps: CheckoutStep[] };
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
  };
  pricing: CheckoutPricing;
  branding: { accentColor: string; ctaLabel: string; customFields: CheckoutCustomField[] };
  /** DPDP notice; nothing personal is accepted by the server until consented. */
  privacy: {
    consented: boolean;
    noticeVersion: string;
    notice: { heading: string; body: string }[];
  };
  /** A builder test run: stop at the payment step. */
  testRun?: boolean;
}

export type CheckoutScreen = "loading" | "questions" | "identity" | "checkout" | "done";
