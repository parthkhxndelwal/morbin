import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/features/auth/auth-layout";
import { getSetupView } from "@/lib/account-setup";
import { JoinForm } from "../join/join-form";
import { setPasswordAction } from "./actions";

export const metadata: Metadata = {
  title: "Set up your account",
  // The URL carries the setup token: never send it onward, never index it.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const view = await getSetupView(token);

  return (
    <AuthLayout>
      {view.state === "valid" ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">Set up your account</h1>
            <p className="text-sm text-muted-foreground">Choose a password to sign in to Morbin.</p>
          </div>
          <JoinForm
            token={token}
            email={view.email}
            defaultName={view.name}
            submitLabel="Set password and sign in"
            action={setPasswordAction}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {view.state === "expired" ? "This link has expired" : "This link doesn't work"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {view.state === "expired"
                ? "Setup links last 7 days. Ask Morbin to send a new one."
                : "It may have been used already, or replaced by a newer email. If you've set your password, just sign in."}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            render={<Link href="/auth" />}
          >
            Go to sign in
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
