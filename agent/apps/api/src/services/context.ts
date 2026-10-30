import type { Pool } from '@arrive/database';
import type { Actor } from '../auth.js';
import type { Config } from '../config.js';

export interface ServiceContext {
  pool: Pool;
  config: Config;
  actor: Actor;
  requestId: string;
  /** Injectable clock so date rules are deterministic in tests. */
  now: () => Date;
}
