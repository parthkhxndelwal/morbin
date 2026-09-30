import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#060614] font-sans text-neutral-300 antialiased">
      <div className="mx-auto max-w-3xl px-6 py-14 sm:px-10">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight text-white">
          morbin
        </Link>
        {children}
      </div>
    </div>
  );
}
