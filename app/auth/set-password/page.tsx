import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSetupView } from "@/lib/account-setup";
import { JoinForm } from "../join/join-form";
import { setPasswordAction } from "./actions";

export const metadata: Metadata = {
  title: "Set up your account",
  // The URL carries the setup token: never send it onward, never index it.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const view = await getSetupView(token);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10">
      <Link href="/" className="text-lg font-semibold tracking-tight">
        Morbin
      </Link>
      <Card className="w-full max-w-sm">
        {view.state === "valid" ? (
          <>
            <CardHeader>
              <CardTitle>Set up your account</CardTitle>
              <CardDescription>Choose a password to sign in to Morbin.</CardDescription>
            </CardHeader>
            <CardContent>
              <JoinForm
                token={token}
                email={view.email}
                defaultName={view.name}
                submitLabel="Set password and sign in"
                action={setPasswordAction}
              />
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>{view.state === "expired" ? "This link has expired" : "This link doesn't work"}</CardTitle>
              <CardDescription>
                {view.state === "expired"
                  ? "Setup links last 7 days. Ask Morbin to send a new one."
                  : "It may have been used already, or replaced by a newer email. If you've set your password, just sign in."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/auth" />}>
                Go to sign in
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
