"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { toast } from "sonner"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  CalendarIcon,
  ExternalLinkIcon,
  LinkIcon,
  MoreHorizontalIcon,
  FolderIcon,
} from "lucide-react"
import type { NavShortcut } from "@/lib/nav"

/**
 * sidebar-08's "Projects" group, used for quick access to upcoming events.
 * Hidden when there is nothing to list.
 */
export function NavProjects({
  label,
  projects,
  moreUrl,
}: {
  label: string
  projects: NavShortcut[]
  moreUrl?: string
}) {
  const { isMobile } = useSidebar()
  const pathname = usePathname()
  if (projects.length === 0) return null

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(new URL(url, window.location.origin).toString())
      toast.success("Link copied")
    } catch {
      toast.error("Couldn't copy the link")
    }
  }

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {projects.map((item) => (
          <SidebarMenuItem key={item.url}>
            <SidebarMenuButton
              isActive={pathname.startsWith(item.url)}
              render={<Link href={item.url} />}
            >
              <CalendarIcon />
              <span>{item.name}</span>
            </SidebarMenuButton>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuAction
                    showOnHover
                    className="aria-expanded:bg-muted"
                  />
                }
              >
                <MoreHorizontalIcon />
                <span className="sr-only">More</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-48"
                side={isMobile ? "bottom" : "right"}
                align={isMobile ? "end" : "start"}
              >
                <DropdownMenuItem render={<Link href={item.url} />}>
                  <FolderIcon className="text-muted-foreground" />
                  <span>Open event</span>
                </DropdownMenuItem>
                {item.publicUrl ? (
                  <>
                    <DropdownMenuItem
                      render={<a href={item.publicUrl} target="_blank" rel="noreferrer" />}
                    >
                      <ExternalLinkIcon className="text-muted-foreground" />
                      <span>View public page</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => copy(item.publicUrl!)}>
                      <LinkIcon className="text-muted-foreground" />
                      <span>Copy public link</span>
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        ))}
        {moreUrl ? (
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href={moreUrl} />}>
              <MoreHorizontalIcon />
              <span>All events</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </SidebarGroup>
  )
}
