/**
 * Verifies the admin bootstrap's safety properties. `planBootstrap` is pure, so
 * this needs no database and no module stubbing.
 *
 *   node --experimental-strip-types lib/admin-bootstrap.check.mts
 */
import { planBootstrap } from "./admin-bootstrap-plan.ts";

const ADMIN = "parthkhandelwal.dev@gmail.com";
const STRONG = "Str0ngPassphrase";
const WEAK = "short";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? "  " + detail : ""}`);
  }
}
const only = (a: ReturnType<typeof planBootstrap>) => a[0];

console.log("\n— no account, no bootstrap password: must NOT invent one —");
let a = only(planBootstrap([ADMIN], new Map(), null));
check("skipped, not created", a.type === "skip", JSON.stringify(a));
check("reason is the missing password", a.type === "skip" && a.reason === "no-account-and-no-password");

console.log("\n— existing account with no role: promoted —");
a = only(planBootstrap([ADMIN], new Map([[ADMIN, undefined]]), null));
check("promoted", a.type === "promote", JSON.stringify(a));

console.log("\n— explicitly demoted (role USER): must NOT be re-promoted —");
a = only(planBootstrap([ADMIN], new Map([[ADMIN, "USER"]]), STRONG));
check("skipped", a.type === "skip", JSON.stringify(a));
check("reason is the explicit demotion", a.type === "skip" && a.reason === "explicitly-demoted");

console.log("\n— already an admin: no-op —");
a = only(planBootstrap([ADMIN], new Map([[ADMIN, "ADMIN"]]), STRONG));
check("skipped as already-admin", a.type === "skip" && a.reason === "already-admin");

console.log("\n— no account but a strong password: create —");
a = only(planBootstrap([ADMIN], new Map(), STRONG));
check("create", a.type === "create", JSON.stringify(a));
check("carries the password", a.type === "create" && a.password === STRONG);

console.log("\n— no account, weak password: refused —");
a = only(planBootstrap([ADMIN], new Map(), WEAK));
check("skipped, not created", a.type === "skip", JSON.stringify(a));
check("reason flags the weak password", a.type === "skip" && a.reason === "no-account-and-weak-password");

console.log("\n— an explicit demotion beats even a valid password —");
a = only(planBootstrap([ADMIN], new Map([[ADMIN, "USER"]]), STRONG));
check("still skipped", a.type === "skip", JSON.stringify(a));

console.log("\n— empty allowlist does nothing —");
check("no actions", planBootstrap([], new Map(), STRONG).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);