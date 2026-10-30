import type { DataQualityIssue, UploadStatus } from '@arrive/shared';
import type { Queryable } from './pool.js';
import { camelize, camelizeAll } from './rows.js';

export interface UploadRow {
  id: string;
  originalFilename: string;
  storedPath: string | null;
  sha256: string | null;
  sizeBytes: number;
  fileType: 'xlsx' | 'xls' | 'csv' | null;
  snapshotDate: string;
  status: UploadStatus;
  failureReason: string | null;
  date1904: boolean;
  uploadedByLabel: string;
  requestId: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
}

export interface SheetRow {
  id: string;
  uploadId: string;
  sheetIndex: number;
  name: string;
  hidden: boolean;
  rowCount: number;
  firstExcelRow: number;
  firstColumn: number;
  headerRowIndex: number | null;
  headers: string[];
  detection: unknown;
  status: 'DETECTED' | 'MAPPED' | 'SKIPPED';
}

export interface MappingRow {
  id: string;
  uploadId: string;
  sheetId: string;
  version: number;
  includeSheet: boolean;
  headerRowIndex: number;
  columns: Record<string, number>;
  acknowledged: string[];
  dateOrder: 'DMY' | 'MDY';
  validation: unknown;
  confirmedByLabel: string;
  confirmedAt: string;
}

const UPLOAD_COLS = `id, original_filename, stored_path, sha256, size_bytes, file_type, snapshot_date, status, failure_reason,
  date1904, uploaded_by_label, request_id, created_at, updated_at, processed_at`;

export async function createUpload(db: Queryable, u: {
  originalFilename: string; storedPath: string | null; sha256: string | null; sizeBytes: number;
  fileType: string | null; snapshotDate: string; status: UploadStatus; failureReason?: string | null;
  date1904?: boolean; uploadedByLabel: string; uploadedBy?: string | null; requestId?: string | null;
}): Promise<UploadRow> {
  const r = await db.query(
    `INSERT INTO uploads (original_filename, stored_path, sha256, size_bytes, file_type, snapshot_date, status, failure_reason,
       date1904, uploaded_by, uploaded_by_label, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${UPLOAD_COLS}`,
    [u.originalFilename, u.storedPath, u.sha256, u.sizeBytes, u.fileType, u.snapshotDate, u.status, u.failureReason ?? null,
      u.date1904 ?? false, u.uploadedBy ?? null, u.uploadedByLabel, u.requestId ?? null]);
  return camelize<UploadRow>(r.rows[0]!);
}

export async function setUploadStatus(db: Queryable, id: string, status: UploadStatus, extra: { failureReason?: string | null; processed?: boolean } = {}) {
  await db.query(
    `UPDATE uploads SET status = $2, failure_reason = $3, processed_at = CASE WHEN $4 THEN now() ELSE processed_at END WHERE id = $1`,
    [id, status, extra.failureReason ?? null, extra.processed ?? false]);
}

export async function getUpload(db: Queryable, id: string): Promise<UploadRow | null> {
  const r = await db.query(`SELECT ${UPLOAD_COLS} FROM uploads WHERE id = $1`, [id]);
  return r.rows[0] ? camelize<UploadRow>(r.rows[0]) : null;
}

