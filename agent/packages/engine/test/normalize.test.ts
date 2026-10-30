import { describe, expect, it } from 'vitest';
import {
  EMPTY_REGISTRIES, foldKey, normalizeTracking, normalizeWorkbook, type RegistryContext, type SheetInput,
} from '../src/index.js';

const SNAP = '2026-10-20';
const mapping = {
  sheetIndex: 0, headerRowIndex: 0, dateOrder: 'DMY' as const,
  columns: { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4, statusEntryDate: 5, lastUpdateDate: 6, governorate: 7 },
};
const sheet = (rows: unknown[][], name = 'جرد'): SheetInput => ({ sheetName: name, rows: [['h'], ...rows], firstExcelRow: 1, mapping, date1904: false });
const codes = (r: ReturnType<typeof normalizeWorkbook>) => r.issues.map((i) => i.code);

describe('normalizeTracking', () => {
  it('handles numbers, strings and bad types', () => {
    expect(normalizeTracking(1234567890)).toEqual({ ok: true, value: '1234567890' });
    expect(normalizeTracking(' eg 100 200 ')).toEqual({ ok: true, value: 'EG100200' });
    expect(normalizeTracking('٣٤٥٦٧٨٩٠')).toEqual({ ok: true, value: '34567890' });
    expect(normalizeTracking(null)).toMatchObject({ ok: false, code: 'MISSING_TRACKING' });
    expect(normalizeTracking('1.2345E+13')).toMatchObject({ ok: false, code: 'INVALID_TRACKING_TYPE' });
    expect(normalizeTracking(12.5)).toMatchObject({ ok: false, code: 'INVALID_TRACKING_TYPE' });
    expect(normalizeTracking(1e20)).toMatchObject({ ok: false, code: 'INVALID_TRACKING_TYPE' });
    expect(normalizeTracking(true)).toMatchObject({ ok: false, code: 'INVALID_DATA_TYPE' });
  });
});

