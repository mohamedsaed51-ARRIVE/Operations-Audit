import type { ChangeType } from '@arrive/shared';
import type { ComparableShipment, ComparisonResult, LastSeen, NormalizedRecord } from '@arrive/engine';
import type { Queryable } from './pool.js';
import { camelize, camelizeAll } from './rows.js';

export interface SnapshotRow {
  id: string;
  snapshotDate: string;
  version: number;
  uploadId: string;
  supersedesSnapshotId: string | null;
  status: 'BUILDING' | 'COMPLETED';
  totalRows: number;
  ingestedRows: number;
  rejectedRows: number;
  emptyRows: number;
  duplicateRows: number;
  configUsed: Record<string, unknown>;
  createdByLabel: string;
  createdAt: string;
  completedAt: string | null;
}

const SNAP_COLS = `id, snapshot_date, version, upload_id, supersedes_snapshot_id, status, total_rows, ingested_rows, rejected_rows,
  empty_rows, duplicate_rows, config_used, created_by_label, created_at, completed_at`;

/** Most recent completed snapshot (highest date, then highest version). */
export async function getLatestSnapshot(db: Queryable): Promise<SnapshotRow | null> {
  const r = await db.query(`SELECT ${SNAP_COLS} FROM snapshots WHERE status = 'COMPLETED' ORDER BY snapshot_date DESC, version DESC LIMIT 1`);
  return r.rows[0] ? camelize<SnapshotRow>(r.rows[0]) : null;
}

/** The active (latest-version) completed snapshot strictly before `date`. */
export async function getPreviousSnapshot(db: Queryable, date: string): Promise<SnapshotRow | null> {
  const r = await db.query(
    `SELECT ${SNAP_COLS} FROM snapshots WHERE status = 'COMPLETED' AND snapshot_date < $1 ORDER BY snapshot_date DESC, version DESC LIMIT 1`, [date]);
  return r.rows[0] ? camelize<SnapshotRow>(r.rows[0]) : null;
}

export async function getSnapshot(db: Queryable, id: string): Promise<SnapshotRow | null> {
  const r = await db.query(`SELECT ${SNAP_COLS} FROM snapshots WHERE id = $1`, [id]);
  return r.rows[0] ? camelize<SnapshotRow>(r.rows[0]) : null;
}

export async function getSnapshotsOnDate(db: Queryable, date: string): Promise<SnapshotRow[]> {
  const r = await db.query(`SELECT ${SNAP_COLS} FROM snapshots WHERE snapshot_date = $1 AND status = 'COMPLETED' ORDER BY version DESC`, [date]);
  return camelizeAll<SnapshotRow>(r.rows);
}

export async function createSnapshot(db: Queryable, s: {
  snapshotDate: string; version: number; uploadId: string; supersedesSnapshotId: string | null; configUsed: unknown; createdByLabel: string;
}): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO snapshots (snapshot_date, version, upload_id, supersedes_snapshot_id, config_used, created_by_label)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [s.snapshotDate, s.version, s.uploadId, s.supersedesSnapshotId, JSON.stringify(s.configUsed), s.createdByLabel]);
  return r.rows[0]!.id;
}

export async function completeSnapshot(db: Queryable, id: string, counts: { totalRows: number; ingestedRows: number; rejectedRows: number; emptyRows: number; duplicateRows: number }) {
  await db.query(
    `UPDATE snapshots SET status = 'COMPLETED', completed_at = now(), total_rows = $2, ingested_rows = $3, rejected_rows = $4, empty_rows = $5, duplicate_rows = $6
     WHERE id = $1`,
    [id, counts.totalRows, counts.ingestedRows, counts.rejectedRows, counts.emptyRows, counts.duplicateRows]);
}

export interface ShipmentInsert extends NormalizedRecord {
  rawRowId: number;
  statusAgeDays: number | null;
  statusAgeBasis: string;
  statusObservedSince: string | null;
}

const SHIP_BATCH = 1500;

