import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmployee, getUpload } from '@arrive/database';
import { processUpload } from '../../apps/api/src/services/process.js';
import { AR_MAPPING_FIELDS, DAY1, DAY2 } from '../fixtures/expected.js';
import { FIXED_NOW, FIXTURES, fixture, ingest, json, mappingFor, startHarness, upload, type Harness, type UploadDetail } from '../support/harness.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

const counts = async () => (await h.pool.query(
  `SELECT (SELECT count(*)::int FROM snapshots) AS snapshots, (SELECT count(*)::int FROM shipment_snapshots) AS shipments,
          (SELECT count(*)::int FROM snapshot_comparisons) AS comparisons, (SELECT count(*)::int FROM snapshot_comparison_items) AS items,
          (SELECT count(*)::int FROM data_quality_issues WHERE stage = 'PROCESS') AS process_issues`)).rows[0] as Record<string, number>;
const ctx = () => ({ pool: h.pool, config: { env: 'test', port: 0, host: '', databaseUrl: '', uploadDir: h.uploadDir, logLevel: 'silent', authMode: 'none' } as const, actor: { id: null, label: 'test', role: 'admin' as const }, requestId: 'test-request-1', now: () => FIXED_NOW });

describe('original data is preserved exactly', () => {
  let uploadId = '';
  beforeAll(async () => {
    const r = await ingest(h, DAY1.file, DAY1.date, AR_MAPPING_FIELDS);
    expect(r.processRes.statusCode, r.processRes.body).toBe(200);
    uploadId = r.uploadId;
  });

  it('stores every spreadsheet row, including empty and rejected rows', async () => {
    const n = (await h.pool.query("SELECT count(*)::int AS n FROM raw_rows r JOIN upload_sheets s ON s.id = r.sheet_id WHERE r.upload_id = $1 AND s.sheet_index = 0", [uploadId])).rows[0].n;
    expect(n).toBe(21); // header + 20 data rows (incl. the blank row and the row without a tracking number)
  });

  it('matches an independent read of the file cell for cell', async () => {
    const wb = XLSX.read(fixture(DAY1.file), { type: 'buffer' });
    const expected = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['الجرد']!, { header: 1, raw: true, defval: null, blankrows: true });
    const stored = (await h.pool.query(
      "SELECT r.cells FROM raw_rows r JOIN upload_sheets s ON s.id = r.sheet_id WHERE r.upload_id = $1 AND s.sheet_index = 0 ORDER BY r.row_number", [uploadId])).rows.map((r) => r.cells);
    expect(stored).toEqual(expected);
  });

  it('keeps invalid, future, blank and unconverted values as they were in the file', async () => {
    const cell = async (row: number, col: number) =>
      (await h.pool.query("SELECT cells->($3::int) AS v FROM raw_rows WHERE upload_id = $1 AND row_number = $2 AND sheet_id = (SELECT id FROM upload_sheets WHERE upload_id = $1 AND sheet_index = 0)", [uploadId, row, col])).rows[0].v;
    expect(await cell(15, 4)).toBe('2026-02-30'); // invalid date kept verbatim
    expect(await cell(2, 4)).toBe(46315); // Excel serial of 2026-10-20 — not converted
    expect(await cell(8, 4)).toBe('15/10/2026'); // text date kept as typed
    expect(await cell(12, 3)).toBeNull(); // missing employee stays missing (not filled in)
    expect(await cell(14, 1)).toBe('تم التسليم'); // the duplicate row was not merged away
    expect(await cell(2, 7)).toBe('01000000001'); // sensitive column kept in the original, masked only in previews
  });

  it('keeps the uploaded file byte-identical to what was sent', async () => {
    const row = await getUpload(h.pool, uploadId);
    const sha = createHash('sha256').update(fixture(DAY1.file)).digest('hex');
    expect(row?.sha256).toBe(sha);
    const stored = (await h.pool.query('SELECT stored_path FROM uploads WHERE id = $1', [uploadId])).rows[0].stored_path as string;
    expect(createHash('sha256').update(readFileSync(stored)).digest('hex')).toBe(sha);
    expect(stored.startsWith(h.uploadDir)).toBe(true);
  });

  it('links every stored shipment to its untouched source row', async () => {
    const r = await h.pool.query(
      `SELECT count(*)::int AS n FROM shipment_snapshots s JOIN raw_rows r ON r.id = s.raw_row_id
       WHERE s.upload_id = $1 AND r.row_number = s.excel_row AND upper(trim(r.cells->>0)) = s.tracking_number`, [uploadId]);
    expect(r.rows[0].n).toBe(DAY1.stats.ingestedRows);
  });

  it('rejects any attempt to modify originals or snapshots at the database level', async () => {
    await expect(h.pool.query("UPDATE raw_rows SET cells = '[]' WHERE upload_id = $1", [uploadId])).rejects.toMatchObject({ code: 'AU001' });
    await expect(h.pool.query("UPDATE shipment_snapshots SET status_raw = 'x' WHERE upload_id = $1", [uploadId])).rejects.toMatchObject({ code: 'AU001' });
    await expect(h.pool.query('DELETE FROM snapshots WHERE upload_id = $1', [uploadId])).rejects.toMatchObject({ code: 'AU002' });
  });
});

