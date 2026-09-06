import { describe, expect, it } from 'vitest';
import { parseConfig, ConfigError } from './config.js';

const validEnv = {
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: 'file:./dev.db',
  JWT_SECRET: 'a'.repeat(32),
};

describe('parseConfig', () => {
  it('parses a minimal valid sqlite environment and applies defaults', () => {
    const config = parseConfig(validEnv);
    expect(config.databaseProvider).toBe('sqlite');
    expect(config.port).toBe(3000);
    expect(config.nodeEnv).toBe('development');
    expect(config.logLevel).toBe('info');
  });

  it('fails closed when JWT_SECRET is missing', () => {
    const { JWT_SECRET, ...rest } = validEnv;
    void JWT_SECRET;
    expect(() => parseConfig(rest)).toThrow(ConfigError);
  });

  it('fails closed when JWT_SECRET is shorter than 32 characters', () => {
    expect(() => parseConfig({ ...validEnv, JWT_SECRET: 'too-short' })).toThrow(ConfigError);
  });

  it('fails closed when JWT_SECRET is a known 32+ char placeholder', () => {
    expect(() =>
      parseConfig({ ...validEnv, JWT_SECRET: 'changeme-changeme-changeme-changeme' }),
    ).toThrow(ConfigError);
  });

  it('requires DATABASE_URL for postgresql', () => {
    expect(() =>
      parseConfig({ DATABASE_PROVIDER: 'postgresql', JWT_SECRET: 'a'.repeat(32) }),
    ).toThrow(ConfigError);
  });

  it('requires DATABASE_URL for sqlite', () => {
    expect(() => parseConfig({ DATABASE_PROVIDER: 'sqlite', JWT_SECRET: 'a'.repeat(32) })).toThrow(
      ConfigError,
    );
  });

  it('does not require DATABASE_URL for d1', () => {
    expect(() =>
      parseConfig({ DATABASE_PROVIDER: 'd1', JWT_SECRET: 'a'.repeat(32) }),
    ).not.toThrow();
  });

  it('splits CORS_ORIGINS on commas and trims whitespace', () => {
    const config = parseConfig({ ...validEnv, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });
});
