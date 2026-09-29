import Link from "next/link";

const guides = [
  {
    slug: "getting-started",
    title: "Getting started",
    blurb: "How an event goes from a draft to tickets in buyers' inboxes.",
  },
  {
    slug: "creating-events",
    title: "Creating events",
    blurb: "Drafts, publishing rules, and what each event field controls.",
  },
  {
    slug: "ticket-types",
    title: "Ticket types",
    blurb: "Pricing, capacity, sale windows, and how inventory is held.",
  },
  {
    slug: "payments",
    title: "Payments & payouts",
    blurb: "Platform fees, Razorpay settlement, and refunds.",
  },
  {
    slug: "check-in",
    title: "Check-in",
    blurb: "Scanning tickets at the door and resolving duplicate scans.",
  },
  {
    slug: "tickets",
    title: "Finding tickets",
    blurb: "How buyers retrieve their tickets without an account.",
  },
];

export const metadata = {
  title: "Documentation",
  description: "Guides for organizers running events on Morbin.",
};

export default function DocsIndexPage() {
  return (
    <div className="min-h-screen bg-[#060614] font-sans text-neutral-300 antialiased">
      <div className="mx-auto max-w-3xl px-6 py-14 sm:px-10">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight text-white">
          morbin
        </Link>
        <h1 className="mt-10 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Documentation
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed">
          Everything you need to run an event on Morbin — from your first draft through
          check-in and payout.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {guides.map((g) => (
            <Link
              key={g.slug}
              href={`/docs/${g.slug}`}
              className="rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-white/25"
            >
              <h2 className="font-semibold text-white">{g.title}</h2>
              <p className="mt-1 text-sm text-neutral-400">{g.blurb}</p>
            </Link>
          ))}
        </div>

        <div className="mt-12 border-t border-white/10 pt-6 text-xs text-neutral-500">
          <Link href="/" className="mr-5 transition-colors hover:text-neutral-300">Home</Link>
          <Link href="/legal/privacy" className="mr-5 transition-colors hover:text-neutral-300">
            Privacy Policy
          </Link>
          <Link href="/legal/terms" className="transition-colors hover:text-neutral-300">
            Terms &amp; Conditions
          </Link>
        </div>
      </div>
    </div>
  );
}
