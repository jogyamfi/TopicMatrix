import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../deps.js';

/** Allow-list from config.corsOrigins (SEC-7) — read fresh from `deps` on every request. */
export const corsMiddleware: MiddlewareHandler<AppEnv> = cors({
  origin: (origin, c) => {
    const deps = c.get('deps');
    return origin && deps.config.corsOrigins.includes(origin) ? origin : undefined;
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
});

/** CSP with no unsafe-inline, HSTS, X-Content-Type-Options, Referrer-Policy (SEC-6). */
export const securityHeadersMiddleware: MiddlewareHandler<AppEnv> = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  },
  strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'no-referrer',
});