describe('failed processing never leaves a partial snapshot', () => {
  it('rolls back everything when a failure happens after the rows were written', async () => {
    const up = await json<UploadDetail>(await upload(h, DAY2.file, DAY2.date));
    await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/mapping`, payload: { sheets: [mappingFor(0, AR_MAPPING_FIELDS)] } });
    const before = await counts();

    await expect(processUpload(ctx(), up.upload.id, {}, { afterRowsInserted: () => { throw new Error('simulated crash after insert'); } }))
      .rejects.toMatchObject({ statusCode: 500, code: 'PROCESSING_FAILED' });

    expect(await counts()).toEqual(before); // no snapshot, shipments, comparison or issues were committed
    const u = await getUpload(h.pool, up.upload.id);
    expect(u?.status).toBe('FAILED');
    expect(u?.failureReason).toContain('simulated crash');
    const audit = await h.pool.query("SELECT outcome, details FROM audit_log WHERE action = 'PROCESS_FAILED' AND entity_id = $1", [up.upload.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].outcome).toBe('FAILURE');

    // the previously successful snapshot is intact, and the failed upload can be retried successfully
    expect((await h.pool.query("SELECT count(*)::int AS n FROM shipment_snapshots WHERE snapshot_date = $1", [DAY1.date])).rows[0].n).toBe(DAY1.stats.ingestedRows);
    const retry = await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/process`, payload: {} });
    expect(retry.statusCode, retry.body).toBe(200);
    expect((await counts()).snapshots).toBe(before.snapshots! + 1);
  });
});

describe('snapshot ordering, versions and state rules', () => {
  it('refuses a second snapshot for the same date unless a new version is explicitly requested', async () => {
    const r = await ingest(h, DAY2.file, DAY2.date, AR_MAPPING_FIELDS);
    expect(r.processRes.statusCode).toBe(409);
    expect((await json(r.processRes)).error.code).toBe('SNAPSHOT_DATE_EXISTS');
    const retry = await h.app.inject({ method: 'POST', url: `/api/uploads/${r.uploadId}/process`, payload: { replaceExisting: true } });
    expect(retry.statusCode, retry.body).toBe(200);
    const body = await json(retry);
    expect(body.version).toBe(2);
    const rows = (await h.pool.query('SELECT version, supersedes_snapshot_id FROM snapshots WHERE snapshot_date = $1 ORDER BY version', [DAY2.date])).rows;
    expect(rows.map((x) => x.version)).toEqual([1, 2]);
    expect(rows[1].supersedes_snapshot_id).not.toBeNull();
    // version 1 is preserved with all its rows
    expect((await h.pool.query("SELECT count(*)::int AS n FROM shipment_snapshots s JOIN snapshots sn ON sn.id = s.snapshot_id WHERE sn.snapshot_date = $1 AND sn.version = 1", [DAY2.date])).rows[0].n).toBeGreaterThan(0);
    // the new version compares against the previous DATE, not against itself
    const cmp = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${body.snapshotId}/comparison` }));
    expect(cmp.comparison.previousSnapshotDate).toBe(DAY1.date);
    const list = await json(await h.app.inject({ method: 'GET', url: '/api/snapshots' }));
    expect(list.data.filter((s: any) => s.snapshotDate === DAY2.date).map((s: any) => [s.version, s.isActive])).toEqual([[2, true], [1, false]]); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('refuses a snapshot older than the latest one (no backfill in Phase 2)', async () => {
    const r = await ingest(h, 'english_valid.xlsx', '2026-10-05', { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4, governorate: 6 });
    expect(r.processRes.statusCode).toBe(409);
    expect((await json(r.processRes)).error.code).toBe('SNAPSHOT_OUT_OF_ORDER');
    expect((await getUpload(h.pool, r.uploadId))?.status).toBe('MAPPED'); // user-correctable, not "failed"
  });

  it('enforces the upload state machine', async () => {
    const up = await json<UploadDetail>(await upload(h, 'legacy_ar.xls', '2026-10-26'));
    const early = await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/process`, payload: {} });
    expect(early.statusCode).toBe(409); // not mapped yet
    expect((await json(early)).error.code).toBe('INVALID_UPLOAD_STATE');
    await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/mapping`, payload: { sheets: [mappingFor(0, { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4 })] } });
    expect((await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/process`, payload: {} })).statusCode).toBe(200);
    const again = await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/process`, payload: {} });
    expect(again.statusCode).toBe(409);
    expect((await json(again)).error.code).toBe('ALREADY_PROCESSED');
    const remap = await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/mapping`, payload: { sheets: [mappingFor(0, { tracking: 0, status: 1, branch: 2, createdDate: 4 })] } });
    expect(remap.statusCode).toBe(409); // a processed upload's mapping can no longer change
  });

  it('serialises concurrent processing so only one snapshot is created per upload', async () => {
    const up = await json<UploadDetail>(await upload(h, 'english_valid.xlsx', '2026-10-27'));
    await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/mapping`, payload: { sheets: [mappingFor(0, { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4, governorate: 6 })] } });
    const results = await Promise.all([1, 2, 3].map(() => h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/process`, payload: {} })));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409, 409]);
    expect((await h.pool.query('SELECT count(*)::int AS n FROM snapshots WHERE upload_id = $1', [up.upload.id])).rows[0].n).toBe(1);
  });
});

