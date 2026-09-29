import { redirect } from "next/navigation";
import { AdminError, requireAdmin } from "@/lib/admin";

/**
 * Role gate only — the chrome comes from app/dashboard/layout.tsx, which every
 * nested route already inherits. Proxy is not trusted for this.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireAdmin();
  } catch (error) {
    redirect(error instanceof AdminError && error.status === 401 ? "/auth" : "/dashboard");
  }
  return <>{children}</>;
}
