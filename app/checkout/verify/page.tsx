import type { Metadata } from "next";
import { VerifyMagicLink } from "./verify-magic-link";

export const metadata: Metadata = {
  title: "Confirm your email",
  robots: { index: false, follow: false },
};

/**
 * Landing page for the emailed link.
 *
 * Deliberately a real page rather than a redirect: the buyer's email client
 * opens it in a fresh tab, and it has to explain itself there. On success it
 * returns the buyer to the event with the drawer already past the auth step.
 */
export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <VerifyMagicLink token={typeof token === "string" ? token : ""} />;
}
