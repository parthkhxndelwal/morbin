import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth, signOut } from "@/lib/auth";
import { isAdminEmail } from "@/lib/config";
import { getOrgByOwner } from "@/lib/organizations";
import { LoginForm } from "./login-form";
import { VerifyEmail } from "./verify-email";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Morbin organizer account.",
};

/**
 * Single entry point for every authentication state. Which view renders is
 * derived from the request — callers never pick a view by URL:
 *
 *   ?token=…                     → verify an email address
 *   no session                   → sign in
 *   session, admin               → /dashboard/admin
 *   session, owns an org         → /dashboard
 *   session, no org yet          → awaiting approval
 */
export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token) {
    return (
      <Shell>
        <div className="w-full max-w-sm text-center">
          <div className="mt-8 rounded-2xl border border-white/15 bg-white/5 p-6">
            <VerifyEmail token={token} />
          </div>
        </div>
      </Shell>
    );
  }

  const session = await auth();

  if (!session?.user?.id) {
    return (
      <Shell>
        <LoginForm />
      </Shell>
    );
  }

  // Already signed in — send them where they actually belong.
  if (isAdminEmail(session.user.email)) redirect("/dashboard/admin");
  const org = await getOrgByOwner(session.user.id);
  if (org) redirect("/dashboard");

  return (
    <Shell>
      <div className="w-full max-w-md">
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-7 text-left">
          <h1 className="text-xl font-bold tracking-tight">You&apos;re on the list</h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-400">
            Your account is active. We&apos;re setting up your organization now — once it&apos;s
            ready you&apos;ll be able to create events and start selling tickets.
          </p>
          <p className="mt-4 text-sm text-neutral-400">
            Signed in as <span className="text-white">{session.user.email}</span>.
          </p>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/auth" });
            }}
            className="mt-6"
          >
            <button className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/10">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#060614] px-6 font-sans text-white antialiased">
      <div className="flex w-full max-w-sm flex-col items-center">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight">
          morbin
        </Link>
        {children}
      </div>
    </div>
  );
}
