"use client"

import * as React from "react"
import Link from "next/link"

import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { initials, type DashboardNav, type NavUserInfo, type Workspace } from "@/lib/nav"

/**
 * The shadcn sidebar-08 block (inset variant), fed by the server-built
 * navigation model instead of its sample data.
 */
export function AppSidebar({
  nav,
  workspace,
  user,
  signOutAction,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  nav: DashboardNav
  workspace: Workspace
  user: NavUserInfo
  signOutAction: () => Promise<void>
}) {
  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href={workspace.href} />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
                {initials(workspace.name)}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{workspace.name}</span>
                <span className="truncate text-xs">{workspace.subtitle}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain label={nav.label} items={nav.main} />
        <NavProjects
          label={nav.shortcutsLabel ?? "Shortcuts"}
          projects={nav.shortcuts}
          moreUrl={nav.shortcuts.length ? "/dashboard/events" : undefined}
        />
        <NavSecondary items={nav.secondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} signOutAction={signOutAction} />
      </SidebarFooter>
    </Sidebar>
  )
}
