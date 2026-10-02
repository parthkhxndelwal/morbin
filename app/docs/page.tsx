import Link from "next/link";
import { LegalFooter } from "@/components/legal-footer";

const guides = [
  {
    slug: "getting-started",
    title: "Getting started",
    blurb: "How an event goes from a draft to tickets in buyers' inboxes.",
  },
  {
    slug: "roles",
    title: "Roles and access",
    blurb: "Who can create events, who can run the door, and how members are labelled.",
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
    <>
      <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
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

      <div className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-5">
        <h2 className="font-semibold text-white">Not on Morbin yet?</h2>
        <p className="mt-1 text-sm text-neutral-400">
          Apply to sell tickets for your organisation. A person reviews every application.
        </p>
        <Link href="/apply" className="mt-3 inline-block text-sm font-semibold text-white underline underline-offset-4">
          List your event
        </Link>
      </div>

      <LegalFooter
        links={[
          { href: "/", label: "Home" },
          { href: "/apply", label: "List your event" },
          { href: "/legal/privacy", label: "Privacy Policy" },
          { href: "/legal/terms", label: "Terms & Conditions" },
        ]}
      />
    </>
  );
}
