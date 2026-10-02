import {
  BanknoteIcon,
  BookOpenIcon,
  Building2Icon,
  CalendarDaysIcon,
  DatabaseIcon,
  FileTextIcon,
  InboxIcon,
  LayoutDashboardIcon,
  LifeBuoyIcon,
  ReceiptIcon,
  ScanLineIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  TicketIcon,
  Undo2Icon,
  UsersIcon,
} from "lucide-react";

/**
 * Icons the server-built navigation can refer to by name. Navigation is
 * assembled in the dashboard layout (a server component), and components can't
 * cross the server/client boundary, so items carry a key from this map.
 */
export const NAV_ICONS = {
  overview: LayoutDashboardIcon,
  events: CalendarDaysIcon,
  ticket: TicketIcon,
  orders: ReceiptIcon,
  checkin: ScanLineIcon,
  refunds: Undo2Icon,
  payouts: BanknoteIcon,
  datasets: DatabaseIcon,
  team: UsersIcon,
  settings: SettingsIcon,
  organisations: Building2Icon,
  applications: InboxIcon,
  audit: ScrollTextIcon,
  privacy: ShieldCheckIcon,
  docs: BookOpenIcon,
  support: LifeBuoyIcon,
  legal: FileTextIcon,
} as const;

export type NavIconName = keyof typeof NAV_ICONS;

export function NavIcon({ name }: { name: NavIconName }) {
  const Icon = NAV_ICONS[name];
  return <Icon />;
}
