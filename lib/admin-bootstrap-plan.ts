/**
 * The decision half of the admin bootstrap, kept free of I/O and of the `@/`
 * bundler alias so it can be exercised directly by
 * lib/admin-bootstrap.check.mts (plain Node cannot resolve a path alias).
 */

export const MIN_PASSWORD_LENGTH = 8;

/** The password shape required for any account Morbin provisions. */
export function passwordProblem(password: string | undefined): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH)
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter";
  if (!/[0-9]/.test(password)) return "Password must include a number";
  return null;
}

/** One decision per allowlisted address. */
export type BootstrapAction =
  | { type: "promote"; email: string }
  | { type: "create"; email: string; password: string }
  | {
      type: "skip";
      email: string;
      reason:
        | "already-admin"
        | "explicitly-demoted"
        | "no-account-and-no-password"
        | "no-account-and-weak-password";
    };

/**
 * Decide what to do for each allowlisted email.
 *
 * `existing` maps a lowercased email to the role currently stored on that user
 * document, or to `undefined` when the document exists but predates roles.
 *
 * Two rules carry the security weight here:
 *
 *   - an address with no account is only created when a bootstrap password was
 *     supplied, so a half-configured deploy is locked out rather than running a
 *     well-known credential;
 *   - an address whose role was already decided — including explicitly demoted
 *     to "USER" — is never re-promoted, so revoking admin actually sticks
 *     across restarts.
 */
export function planBootstrap(
  emails: readonly string[],
  existing: ReadonlyMap<string, string | undefined>,
  password: string | null,
): BootstrapAction[] {
  return emails.map((email) => {
    if (existing.has(email)) {
      const role = existing.get(email);
      if (role === "ADMIN") return { type: "skip", email, reason: "already-admin" };
      if (role === "USER") return { type: "skip", email, reason: "explicitly-demoted" };
      return { type: "promote", email };
    }
    if (!password) return { type: "skip", email, reason: "no-account-and-no-password" };
    if (passwordProblem(password))
      return { type: "skip", email, reason: "no-account-and-weak-password" };
    return { type: "create", email, password };
  });
}