import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth, signOut } from "@/lib/auth";
import { getOrgForUser } from "@/lib/organizations";
import { Button } from "@/components/ui/button";
import { AuthShell } from "./auth-shell";
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
 *   session, belongs to an org   → /dashboard
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
      <AuthShell>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <VerifyEmail token={token} />
        </div>
      </AuthShell>
    );
  }

  const session = await auth();

  if (!session?.user?.id) {
    return (
      <AuthShell>
        <LoginForm />
      </AuthShell>
    );
  }

  // Already signed in — send them where they actually belong.
  if (session.user.role === "ADMIN") redirect("/dashboard/admin");
  const resolved = await getOrgForUser(session.user.id);
  if (resolved) redirect("/dashboard");

  return (
    <AuthShell>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">You&apos;re on the list</h1>
          <p className="text-sm leading-relaxed text-neutral-400">
            Your account is active. We&apos;re setting up your organization now — once
            it&apos;s ready you&apos;ll be able to create events and start selling tickets.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-sm">
          <p className="text-neutral-400">
            Signed in as <span className="text-white">{session.user.email}</span>
          </p>
        </div>

        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/auth" });
          }}
        >
          <Button variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}