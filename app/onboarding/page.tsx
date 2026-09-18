import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getOrgByOwner } from "@/lib/organizations";
import { OnboardingActions, OrgForm } from "./actions";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getOrgByOwner(session.user.id);

  const steps = [
    { label: "Account created", done: true },
    { label: "Organization profile", done: !!org },
    {
      label: "Razorpay verification submitted",
      done: !!org?.razorpayAccountId,
    },
    { label: "Organizer approved", done: org?.paymentAccountStatus === "VERIFIED" },
    { label: "Create your first event", done: false },
  ];

  return (
    <div className="min-h-dvh bg-[#060614] px-6 py-12 font-sans text-white antialiased">
      <div className="mx-auto w-full max-w-xl">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight">
          morbin
        </Link>
        <h1 className="mt-8 text-2xl font-bold tracking-tight">Organizer onboarding</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Signed in as {session.user.email}. Complete these steps to start selling tickets.
        </p>

        <ol className="mt-8 space-y-3">
          {steps.map((s) => (
            <li
              key={s.label}
              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  s.done ? "bg-emerald-500 text-white" : "bg-white/10 text-neutral-400"
                }`}
              >
                {s.done ? "✓" : "·"}
              </span>
              <span className={s.done ? "text-white" : "text-neutral-400"}>{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">
            {org ? "Organization profile" : "Create your organization"}
          </h2>
          <div className="mt-3">
            <OrgForm initialName={org?.name ?? ""} />
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h2 className="text-sm font-bold uppercase tracking-widest text-neutral-400">
            Payment verification
          </h2>
          <p className="mt-2 text-sm text-neutral-400">
            {org?.paymentAccountStatus === "VERIFIED"
              ? "Your organizer account is verified. You can publish paid events."
              : "Verify with Razorpay to accept payments and receive automatic settlements."}
          </p>
          <div className="mt-3">
            <OnboardingActions hasOrg={!!org} />
          </div>
        </div>

        {org?.paymentAccountStatus === "VERIFIED" && (
          <Link
            href="/dashboard"
            className="mt-6 block rounded-full bg-white px-5 py-3 text-center text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200"
          >
            Go to dashboard
          </Link>
        )}
      </div>
    </div>
  );
}
