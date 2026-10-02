import Link from "next/link";
import { notFound } from "next/navigation";
import { listOrganizations, requireAdmin } from "@/lib/admin";
import { memberLabelPlural } from "@/lib/permissions";
import { Members } from "./members";

export const metadata = { title: "Organization" };

const card = "rounded-2xl border border-white/10 bg-white/5 p-4";

export default async function AdminOrgPage({ params }: { params: Promise<{ id: string }> }) {
  // Same belt-and-braces gate as the list page: the layout redirect is UX
  // only, so the data fetch itself is never reachable by a non-admin.
  await requireAdmin();
  const { id } = await params;

  const rows = await listOrganizations();
  const row = rows.find((r) => r.org.id === id);
  if (!row) notFound();
  const { org, owner, eventCount } = row;

  return (
    <div>
      <Link href="/dashboard/admin" className="text-sm text-neutral-400 hover:text-white">
        ← Organizations
      </Link>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {org.type} · {org.memberCount} {memberLabelPlural(org.type)} · {eventCount} event
            {eventCount === 1 ? "" : "s"} ·{" "}
            {org.orderCount} order{org.orderCount === 1 ? "" : "s"} on record
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              org.status === "SUSPENDED"
                ? "bg-rose-500/20 text-rose-300"
                : "bg-emerald-500/20 text-emerald-300"
            }`}
          >
            {org.status}
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-neutral-300">
            {org.paymentAccountStatus}
          </span>
        </div>
      </div>

      {org.status === "SUSPENDED" && (
        <p className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-200">
          This organization is suspended. It keeps every event, order and ticket, but cannot
          publish or take new orders. Restore it from the{" "}
          <Link href="/dashboard/admin" className="underline">
            organization list
          </Link>
          .
        </p>
      )}

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Detail label="Owner" value={owner?.email ?? "No owner on record"} />
        <Detail label="Type" value={org.type} hint={org.type === "INSTITUTION" ? "Members are Students" : "Members are Staff"} />
        <Detail label="Slug" value={org.slug} mono />
        <Detail
          label="Payouts"
          value={org.payoutsEnabled ? "Enabled" : "Disabled"}
          hint={org.payoutsEnabled ? undefined : "Only VERIFIED organizations can take money"}
        />
        <Detail
          label="Created"
          value={new Date(org.createdAt).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        />
      </div>

      <p className="mt-4 text-xs text-neutral-500">
        Rename, re-point the Razorpay account and change the approval status from the{" "}
        <Link href="/dashboard/admin" className="text-neutral-400 underline">
          organization list
        </Link>
        . Deletion is refused while orders or members exist — suspend instead.
      </p>

      <div className="mt-10">
        <Members organizationId={org.id} type={org.type} />
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div className={card}>
      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400">{label}</p>
      <p className={`mt-1.5 truncate text-sm ${mono ? "font-mono text-neutral-300" : "font-semibold"}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
