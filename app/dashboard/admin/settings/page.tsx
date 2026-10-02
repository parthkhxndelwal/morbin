import { PlatformSettingsForm } from "@/components/features/admin/platform-settings-form";
import { PageHeader } from "@/components/patterns/page-header";
import { requireAdmin } from "@/lib/admin";
import { getPlatformSettings, gstReady } from "@/lib/platform-settings";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireAdmin();
  const s = await getPlatformSettings();
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Platform defaults, and Morbin's details for GST invoices." />
      <PlatformSettingsForm
        values={{ defaultFeeBps: s.defaultFeeBps, defaultRetentionMonths: s.defaultRetentionMonths, gst: s.gst }}
        gstReady={gstReady(s.gst)}
      />
    </div>
  );
}
