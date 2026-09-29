import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config used by middleware.
 * No database imports here — session is JWT-based.
 */
export const authConfig = {
  pages: {
    signIn: "/auth",
    error: "/auth",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const isLoggedIn = !!auth?.user;

      // /dashboard needs a session. Role checks (admin vs org member) and the
      // "already signed in" bounce live in the layouts, not here — proxy is a UX
      // redirect, never the security gate.
      if (pathname.startsWith("/dashboard")) {
        return isLoggedIn;
      }

      // /auth stays reachable both signed out (renders the sign-in form) and
      // signed in (dispatches onward), so it is never gated here.
      return true;
    },
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.organizationId = user.organizationId ?? null;
        token.organizationRole = user.organizationRole ?? null;
        token.onboardingStatus = user.onboardingStatus ?? null;
        token.paymentAccountStatus = user.paymentAccountStatus ?? null;
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
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? "";
        session.user.organizationId = (token.organizationId as string | null) ?? null;
        session.user.organizationRole = (token.organizationRole as string | null) ?? null;
        session.user.onboardingStatus = (token.onboardingStatus as string | null) ?? null;
        session.user.paymentAccountStatus =
          (token.paymentAccountStatus as string | null) ?? null;
      }
      return session;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;