export async function insertShipmentRows(db: Queryable, snapshot: { id: string; date: string; uploadId: string }, rows: ShipmentInsert[]) {
  for (let start = 0; start < rows.length; start += SHIP_BATCH) {
    const chunk = rows.slice(start, start + SHIP_BATCH).map((r) => ({
      snapshot_id: snapshot.id, snapshot_date: snapshot.date, upload_id: snapshot.uploadId, raw_row_id: r.rawRowId,
      sheet_name: r.sheetName, excel_row: r.rowNumber, tracking_number: r.trackingNumber, tracking_key: r.trackingKey,
      status_raw: r.statusRaw, status_key: r.statusKey, status_code: r.statusCode, status_known: r.statusKnown,
      branch_raw: r.branchRaw, branch_key: r.branchKey, branch_id: r.branchId,
      employee_raw: r.employeeRaw, employee_key: r.employeeKey, employee_id: r.employeeId, employee_missing: r.employeeMissing,
      created_date: r.createdDate, status_entry_date: r.statusEntryDate, last_update_date: r.lastUpdateDate,
      governorate_raw: r.governorateRaw, governorate_key: r.governorateKey,
      shipment_age_days: r.shipmentAgeDays, age_category: r.ageCategory, status_age_days: r.statusAgeDays,
      status_age_basis: r.statusAgeBasis, status_observed_since: r.statusObservedSince, last_update_age_days: r.lastUpdateAgeDays,
      is_primary: r.isPrimary, duplicate_group_size: r.duplicateGroupSize, duplicate_rank: r.duplicateRank,
    }));
    await db.query(
      `INSERT INTO shipment_snapshots (snapshot_id, snapshot_date, upload_id, raw_row_id, sheet_name, excel_row, tracking_number, tracking_key,
         status_raw, status_key, status_code, status_known, branch_raw, branch_key, branch_id, employee_raw, employee_key, employee_id, employee_missing,
         created_date, status_entry_date, last_update_date, governorate_raw, governorate_key, shipment_age_days, age_category, status_age_days,
         status_age_basis, status_observed_since, last_update_age_days, is_primary, duplicate_group_size, duplicate_rank)
       SELECT snapshot_id, snapshot_date, upload_id, raw_row_id, sheet_name, excel_row, tracking_number, tracking_key,
         status_raw, status_key, status_code, status_known, branch_raw, branch_key, branch_id, employee_raw, employee_key, employee_id, employee_missing,
         created_date, status_entry_date, last_update_date, governorate_raw, governorate_key, shipment_age_days, age_category, status_age_days,
         status_age_basis, status_observed_since, last_update_age_days, is_primary, duplicate_group_size, duplicate_rank
       FROM jsonb_populate_recordset(null::shipment_snapshots, $1::jsonb)`,
      [JSON.stringify(chunk)]);
  }
}

export interface StoredShipment extends ComparableShipment {
  statusObservedSince: string | null;
}

/** Primary-occurrence shipments of a snapshot (one per tracking key). */
export async function loadPrimaryShipments(db: Queryable, snapshotId: string): Promise<StoredShipment[]> {
  const r = await db.query(
    `SELECT tracking_key, tracking_number, status_key, status_raw, branch_key, branch_raw, employee_key, employee_raw, status_observed_since
     FROM shipment_snapshots WHERE snapshot_id = $1 AND is_primary`, [snapshotId]);
  return camelizeAll<StoredShipment>(r.rows);
}

/**
 * For keys that are not in the previous snapshot: the most recent earlier presence (strictly before `beforeDate`),
 * looking only at the active (latest-version) snapshot of each earlier date.
 */
