import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MIGRATIONS_DIR, createSnapshot, createUpload, insertRawRows, insertShipmentRows, insertSheet, loadMigrations, loadSettings,
  migrateDown, migrateUp, appliedMigrations, completeSnapshot, writeAudit, type Pool,
} from '../src/index.js';
import { freshDatabase } from './helpers.js';

let pool: Pool;
beforeAll(async () => { pool = await freshDatabase(); });
afterAll(async () => { await pool.end(); });

const tables = async () =>
  (await pool.query<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.t);

describe('migrations', () => {
  it('create every required table', async () => {
    const t = await tables();
    for (const name of [
      'users', 'roles', 'audit_log', 'branches', 'branch_aliases', 'employees', 'uploads', 'upload_sheets', 'column_mappings',
      'raw_rows', 'shipment_snapshots', 'snapshot_comparisons', 'status_dictionary', 'settings', 'snapshots', 'data_quality_issues',
    ]) expect(t, name).toContain(name);
  });

  it('are idempotent and every migration has a down script', async () => {
    expect(await migrateUp(pool)).toEqual([]);
    expect(loadMigrations()).toHaveLength((await appliedMigrations(pool)).length);
  });

  it('detects an applied migration that was edited afterwards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig-'));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    const f = join(dir, '0001_core.up.sql');
    writeFileSync(f, readFileSync(f, 'utf8') + '\n-- tampered');
    await expect(migrateUp(pool, dir)).rejects.toThrow(/modified after being applied/);
  });

  it('roll back only with force, then re-apply cleanly', async () => {
    await expect(migrateDown(pool, { steps: 3 })).rejects.toThrow(/force/);
    expect((await appliedMigrations(pool)).length).toBe(3); // nothing was touched

    const reverted = await migrateDown(pool, { steps: 3, force: true });
    expect(reverted).toEqual(['0003_snapshots', '0002_ingestion', '0001_core']);
    expect(await tables()).toEqual(['schema_migrations']);

    expect(await migrateUp(pool)).toHaveLength(3);
    expect(await tables()).toContain('shipment_snapshots');
  });
});

describe('reference data & settings', () => {
  it('loads approved aging defaults and falls back safely on malformed values', async () => {
    const { seedReferenceData } = await import('../src/index.js');
    await seedReferenceData(pool);
    await seedReferenceData(pool); // idempotent
    const s = await loadSettings(pool);
    expect(s.aging).toEqual({ maxDays: 15, criticalDays: 25, bucketBounds: [3, 7, 15, 25] });
    expect((await pool.query('SELECT count(*)::int AS n FROM roles')).rows[0].n).toBe(4);
    expect((await pool.query('SELECT count(*)::int AS n FROM status_dictionary')).rows[0].n).toBe(10);

    await pool.query(`UPDATE settings SET value = '{"maxDays": -3, "bucketBounds": [9, 2, 5, 1]}' WHERE key = 'aging'`);
    expect((await loadSettings(pool)).aging).toEqual({ maxDays: 15, criticalDays: 25, bucketBounds: [3, 7, 15, 25] });
    await pool.query(`UPDATE settings SET value = '{"maxDays": 15, "criticalDays": 25, "bucketBounds": [3, 7, 15, 25]}' WHERE key = 'aging'`);
  });
});

