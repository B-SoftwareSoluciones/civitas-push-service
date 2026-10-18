import type { Context, Next } from 'hono';

import { config } from '../config';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self' data: https://unpkg.com",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function securityHeaders(c: Context, next: Next): Promise<void> {
  await next();

  const headers = c.res.headers;
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);

  if (config.isProduction) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}
