import { DATA_REQUEST_DEADLINE_DAYS } from "@/lib/privacy-notice";
import { RequestForm } from "./request-form";
import { PrivacyShell } from "./shell";

export const metadata = {
  title: "Your data",
  description: "Ask Morbin for a copy of your data, a correction, or erasure.",
};

export default function DataRequestPage() {
  return (
    <PrivacyShell
      title="Your data, your call"
      description={
        <>
          Ask for a copy of what Morbin holds about you, a correction, or erasure. We&apos;ll email you a link to confirm
          it&apos;s you, then answer within {DATA_REQUEST_DEADLINE_DAYS} days at most — usually far sooner. To withdraw
          consent, ask for erasure: bookings already made aren&apos;t undone.
        </>
      }
    >
      <RequestForm />
    </PrivacyShell>
  );
}
