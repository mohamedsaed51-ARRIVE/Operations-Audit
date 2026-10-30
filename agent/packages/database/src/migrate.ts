import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from './pool.js';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const LOCK_KEY = 7_204_001; // advisory lock id: one migrator at a time

export interface Migration {
  version: string;
  name: string;
  up: string;
  down: string;
  checksum: string;
  /** The down script drops data; requires an explicit force. */
  destructive: boolean;
}

export function loadMigrations(dir = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir);
  const ups = files.filter((f) => f.endsWith('.up.sql')).sort();
  return ups.map((f) => {
    const base = f.replace(/\.up\.sql$/, '');
    const m = /^(\d{4})_(.+)$/.exec(base);
    if (!m) throw new Error(`Invalid migration file name: ${f}`);
    const downFile = `${base}.down.sql`;
    if (!files.includes(downFile)) throw new Error(`Migration ${base} has no down script (rollback strategy requires one)`);
    const up = readFileSync(`${dir}/${f}`, 'utf8');
    const down = readFileSync(`${dir}/${downFile}`, 'utf8');
    return {
      version: m[1]!, name: m[2]!, up, down,
      checksum: createHash('sha256').update(up).digest('hex'),
      destructive: /^--\s*destructive:\s*true/im.test(down),
    };
  });
}

async function ensureTable(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
}

export interface AppliedMigration { version: string; name: string; checksum: string; applied_at: string }

export async function appliedMigrations(pool: Pool): Promise<AppliedMigration[]> {
  await ensureTable(pool);
  const r = await pool.query<AppliedMigration>('SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version');
  return r.rows;
}

/** Applies all pending migrations, each in its own transaction. Refuses if an applied migration was edited. */
export async function migrateUp(pool: Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Map((await client.query<AppliedMigration>('SELECT * FROM schema_migrations')).rows.map((r) => [r.version, r]));
    for (const m of loadMigrations(dir)) {
      const prior = done.get(m.version);
      if (prior) {
        if (prior.checksum !== m.checksum) throw new Error(`Migration ${m.version}_${m.name} was modified after being applied`);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(m.up);
        await client.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [m.version, m.name, m.checksum]);
        await client.query('COMMIT');
        applied.push(`${m.version}_${m.name}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.version}_${m.name} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return applied;
}

/**
 * Rolls back the latest `steps` migrations (newest first), each in its own transaction.
 * Down scripts that drop data are refused unless `force` is true.
 */
export async function migrateDown(pool: Pool, opts: { steps?: number; force?: boolean; dir?: string } = {}): Promise<string[]> {
  const steps = opts.steps ?? 1;
  const all = new Map(loadMigrations(opts.dir ?? MIGRATIONS_DIR).map((m) => [m.version, m]));
  const client = await pool.connect();
  const reverted: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const rows = (await client.query<AppliedMigration>('SELECT * FROM schema_migrations ORDER BY version DESC LIMIT $1', [steps])).rows;
    for (const row of rows) {
      const m = all.get(row.version);
      if (!m) throw new Error(`Applied migration ${row.version} has no file on disk; cannot roll back`);
      if (m.destructive && !opts.force) {
        throw new Error(`Rolling back ${m.version}_${m.name} drops data tables. Re-run with force to confirm.`);
      }
      try {
        await client.query('BEGIN');
        await client.query(m.down);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [m.version]);
        await client.query('COMMIT');
        reverted.push(`${m.version}_${m.name}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Rollback of ${m.version}_${m.name} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return reverted;
}
