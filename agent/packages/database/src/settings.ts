import { DEFAULT_AGING_CONFIG, type AgingConfig, type DateOrder } from '@arrive/shared';
import type { Queryable } from './pool.js';

export interface AppSettings {
  aging: AgingConfig;
  upload: { maxMb: number; maxRows: number; maxColumns: number; maxSheets: number };
  dates: { defaultOrder: DateOrder; timezone: string };
  snapshots: { allowBackfill: boolean };
}

export const DEFAULT_SETTINGS: AppSettings = {
  aging: DEFAULT_AGING_CONFIG,
  upload: { maxMb: 20, maxRows: 200_000, maxColumns: 200, maxSheets: 20 },
  dates: { defaultOrder: 'DMY', timezone: 'Africa/Cairo' },
  snapshots: { allowBackfill: false },
};

const posInt = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback);

/** Loads settings from the database, falling back per-field to safe defaults when a value is missing or malformed. */
export async function loadSettings(db: Queryable): Promise<AppSettings> {
  const rows = (await db.query<{ key: string; value: Record<string, unknown> }>('SELECT key, value FROM settings')).rows;
  const get = (k: string) => (rows.find((r) => r.key === k)?.value ?? {}) as Record<string, unknown>;
  const a = get('aging');
  const bounds = Array.isArray(a.bucketBounds) && a.bucketBounds.length === 4 && a.bucketBounds.every((n) => Number.isInteger(n))
    && (a.bucketBounds as number[]).every((n, i, arr) => i === 0 || n > arr[i - 1]!)
    ? (a.bucketBounds as [number, number, number, number]) : DEFAULT_AGING_CONFIG.bucketBounds;
  const u = get('upload');
  const d = get('dates');
  const s = get('snapshots');
  return {
    aging: { maxDays: posInt(a.maxDays, DEFAULT_AGING_CONFIG.maxDays), criticalDays: posInt(a.criticalDays, DEFAULT_AGING_CONFIG.criticalDays), bucketBounds: bounds },
    upload: {
      maxMb: posInt(u.maxMb, DEFAULT_SETTINGS.upload.maxMb), maxRows: posInt(u.maxRows, DEFAULT_SETTINGS.upload.maxRows),
      maxColumns: posInt(u.maxColumns, DEFAULT_SETTINGS.upload.maxColumns), maxSheets: posInt(u.maxSheets, DEFAULT_SETTINGS.upload.maxSheets),
    },
    dates: { defaultOrder: d.defaultOrder === 'MDY' ? 'MDY' : 'DMY', timezone: typeof d.timezone === 'string' ? d.timezone : DEFAULT_SETTINGS.dates.timezone },
    snapshots: { allowBackfill: s.allowBackfill === true },
  };
}
