import type {
  CheckoutFlow,
  CheckoutIdentityMethod,
  FlowOption,
  FlowStep,
  Offer,
  OfferTicketType,
  TicketType,
} from "@/lib/types";

/**
 * The rules of a checkout flow, with no database and no request in sight.
 *
 * Split from `lib/flows.ts` so this half is importable from a plain Node script
 * (which cannot resolve the `@/` alias) and therefore directly testable. The
 * customer-facing path, the dashboard's builder preview and the order route all
 * resolve through this one implementation — that is the point of the split.
 */

/**
 * Ceiling on how many of ONE ticket type a single order may contain. Mirrors the
 * Zod bound in the order route so a flow can never promise more than checkout
 * will accept.
 */
export const MAX_PER_TYPE_PER_ORDER = 10;


/**
 * The flow a brand-new event gets: no questions, no identity requirement, seat
 * count editable. Exactly the pre-flow behaviour, which makes it both the safe
 * starting template and the correct fallback for an event with no published flow.
 */
export function permissiveFlow(eventId: string, version = 1): CheckoutFlow {
  const now = new Date();
  return {
    eventId,
    version,
    status: "PUBLISHED",
    steps: [
      { id: "step_quantity", kind: "QUANTITY", title: "How many tickets?", required: true },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

export function findStep(
  flow: CheckoutFlow,
  stepId: string | null | undefined,
): FlowStep | null {
  if (!stepId) return null;
  return flow.steps.find((s) => s.id === stepId) ?? null;
}

interface BranchPolicy {
  optionIds: string[];
  identity: {
    method: CheckoutIdentityMethod;
    emailDomain?: string | null;
    allowedEmailDomains?: string[] | null;
  } | null;
  allowedTicketTypeIds: string[] | null;
  maxPerOrder: number | null;
  capacity: number | null;
  quantityEditable: boolean | null;
  showFieldIds: string[] | null;
}

/** Every answered branching step, in step order. */
function answeredBranches(
  flow: CheckoutFlow,
  answers: Record<string, string>,
): { step: FlowStep; option: FlowOption }[] {
  const out: { step: FlowStep; option: FlowOption }[] = [];
  for (const step of flow.steps) {
    if (step.kind !== "SINGLE_CHOICE" || !step.options?.length) continue;
    const value = answers[step.id];
    if (!value) continue;
    const option = step.options.find((o) => o.value === value);
    if (option) out.push({ step, option });
  }
  return out;
}

/**
 * Fold every answered branch into one policy.
 *
 * Merge semantics are chosen so adding a question can only ever *narrow* what a
 * buyer may do, never widen it:
 *
 *   identity          later answer wins (an explicit override is deliberate)
 *   allowedTypes      intersected (a buyer must satisfy every restriction)
 *   maxPerOrder       minimum       (the tightest cap applies)
 *   capacity          minimum
 *   quantityEditable  logical AND   (one "no stepper" branch is enough to hide it)
 */
function resolveBranch(
  flow: CheckoutFlow,
  answers: Record<string, string>,
): BranchPolicy | null {
  const branches = answeredBranches(flow, answers);
  if (branches.length === 0) return null;

  const policy: BranchPolicy = {
    optionIds: [],
    identity: null,
    allowedTicketTypeIds: null,
    maxPerOrder: null,
    capacity: null,
    quantityEditable: null,
    showFieldIds: null,
  };

  for (const { option } of branches) {
    policy.optionIds.push(option.id);

    if (option.identity?.method) policy.identity = option.identity;

    if (Array.isArray(option.allowedTicketTypeIds)) {
      const next = option.allowedTicketTypeIds;
      policy.allowedTicketTypeIds =
        policy.allowedTicketTypeIds === null
          ? [...next]
          : policy.allowedTicketTypeIds.filter((id) => next.includes(id));
    }

    if (typeof option.maxPerOrder === "number") {
      policy.maxPerOrder =
        policy.maxPerOrder === null
          ? option.maxPerOrder
          : Math.min(policy.maxPerOrder, option.maxPerOrder);
    }

    if (typeof option.capacity === "number") {
      policy.capacity =
        policy.capacity === null ? option.capacity : Math.min(policy.capacity, option.capacity);
    }

    if (option.quantityEditable === false) policy.quantityEditable = false;

    if (Array.isArray(option.showFieldIds)) {
      const next = option.showFieldIds;
      policy.showFieldIds =
        policy.showFieldIds === null
          ? [...next]
          : policy.showFieldIds.filter((id) => next.includes(id));
    }
  }

  return policy;
}

/**
 * Does this address satisfy the branch's domain rule?
 *
 * Exact match on the registrable domain, never a suffix test: `krmu.edu.in` must
 * not accept `notkrmu.edu.in` or `krmu.edu.in.evil.com`.
 */
export function emailMatchesIdentity(
  identity: { emailDomain?: string | null; allowedEmailDomains?: string[] | null } | null,
  email: string,
): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return false;
  if (identity?.emailDomain) return domain === identity.emailDomain.toLowerCase();
  if (identity?.allowedEmailDomains?.length) {
    return identity.allowedEmailDomains.some(
      (d) => domain === d.toLowerCase().replace(/^@/, ""),
    );
  }
  return true;
}

export interface ResolveOfferInput {
  flow: CheckoutFlow;
  answers: Record<string, string>;
  identity: { method: CheckoutIdentityMethod; email: string | null; verified: boolean };
  ticketTypes: TicketType[];
  /**
   * Seats THIS identity already holds under this branch. Drives the per-order
   * cap ("one ticket per login").
   */
  claimedUnits?: number;
  /**
   * Seats EVERYONE has taken under this branch. Drives the branch's own seat
   * allowance ("300 student seats, then stop"). Distinct from `claimedUnits`:
   * conflating them would let one buyer exhaust the whole event.
   */
  branchClaimedUnits?: number;
  now?: Date;
}

/**
 * The one place that decides what a buyer may do next.
 *
 * Pure and total: it never throws and never reads a database, so the dashboard's
 * flow builder can call it to preview a journey and the checkout drawer can call
 * it to price a cart, from the same code. The customer-facing path is finished
 * here; the builder only ever changes `flow`.
 */
export function resolveOffer(input: ResolveOfferInput): Offer {
  const { flow, answers, identity, ticketTypes } = input;
  const now = input.now ?? new Date();

  const missingRequiredSteps = flow.steps
    .filter((s) => s.required)
    .filter((s) => {
      // IDENTITY and QUANTITY are not questions: they are consequences of the
      // branch already chosen, so they can never be "unanswered".
      if (s.kind === "IDENTITY" || s.kind === "QUANTITY") return false;
      return !answers[s.id];
    })
    .map((s) => s.id);

  const policy = resolveBranch(flow, answers);
  const method = policy?.identity?.method ?? identity.method;

  // Which types this audience is allowed to see at all.
  let candidates = ticketTypes;
  if (policy?.allowedTicketTypeIds) {
    candidates = candidates.filter((t) =>
      policy.allowedTicketTypeIds!.includes(t._id!.toString()),
    );
  }
  if (policy?.optionIds.length) {
    // A type may name the audiences it sells to. An absent list means everyone.
    candidates = candidates.filter(
      (t) =>
        !t.audienceOptionIds?.length ||
        t.audienceOptionIds.some((id) => policy.optionIds.includes(id)),
    );
  }

  // …and which of those are actually purchasable right now.
  const sellable = candidates.filter((t) => {
    if (t.status === "PAUSED" || t.status === "HIDDEN") return false;
    if (t.saleStartsAt && t.saleStartsAt > now) return false;
    if (t.saleEndsAt && t.saleEndsAt < now) return false;
    return true;
  });

  const quantityEditable = policy?.quantityEditable !== false;
  const branchCap = policy?.maxPerOrder ?? null;
  const typeCap = (t: TicketType) =>
    typeof t.defaultMaxPerOrder === "number" ? t.defaultMaxPerOrder : MAX_PER_TYPE_PER_ORDER;

  const offers: OfferTicketType[] = sellable.map((t) => {
    const left = Math.max(0, t.capacity - t.soldCount);
    const caps = [left, MAX_PER_TYPE_PER_ORDER, typeCap(t)];
    if (branchCap !== null) caps.push(branchCap);
    return {
      id: t._id!.toString(),
      name: t.name,
      description: t.description,
      pricePaise: t.pricePaise,
      left,
      quantityEditable,
      maxSelectable: Math.max(0, Math.min(...caps)),
    };
  });

  // Two independent allowances, drawn from two different populations.
  const perOrderRemaining =
    branchCap === null ? null : Math.max(0, branchCap - (input.claimedUnits ?? 0));
  const branchRemaining =
    policy?.capacity == null
      ? null
      : Math.max(0, policy.capacity - (input.branchClaimedUnits ?? 0));

  const capped = offers.map((o) => {
    const limits = [o.maxSelectable];
    if (perOrderRemaining !== null) limits.push(perOrderRemaining);
    return { ...o, maxSelectable: Math.max(0, Math.min(...limits)) };
  });

  // Nothing this audience may buy, either because its seats ran out or because
  // the identity has spent its allowance.
  const buyable = capped.find((o) => o.maxSelectable > 0) ?? null;
  const soldOutForIdentity =
    buyable === null || perOrderRemaining === 0 || branchRemaining === 0;

  // With the stepper hidden, the contents are already decided: exactly one ticket
  // from the first thing this audience is allowed to buy.
  //
  // Gated on `soldOutForIdentity` and not merely on `buyable`, because the two
  // allowances are independent. With the branch's seats exhausted but this
  // identity's own allowance untouched, a type can still look buyable — and
  // emitting a forced item there would let a buyer manufacture an order past the
  // cap. The order route re-checks, but the offer must not advertise it.
  const forcedItems =
    quantityEditable || soldOutForIdentity || !buyable
      ? null
      : [{ ticketTypeId: buyable.id, quantity: 1 }];


  const chosen = answeredBranches(flow, answers).at(-1) ?? null;

  return {
    branch: chosen
      ? {
          stepId: chosen.step.id,
          optionId: chosen.option.id,
          value: chosen.option.value,
          label: chosen.option.label,
        }
      : null,
    identity: { method, email: identity.email, verified: identity.verified },
    ticketTypes: capped,
    quantityRequired: quantityEditable,
    forcedItems,
    soldOutForIdentity,
    missingRequiredSteps,
  };
}

/** Which optional custom fields this branch should render. */
export function visibleFieldIds(
  flow: CheckoutFlow,
  answers: Record<string, string>,
  allFieldIds: string[],
): string[] {
  const policy = resolveBranch(flow, answers);
  if (!policy?.showFieldIds) return allFieldIds;
  return policy.showFieldIds;
}
