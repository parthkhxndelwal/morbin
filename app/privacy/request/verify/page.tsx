import { PrivacyShell } from "../shell";
import { ConfirmRequest } from "./confirm-request";

export const metadata = { title: "Confirm your data request", robots: { index: false } };

/**
 * The emailed link lands here; the request is confirmed by a button, not by
 * the visit, so a mail scanner opening the link can't confirm it for you.
 */
export default async function VerifyDataRequestPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <PrivacyShell title="Confirm your request" description="One tap and it reaches our team.">
      <ConfirmRequest token={typeof token === "string" ? token : ""} />
    </PrivacyShell>
  );
}
