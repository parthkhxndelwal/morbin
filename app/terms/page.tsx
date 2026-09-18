import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms & Conditions — Morbin",
  description: "Morbin terms and conditions.",
};

const sections = [
  {
    h: "1. What Morbin is",
    p: "Morbin is currently in stealth and operates an early-access waitlist. By requesting early access you ask us to notify you when the product becomes available. Nothing on this site constitutes an offer of service or a guarantee of access.",
  },
  {
    h: "2. Early access",
    p: "Submitting your email address adds you to our waitlist. Invitations, if issued, are personal, non-transferable, and may be revoked at any time. We may cap the number of early-access participants.",
  },
  {
    h: "3. Acceptable use",
    p: "You agree not to misuse this site, attempt to disrupt it, scrape it aggressively, or submit false information. We may block access for abuse without notice.",
  },
  {
    h: "4. Intellectual property",
    p: "The site, the Morbin name, and all content on it are owned by us and protected by applicable laws. You may not copy, reproduce, or redistribute them without written permission.",
  },
  {
    h: "5. No warranties",
    p: "This site is provided “as is” without warranties of any kind. To the maximum extent permitted by law, we disclaim all implied warranties, including merchantability and fitness for a particular purpose.",
  },
  {
    h: "6. Limitation of liability",
    p: "To the maximum extent permitted by law, Morbin will not be liable for any indirect, incidental, or consequential damages arising from your use of this site.",
  },
  {
    h: "7. Changes",
    p: "We may update these terms at any time by posting a revised version here with a new effective date. Continued use of the site after changes means you accept them.",
  },
  {
    h: "8. Contact",
    p: "Questions about these terms? Contact us at hello@morbin.example.com.",
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#060614] font-sans text-slate-300 antialiased">
      <div className="mx-auto max-w-3xl px-6 py-14 sm:px-10">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight text-white">
          morbin
        </Link>
        <h1 className="mt-10 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Terms &amp; Conditions
        </h1>
        <p className="mt-2 text-sm text-slate-500">Effective date: 18 September 2026</p>
        <div className="mt-10 space-y-8">
          {sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-lg font-semibold text-white">{s.h}</h2>
              <p className="mt-2 text-sm leading-relaxed">{s.p}</p>
            </section>
          ))}
        </div>
        <div className="mt-12 border-t border-white/10 pt-6 text-xs text-slate-500">
          <Link href="/" className="mr-5 transition-colors hover:text-slate-300">Home</Link>
          <Link href="/privacy" className="transition-colors hover:text-slate-300">Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
}
