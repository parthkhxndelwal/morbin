import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { getOrgByOwner } from "@/lib/organizations";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const org = await getOrgByOwner(session.user.id);
  if (!org) redirect("/onboarding");

  return (
    <div className="min-h-dvh bg-[#060614] font-sans text-white antialiased">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-extrabold lowercase tracking-tight">
              morbin
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-400">
              <Link href="/dashboard" className="hover:text-white">Overview</Link>
              <Link href="/dashboard/events" className="hover:text-white">Events</Link>
              <Link href="/verify" className="hover:text-white">Check-in</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-neutral-400 sm:block">{org.name}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button className="rounded-full border border-white/15 px-4 py-1.5 text-xs font-semibold hover:bg-white/10">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
