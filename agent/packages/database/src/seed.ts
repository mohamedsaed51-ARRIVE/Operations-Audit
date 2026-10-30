import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { foldKey } from '@arrive/engine';
import type { Pool } from './pool.js';

const SEEDS_DIR = fileURLToPath(new URL('../seeds/', import.meta.url));

interface StatusSeed {
  source: string;
  statuses: { code: string; label_ar: string; label_en: string; is_terminal: boolean | null; aliases: string[] }[];
}

/** Idempotent reference-data seed (roles, settings, placeholder status dictionary). */
export async function seedReferenceData(pool: Pool): Promise<void> {
  await pool.query(readFileSync(`${SEEDS_DIR}001_roles_settings.sql`, 'utf8'));
  const seed = JSON.parse(readFileSync(`${SEEDS_DIR}002_status_dictionary.json`, 'utf8')) as StatusSeed;
  for (const s of seed.statuses) {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO status_dictionary (code, label_ar, label_en, is_terminal, source) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`,
      [s.code, s.label_ar, s.label_en, s.is_terminal, seed.source],
    );
    for (const alias of [s.label_ar, s.label_en, ...s.aliases]) {
      await pool.query(
        'INSERT INTO status_aliases (status_id, alias, alias_key) VALUES ($1,$2,$3) ON CONFLICT (alias_key) DO NOTHING',
        [r.rows[0]!.id, alias, foldKey(alias)],
      );
    }
  }
}
