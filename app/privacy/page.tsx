import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Morbin",
  description: "How Morbin collects and uses personal information.",
};

const sections = [
  {
    h: "1. What we collect",
    p: "The only personal information we currently collect is the email address you voluntarily submit through our early-access form, plus basic technical data (such as device and usage information) collected automatically when you visit the site.",
  },
  {
    h: "2. How we use it",
    p: "We use your email address to notify you about early access and the Morbin launch, and to respond if you contact us. We do not sell your personal information.",
  },
  {
    h: "3. Email communications",
    p: "By joining the waitlist you consent to receive launch-related emails from us. Every email will include a way to unsubscribe, and you can ask to be removed at any time by writing to hello@morbin.example.com.",
  },
  {
    h: "4. Sharing",
    p: "We share data only with service providers that help us operate the site (for example, hosting and email infrastructure), and only as needed for those purposes. We may disclose information if required by law.",
  },
  {
    h: "5. Data security and retention",
    p: "We take reasonable measures to protect your information, but no system is perfectly secure. We keep waitlist emails until you unsubscribe or ask us to delete them.",
  },
  {
    h: "6. Your rights",
    p: "Depending on where you live, you may have rights to access, correct, or delete your personal information. Contact hello@morbin.example.com and we will respond within a reasonable time.",
  },
  {
    h: "7. Changes to this policy",
    p: "We may update this policy by posting a revised version here with a new effective date. Please check back occasionally.",
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#060614] font-sans text-slate-300 antialiased">
      <div className="mx-auto max-w-3xl px-6 py-14 sm:px-10">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight text-white">
          morbin
        </Link>
        <h1 className="mt-10 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Privacy Policy
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
          <Link href="/terms" className="transition-colors hover:text-slate-300">Terms &amp; Conditions</Link>
        </div>
      </div>
    </div>
  );
}
