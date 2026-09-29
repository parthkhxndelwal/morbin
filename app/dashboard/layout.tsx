import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/lib/auth";
import { isAdminEmail } from "@/lib/config";
import { getOrgByOwner } from "@/lib/organizations";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth");

  // Admins may not own an organization themselves; they reach /dashboard/admin.
  const isAdmin = isAdminEmail(session.user.email);
  const org = isAdmin ? null : await getOrgByOwner(session.user.id);
  if (!isAdmin && !org) redirect("/auth");

  return (
    <div className="min-h-dvh bg-[#060614] font-sans text-white antialiased">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-lg font-extrabold lowercase tracking-tight">
              morbin
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-400">
              {isAdmin ? (
                <Link href="/dashboard/admin" className="hover:text-white">
                  Organizations
                </Link>
              ) : (
                <>
                  <Link href="/dashboard" className="hover:text-white">Overview</Link>
                  <Link href="/dashboard/events" className="hover:text-white">Events</Link>
                  <Link href="/dashboard/scan" className="hover:text-white">Check-in</Link>
                </>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-neutral-400 sm:block">
              {isAdmin ? "Admin" : org?.name}
            </span>
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