export async function loadLastSeen(db: Queryable, keys: string[], beforeDate: string): Promise<Map<string, LastSeen>> {
  const out = new Map<string, LastSeen>();
  if (keys.length === 0) return out;
  const r = await db.query(
    `WITH active AS (
       SELECT DISTINCT ON (snapshot_date) id, snapshot_date FROM snapshots
       WHERE status = 'COMPLETED' AND snapshot_date < $2 ORDER BY snapshot_date, version DESC)
     SELECT DISTINCT ON (s.tracking_key) s.tracking_key, s.tracking_number, s.snapshot_id, s.snapshot_date,
            s.status_key, s.status_raw, s.branch_key, s.branch_raw, s.employee_key, s.employee_raw
     FROM shipment_snapshots s JOIN active a ON a.id = s.snapshot_id
     WHERE s.is_primary AND s.tracking_key = ANY($1::text[])
     ORDER BY s.tracking_key, s.snapshot_date DESC`, [keys, beforeDate]);
  for (const row of r.rows) {
    out.set(row.tracking_key, {
      snapshotId: row.snapshot_id, snapshotDate: row.snapshot_date,
      shipment: {
        trackingKey: row.tracking_key, trackingNumber: row.tracking_number, statusKey: row.status_key, statusRaw: row.status_raw,
        branchKey: row.branch_key, branchRaw: row.branch_raw, employeeKey: row.employee_key, employeeRaw: row.employee_raw,
      },
    });
  }
  return out;
}

export async function insertComparison(db: Queryable, snapshotId: string, previous: { id: string; date: string } | null, result: ComparisonResult): Promise<string> {
  const c = result.counts;
  const r = await db.query<{ id: string }>(
    `INSERT INTO snapshot_comparisons (snapshot_id, previous_snapshot_id, previous_snapshot_date, days_between, mode,
       new_count, continued_count, status_changed_count, branch_changed_count, employee_changed_count, disappeared_count, reappeared_count, warnings)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [snapshotId, previous?.id ?? null, previous?.date ?? null, result.daysBetween, result.mode,
      c.NEW, c.CONTINUED, c.STATUS_CHANGED, c.BRANCH_CHANGED, c.EMPLOYEE_CHANGED, c.DISAPPEARED, c.REAPPEARED, JSON.stringify(result.warnings)]);
  const comparisonId = r.rows[0]!.id;
  const BATCH = 2000;
  for (let start = 0; start < result.items.length; start += BATCH) {
    const chunk = result.items.slice(start, start + BATCH).map((i) => ({
      comparison_id: comparisonId, tracking_key: i.trackingKey, tracking_number: i.trackingNumber, change_types: i.changeTypes,
      prev_status_raw: i.previous?.statusRaw ?? null, prev_branch_raw: i.previous?.branchRaw ?? null, prev_employee_raw: i.previous?.employeeRaw ?? null,
      curr_status_raw: i.current?.statusRaw ?? null, curr_branch_raw: i.current?.branchRaw ?? null, curr_employee_raw: i.current?.employeeRaw ?? null,
      last_seen_snapshot_id: i.lastSeenSnapshotId, last_seen_date: i.lastSeenDate,
    }));
    await db.query(
      `INSERT INTO snapshot_comparison_items (comparison_id, tracking_key, tracking_number, change_types, prev_status_raw, prev_branch_raw, prev_employee_raw,
         curr_status_raw, curr_branch_raw, curr_employee_raw, last_seen_snapshot_id, last_seen_date)
       SELECT comparison_id, tracking_key, tracking_number, change_types, prev_status_raw, prev_branch_raw, prev_employee_raw,
         curr_status_raw, curr_branch_raw, curr_employee_raw, last_seen_snapshot_id, last_seen_date
       FROM jsonb_to_recordset($1::jsonb) AS t(comparison_id uuid, tracking_key text, tracking_number text, change_types text[],
         prev_status_raw text, prev_branch_raw text, prev_employee_raw text, curr_status_raw text, curr_branch_raw text, curr_employee_raw text,
         last_seen_snapshot_id uuid, last_seen_date date)`,
      [JSON.stringify(chunk)]);
  }
  return comparisonId;
}

// ───────── read side ─────────

export async function listSnapshots(db: Queryable, page: number, pageSize: number) {
  const total = (await db.query<{ n: number }>("SELECT count(*) AS n FROM snapshots WHERE status = 'COMPLETED'")).rows[0]!.n;
  const r = await db.query(
    `SELECT s.id, s.snapshot_date, s.version, s.upload_id, s.supersedes_snapshot_id, s.total_rows, s.ingested_rows, s.rejected_rows,
            s.empty_rows, s.duplicate_rows, s.created_at, s.completed_at, u.original_filename,
            NOT EXISTS (SELECT 1 FROM snapshots n WHERE n.snapshot_date = s.snapshot_date AND n.version > s.version AND n.status = 'COMPLETED') AS is_active,
            c.mode AS comparison_mode
     FROM snapshots s JOIN uploads u ON u.id = s.upload_id LEFT JOIN snapshot_comparisons c ON c.snapshot_id = s.id
     WHERE s.status = 'COMPLETED' ORDER BY s.snapshot_date DESC, s.version DESC LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]);
  return { rows: camelizeAll(r.rows), total };
}

