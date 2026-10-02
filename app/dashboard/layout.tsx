import { redirect } from "next/navigation";
import { AlertTriangleIcon } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { BreadcrumbLabelsProvider } from "@/components/breadcrumb-labels";
import { DashboardBreadcrumbs } from "@/components/dashboard-breadcrumbs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { auth, signOut } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { BreadcrumbLabels, DashboardNav, Workspace } from "@/lib/nav";
import { getOrgForUser } from "@/lib/organizations";
import { describeMemberRole } from "@/lib/permissions";
import type { Event, Organization } from "@/lib/types";

/**
 * The dashboard shell: shadcn sidebar-08 (inset) around every organiser and
 * admin page. Navigation is built here, on the server, from the signed-in
 * person's role — a MEMBER never even sees links to owner-only areas, and the
 * pages behind them re-check regardless.
 *
 * The admin hop for org pages lives in `requireOrgSession`, not here: this
 * layout also wraps /dashboard/admin, so redirecting from it would loop.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth");

  const isAdmin = session.user.role === "ADMIN";
  const resolved = isAdmin ? null : await getOrgForUser(session.user.id);
  const org = resolved?.org ?? null;
  if (!isAdmin && !org) redirect("/auth");

  const db = await getDb();
  let nav: DashboardNav;
  let workspace: Workspace;
  let labels: BreadcrumbLabels = {};

  if (isAdmin) {
    const orgs = await db
      .collection<Organization>("organizations")
      .find({}, { projection: { name: 1 } })
      .toArray();
    labels = Object.fromEntries(orgs.map((o) => [o._id!.toString(), o.name]));
    workspace = {
      name: "Morbin",
      subtitle: "Platform admin",
      href: "/dashboard/admin",
    };
    nav = {
      label: "Platform",
      main: [
        {
          title: "Organisations",
          url: "/dashboard/admin",
          icon: "organisations",
        },
      ],
      shortcuts: [],
      secondary: [{ title: "Documentation", url: "/docs", icon: "docs" }],
    };
  } else {
    const orgId = org!._id!.toString();
    const events = await db
      .collection<Event>("events")
      .find(
        { organizationId: orgId },
        {
          projection: { title: 1, slug: 1, status: 1, startsAt: 1, endsAt: 1 },
        },
      )
      .sort({ startsAt: 1 })
      .toArray();
    labels = Object.fromEntries(
      events.map((e) => [e._id!.toString(), e.title]),
    );
    const now = new Date();
    const upcoming = events
      .filter((e) => e.status !== "CANCELLED" && e.endsAt >= now)
      .slice(0, 5);
    workspace = {
      name: org!.name,
      subtitle: describeMemberRole(org!.type ?? "EVENT", resolved!.role),
      href: "/dashboard",
    };
    nav = {
      label: "Organisation",
      main: [
        { title: "Overview", url: "/dashboard", icon: "overview", exact: true },
        { title: "Events", url: "/dashboard/events", icon: "events" },
        { title: "Check-in", url: "/dashboard/scan", icon: "checkin" },
      ],
      shortcutsLabel: "Upcoming events",
      shortcuts: upcoming.map((e) => ({
        name: e.title,
        url: `/dashboard/events/${e._id!.toString()}`,
        publicUrl: e.status === "PUBLISHED" ? `/event/${e.slug}` : null,
      })),
      secondary: [{ title: "Documentation", url: "/docs", icon: "docs" }],
    };
  }

  async function signOutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <BreadcrumbLabelsProvider initial={labels}>
      <SidebarProvider>
        <AppSidebar
          nav={nav}
          workspace={workspace}
          user={{
            name: session.user.name ?? "",
            email: session.user.email ?? "",
            image: session.user.image ?? null,
          }}
          signOutAction={signOutAction}
        />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex min-w-0 items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              <DashboardBreadcrumbs
                rootHref={isAdmin ? "/dashboard/admin" : "/dashboard"}
              />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-6 p-4 pt-0 md:px-6">
            {org?.status === "SUSPENDED" && (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>This organisation is suspended</AlertTitle>
                <AlertDescription>
                  Existing tickets still scan at the door, but nothing new can
                  be published or sold until Morbin restores the account.
                </AlertDescription>
              </Alert>
            )}
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </div>
        </SidebarInset>
      </SidebarProvider>
    </BreadcrumbLabelsProvider>
  );
}
