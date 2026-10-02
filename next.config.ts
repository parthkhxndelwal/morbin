import type { NextConfig } from "next";

/**
 * Self-hosted on a single server (see docker-compose.yml). `standalone` emits a
 * minimal `server.js` plus only the traced `node_modules`, which is what the
 * runtime image copies.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera is needed only by the check-in scanner, which is same-origin.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // No remotePatterns: every image this app renders is served from its own
  // origin (/public or /media), so no request is made to a third-party host.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
