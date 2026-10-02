/** Central feature-flag / integration-status helpers (server-only env reads). */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

/**
 * Emails that are *permitted to hold* the ADMIN role.
 *
 * This is a provisioning list, not the authorization check. It says who the
 * bootstrap is allowed to promote to admin; whether a signed-in user is an
 * admin is answered by the `role` field on their user document (see
 * `requireAdmin`). Keeping those separate is what makes it possible to demote
 * someone by editing the database, and to survive an env change without
 * silently handing out admin.
 *
 * An unset or empty value means nobody may be promoted, so this fails closed.
 */
export function adminEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Edge-safe (no DB): may this email be granted the ADMIN role? */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.trim().toLowerCase());
}

/**
 * Password used only to create a brand-new admin account during the very
 * first bootstrap, when no user row exists for the address yet.
 *
 * Deliberately has no default: with this unset the bootstrap promotes existing
 * accounts but will never invent a credential, so a deployment that forgets to
 * set it stays locked rather than shipping a well-known password. An existing
 * account's password is never touched, whatever this holds.
 */
export function adminBootstrapPassword(): string | null {
  const p = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  return p && p.length > 0 ? p : null;
}