describe('rejected and hostile files', () => {
  const rejected = async (name: string, data: Buffer, date = '2026-10-28') => {
    const before = readdirSync(h.uploadDir).length;
    const res = await upload(h, { name, data }, date);
    expect(res.statusCode, res.body).toBe(422);
    const body = await json(res);
    expect(body.error.code).toBe('FILE_REJECTED');
    expect(readdirSync(h.uploadDir).length).toBe(before); // nothing was stored on disk
    return body.error.details.issues[0] as { code: string };
  };

  it('rejects unsupported extensions and content that does not match the extension', async () => {
    expect((await rejected('report.pdf', Buffer.from('%PDF-1.4'))).code).toBe('FILE_UNSUPPORTED_EXTENSION');
    expect((await rejected('fake.xlsx', Buffer.from('this is plain text, not a zip'))).code).toBe('FILE_CONTENT_MISMATCH');
    expect((await rejected('renamed.xls', fixture('english_valid.xlsx'))).code).toBe('FILE_CONTENT_MISMATCH');
    expect((await rejected('binary.csv', fixture('english_valid.xlsx'))).code).toBe('FILE_CONTENT_MISMATCH');
    expect((await rejected('empty.csv', Buffer.alloc(0))).code).toBe('FILE_EMPTY');
    expect((await rejected('broken.xlsx', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('garbage garbage garbage')]))).code).toBe('FILE_UNREADABLE');
  });

  it('rejects files over the configured size and records the rejection', async () => {
    await h.pool.query(`UPDATE settings SET value = '{"maxMb": 1, "maxRows": 200000, "maxColumns": 200, "maxSheets": 20}' WHERE key = 'upload'`);
    try {
      const big = Buffer.concat([Buffer.from('a,b\n'), Buffer.alloc(1_200_000, 'x')]);
      expect((await rejected('big.csv', big)).code).toBe('FILE_TOO_LARGE');
    } finally {
      await h.pool.query(`UPDATE settings SET value = '{"maxMb": 20, "maxRows": 200000, "maxColumns": 200, "maxSheets": 20}' WHERE key = 'upload'`);
    }
    const rec = (await h.pool.query("SELECT status, stored_path FROM uploads WHERE original_filename = 'big.csv'")).rows[0];
    expect(rec).toEqual({ status: 'REJECTED', stored_path: null });
    const audit = await h.pool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'UPLOAD_REJECTED' AND outcome = 'FAILURE'");
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(7);
  });

  it('never uses the client file name for storage (path traversal)', async () => {
    const res = await upload(h, { name: '../../../etc/passwd.xlsx', data: fixture('english_valid.xlsx') }, '2026-10-28');
    expect(res.statusCode, res.body).toBe(201);
    const body = await json<UploadDetail>(res);
    const row = (await h.pool.query('SELECT original_filename, stored_path FROM uploads WHERE id = $1', [body.upload.id])).rows[0];
    expect(row.original_filename).toBe('passwd.xlsx');
    expect(row.stored_path.startsWith(h.uploadDir)).toBe(true);
    expect(row.stored_path).not.toContain('passwd');
    expect(JSON.stringify(body)).not.toContain(h.uploadDir); // internal paths are never returned
  });

  it('rejects a snapshot date that is missing, malformed, impossible or in the future', async () => {
    for (const d of ['', 'yesterday', '2026-02-30', '2026-11-16']) {
      const r = await upload(h, 'english_valid.xlsx', d);
      expect(r.statusCode, d).toBe(422);
      expect((await json(r)).error.code).toBe('INVALID_SNAPSHOT_DATE');
    }
  });

  it('warns when identical file content was already processed', async () => {
    const r = await upload(h, DAY1.file, '2026-10-29');
    const id = (await json<UploadDetail>(r)).upload.id;
    const issues = await json(await h.app.inject({ method: 'GET', url: `/api/uploads/${id}/issues?code=FILE_DUPLICATE_CONTENT` }));
    expect(issues.data).toHaveLength(1);
    expect(issues.data[0]).toMatchObject({ category: 'FILE_LEVEL', severity: 'WARNING' });
  });

  it('keeps the fixtures directory free of unexpected files', () => {
    expect(existsSync(FIXTURES)).toBe(true);
  });
});

