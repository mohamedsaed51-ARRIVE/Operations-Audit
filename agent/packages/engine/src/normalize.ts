import { DEFAULT_AGING_CONFIG, type AgeCategory, type AgingConfig, type FieldKey } from '@arrive/shared';
import { ageCategory, lastUpdateAgeDays, shipmentAgeDays } from './aging.js';
import { diffDays, parseDateValue } from './dates.js';
import { findPossibleDuplicateNames, normalizeEmployee } from './employees.js';
import { makeIssue, type EngineIssue, type IssueCode } from './issues.js';
import type { ResolvedSheetMapping } from './mapping.js';
import { cleanText, foldKey, isMissingValue, normalizeDigits } from './text.js';

// ───────────────────────── Registries (plain data, loaded by the caller) ─────────────────────────

export interface RegistryContext {
  /** Folded status alias → dictionary entry. */
  statuses: Map<string, { code: string; label: string }>;
  /** Folded branch name or alias → branch. Empty map ⇒ registry not configured. */
  branches: Map<string, { id: string; name: string }>;
  /** Folded employee name → employee. */
  employees: Map<string, { id: string; branchId: string | null; verified: boolean }>;
}

export const EMPTY_REGISTRIES: RegistryContext = { statuses: new Map(), branches: new Map(), employees: new Map() };

// ───────────────────────── Types ─────────────────────────

export interface SheetInput {
  sheetName: string;
  rows: unknown[][];
  firstExcelRow: number;
  mapping: ResolvedSheetMapping;
  date1904: boolean;
}

export interface NormalizedRecord {
  sheetName: string;
  rowNumber: number;
  trackingNumber: string;
  trackingKey: string;
  statusRaw: string | null;
  statusKey: string | null;
  statusCode: string | null;
  statusKnown: boolean;
  branchRaw: string | null;
  branchKey: string | null;
  branchId: string | null;
  employeeRaw: string | null;
  employeeKey: string | null;
  employeeId: string | null;
  /** null when the sheet has no employee column (custody cannot be assessed). */
  employeeMissing: boolean | null;
  createdDate: string | null;
  statusEntryDate: string | null;
  lastUpdateDate: string | null;
  /** True when the status-entry date is a plausible, usable evidence (not future, not before creation). */
  statusEntryUsable: boolean;
  governorateRaw: string | null;
  governorateKey: string | null;
  shipmentAgeDays: number | null;
  ageCategory: AgeCategory | null;
  lastUpdateAgeDays: number | null;
  isPrimary: boolean;
  duplicateGroupSize: number;
  duplicateRank: number;
}

export interface NormalizeStats {
  totalRows: number;
  emptyRows: number;
  rejectedRows: number;
  ingestedRows: number;
  duplicateRows: number;
}

export interface NormalizeResult {
  records: NormalizedRecord[];
  issues: EngineIssue[];
  stats: NormalizeStats;
}

export interface NormalizeOptions {
  snapshotDate: string;
  registries: RegistryContext;
  aging?: AgingConfig;
}

// ───────────────────────── Tracking ─────────────────────────

const SCIENTIFIC = /^\d+(\.\d+)?e[+-]?\d+$/i;
const TRACKING_SHAPE = /^[A-Z0-9][A-Z0-9\-_/]{3,39}$/;

type TrackingOutcome =
  | { ok: true; value: string }
  | { ok: false; code: 'MISSING_TRACKING' | 'INVALID_TRACKING_TYPE' | 'INVALID_DATA_TYPE'; detail?: string };

export function normalizeTracking(v: unknown): TrackingOutcome {
  if (isMissingValue(v)) return { ok: false, code: 'MISSING_TRACKING' };
  if (typeof v === 'boolean') return { ok: false, code: 'INVALID_DATA_TYPE', detail: 'قيمة منطقية في عمود رقم الشحنة.' };
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) return { ok: false, code: 'INVALID_TRACKING_TYPE', detail: 'قيمة عشرية.' };
    if (!Number.isSafeInteger(v)) return { ok: false, code: 'INVALID_TRACKING_TYPE', detail: 'الرقم أكبر من دقة إكسل (15 رقمًا)؛ قد تكون الأرقام الأخيرة فُقدت.' };
    return { ok: true, value: String(v) };
  }
  const s = normalizeDigits(cleanText(v)).replace(/\s+/g, '').toUpperCase();
  if (s === '') return { ok: false, code: 'MISSING_TRACKING' };
  if (SCIENTIFIC.test(s)) return { ok: false, code: 'INVALID_TRACKING_TYPE', detail: 'الرقم بصيغة علمية (E+) وفُقدت أرقامه.' };
  return { ok: true, value: s };
}

