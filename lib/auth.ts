import { MongoDBAdapter } from "@auth/mongodb-adapter";
import bcrypt from "bcryptjs";
import NextAuth, { type DefaultSession, CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { authConfig } from "@/lib/auth.config";
import { getSessionByResumeToken } from "@/lib/checkout";
import { getClientPromise, getDb, toObjectId } from "@/lib/db";
import { loginSchema } from "@/lib/validations";
import type { Membership, Organization, User } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string | null;
      organizationRole: string | null;
      onboardingStatus: string | null;
      paymentAccountStatus: string | null;
      /**
       * Convenience only, stamped at sign-in. Authorization never trusts this:
       * `requireAdmin` re-reads the role from the database so a demotion takes
       * effect immediately instead of at the holder's next sign-in.
       */
      role: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    organizationId?: string | null;
    organizationRole?: string | null;
    onboardingStatus?: string | null;
    paymentAccountStatus?: string | null;
    role?: string | null;
  }
}

export class EmailNotVerifiedError extends CredentialsSignin {
  code = "EMAIL_NOT_VERIFIED";
}

export class ResumeTokenError extends CredentialsSignin {
  code = "RESUME_TOKEN_INVALID";
}

/**
 * Provision (or adopt) the user behind a verified checkout identity.
 *
 * A buyer who arrives on the college-email branch has proven control of an inbox
 * but has never signed in. The magic link *is* the proof, so this creates their
 * account — with no password, which is deliberate: the only two ways back into
 * this account are the magic link and Google, and both require that same inbox.
 * The `credentials` provider already refuses a row with no `passwordHash`, so
 * there is no third door.
 *
 * Deliberately creates no organization and no membership. A ticket buyer is not
 * an organizer, and an org-less user row is exactly what lets a later Google
 * sign-in on the same address resolve to this same person.
 */
async function provisionVerifiedUser(email: string): Promise<User> {
  const db = await getDb();
  const normalised = email.toLowerCase();
  const existing = await db.collection<User>("users").findOne({ email: normalised });
  if (existing) {
    // The provider is the verification, so stamp it if the row predates it.
    if (!existing.emailVerified) {
      await db
        .collection<User>("users")
        .updateOne({ _id: existing._id }, { $set: { emailVerified: new Date() } });
      return { ...existing, emailVerified: new Date() };
    }
    return existing;
  }
  const now = new Date();
  const user: User = { email: normalised, emailVerified: now, createdAt: now };
  const { insertedId } = await db.collection<User>("users").insertOne(user);
  return { ...user, _id: insertedId };
}

async function getOrgContext(userId: string) {
  const db = await getDb();
  const membership = await db
    .collection<Membership>("memberships")
    .findOne({ userId }, { sort: { createdAt: 1 } });
  // Resolve the organization: prefer the earliest membership, fall back to owned org.
  let organization: Organization | null = null;
  if (membership) {
    const _id = toObjectId(membership.organizationId);
    organization = _id
      ? await db.collection<Organization>("organizations").findOne({ _id })
      : null;
  }
  if (!organization) {
    organization = await db
      .collection<Organization>("organizations")
      .findOne({ ownerId: userId })
      .catch(() => null);
  }
  if (!membership && !organization) {
    return {
      organizationId: null,
      organizationRole: null,
      onboardingStatus: null,
      paymentAccountStatus: null,
    };
  }
  return {
    organizationId: organization?._id?.toString() ?? membership?.organizationId ?? null,
    organizationRole: membership?.role ?? (organization ? "OWNER" : null),
    onboardingStatus: organization?.onboardingStatus ?? null,
    paymentAccountStatus: organization?.paymentAccountStatus ?? null,
  };
}

/**
 * Resolve the platform role for a signed-in user.
 *
 * The credentials provider already has the row in hand; for every other path
 * (Google first sign-in) the value is read from the database. A failure
 * resolves to null rather than throwing, so a transient database blip can
 * never block a sign-in — the consequence is only that admin navigation is
 * hidden until the next sign-in, and `requireAdmin` re-checks regardless.
 */
