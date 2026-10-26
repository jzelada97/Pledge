import { NextResponse, type NextRequest } from "next/server";
import testnet from "../../deployments/testnet.json";

// Content-Security-Policy with a fresh nonce per request (security CS-2). Next reads the nonce from the
// request's CSP header and puts it on its own scripts, so pages must render per request (root layout).
// The other security headers are static and live in next.config.ts.
const rpcOrigin = new URL(testnet.rpcUrl).origin; // staff actions read and sign against Soroban RPC

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' only in development: React uses eval there to rebuild server error stacks
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", // React style attributes can't carry a nonce
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src 'self' ${rpcOrigin}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
