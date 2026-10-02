/**
 * The return shape of every server action and mutation route.
 *
 * `ConfirmAction` and `FormDialog` render it uniformly: success → toast,
 * `fieldErrors` → inline under each field, anything else → one error message.
 * Actions never throw to the client; they return `err(...)`.
 */
export type Result<T = void> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok<T>(data: T, message?: string): Result<T>;
export function ok(): Result<void>;
export function ok<T>(data?: T, message?: string): Result<T | undefined> {
  return { ok: true, data, message };
}

export function err(error: string, fieldErrors?: Record<string, string>): Result<never> {
  return { ok: false, error, fieldErrors };
}

/** Flatten a zod error into `{ field: firstMessage }` for inline display. */
export function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (key && !(key in out)) out[key] = issue.message;
  }
  return out;
}