describe('normalizeWorkbook', () => {
  it('normalises a clean row and computes its age', () => {
    const r = normalizeWorkbook([sheet([['EG100001', 'مع المندوب', 'القاهرة', 'أحمد علي', '2026-10-05', null, '2026-10-17', 'القاهرة']])], { snapshotDate: SNAP, registries: EMPTY_REGISTRIES });
    expect(r.records).toHaveLength(1);
    expect(r.records[0]).toMatchObject({
      trackingKey: 'EG100001', statusKey: foldKey('مع المندوب'), branchKey: foldKey('القاهرة'),
      employeeRaw: 'أحمد علي', employeeMissing: false, createdDate: '2026-10-05',
      shipmentAgeDays: 15, ageCategory: 'D8_15', lastUpdateAgeDays: 3, rowNumber: 2,
    });
  });

  it('reports every row-level problem without deleting rows silently', () => {
    const rows = [
      ['EG100002', 'مع المندوب', 'القاهرة', null, '2026-10-05', null, null, null], // missing employee
      [null, 'مع المندوب', 'القاهرة', 'أحمد', '2026-10-05', null, null, null], // missing tracking → rejected
      ['EG100003', null, 'القاهرة', 'أحمد', '2026-10-05', null, null, null], // missing status
      ['EG100004', 'جديد', null, 'أحمد', '2026-10-05', null, null, null], // missing branch
      ['EG100005', 'جديد', 'القاهرة', 'أحمد', '2026-02-30', null, null, null], // invalid date
      ['EG100006', 'جديد', 'القاهرة', 'أحمد', '2026-10-25', null, null, null], // future creation
      ['EG100007', 'جديد', 'القاهرة', 'أحمد', null, null, null, null], // missing created date
      [null, null, null, null, null, null, null, null], // empty row
      ['EG100008', 'جديد', 'القاهرة', 'أحمد', '2026-10-10', '2026-10-01', '2026-10-02', null], // conflicting dates
    ];
    const r = normalizeWorkbook([sheet(rows)], { snapshotDate: SNAP, registries: EMPTY_REGISTRIES });
    expect(r.stats).toMatchObject({ totalRows: 9, emptyRows: 1, rejectedRows: 1, ingestedRows: 7 });
    const c = codes(r);
    for (const code of ['MISSING_EMPLOYEE', 'MISSING_TRACKING', 'MISSING_STATUS', 'MISSING_BRANCH', 'INVALID_DATE', 'FUTURE_DATE', 'MISSING_CREATED_DATE', 'EMPTY_ROW', 'CONFLICTING_DATES']) {
      expect(c, code).toContain(code);
    }
    // Excel row numbers are exact (header is row 1)
    expect(r.issues.find((i) => i.code === 'MISSING_TRACKING')).toMatchObject({ rowNumber: 3, worksheet: 'جرد', field: 'tracking' });
    expect(r.issues.find((i) => i.code === 'INVALID_DATE')).toMatchObject({ rowNumber: 6, originalValue: '2026-02-30' });
    // the future-dated and invalid-dated shipments are kept, with no age
    expect(r.records.find((x) => x.trackingKey === 'EG100006')?.shipmentAgeDays).toBeNull();
    expect(r.records.find((x) => x.trackingKey === 'EG100005')?.createdDate).toBeNull();
    // custody exception is classified as a business warning, not an accusation
    expect(r.issues.find((i) => i.code === 'MISSING_EMPLOYEE')).toMatchObject({ category: 'BUSINESS_WARNING', severity: 'WARNING' });
  });

  it('flags duplicates but keeps every row; first occurrence is primary', () => {
    const rows = [
      ['EG100010', 'جديد', 'القاهرة', 'أحمد', '2026-10-05', null, null, null],
      ['EG100010', 'تم التسليم', 'الجيزة', 'محمد', '2026-10-05', null, null, null],
      ['eg100010', 'جديد', 'القاهرة', 'أحمد', '2026-10-05', null, null, null],
    ];
    const r = normalizeWorkbook([sheet(rows)], { snapshotDate: SNAP, registries: EMPTY_REGISTRIES });
    expect(r.records).toHaveLength(3);
    expect(r.records.map((x) => x.isPrimary)).toEqual([true, false, false]);
    expect(r.records.map((x) => x.duplicateRank)).toEqual([1, 2, 3]);
    expect(r.stats.duplicateRows).toBe(2);
    expect(codes(r).filter((c) => c === 'DUPLICATE_TRACKING')).toHaveLength(3);
    expect(codes(r).filter((c) => c === 'DUPLICATE_CONFLICTING_VALUES')).toHaveLength(1);
  });

  it('detects duplicates across sheets', () => {
    const row = ['EG100011', 'جديد', 'القاهرة', 'أحمد', '2026-10-05', null, null, null];
    const r = normalizeWorkbook([sheet([row], 'أ'), sheet([row], 'ب')], { snapshotDate: SNAP, registries: EMPTY_REGISTRIES });
    expect(r.records.filter((x) => x.isPrimary)).toHaveLength(1);
    expect(r.issues.find((i) => i.code === 'DUPLICATE_TRACKING' && i.worksheet === 'ب')?.explanation).toContain('أول ظهور');
  });

  it('uses registries for unknown status/branch/employee and employee–branch mismatch', () => {
    const registries: RegistryContext = {
      statuses: new Map([[foldKey('جديد'), { code: 'NEW', label: 'جديد' }]]),
      branches: new Map([
        [foldKey('القاهرة'), { id: 'b-cai', name: 'القاهرة' }],
        [foldKey('الجيزة'), { id: 'b-giz', name: 'الجيزة' }],
      ]),
      employees: new Map([[foldKey('أحمد علي'), { id: 'e1', branchId: 'b-cai', verified: true }]]),
    };
    const rows = [
      ['EG100101', 'جديد', 'القاهرة', 'أحمد علي', '2026-10-05', null, null, null], // all good
      ['EG100102', 'حالة غريبة', 'مدينة نصر', 'شخص مجهول', '2026-10-05', null, null, null], // 3 unknowns
      ['EG100103', 'جديد', 'الجيزة', 'احمد علي', '2026-10-05', null, null, null], // verified employee in other branch
    ];
    const r = normalizeWorkbook([sheet(rows)], { snapshotDate: SNAP, registries });
    const c = codes(r);
    expect(c).toContain('UNKNOWN_STATUS');
    expect(c).toContain('UNKNOWN_BRANCH');
    expect(c).toContain('UNKNOWN_EMPLOYEE');
    expect(c).toContain('EMPLOYEE_BRANCH_MISMATCH');
    expect(r.issues.filter((i) => i.rowNumber === 2).map((i) => i.code)).toEqual([]);
    expect(r.records[0]).toMatchObject({ statusKnown: true, branchId: 'b-cai', employeeId: 'e1' });
  });

  it('notes empty registries once instead of flagging every row', () => {
    const r = normalizeWorkbook([sheet([['EG1', 'جديد', 'القاهرة', 'أحمد', '2026-10-05', null, null, null]])], { snapshotDate: SNAP, registries: EMPTY_REGISTRIES });
    expect(codes(r)).toContain('BRANCH_REGISTRY_EMPTY');
    expect(codes(r)).toContain('EMPLOYEE_REGISTRY_EMPTY');
    expect(codes(r)).not.toContain('UNKNOWN_BRANCH');
  });

  it('records employee name variants and possible duplicate people as advisory', () => {
    const rows = [
      ['EG1', 'جديد', 'القاهرة', 'أحمد   إبراهيم', '2026-10-05', null, null, null],
      ['EG2', 'جديد', 'القاهرة', 'احمد ابراهيم', '2026-10-05', null, null, null],
      ['EG3', 'جديد', 'القاهرة', 'محمد عبدالله حسن', '2026-10-05', null, null, null],
      ['EG4', 'جديد', 'القاهرة', 'محمد عبدالله حسين', '2026-10-05', null, null, null],
    ];
    const r = normalizeWorkbook([sheet(rows)], { snapshotDate: SNAP, registries: EMPTY_REGISTRIES });
    expect(codes(r)).toContain('EMPLOYEE_NAME_VARIANTS');
    expect(codes(r)).toContain('EMPLOYEE_POSSIBLE_DUPLICATE');
    expect(r.records[0]!.employeeKey).toBe(r.records[1]!.employeeKey);
  });

  it('does not report missing employees when the sheet has no employee column', () => {
    const m = { ...mapping, columns: { tracking: 0, status: 1, branch: 2, createdDate: 4 } };
    const r = normalizeWorkbook([{ ...sheet([['EG1', 'جديد', 'القاهرة', null, '2026-10-05']]), mapping: m }], { snapshotDate: SNAP, registries: EMPTY_REGISTRIES });
    expect(codes(r)).not.toContain('MISSING_EMPLOYEE');
    expect(r.records[0]!.employeeMissing).toBeNull();
  });

  it('never mutates the input rows', () => {
    const rows = [['EG100099', ' جديد ', 'القاهره', 'أحمد', '5/10/2026', null, null, null]];
    const input = sheet(rows);
    const before = JSON.stringify(input.rows);
    normalizeWorkbook([input], { snapshotDate: SNAP, registries: EMPTY_REGISTRIES });
    expect(JSON.stringify(input.rows)).toBe(before);
  });

  it('keeps Excel row numbers correct when the sheet starts below row 1', () => {
    const s: SheetInput = { ...sheet([['EG1', 'جديد', 'القاهرة', 'أحمد', null, null, null, null]]), firstExcelRow: 5 };
    const r = normalizeWorkbook([s], { snapshotDate: SNAP, registries: EMPTY_REGISTRIES });
    expect(r.issues.find((i) => i.code === 'MISSING_CREATED_DATE')?.rowNumber).toBe(6);
  });
});

describe('canonical keys from registries', () => {
  it('maps status and branch aliases to one comparison key', () => {
    const registries: RegistryContext = {
      statuses: new Map([[foldKey('جديد'), { code: 'NEW', label: 'جديد' }], [foldKey('New'), { code: 'NEW', label: 'جديد' }]]),
      branches: new Map([[foldKey('القاهرة'), { id: 'b1', name: 'القاهرة' }], [foldKey('Cairo'), { id: 'b1', name: 'القاهرة' }]]),
      employees: new Map(),
    };
    const r = normalizeWorkbook([sheet([
      ['EG100201', 'جديد', 'القاهرة', 'أحمد', '2026-10-05', null, null, null],
      ['EG100202', 'New', 'Cairo', 'أحمد', '2026-10-05', null, null, null],
    ])], { snapshotDate: SNAP, registries });
    expect(r.records[0]!.statusKey).toBe(r.records[1]!.statusKey);
    expect(r.records[0]!.branchKey).toBe(r.records[1]!.branchKey);
    expect(r.records[1]).toMatchObject({ statusRaw: 'New', branchRaw: 'Cairo' }); // display values untouched
  });
});
