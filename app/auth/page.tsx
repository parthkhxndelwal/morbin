import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { AuthLayout } from "@/components/features/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { auth, signOut } from "@/lib/auth";
import { isGoogleConfigured } from "@/lib/config";
import { getOrgForUser } from "@/lib/organizations";
import { LoginForm } from "./login-form";
import { VerifyEmail } from "./verify-email";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Morbin account.",
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
  searchParams: Promise<{ token?: string; callbackUrl?: string }>;
}) {
  const { token, callbackUrl } = await searchParams;

  if (token) {
    return (
      <AuthLayout>
        <VerifyEmail token={token} />
      </AuthLayout>
    );
  }

  const session = await auth();

  if (!session?.user?.id) {
    // Only same-site paths, so the sign-in page can't be used as an open redirect.
    const next = callbackUrl?.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : "/dashboard";
    return (
      <AuthLayout>
        <LoginForm googleEnabled={isGoogleConfigured()} callbackUrl={next} />
      </AuthLayout>
    );
  }

  // Already signed in — send them where they actually belong.
  if (session.user.role === "ADMIN") redirect("/dashboard/admin");
  const resolved = await getOrgForUser(session.user.id);
  if (resolved) redirect("/dashboard");

  return (
    <AuthLayout>
      <div className="space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">You&apos;re signed in</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            This account isn&apos;t part of an organisation yet. If you booked tickets, they&apos;re on your event&apos;s
            tickets page. To sell tickets, apply to list your event.
          </p>
        </div>
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <p className="text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{session.user.email}</span>
          </p>
        </div>
        <div className="grid gap-2">
          <Button nativeButton={false} render={<a href="/apply" />}>
            List your event
          </Button>
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
      </div>
    </AuthLayout>
  );
}
