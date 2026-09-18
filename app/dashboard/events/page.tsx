import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOrgEvents } from "@/lib/events";
import { getOrgByOwner } from "@/lib/organizations";
import { NewEventForm } from "./new-event-form";

export default async function EventsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getOrgByOwner(session.user.id);
  if (!org || !org._id) redirect("/onboarding");
  const events = await getOrgEvents(org._id.toString());

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Events</h1>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
            New event
          </h2>
          <NewEventForm />
        </div>
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-neutral-400">
            Your events
          </h2>
          <div className="space-y-3">
            {events.map((e) => (
              <Link
                key={e._id!.toString()}
                href={`/dashboard/events/${e._id!.toString()}`}
                className="block rounded-2xl border border-white/10 bg-white/5 p-4 hover:border-white/25"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold">{e.title}</p>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      e.status === "PUBLISHED"
                        ? "bg-emerald-500/20 text-emerald-300"
                        : e.status === "CANCELLED"
                          ? "bg-rose-500/20 text-rose-300"
                          : "bg-white/10 text-neutral-300"
                    }`}
                  >
                    {e.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-400">
                  {e.venue} · {new Date(e.startsAt).toLocaleDateString("en-IN")}
                </p>
              </Link>
            ))}
            {events.length === 0 && (
              <p className="rounded-2xl border border-white/10 p-6 text-center text-sm text-neutral-500">
                No events yet — create your first draft.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
