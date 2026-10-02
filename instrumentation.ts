/**
 * Runs once when a new server instance is initialised, before it is ready to
 * handle requests.
 *
 * Its only job is to make sure the platform has an admin. That work touches the
 * database, so it is given a short deadline and its failures are swallowed: a
 * bootstrap problem must degrade to "nobody is an admin yet" (everything
 * admin-related 403s, which is safe), never to an app that will not boot.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;

  try {
    const { ensureBootstrapAdmin } = await import("@/lib/admin-bootstrap");
    const result = await withDeadline(ensureBootstrapAdmin(), 4_000);

    if (result.created.length) {
      console.warn(
        `[admin-bootstrap] CREATED admin account(s) for: ${result.created.join(", ")}. ` +
          `Change this password immediately (ADMIN_BOOTSTRAP_PASSWORD is no longer needed, ` +
          `and may be removed from the environment once it has been changed).`,
      );
    }
    if (result.promoted.length) {
      console.warn(`[admin-bootstrap] promoted to ADMIN: ${result.promoted.join(", ")}`);
    }
    if (result.skippedNoPassword.length) {
      console.warn(
        `[admin-bootstrap] NO ADMIN EXISTS for: ${result.skippedNoPassword.join(", ")}. ` +
          `These addresses have no Morbin account yet. Sign in once (Google is quickest) ` +
          `to create it, or set ADMIN_BOOTSTRAP_PASSWORD and redeploy. Until then the admin ` +
          `portal is locked.`,
      );
    }
    if (result.skippedExplicitRole.length) {
      console.warn(
        `[admin-bootstrap] left alone (role explicitly set): ${result.skippedExplicitRole.join(", ")}`,
      );
    }
  } catch (error) {
    console.error("[admin-bootstrap] failed; continuing without an admin:", error);
  }

  // Not during `next build` (no database there) and not in dev unless asked.
  if (process.env.NODE_ENV === "production" || process.env.MORBIN_SCHEDULER === "1") {
    const { startScheduler } = await import("@/lib/scheduler");
    startScheduler();
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref?.(),
    ),
  ]);
}