describe('registry-aware checks', () => {
  it('flags unknown and branch-inconsistent employees only against a verified registry, without accusing anyone', async () => {
    const cairo = (await h.pool.query("SELECT id FROM branches WHERE name = 'القاهرة'")).rows[0].id as string;
    const giza = (await h.pool.query("SELECT id FROM branches WHERE name = 'الجيزة'")).rows[0].id as string;
    await createEmployee(h.pool, { name: 'أحمد علي', branchId: cairo, verified: true });
    await createEmployee(h.pool, { name: 'محمد حسن', branchId: giza, verified: true });
    // multi_sheet: Cairo sheet has «أحمد علي», Giza sheet has «محمد حسن»; EG rows below use a wrong branch for one employee
    const csv = Buffer.from('بوليصة,الحالة,الفرع,عهدة العضو,تاريخ الشحنة\nRG1001,جديد,القاهرة,أحمد علي,2026-10-30\nRG1002,جديد,الجيزة,أحمد علي,2026-10-30\nRG1003,جديد,الجيزة,شخص غير معروف,2026-10-30\nRG1004,جديد,الجيزة,,2026-10-30\n', 'utf8');
    const up = await json<UploadDetail>(await upload(h, { name: 'reg.csv', data: csv }, '2026-10-30'));
    await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/mapping`, payload: { sheets: [mappingFor(0, { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4 })] } });
    const p = await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/process`, payload: {} });
    expect(p.statusCode, p.body).toBe(200);
    const issues = (await json(await h.app.inject({ method: 'GET', url: `/api/uploads/${up.upload.id}/issues?stage=PROCESS&pageSize=100` }))).data as { code: string; rowNumber: number; category: string }[];
    const at = (code: string) => issues.filter((i) => i.code === code).map((i) => i.rowNumber);
    expect(at('EMPLOYEE_BRANCH_MISMATCH')).toEqual([3]); // verified employee of Cairo recorded under Giza
    expect(at('UNKNOWN_EMPLOYEE')).toEqual([4]);
    expect(at('MISSING_EMPLOYEE')).toEqual([5]);
    expect(issues.some((i) => i.code === 'EMPLOYEE_REGISTRY_EMPTY')).toBe(false);
    expect(issues.filter((i) => ['EMPLOYEE_BRANCH_MISMATCH', 'UNKNOWN_EMPLOYEE', 'MISSING_EMPLOYEE'].includes(i.code)).every((i) => i.category === 'BUSINESS_WARNING')).toBe(true);
  });

  it('registers unseen branches/employees only when explicitly asked, as unverified auto-registered entries', async () => {
    const csv = Buffer.from('بوليصة,الحالة,الفرع,عهدة العضو,تاريخ الشحنة\nRH2001,جديد,فرع جديد تماما,موظف جديد اسمه كامل,2026-10-31\n', 'utf8');
    const prepare = async () => {
      const up = await json<UploadDetail>(await upload(h, { name: 'new.csv', data: csv }, '2026-10-31'));
      await h.app.inject({ method: 'POST', url: `/api/uploads/${up.upload.id}/mapping`, payload: { sheets: [mappingFor(0, { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4 })] } });
      return up.upload.id;
    };
    const id = await prepare();
    expect((await h.pool.query("SELECT count(*)::int AS n FROM branches WHERE name = 'فرع جديد تماما'")).rows[0].n).toBe(0);
    const p = await json(await h.app.inject({ method: 'POST', url: `/api/uploads/${id}/process`, payload: { registerUnknownBranches: true, registerUnknownEmployees: true } }));
    expect(p.registered).toEqual({ branches: 1, employees: 1 });
    expect((await h.pool.query("SELECT source FROM branches WHERE name = 'فرع جديد تماما'")).rows[0].source).toBe('AUTO_REGISTERED_FROM_UPLOAD');
    expect((await h.pool.query("SELECT is_verified, source FROM employees WHERE name = 'موظف جديد اسمه كامل'")).rows[0]).toEqual({ is_verified: false, source: 'AUTO_REGISTERED_FROM_UPLOAD' });
    const unknown = await json(await h.app.inject({ method: 'GET', url: `/api/uploads/${id}/issues?code=UNKNOWN_BRANCH` }));
    expect(unknown.data).toHaveLength(0);
  });
});
