import Link from "next/link";
import { DownloadIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PrivacyShell } from "../shell";

export const metadata = { title: "Download your data", robots: { index: false } };

const ERRORS: Record<string, string> = {
  invalid: "This link isn't valid, or the file was already downloaded.",
  expired: "This link has expired.",
  limit: "Too many attempts. Try again in an hour.",
};

/**
 * The export link from the email. The file is fetched by a POST from this
 * button, so a scanner following the link doesn't spend the one download.
 */
export default async function DownloadDataPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const message = error ? (ERRORS[error] ?? ERRORS.invalid) : null;
  return (
    <PrivacyShell
      title="Your data export"
      description="A JSON file with everything Morbin holds for your email address. It downloads once; keep it somewhere safe."
    >
      <div className="space-y-4">
        {message && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>
              {message}{" "}
              <Link href="/privacy/request" className="underline underline-offset-4">
                Make a new request
              </Link>
            </AlertDescription>
          </Alert>
        )}
        {token && !message && (
          <form method="post" action="/api/privacy/download">
            <input type="hidden" name="token" value={token} />
            <Button type="submit" size="lg" className="w-full">
              <DownloadIcon data-icon="inline-start" />
              Download my data
            </Button>
          </form>
        )}
      </div>
    </PrivacyShell>
  );
}