// ───────────────────────── Row normalisation ─────────────────────────

const colOf = (m: ResolvedSheetMapping, f: FieldKey): number | undefined => m.columns[f];
const isEmptyCell = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export function normalizeSheet(
  sheet: SheetInput,
  opts: NormalizeOptions,
  startRow = 0,
): { records: NormalizedRecord[]; issues: EngineIssue[]; stats: Omit<NormalizeStats, 'duplicateRows'> } {
  const { mapping } = sheet;
  const aging = opts.aging ?? DEFAULT_AGING_CONFIG;
  const reg = opts.registries;
  const records: NormalizedRecord[] = [];
  const issues: EngineIssue[] = [];
  let totalRows = 0, emptyRows = 0, rejectedRows = 0;

  const dataStart = Math.max(mapping.headerRowIndex + 1, startRow);
  for (let i = dataStart; i < sheet.rows.length; i++) {
    const row = sheet.rows[i]!;
    const rowNumber = sheet.firstExcelRow + i;
    totalRows++;
    const at = (code: IssueCode, field: FieldKey | null, original: unknown, detail?: string) =>
      issues.push(makeIssue(code, { worksheet: sheet.sheetName, rowNumber, field, originalValue: original, detail }));

    if (row.every(isEmptyCell)) {
      emptyRows++;
      issues.push(makeIssue('EMPTY_ROW', { worksheet: sheet.sheetName, rowNumber }));
      continue;
    }

    // tracking (identity of the row — without it the row cannot enter the snapshot)
    const tCol = colOf(mapping, 'tracking')!;
    const tracking = normalizeTracking(row[tCol]);
    if (!tracking.ok) {
      rejectedRows++;
      at(tracking.code, 'tracking', row[tCol], tracking.detail);
      continue;
    }
    if (!TRACKING_SHAPE.test(tracking.value)) at('INVALID_TRACKING_FORMAT', 'tracking', row[tCol]);

    // status
    const sCol = colOf(mapping, 'status')!;
    let statusRaw: string | null = null, statusKey: string | null = null, statusCode: string | null = null, statusKnown = false;
    if (isMissingValue(row[sCol])) at('MISSING_STATUS', 'status', row[sCol]);
    else {
      statusRaw = cleanText(row[sCol]);
      statusKey = foldKey(statusRaw);
      const hit = reg.statuses.get(statusKey);
      if (hit) {
        statusCode = hit.code;
        statusKnown = true;
        // Dictionary aliases of one status (e.g. «جديد» / «New») must compare as the same status across snapshots.
        statusKey = `code:${hit.code}`;
      } else if (reg.statuses.size > 0) at('UNKNOWN_STATUS', 'status', row[sCol]);
    }

    // branch
    const bCol = colOf(mapping, 'branch')!;
    let branchRaw: string | null = null, branchKey: string | null = null, branchId: string | null = null;
    if (isMissingValue(row[bCol])) at('MISSING_BRANCH', 'branch', row[bCol]);
    else {
      branchRaw = cleanText(row[bCol]);
      branchKey = foldKey(branchRaw);
      const hit = reg.branches.get(branchKey);
      if (hit) {
        branchId = hit.id;
        // Aliases resolve to the registered branch, so «Cairo» and «القاهرة» are not a branch change.
        branchKey = foldKey(hit.name);
      } else if (reg.branches.size > 0) at('UNKNOWN_BRANCH', 'branch', row[bCol]);
    }

    // employee (primary custody evidence)
    const eCol = colOf(mapping, 'employee');
    let employeeRaw: string | null = null, employeeKey: string | null = null, employeeId: string | null = null;
    let employeeMissing: boolean | null = null;
    if (eCol !== undefined) {
      const id = normalizeEmployee(row[eCol]);
      if (!id) {
        employeeMissing = true;
        at('MISSING_EMPLOYEE', 'employee', row[eCol]);
      } else {
        employeeMissing = false;
        employeeRaw = id.display;
        employeeKey = id.key;
        if (reg.employees.size > 0) {
          const hit = reg.employees.get(id.key);
          if (!hit) at('UNKNOWN_EMPLOYEE', 'employee', row[eCol]);
          else {
            employeeId = hit.id;
            if (hit.verified && hit.branchId && branchId && hit.branchId !== branchId) {
              at('EMPLOYEE_BRANCH_MISMATCH', 'employee', row[eCol], `الفرع في الجرد: «${branchRaw}».`);
            }
          }
        }
      }
    }

    // dates
    const parseOpts = { dateOrder: mapping.dateOrder, date1904: sheet.date1904 };
    const readDate = (field: 'createdDate' | 'statusEntryDate' | 'lastUpdateDate'): string | null => {
      const col = colOf(mapping, field);
      if (col === undefined) return null;
      const p = parseDateValue(row[col], parseOpts);
      if (p.kind === 'empty') {
        if (field === 'createdDate') at('MISSING_CREATED_DATE', field, row[col]);
        return null;
      }
      if (p.kind === 'invalid') { at('INVALID_DATE', field, row[col], p.reason); return null; }
      if (diffDays(p.iso, opts.snapshotDate) < 0) at('FUTURE_DATE', field, row[col], `التاريخ ${p.iso} بعد تاريخ الجرد ${opts.snapshotDate}.`);
      return p.iso;
    };
    const createdDate = readDate('createdDate');
    const statusEntryDate = readDate('statusEntryDate');
    const lastUpdateDate = readDate('lastUpdateDate');

    if (createdDate && statusEntryDate && diffDays(createdDate, statusEntryDate) < 0) {
      at('CONFLICTING_DATES', 'statusEntryDate', row[colOf(mapping, 'statusEntryDate')!], `تاريخ الحالة ${statusEntryDate} قبل تاريخ الإنشاء ${createdDate}.`);
    }
    if (createdDate && lastUpdateDate && diffDays(createdDate, lastUpdateDate) < 0) {
      at('CONFLICTING_DATES', 'lastUpdateDate', row[colOf(mapping, 'lastUpdateDate')!], `آخر تحديث ${lastUpdateDate} قبل تاريخ الإنشاء ${createdDate}.`);
    }

    const age = shipmentAgeDays(opts.snapshotDate, createdDate);
    const statusEntryUsable =
      statusEntryDate !== null &&
      diffDays(statusEntryDate, opts.snapshotDate) >= 0 &&
      (createdDate === null || diffDays(createdDate, statusEntryDate) >= 0);
    const lastUpdateUsable =
      lastUpdateDate !== null && (createdDate === null || diffDays(createdDate, lastUpdateDate) >= 0);

    // governorate (optional)
    const gCol = colOf(mapping, 'governorate');
    const govRaw = gCol !== undefined && !isMissingValue(row[gCol]) ? cleanText(row[gCol]) : null;

    records.push({
      sheetName: sheet.sheetName,
      rowNumber,
      trackingNumber: tracking.value,
      trackingKey: tracking.value,
      statusRaw, statusKey, statusCode, statusKnown,
      branchRaw, branchKey, branchId,
      employeeRaw, employeeKey, employeeId, employeeMissing,
      createdDate, statusEntryDate, lastUpdateDate, statusEntryUsable,
      governorateRaw: govRaw,
      governorateKey: govRaw ? foldKey(govRaw) : null,
      shipmentAgeDays: age,
      ageCategory: ageCategory(age, aging),
      lastUpdateAgeDays: lastUpdateUsable ? lastUpdateAgeDays(opts.snapshotDate, lastUpdateDate) : null,
      isPrimary: true,
      duplicateGroupSize: 1,
      duplicateRank: 1,
    });
  }
  return { records, issues, stats: { totalRows, emptyRows, rejectedRows, ingestedRows: records.length } };
}

