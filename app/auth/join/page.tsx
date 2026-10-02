import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthLayout } from "@/components/features/auth/auth-layout";
import { getInviteView } from "@/lib/team";
import { acceptInviteAction } from "./actions";
import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "Join your team",
  // The URL carries the invite token: never send it onward, never index it.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

const DEAD_LINK: Record<"expired" | "used" | "invalid", { title: string; body: string }> = {
  expired: {
    title: "This invite has expired",
    body: "Invites last 7 days. Ask the organisation's owner to resend it from their Team page.",
  },
  used: {
    title: "This invite was already used",
    body: "The account has been set up. Sign in with the email and password chosen when it was accepted.",
  },
  invalid: {
    title: "This invite link doesn't work",
    body: "It may have been revoked, or replaced by a newer invite. Check for a more recent email, or ask the owner to resend it.",
  },
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const invite = await getInviteView(token);

  return (
    <AuthLayout>
      {invite.state === "valid" ? (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Join {invite.organizationName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Set up your Morbin account to see events and check tickets in.
            </p>
          </div>
          <JoinForm
            token={token}
            email={invite.email}
            defaultName={invite.name ?? ""}
            action={acceptInviteAction}
          />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {DEAD_LINK[invite.state].title}
            </h1>
            <p className="text-sm text-muted-foreground">{DEAD_LINK[invite.state].body}</p>
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
