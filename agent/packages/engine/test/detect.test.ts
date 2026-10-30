import { describe, expect, it } from 'vitest';
import { detectHeaderRow, detectSheet, isSensitiveHeader } from '../src/index.js';
import { AR_HEADERS, EN_HEADERS } from './helpers.js';

const body = (n: number) =>
  Array.from({ length: n }, (_, i) => [`EG${100000 + i}`, 'مع المندوب', 'القاهرة', `موظف ${i % 5}`, '2026-10-01', 'القاهرة']);

describe('header row detection', () => {
  it('finds the header below title rows', () => {
    const rows = [['تقرير الجرد اليومي'], [], AR_HEADERS, ...body(3)];
    expect(detectHeaderRow(rows)).toEqual({ index: 2, confidence: 'HIGH' });
  });
  it('flags a header with no recognised names as low confidence', () => {
    const rows = [['colA', 'colB', 'colC'], ['1', '2', '3']];
    expect(detectHeaderRow(rows)).toEqual({ index: 0, confidence: 'LOW' });
  });
  it('returns null when there is no textual row', () => {
    expect(detectHeaderRow([[1, 2], [3, 4]])).toBeNull();
  });
});

describe('column detection', () => {
  it('maps the Arabic header set confidently', () => {
    const d = detectSheet([AR_HEADERS, ...body(30)])!;
    expect(d.fields.tracking).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 0 });
    expect(d.fields.status).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 1 });
    expect(d.fields.branch).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 2 });
    expect(d.fields.employee).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 3 });
    expect(d.fields.createdDate).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 4 });
    expect(d.fields.governorate).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 5 });
    expect(d.fields.statusEntryDate.status).toBe('MISSING');
    expect(d.fields.lastUpdateDate.status).toBe('MISSING');
  });

  it('maps the English header set confidently', () => {
    const d = detectSheet([EN_HEADERS, ...body(30)])!;
    expect(d.fields.tracking.suggestedColumn).toBe(0);
    expect(d.fields.status.suggestedColumn).toBe(1);
    expect(d.fields.branch.suggestedColumn).toBe(2);
    expect(d.fields.employee.suggestedColumn).toBe(3);
    expect(d.fields.createdDate.suggestedColumn).toBe(4);
    expect(Object.values(d.fields).filter((f) => f.status === 'CONFIDENT')).toHaveLength(6);
  });

  it('does not read «تاريخ الحالة» as the status or «تاريخ الشحنة» as status-entry date', () => {
    const headers = ['بوليصة', 'الحالة', 'تاريخ الحالة', 'تاريخ الشحنة', 'الفرع', 'آخر تحديث'];
    const rows = Array.from({ length: 10 }, (_, i) => [`EG${200000 + i}`, 'مع المندوب', '2026-10-02', '2026-10-01', 'الجيزة', '2026-10-03']);
    const d = detectSheet([headers, ...rows])!;
    expect(d.fields.status.suggestedColumn).toBe(1);
    expect(d.fields.statusEntryDate.suggestedColumn).toBe(2);
    expect(d.fields.createdDate.suggestedColumn).toBe(3);
    expect(d.fields.lastUpdateDate.suggestedColumn).toBe(5);
  });

  it('marks two equally good tracking columns as AMBIGUOUS instead of choosing', () => {
    const headers = ['Tracking Number', 'Shipment ID', 'Status', 'Branch', 'Created At'];
    const rows = Array.from({ length: 10 }, (_, i) => [`EG${300000 + i}`, `SH${i}00000`, 'New', 'Cairo', '2026-10-01']);
    const d = detectSheet([headers, ...rows])!;
    expect(d.fields.tracking.status).toBe('AMBIGUOUS');
    expect(d.fields.tracking.candidates.map((c) => c.columnIndex).sort()).toEqual([0, 1]);
  });

  it('does not treat a related-but-different header as confident («الفرع المرسل»)', () => {
    const headers = ['بوليصة', 'الحالة', 'الفرع المرسل', 'تاريخ الشحنة'];
    const rows = Array.from({ length: 10 }, (_, i) => [`EG${400000 + i}`, 'جديد', 'الإسكندرية', '2026-10-01']);
    const d = detectSheet([headers, ...rows])!;
    expect(d.fields.branch.suggestedColumn).toBe(2);
    expect(d.fields.branch.status).toBe('LOW');
  });

  it('keeps courier columns below confident for the employee field', () => {
    const headers = ['بوليصة', 'الحالة', 'الفرع', 'المندوب', 'تاريخ الشحنة'];
    const rows = Array.from({ length: 10 }, (_, i) => [`EG${500000 + i}`, 'جديد', 'الجيزة', `مندوب ${i}`, '2026-10-01']);
    const d = detectSheet([headers, ...rows])!;
    expect(d.fields.employee.status).toBe('LOW');
  });

  it('downgrades a date-named column that contains no dates', () => {
    const headers = ['بوليصة', 'الحالة', 'الفرع', 'تاريخ الشحنة'];
    const rows = Array.from({ length: 10 }, (_, i) => [`EG${600000 + i}`, 'جديد', 'الجيزة', `نص ${i}`]);
    const d = detectSheet([headers, ...rows])!;
    expect(d.fields.createdDate.status).not.toBe('CONFIDENT');
  });

  it('suggests an unlabeled tracking-like column only as low confidence', () => {
    const headers = ['كود', 'الحالة', 'الفرع', 'تاريخ الشحنة'];
    const rows = Array.from({ length: 10 }, (_, i) => [`EG${700000 + i}`, 'جديد', 'الجيزة', '2026-10-01']);
    const d = detectSheet([headers, ...rows])!;
    expect(d.fields.tracking).toMatchObject({ status: 'LOW', suggestedColumn: 0 });
  });

  it('reports duplicate headers', () => {
    const d = detectSheet([['بوليصة', 'الحالة', 'الحالة', 'الفرع', 'تاريخ الشحنة'], ['EG1', 'a', 'b', 'c', '2026-10-01']])!;
    expect(d.duplicateHeaders).toHaveLength(1);
  });
});

describe('sensitive header masking', () => {
  it('flags personal/financial headers', () => {
    for (const h of ['Phone', 'تليفون العميل', 'العنوان', 'Customer Name', 'COD', 'المرسل إليه']) expect(isSensitiveHeader(h)).toBe(true);
    for (const h of ['الفرع', 'بوليصة', 'الحالة']) expect(isSensitiveHeader(h)).toBe(false);
  });
});
