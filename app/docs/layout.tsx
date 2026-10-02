import Link from "next/link";
import { Logo } from "@/components/logo";

const guides = [
  { slug: "getting-started", title: "Getting started" },
  { slug: "roles", title: "Roles and access" },
  { slug: "creating-events", title: "Creating events" },
  { slug: "ticket-types", title: "Ticket types" },
  { slug: "payments", title: "Payments & payouts" },
  { slug: "check-in", title: "Check-in" },
  { slug: "tickets", title: "Finding tickets" },
];

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#060614] font-sans text-neutral-300 antialiased">
      <div className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-14 sm:px-10 lg:flex-row">
        <aside className="lg:w-56 lg:shrink-0">
          <Logo height={24} />
          <p className="mt-1 text-xs uppercase tracking-widest text-neutral-500">Docs</p>
          <nav className="mt-6 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {guides.map((g) => (
              <Link
                key={g.slug}
                href={`/docs/${g.slug}`}
                className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                {g.title}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
