import type { NavIconName } from "@/components/nav-icons";

/** Serializable navigation model, built on the server, rendered by AppSidebar. */
export interface NavItem {
  title: string;
  url: string;
  icon: NavIconName;
  /** Match only this exact path (e.g. "/dashboard" must not light up for every child). */
  exact?: boolean;
  /** Small count shown at the end of the item (e.g. pending approvals). */
  badge?: number;
  items?: { title: string; url: string }[];
}

export interface NavShortcut {
  name: string;
  url: string;
  /** Public page for this item, offered in its action menu. */
  publicUrl?: string | null;
}

export interface DashboardNav {
  label: string;
  main: NavItem[];
  shortcutsLabel?: string;
  shortcuts: NavShortcut[];
  secondary: NavItem[];
}

export interface Workspace {
  name: string;
  subtitle: string;
  href: string;
}

export interface NavUserInfo {
  name: string;
  email: string;
  image: string | null;
}

/** Labels for path segments the breadcrumbs can't infer (ids → names). */
export type BreadcrumbLabels = Record<string, string>;

export function isActivePath(pathname: string, item: Pick<NavItem, "url" | "exact">): boolean {
  if (item.exact) return pathname === item.url;
  return pathname === item.url || pathname.startsWith(`${item.url}/`);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