describe('integrity protections', () => {
  let uploadId = '';
  let sheetId = '';
  let snapshotId = '';

  beforeAll(async () => {
    const u = await createUpload(pool, { originalFilename: 'a.xlsx', storedPath: null, sha256: 'x', sizeBytes: 1, fileType: 'xlsx', snapshotDate: '2026-10-20', status: 'PROCESSED', uploadedByLabel: 't' });
    uploadId = u.id;
    sheetId = await insertSheet(pool, { uploadId, sheetIndex: 0, name: 'S', hidden: false, rowCount: 2, firstExcelRow: 1, firstColumn: 0, headerRowIndex: 0, headers: ['h'], detection: null });
    await insertRawRows(pool, uploadId, sheetId, 1, [['h'], ['v']]);
    snapshotId = await createSnapshot(pool, { snapshotDate: '2026-10-20', version: 1, uploadId, supersedesSnapshotId: null, configUsed: {}, createdByLabel: 't' });
    const base = {
      sheetName: 'S', rowNumber: 2, trackingNumber: 'EG1', trackingKey: 'EG1', statusRaw: 'a', statusKey: 'a', statusCode: null, statusKnown: false,
      branchRaw: 'b', branchKey: 'b', branchId: null, employeeRaw: null, employeeKey: null, employeeId: null, employeeMissing: true,
      createdDate: '2026-10-01', statusEntryDate: null, lastUpdateDate: null, statusEntryUsable: false, governorateRaw: null, governorateKey: null,
      shipmentAgeDays: 19, ageCategory: 'D16_25' as const, lastUpdateAgeDays: null, isPrimary: true, duplicateGroupSize: 1, duplicateRank: 1,
      rawRowId: (await pool.query('SELECT id FROM raw_rows WHERE row_number = 2')).rows[0].id as number,
      statusAgeDays: null, statusAgeBasis: 'UNKNOWN_INSUFFICIENT_HISTORY', statusObservedSince: '2026-10-20',
    };
    await insertShipmentRows(pool, { id: snapshotId, date: '2026-10-20', uploadId }, [base]);
    await completeSnapshot(pool, snapshotId, { totalRows: 1, ingestedRows: 1, rejectedRows: 0, emptyRows: 0, duplicateRows: 0 });
  });

  it('keeps original rows immutable', async () => {
    await expect(pool.query("UPDATE raw_rows SET cells = '[]' WHERE sheet_id = $1", [sheetId])).rejects.toMatchObject({ code: 'AU001' });
    await expect(pool.query('DELETE FROM raw_rows WHERE sheet_id = $1', [sheetId])).rejects.toMatchObject({ code: 'AU002' });
  });

  it('keeps completed snapshots and their shipments immutable', async () => {
    await expect(pool.query("UPDATE snapshots SET total_rows = 99 WHERE id = $1", [snapshotId])).rejects.toMatchObject({ code: 'AU001' });
    await expect(pool.query('DELETE FROM snapshots WHERE id = $1', [snapshotId])).rejects.toMatchObject({ code: 'AU002' });
    await expect(pool.query("UPDATE shipment_snapshots SET status_raw = 'x' WHERE snapshot_id = $1", [snapshotId])).rejects.toMatchObject({ code: 'AU001' });
    await expect(pool.query('DELETE FROM shipment_snapshots WHERE snapshot_id = $1', [snapshotId])).rejects.toMatchObject({ code: 'AU002' });
  });

  it('keeps the audit log append-only', async () => {
    await writeAudit(pool, { actorLabel: 't', action: 'TEST' });
    await expect(pool.query("UPDATE audit_log SET action = 'x'")).rejects.toMatchObject({ code: 'AU001' });
    await expect(pool.query('DELETE FROM audit_log')).rejects.toMatchObject({ code: 'AU002' });
  });

  it('allows deletion only inside an explicit purge', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SET LOCAL arrive.allow_purge = 'on'");
      const r = await c.query('DELETE FROM shipment_snapshots WHERE snapshot_id = $1', [snapshotId]);
      expect(r.rowCount).toBe(1);
    } finally { await c.query('ROLLBACK'); c.release(); } // never actually purge
    expect((await pool.query('SELECT count(*)::int AS n FROM shipment_snapshots')).rows[0].n).toBe(1);
  });

  it('enforces one primary row per tracking number but stores duplicates', async () => {
    const sid = await createSnapshot(pool, { snapshotDate: '2026-10-21', version: 1, uploadId: (await createUpload(pool, { originalFilename: 'b.xlsx', storedPath: null, sha256: 'y', sizeBytes: 1, fileType: 'xlsx', snapshotDate: '2026-10-21', status: 'PROCESSED', uploadedByLabel: 't' })).id, supersedesSnapshotId: null, configUsed: {}, createdByLabel: 't' });
    const up = (await pool.query('SELECT upload_id FROM snapshots WHERE id = $1', [sid])).rows[0].upload_id as string;
    const rawRowId = (await pool.query('SELECT id FROM raw_rows LIMIT 1')).rows[0].id as number;
    const mk = (isPrimary: boolean, rank: number) => ({
      sheetName: 'S', rowNumber: 2, trackingNumber: 'EG9', trackingKey: 'EG9', statusRaw: null, statusKey: null, statusCode: null, statusKnown: false,
      branchRaw: null, branchKey: null, branchId: null, employeeRaw: null, employeeKey: null, employeeId: null, employeeMissing: null,
      createdDate: null, statusEntryDate: null, lastUpdateDate: null, statusEntryUsable: false, governorateRaw: null, governorateKey: null,
      shipmentAgeDays: null, ageCategory: null, lastUpdateAgeDays: null, isPrimary, duplicateGroupSize: 2, duplicateRank: rank,
      rawRowId, statusAgeDays: null, statusAgeBasis: 'UNKNOWN_INSUFFICIENT_HISTORY', statusObservedSince: null,
    });
    await insertShipmentRows(pool, { id: sid, date: '2026-10-21', uploadId: up }, [mk(true, 1), mk(false, 2)]);
    await expect(insertShipmentRows(pool, { id: sid, date: '2026-10-21', uploadId: up }, [mk(true, 3)])).rejects.toMatchObject({ code: '23505' });
  });
});