// ───────────────────────── Workbook-level pass ─────────────────────────

/**
 * Normalises every mapped sheet, then applies the cross-sheet checks (duplicates, employee name variants,
 * possible duplicate people, empty registries). No row is ever dropped for being a duplicate — the first
 * occurrence is flagged primary and the others stay stored and flagged.
 */
export function normalizeWorkbook(sheets: SheetInput[], opts: NormalizeOptions): NormalizeResult {
  const records: NormalizedRecord[] = [];
  const issues: EngineIssue[] = [];
  const stats: NormalizeStats = { totalRows: 0, emptyRows: 0, rejectedRows: 0, ingestedRows: 0, duplicateRows: 0 };

  for (const sheet of sheets) {
    const r = normalizeSheet(sheet, opts);
    records.push(...r.records);
    issues.push(...r.issues);
    stats.totalRows += r.stats.totalRows;
    stats.emptyRows += r.stats.emptyRows;
    stats.rejectedRows += r.stats.rejectedRows;
  }
  stats.ingestedRows = records.length;

  // duplicates
  const groups = new Map<string, NormalizedRecord[]>();
  for (const rec of records) {
    const g = groups.get(rec.trackingKey);
    if (g) g.push(rec); else groups.set(rec.trackingKey, [rec]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const first = group[0]!;
    group.forEach((rec, idx) => {
      rec.isPrimary = idx === 0;
      rec.duplicateRank = idx + 1;
      rec.duplicateGroupSize = group.length;
      issues.push(makeIssue('DUPLICATE_TRACKING', {
        worksheet: rec.sheetName, rowNumber: rec.rowNumber, field: 'tracking', originalValue: rec.trackingNumber,
        detail: `ورد ${group.length} مرات؛ أول ظهور: ورقة «${first.sheetName}» صف ${first.rowNumber}.`,
      }));
      if (idx > 0 && (rec.statusKey !== first.statusKey || rec.branchKey !== first.branchKey || rec.employeeKey !== first.employeeKey)) {
        issues.push(makeIssue('DUPLICATE_CONFLICTING_VALUES', {
          worksheet: rec.sheetName, rowNumber: rec.rowNumber, field: 'tracking', originalValue: rec.trackingNumber,
          detail: `يختلف عن أول ظهور (صف ${first.rowNumber}) في: ${[
            rec.statusKey !== first.statusKey ? 'الحالة' : '',
            rec.branchKey !== first.branchKey ? 'الفرع' : '',
            rec.employeeKey !== first.employeeKey ? 'الموظف' : '',
          ].filter(Boolean).join('، ')}.`,
        }));
      }
    });
    stats.duplicateRows += group.length - 1;
  }

  // employee identity consistency
  const displaysByKey = new Map<string, Set<string>>();
  for (const rec of records) {
    if (rec.employeeKey && rec.employeeRaw) {
      const set = displaysByKey.get(rec.employeeKey) ?? new Set<string>();
      set.add(rec.employeeRaw);
      displaysByKey.set(rec.employeeKey, set);
    }
  }
  for (const [, set] of displaysByKey) {
    if (set.size > 1) {
      issues.push(makeIssue('EMPLOYEE_NAME_VARIANTS', { field: 'employee', detail: `الكتابات: ${[...set].map((s) => `«${s}»`).join('، ')}.` }));
    }
  }
  for (const pair of findPossibleDuplicateNames([...displaysByKey.keys()])) {
    issues.push(makeIssue('EMPLOYEE_POSSIBLE_DUPLICATE', { field: 'employee', detail: `«${pair.a}» ≈ «${pair.b}».` }));
  }

  // registry coverage notes
  const hasEmployeeColumn = sheets.some((s) => s.mapping.columns.employee !== undefined);
  if (opts.registries.branches.size === 0 && records.length > 0) issues.push(makeIssue('BRANCH_REGISTRY_EMPTY', { field: 'branch' }));
  if (opts.registries.employees.size === 0 && hasEmployeeColumn && records.length > 0) issues.push(makeIssue('EMPLOYEE_REGISTRY_EMPTY', { field: 'employee' }));

  return { records, issues, stats };
}
