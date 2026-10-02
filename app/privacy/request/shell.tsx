import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** The public data-request pages share one plain frame. */
export function PrivacyShell({ title, description, children }: { title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Morbin
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/legal/privacy" className="underline underline-offset-4">
            Privacy policy
          </Link>
        </p>
      </div>
    </main>
  );
}
