import { FeeBearerForm } from "@/components/features/settings/fee-bearer-form";
import { OrgProfileForm } from "@/components/features/settings/org-profile-form";
import { PayoutAccountForm } from "@/components/features/settings/payout-account-form";
import { PageHeader } from "@/components/patterns/page-header";
import { NoAccessState } from "@/components/patterns/states";
import { requireOrgSession } from "@/lib/guards";
import { getFeeSettings, getOrgSettingsView } from "@/lib/org-settings";
import { getPayoutAccountView, payoutEncryptionState } from "@/lib/payout-accounts";
import { can } from "@/lib/permissions";

export const metadata = { title: "Settings" };

/**
 * `/dashboard/settings` — organisation profile, the fee arrangement, and the
 * encrypted bank details a payout is sent to.
 *
 * The page is owner-only: `finance` is an OWNER capability, and everything here
 * moves money or names the organisation on an invoice. It loads three
 * independent view models and hands each to a feature component, which owns its
 * own form state and edge cases; no page here decides a rule or computes a
 * figure.
 */
export default async function SettingsPage() {
  const { org, role } = await requireOrgSession();
  if (!can(role, "finance")) {
    return <NoAccessState description="Settings are managed by the organisation owner." />;
  }
  const orgId = org._id.toString();
  const profile = getOrgSettingsView(org);
  const [fees, payoutAccount] = await Promise.all([
    getFeeSettings(org),
    getPayoutAccountView(orgId),
  ]);
  const disabled = org.status === "SUSPENDED";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="How your organisation appears on tickets and invoices, who pays the convenience fee, and where your payouts are sent."
      />
      <div className="grid gap-6">
        <OrgProfileForm defaults={profile} disabled={disabled} />
        <FeeBearerForm
          feePercent={fees.feePercent}
          gstPercent={fees.gstPercent}
          isCustomRate={fees.isCustomRate}
          feeBearer={fees.feeBearer}
          exampleCustomer={fees.exampleCustomer}
          exampleOrganiser={fees.exampleOrganiser}
          disabled={disabled}
        />
        <PayoutAccountForm
          view={
            payoutAccount && {
              accountName: payoutAccount.accountName,
              ifsc: payoutAccount.ifsc,
              last4: payoutAccount.last4,
              updatedAt: payoutAccount.updatedAt.toISOString(),
            }
          }
          encryption={payoutEncryptionState()}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
