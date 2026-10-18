import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';
// Direct-to-storage uploads (presigned PUT) go to the S3/R2 endpoint, so the CSP must allow that origin.
const storageOrigin = (() => {
  try { return process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : ''; } catch { return ''; }
})();

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${dev ? "'unsafe-eval' " : ''}https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src 'self' https://challenges.cloudflare.com ${storageOrigin}`.trim(),
  "frame-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Staff upload one small photo or CSV at a time through a server action; Vercel itself caps request bodies at about 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: '4.5mb' } },
  turbopack: { root: process.cwd() },
  serverExternalPackages: ['sharp', '@node-rs/argon2', 'ffmpeg-static', 'pg', 'web-push', 'file-type'],
  // ffmpeg is a native binary the tracer can't see; without this Vercel deployments would ship without it.
  outputFileTracingIncludes: { '/api/tips': ['./node_modules/ffmpeg-static/ffmpeg*'] },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
        ],
      },
      // Tipster and staff pages must never be cached by the browser, a proxy or the CDN.
      ...['/check', '/submit', '/staff/:path*', '/api/:path*'].map((source) => ({ source, headers: [{ key: 'Cache-Control', value: 'no-store' }] })),
    ];
  },
};

export default nextConfig;
