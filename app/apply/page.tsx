import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApplyForm } from "./apply-form";

export const metadata = {
  title: "List your event",
  description: "Apply to sell tickets on Morbin. A person reviews every application.",
};

export default function ApplyPage() {
  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Morbin
        </Link>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">List your event on Morbin</CardTitle>
            <CardDescription>
              Tell us who you are and what you run. A person reviews every application; once approved you get an
              email to set up your account and can start selling the same day.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ApplyForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