async function getUserRole(
  userId: string,
  provided?: { role?: string | null },
): Promise<string | null> {
  if (provided?.role !== undefined) return provided.role ?? null;
  try {
    const db = await getDb();
    const _id = toObjectId(userId);
    if (!_id) return null;
    const user = await db
      .collection<{ role?: string }>("users")
      .findOne({ _id }, { projection: { role: 1 } });
    return user?.role ?? null;
  } catch {
    return null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: MongoDBAdapter(getClientPromise()),
  session: { strategy: "jwt" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    /**
     * Turns a magic link that was already consumed into a real session.
     *
     * The single-use burn happened in `consumeOtp` when the link was clicked;
     * this provider only re-reads the resulting verified state, so it is safe
     * for Auth.js to invoke more than once. It never accepts an email or a
     * domain directly — authority always comes from the checkout session, which
     * is what makes "the insider branch proved the address" auditable.
     */
    Credentials({
      id: "verified-checkout",
      name: "verified-checkout",
      credentials: { resumeToken: { label: "Resume token", type: "text" } },
      async authorize(credentials) {
        const raw = credentials?.resumeToken;
        if (typeof raw !== "string" || raw.length === 0) return null;
        const session = await getSessionByResumeToken(raw);
        if (!session) throw new ResumeTokenError();
        if (!session.identity.verifiedAt || !session.identity.email) return null;
        // Expiry is enforced by getSessionByResumeToken; re-checking status here
        // means a completed order can still re-open its receipt view.
        if (session.status === "EXPIRED") return null;

        const user = await provisionVerifiedUser(session.identity.email);
        if (!user._id) return null;
        const ctx = await getOrgContext(user._id.toString());
        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name ?? null,
          image: user.image ?? null,
          emailVerified: user.emailVerified ?? new Date(),
          role: user.role ?? null,
          ...ctx,
        };
      },
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const db = await getDb();
        const user = await db.collection("users").findOne({
          email: parsed.data.email.toLowerCase(),
        });
        if (!user?.passwordHash) return null;
        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;
        if (!user.emailVerified) throw new EmailNotVerifiedError();
        const ctx = await getOrgContext(user._id.toString());
        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          image: user.image,
          emailVerified: user.emailVerified,
          role: user.role ?? null,
          ...ctx,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger, session, account }) {
      if (user) {
        token.id = user.id;
        // Google and the magic-link provider are both the provider verifying the
        // address, so stamp it on first link. The credentials provider has
        // already required a verified address and is left alone.
        if (
          (account?.provider === "google" ||
            account?.provider === "verified-checkout") &&
          user.email
        ) {
          try {
            const db = await getDb();
            await db
              .collection("users")
              .updateOne(
                { email: user.email.toLowerCase() },
                { $set: { emailVerified: new Date() } },
              );
          } catch {
            /* non-fatal */
          }
        }
        const ctx = await getOrgContext(user.id as string).catch(() => ({
          organizationId: (user.organizationId as string | null) ?? null,
          organizationRole: (user.organizationRole as string | null) ?? null,
          onboardingStatus: (user.onboardingStatus as string | null) ?? null,
          paymentAccountStatus: (user.paymentAccountStatus as string | null) ?? null,
        }));
        token.organizationId = ctx.organizationId;
        token.organizationRole = ctx.organizationRole;
        token.onboardingStatus = ctx.onboardingStatus;
        token.paymentAccountStatus = ctx.paymentAccountStatus;
        // Stamp the platform role so the UI can render admin navigation. This is
        // a convenience copy only — requireAdmin re-reads it from the database.
        token.role = await getUserRole(user.id as string, user);
      }
      if (trigger === "update" && session) {
        if (typeof session.organizationId !== "undefined")
          token.organizationId = session.organizationId;
        if (typeof session.organizationRole !== "undefined")
          token.organizationRole = session.organizationRole;
        if (typeof session.onboardingStatus !== "undefined")
          token.onboardingStatus = session.onboardingStatus;
        if (typeof session.paymentAccountStatus !== "undefined")
          token.paymentAccountStatus = session.paymentAccountStatus;
      }
      return token;
    },
  },
});
