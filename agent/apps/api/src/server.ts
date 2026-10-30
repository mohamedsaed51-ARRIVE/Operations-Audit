import { createPool } from '@arrive/database';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const app = await buildApp({ config, pool });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

if (config.authMode === 'none') app.log.warn('AUTH_MODE=none — no authentication is enforced (development only).');
await app.listen({ port: config.port, host: config.host });
