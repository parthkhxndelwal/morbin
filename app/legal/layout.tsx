import { Logo } from "@/components/logo";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#060614] font-sans text-neutral-300 antialiased">
      <div className="mx-auto max-w-3xl px-6 py-14 sm:px-10">
        <Logo height={24} />
        {children}
      </div>
    </div>
  );
}