export interface SnapshotSummary {
  snapshot: SnapshotRow;
  totals: Record<string, number>;
  byAgeCategory: { ageCategory: string | null; n: number }[];
  byStatus: { status: string | null; n: number }[];
  byBranch: { branch: string | null; n: number; overMaxAge: number; missingEmployee: number }[];
  byStatusAgeBasis: { basis: string; n: number }[];
}

export async function getSnapshotSummary(db: Queryable, snapshot: SnapshotRow): Promise<SnapshotSummary> {
  const aging = (snapshot.configUsed as { aging?: { maxDays: number; criticalDays: number } }).aging ?? { maxDays: 15, criticalDays: 25 };
  const t = (await db.query(
    `SELECT count(*) FILTER (WHERE is_primary) AS unique_shipments,
            count(*) AS stored_rows,
            count(*) FILTER (WHERE NOT is_primary) AS duplicate_rows,
            count(*) FILTER (WHERE is_primary AND shipment_age_days > $2) AS over_max_age,
            count(*) FILTER (WHERE is_primary AND shipment_age_days > $3) AS over_critical_age,
            count(*) FILTER (WHERE is_primary AND shipment_age_days IS NULL) AS age_unknown,
            count(*) FILTER (WHERE is_primary AND employee_missing IS TRUE) AS missing_employee,
            count(*) FILTER (WHERE is_primary AND employee_missing IS NULL) AS custody_not_assessable,
            count(*) FILTER (WHERE is_primary AND status_age_basis = 'UNKNOWN_INSUFFICIENT_HISTORY') AS status_age_unknown,
            count(*) FILTER (WHERE is_primary AND last_update_age_days IS NULL) AS last_update_age_unknown,
            count(*) FILTER (WHERE is_primary AND NOT status_known) AS status_not_in_dictionary
     FROM shipment_snapshots WHERE snapshot_id = $1`, [snapshot.id, aging.maxDays, aging.criticalDays])).rows[0] as Record<string, number>;
  const byAge = (await db.query(
    `SELECT age_category, count(*) AS n FROM shipment_snapshots WHERE snapshot_id = $1 AND is_primary GROUP BY 1 ORDER BY 1`, [snapshot.id])).rows;
  const byStatus = (await db.query(
    `SELECT COALESCE(max(status_raw), '—') AS status, count(*) AS n FROM shipment_snapshots WHERE snapshot_id = $1 AND is_primary
     GROUP BY status_key ORDER BY n DESC`, [snapshot.id])).rows;
  const byBranch = (await db.query(
    `SELECT COALESCE(max(branch_raw), '—') AS branch, count(*) AS n,
            count(*) FILTER (WHERE shipment_age_days > $2) AS over_max_age,
            count(*) FILTER (WHERE employee_missing IS TRUE) AS missing_employee
     FROM shipment_snapshots WHERE snapshot_id = $1 AND is_primary GROUP BY branch_key ORDER BY n DESC`, [snapshot.id, aging.maxDays])).rows;
  const byBasis = (await db.query(
    `SELECT status_age_basis AS basis, count(*) AS n FROM shipment_snapshots WHERE snapshot_id = $1 AND is_primary GROUP BY 1 ORDER BY 1`, [snapshot.id])).rows;
  return {
    snapshot, totals: camelize<Record<string, number>>(t),
    byAgeCategory: camelizeAll(byAge) as SnapshotSummary['byAgeCategory'],
    byStatus: byStatus as SnapshotSummary['byStatus'],
    byBranch: camelizeAll(byBranch) as SnapshotSummary['byBranch'],
    byStatusAgeBasis: byBasis as SnapshotSummary['byStatusAgeBasis'],
  };
}

