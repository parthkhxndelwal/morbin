import { MongoDBAdapter } from "@auth/mongodb-adapter";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { authConfig } from "@/lib/auth.config";
import { getClientPromise, getDb } from "@/lib/db";
import { loginSchema } from "@/lib/validations";
import type { Membership, Organization } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      organizationId: string | null;
      organizationRole: string | null;
      onboardingStatus: string | null;
      paymentAccountStatus: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    organizationId?: string | null;
    organizationRole?: string | null;
    onboardingStatus?: string | null;
    paymentAccountStatus?: string | null;
  }
}

async function getOrgContext(userId: string) {
  const db = await getDb();
  const membership = await db
    .collection<Membership>("memberships")
    .findOne({ userId }, { sort: { createdAt: 1 } });
  // Resolve the organization: prefer the earliest membership, fall back to owned org.
  let organization: Organization | null = null;
  if (membership) {
    try {
      organization = await db
        .collection<Organization>("organizations")
        .findOne({ _id: new ObjectId(membership.organizationId) });
    } catch {
      organization = null;
    }
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
        if (!user.emailVerified) throw new Error("EMAIL_NOT_VERIFIED");
        const ctx = await getOrgContext(user._id.toString());
        return {
          id: user._id.toString(),
          email: user.email,
          name: user.name,
          image: user.image,
          emailVerified: user.emailVerified,
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
        // Google users are email-verified by the provider; stamp it on first link.
        if (account?.provider === "google" && user.email) {
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
