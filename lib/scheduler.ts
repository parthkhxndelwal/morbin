/**
 * In-process background jobs.
 *
 * Morbin runs as a single Node process on a single server, so a timer loop is
 * sufficient and avoids exposing a cron endpoint to the network. Each job is
 * guarded against overlapping with itself, and failures are logged and retried
 * on the next tick rather than crashing the server.
 */
import { ensureIndexes } from "@/lib/db";
import { flushEmailQueue } from "@/lib/email";
import { expireStaleOrders } from "@/lib/orders";
import { runRetention } from "@/lib/retention";

interface Job {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
}

const JOBS: Job[] = [
  { name: "expire-stale-orders", everyMs: 60_000, run: () => expireStaleOrders() },
  { name: "flush-email-queue", everyMs: 30_000, run: () => flushEmailQueue(50) },
  // Ticks hourly; the job itself runs once a day (lib/retention-rules.ts).
  { name: "retention", everyMs: 60 * 60_000, run: () => runRetention({ trigger: "SCHEDULE" }) },
];

declare global {
  var __morbin_scheduler_started: boolean | undefined;
}

export function startScheduler(): void {
  if (globalThis.__morbin_scheduler_started) return;
  globalThis.__morbin_scheduler_started = true;

  // Indexes are idempotent; creating them at boot means a fresh volume is
  // correct without a manual post-deploy step.
  ensureIndexes().catch((error) => console.error("[scheduler] ensureIndexes failed", error));

  for (const job of JOBS) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (error) {
        console.error(`[scheduler] ${job.name} failed`, error);
      } finally {
        running = false;
      }
    };
    setInterval(tick, job.everyMs).unref?.();
  }
}
