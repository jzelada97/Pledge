import type { NextConfig } from "next";

// Static security headers on every route (security CS-2). The CSP needs a per-request nonce, so it is set
// in proxy.ts instead.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" }, // the invitation link /i/<id> must never leak in a Referer
  {
    key: "Permissions-Policy",
    value: "publickey-credentials-get=(self), publickey-credentials-create=(self), camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
