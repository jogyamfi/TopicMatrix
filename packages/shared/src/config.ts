import { z } from 'zod';
import { isValidTimezone } from './date.js';

// Known placeholder secrets that must never be accepted, even if 32+ chars (SEC-5).
const PLACEHOLDER_SECRETS = new Set([
  'changeme',
  'change-me',
  'secret',
  'your-secret-here',
  'insert-your-jwt-secret-here-please-pad',
  'changeme-changeme-changeme-changeme',
]);

const envSchema = z.object({
  DATABASE_PROVIDER: z.enum(['sqlite', 'postgresql', 'd1']),
  DATABASE_URL: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().optional(),
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .refine((v) => !PLACEHOLDER_SECRETS.has(v.toLowerCase()), {
      message: 'JWT_SECRET must not be a known placeholder value',
    }),
  ARGON2_MEMORY_KIB: z.coerce.number().int().positive().default(19456),
  ARGON2_ITERATIONS: z.coerce.number().int().positive().default(2),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // Number of reverse proxies in front of the Node API whose X-Forwarded-For entries are
  // trusted (e.g. 1 for the docker-compose nginx). 0 = use the socket address only, since a
  // client can put anything in X-Forwarded-For when nothing trusted rewrites it.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  // Timezone new accounts start with (users can change theirs in Settings, and are offered their
  // device's timezone on first login if it differs).
  DEFAULT_TIMEZONE: z
    .string()
    .refine(isValidTimezone, { message: 'DEFAULT_TIMEZONE must be a valid IANA timezone' })
    .default('Europe/London'),
});

export type RawEnv = Record<string, string | undefined>;

export interface AppConfig {
  databaseProvider: 'sqlite' | 'postgresql' | 'd1';
  databaseUrl: string | undefined;
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  corsOrigins: string[];
  jwtSecret: string;
  argon2MemoryKib: number;
  argon2Iterations: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  trustProxyHops: number;
  defaultTimezone: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validates the environment contract (SRS §14.1.1). Fails closed: throws rather than
 * returning a partially-valid config. DATABASE_URL is required for sqlite/postgresql but
 * unused for d1 (reached via binding), so it is validated conditionally, not unconditionally.
 */
export function parseConfig(env: RawEnv): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid configuration:\n${issues.join('\n')}`);
  }

  const data = parsed.data;

  if (data.DATABASE_PROVIDER !== 'd1' && !data.DATABASE_URL) {
    throw new ConfigError(
      `DATABASE_URL is required when DATABASE_PROVIDER=${data.DATABASE_PROVIDER}`,
    );
  }

  return {
    databaseProvider: data.DATABASE_PROVIDER,
    databaseUrl: data.DATABASE_URL,
    nodeEnv: data.NODE_ENV,
    port: data.PORT,
    corsOrigins: (data.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    jwtSecret: data.JWT_SECRET,
    argon2MemoryKib: data.ARGON2_MEMORY_KIB,
    argon2Iterations: data.ARGON2_ITERATIONS,
    logLevel: data.LOG_LEVEL,
    trustProxyHops: data.TRUST_PROXY_HOPS,
    defaultTimezone: data.DEFAULT_TIMEZONE,
  };
}