export async function listShipments(db: Queryable, snapshotId: string, f: { branch?: string; ageCategory?: string; employeeMissing?: boolean; q?: string; duplicatesOnly?: boolean }, page: number, pageSize: number) {
  const where = `snapshot_id = $1 AND ($2::text IS NULL OR branch_key = $2) AND ($3::text IS NULL OR age_category = $3)
    AND ($4::boolean IS NULL OR employee_missing IS NOT DISTINCT FROM $4) AND ($5::text IS NULL OR tracking_key = $5)
    AND ($6::boolean IS NULL OR (NOT is_primary) = $6 OR duplicate_group_size > 1)`;
  const args = [snapshotId, f.branch ?? null, f.ageCategory ?? null, f.employeeMissing ?? null, f.q ? f.q.toUpperCase() : null, f.duplicatesOnly ? true : null];
  const total = (await db.query<{ n: number }>(`SELECT count(*) AS n FROM shipment_snapshots WHERE ${where}`, args)).rows[0]!.n;
  const r = await db.query(
    `SELECT id, sheet_name, excel_row, tracking_number, status_raw, status_known, branch_raw, employee_raw, employee_missing,
            created_date, status_entry_date, last_update_date, governorate_raw, shipment_age_days, age_category,
            status_age_days, status_age_basis, last_update_age_days, is_primary, duplicate_group_size, duplicate_rank
     FROM shipment_snapshots WHERE ${where} ORDER BY id LIMIT $7 OFFSET $8`, [...args, pageSize, (page - 1) * pageSize]);
  return { rows: camelizeAll(r.rows), total };
}

export async function getComparison(db: Queryable, snapshotId: string) {
  const r = await db.query(
    `SELECT id, snapshot_id, previous_snapshot_id, previous_snapshot_date, days_between, mode, new_count, continued_count, status_changed_count,
            branch_changed_count, employee_changed_count, disappeared_count, reappeared_count, warnings, created_at
     FROM snapshot_comparisons WHERE snapshot_id = $1`, [snapshotId]);
  return r.rows[0] ? camelize(r.rows[0]) : null;
}

export async function listComparisonItems(db: Queryable, comparisonId: string, changeType: ChangeType | undefined, page: number, pageSize: number) {
  const total = (await db.query<{ n: number }>(
    'SELECT count(*) AS n FROM snapshot_comparison_items WHERE comparison_id = $1 AND ($2::text IS NULL OR $2 = ANY(change_types))',
    [comparisonId, changeType ?? null])).rows[0]!.n;
  const r = await db.query(
    `SELECT tracking_number, change_types, prev_status_raw, prev_branch_raw, prev_employee_raw, curr_status_raw, curr_branch_raw, curr_employee_raw,
            last_seen_snapshot_id, last_seen_date
     FROM snapshot_comparison_items WHERE comparison_id = $1 AND ($2::text IS NULL OR $2 = ANY(change_types))
     ORDER BY id LIMIT $3 OFFSET $4`, [comparisonId, changeType ?? null, pageSize, (page - 1) * pageSize]);
  return { rows: camelizeAll(r.rows), total };
}
