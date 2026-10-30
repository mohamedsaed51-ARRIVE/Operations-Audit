import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('configuration safety', () => {
  const base = { DATABASE_URL: 'postgres://u:p@h/db' };
  it('requires a database URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
  it('allows unauthenticated mode in development and test only', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).authMode).toBe('none');
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).logLevel).toBe('silent');
  });
  it('fails closed in production without authentication', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/AUTH_MODE=none is refused/);
    expect(loadConfig({ ...base, NODE_ENV: 'production', ALLOW_UNAUTHENTICATED: 'true' }).env).toBe('production');
  });
  it('rejects unknown auth modes', () => {
    expect(() => loadConfig({ ...base, AUTH_MODE: 'magic' })).toThrow(/Unsupported AUTH_MODE/);
  });
  it('binds to loopback by default', () => {
    expect(loadConfig(base).host).toBe('127.0.0.1');
  });
});