export async function listUploads(db: Queryable, page: number, pageSize: number) {
  const total = (await db.query<{ n: number }>('SELECT count(*) AS n FROM uploads')).rows[0]!.n;
  const r = await db.query(
    `SELECT ${UPLOAD_COLS}, (SELECT count(*) FROM data_quality_issues i WHERE i.upload_id = uploads.id AND i.severity = 'ERROR') AS error_count
     FROM uploads ORDER BY created_at DESC, id LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]);
  return { rows: camelizeAll<UploadRow & { errorCount: number }>(r.rows), total };
}

export async function countProcessedWithSha(db: Queryable, sha256: string): Promise<number> {
  return (await db.query<{ n: number }>("SELECT count(*) AS n FROM uploads WHERE sha256 = $1 AND status = 'PROCESSED'", [sha256])).rows[0]!.n;
}

export async function insertSheet(db: Queryable, s: {
  uploadId: string; sheetIndex: number; name: string; hidden: boolean; rowCount: number; firstExcelRow: number;
  firstColumn: number; headerRowIndex: number | null; headers: string[]; detection: unknown; status?: SheetRow['status'];
}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO upload_sheets (upload_id, sheet_index, name, hidden, row_count, first_excel_row, first_column, header_row_index, headers, detection, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [s.uploadId, s.sheetIndex, s.name, s.hidden, s.rowCount, s.firstExcelRow, s.firstColumn, s.headerRowIndex,
      JSON.stringify(s.headers), s.detection === null ? null : JSON.stringify(s.detection), s.status ?? 'DETECTED']);
  return r.rows[0]!.id;
}

export async function getSheets(db: Queryable, uploadId: string): Promise<SheetRow[]> {
  const r = await db.query(
    `SELECT id, upload_id, sheet_index, name, hidden, row_count, first_excel_row, first_column, header_row_index, headers, detection, status
     FROM upload_sheets WHERE upload_id = $1 ORDER BY sheet_index`, [uploadId]);
  return camelizeAll<SheetRow>(r.rows);
}

export async function setSheetStatus(db: Queryable, sheetId: string, status: SheetRow['status']) {
  await db.query('UPDATE upload_sheets SET status = $2 WHERE id = $1', [sheetId, status]);
}

const RAW_BATCH = 2000;

/** Stores the original cells exactly as read. Rows are keyed by their Excel row number. */
export async function insertRawRows(db: Queryable, uploadId: string, sheetId: string, firstExcelRow: number, rows: unknown[][]) {
  for (let start = 0; start < rows.length; start += RAW_BATCH) {
    const chunk = rows.slice(start, start + RAW_BATCH).map((cells, i) => ({ n: firstExcelRow + start + i, c: cells }));
    await db.query(
      `INSERT INTO raw_rows (upload_id, sheet_id, row_number, cells)
       SELECT $1, $2, (e->>'n')::int, e->'c' FROM jsonb_array_elements($3::jsonb) AS e`,
      [uploadId, sheetId, JSON.stringify(chunk)]);
  }
}

export interface RawRowRecord { id: number; rowNumber: number; cells: unknown[] }

export async function getRawRows(db: Queryable, sheetId: string, opts: { limit?: number; offset?: number } = {}): Promise<RawRowRecord[]> {
  const r = await db.query(
    'SELECT id, row_number, cells FROM raw_rows WHERE sheet_id = $1 ORDER BY row_number LIMIT $2 OFFSET $3',
    [sheetId, opts.limit ?? 1_000_000, opts.offset ?? 0]);
  return camelizeAll<RawRowRecord>(r.rows);
}

export async function saveMapping(db: Queryable, m: {
  uploadId: string; sheetId: string; includeSheet: boolean; headerRowIndex: number; columns: Record<string, number>;
  acknowledged: string[]; dateOrder: 'DMY' | 'MDY'; validation: unknown; confirmedByLabel: string; confirmedBy?: string | null;
}): Promise<number> {
  const r = await db.query<{ version: number }>(
    `INSERT INTO column_mappings (upload_id, sheet_id, version, include_sheet, header_row_index, columns, acknowledged, date_order, validation, confirmed_by, confirmed_by_label)
     VALUES ($1,$2,(SELECT COALESCE(MAX(version),0)+1 FROM column_mappings WHERE sheet_id = $2),$3,$4,$5,$6,$7,$8,$9,$10) RETURNING version`,
    [m.uploadId, m.sheetId, m.includeSheet, m.headerRowIndex, JSON.stringify(m.columns), m.acknowledged, m.dateOrder,
      JSON.stringify(m.validation), m.confirmedBy ?? null, m.confirmedByLabel]);
  return r.rows[0]!.version;
}

export async function getLatestMappings(db: Queryable, uploadId: string): Promise<MappingRow[]> {
  const r = await db.query(
    `SELECT DISTINCT ON (sheet_id) id, upload_id, sheet_id, version, include_sheet, header_row_index, columns, acknowledged, date_order,
            validation, confirmed_by_label, confirmed_at
     FROM column_mappings WHERE upload_id = $1 ORDER BY sheet_id, version DESC`, [uploadId]);
  return camelizeAll<MappingRow>(r.rows);
}

// ───────── data-quality issues ─────────

export interface IssueInsert extends DataQualityIssue {
  uploadId: string;
  sheetId: string | null;
  snapshotId: string | null;
  rawRowId: number | null;
  stage: 'UPLOAD' | 'MAPPING' | 'PROCESS';
}

const ISSUE_BATCH = 2000;

export async function insertIssues(db: Queryable, issues: IssueInsert[]) {
  for (let start = 0; start < issues.length; start += ISSUE_BATCH) {
    const chunk = issues.slice(start, start + ISSUE_BATCH).map((i) => ({
      upload_id: i.uploadId, sheet_id: i.sheetId, snapshot_id: i.snapshotId, raw_row_id: i.rawRowId, stage: i.stage,
      code: i.code, category: i.category, severity: i.severity, worksheet: i.worksheet, row_number: i.rowNumber,
      field: i.field, original_value: i.originalValue, explanation: i.explanation, suggestion: i.suggestion,
    }));
    await db.query(
      `INSERT INTO data_quality_issues (upload_id, sheet_id, snapshot_id, raw_row_id, stage, code, category, severity, worksheet, row_number, field, original_value, explanation, suggestion)
       SELECT upload_id, sheet_id, snapshot_id, raw_row_id, stage, code, category, severity, worksheet, row_number, field, original_value, explanation, suggestion
       FROM jsonb_populate_recordset(null::data_quality_issues, $1::jsonb)`,
      [JSON.stringify(chunk)]);
  }
}

export interface IssueFilter { category?: string; severity?: string; code?: string; stage?: string; worksheet?: string }

export async function listIssues(db: Queryable, uploadId: string, f: IssueFilter, page: number, pageSize: number) {
  const where = `upload_id = $1 AND ($2::text IS NULL OR category = $2) AND ($3::text IS NULL OR severity = $3)
                 AND ($4::text IS NULL OR code = $4) AND ($5::text IS NULL OR stage = $5) AND ($6::text IS NULL OR worksheet = $6)`;
  const args = [uploadId, f.category ?? null, f.severity ?? null, f.code ?? null, f.stage ?? null, f.worksheet ?? null];
  const total = (await db.query<{ n: number }>(`SELECT count(*) AS n FROM data_quality_issues WHERE ${where}`, args)).rows[0]!.n;
  const r = await db.query(
    `SELECT id AS issue_id, stage, code, category, severity, worksheet, row_number, field, original_value, explanation, suggestion
     FROM data_quality_issues WHERE ${where}
     ORDER BY CASE severity WHEN 'ERROR' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, worksheet NULLS FIRST, row_number NULLS FIRST, id
     LIMIT $7 OFFSET $8`, [...args, pageSize, (page - 1) * pageSize]);
  return { rows: camelizeAll(r.rows), total };
}

export async function issueSummary(db: Queryable, uploadId: string) {
  const byCategory = (await db.query('SELECT category, severity, count(*) AS n FROM data_quality_issues WHERE upload_id = $1 GROUP BY 1,2 ORDER BY 1,2', [uploadId])).rows;
  const byCode = (await db.query(
    `SELECT code, category, severity, count(*) AS n FROM data_quality_issues WHERE upload_id = $1 GROUP BY 1,2,3
     ORDER BY n DESC, code`, [uploadId])).rows;
  return { byCategory: camelizeAll(byCategory), byCode: camelizeAll(byCode) };
}
