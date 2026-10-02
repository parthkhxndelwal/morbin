import { PlatformSettingsForm } from "@/components/features/admin/platform-settings-form";
import { RetentionCard } from "@/components/features/admin/retention-card";
import { PageHeader } from "@/components/patterns/page-header";
import { requireAdmin } from "@/lib/admin";
import { getPlatformSettings, gstReady } from "@/lib/platform-settings";
import { getRetentionRun } from "@/lib/retention";

export const metadata = { title: "Settings" };

export default async function AdminSettingsPage() {
  await requireAdmin();
  const [s, run] = await Promise.all([getPlatformSettings(), getRetentionRun()]);
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Platform defaults, and Morbin's details for GST invoices." />
      <PlatformSettingsForm
        values={{ defaultFeeBps: s.defaultFeeBps, defaultRetentionMonths: s.defaultRetentionMonths, gst: s.gst }}
        gstReady={gstReady(s.gst)}
      />
      <RetentionCard
        defaultMonths={s.defaultRetentionMonths}
        run={
          run && {
            startedAt: run.startedAt?.toISOString() ?? null,
            finishedAt: run.finishedAt?.toISOString() ?? null,
            trigger: run.trigger,
            running: !!run.leaseUntil && run.leaseUntil > new Date(),
            error: run.error,
            counts: run.counts ? { ...run.counts } : null,
          }
        }
      />
    </div>
  );
}
