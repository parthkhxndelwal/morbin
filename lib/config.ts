/** Central feature-flag / integration-status helpers (server-only env reads). */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

/**
 * Admin allowlist from ADMIN_EMAILS (comma-separated). An unset or empty
 * value means nobody is an admin — the portal fails closed.
 */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Edge-safe (no DB): is this email an admin? */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.trim().toLowerCase());
}

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.AWS_REGION &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY,
  );
}

export function isWebhookConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
}

export function isCronConfigured(): boolean {
  return Boolean(process.env.CRON_SECRET);
}
