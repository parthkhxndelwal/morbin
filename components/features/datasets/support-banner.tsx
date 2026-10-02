import Link from "next/link";
import { LifeBuoyIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Shown on every dataset screen an admin opens as support. */
export function DatasetSupportBanner({ orgId, orgName }: { orgId: string; orgName: string }) {
  return (
    <Alert>
      <LifeBuoyIcon />
      <AlertTitle>Editing as Morbin support for {orgName}</AlertTitle>
      <AlertDescription>
        <p>Changes are visible to the organisation: each one is logged and the owner is notified.</p>
        <Link href={`/dashboard/admin/orgs/${orgId}`} className="underline underline-offset-4">
          Back to {orgName}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
