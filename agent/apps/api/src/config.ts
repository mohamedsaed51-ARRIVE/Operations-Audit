import { resolve } from 'node:path';

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  uploadDir: string;
  logLevel: string;
  /** 'none' = single local operator (development only). Real authentication plugs in via Authenticator. */
  authMode: 'none';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = (env.NODE_ENV ?? 'development') as Config['env'];
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required (see .env.example)');
  const authMode = (env.AUTH_MODE ?? 'none') as Config['authMode'];
  if (authMode !== 'none') throw new Error(`Unsupported AUTH_MODE "${authMode}" (only "none" exists in Phase 2)`);
  if (nodeEnv === 'production' && authMode === 'none' && env.ALLOW_UNAUTHENTICATED !== 'true') {
    // Fail closed: Phase 2 has no authentication, so it must not be exposed in production by accident.
    throw new Error('AUTH_MODE=none is refused in production. Authentication arrives in Phase 8; set ALLOW_UNAUTHENTICATED=true only behind a trusted network boundary.');
  }
  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 3001),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl,
    uploadDir: resolve(env.UPLOAD_DIR ?? './data/uploads'),
    logLevel: env.LOG_LEVEL ?? (nodeEnv === 'test' ? 'silent' : 'info'),
    authMode,
  };
}
