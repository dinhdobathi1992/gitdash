import type { NextConfig } from "next";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pkg = require("./package.json") as { version: string };

const isDev = process.env.NODE_ENV !== "production";

// output: "standalone" is only needed for Docker — Vercel manages its own output
const nextConfig: NextConfig = {
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" } : {}),
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // ── HIGH-001: Security headers ────────────────────────────────
          // Clickjacking protection
          { key: "X-Frame-Options", value: "DENY" },
          // MIME-sniffing protection
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Referrer policy
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable browser features we don't use
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          // MED-003: HSTS — only in production (browsers ignore it over HTTP)
          ...(isDev ? [] : [{
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          }]),
          // MED-005: Explicit CORS deny — we don't expose a public API
          { key: "Access-Control-Allow-Origin", value: "null" },
          // CSP — permissive enough for Next.js + Recharts + GitHub avatars
          // 'unsafe-inline' required by Tailwind CSS; 'unsafe-eval' required by Next.js HMR in dev
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              isDev
                ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
                : "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              // GitHub avatars live on avatars.githubusercontent.com and user-images.githubusercontent.com
              "img-src 'self' data: https://avatars.githubusercontent.com https://user-images.githubusercontent.com https://*.githubusercontent.com",
              // API calls go to GitHub; OAuth redirect goes to github.com
              "connect-src 'self' https://api.github.com https://github.com",
              "font-src 'self' data:",
              // Completely deny framing
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self' https://github.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
