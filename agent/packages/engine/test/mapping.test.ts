import { describe, expect, it } from 'vitest';
import type { SheetMappingInput } from '@arrive/shared';
import { detectSheet, validateMapping } from '../src/index.js';
import { AR_HEADERS } from './helpers.js';

const rows = [
  AR_HEADERS,
  ...Array.from({ length: 10 }, (_, i) => [`EG${100000 + i}`, 'مع المندوب', 'القاهرة', `موظف ${i}`, '2026-10-01', 'القاهرة']),
];
const det = detectSheet(rows)!;
const base: SheetMappingInput = {
  sheetIndex: 0, include: true, acknowledged: [],
  fields: { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4, governorate: 5 },
};

describe('validateMapping', () => {
  it('accepts a complete confident mapping', () => {
    const r = validateMapping('S', det, rows.slice(1), base);
    expect(r.ok).toBe(true);
    expect(r.mapping?.columns).toMatchObject({ tracking: 0, createdDate: 4 });
    expect(r.warnings.map((w) => w.code)).toContain('MAPPING_OPTIONAL_MISSING');
  });

  it('rejects when a required field is missing', () => {
    const r = validateMapping('S', det, rows.slice(1), { ...base, fields: { ...base.fields, branch: null } });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain('MAPPING_REQUIRED_MISSING');
  });

  it('rejects one column mapped to two fields', () => {
    const r = validateMapping('S', det, rows.slice(1), { ...base, fields: { ...base.fields, status: 0 } });
    expect(r.errors.map((e) => e.code)).toContain('MAPPING_COLUMN_CONFLICT');
  });

  it('rejects out-of-range columns', () => {
    const r = validateMapping('S', det, rows.slice(1), { ...base, fields: { ...base.fields, governorate: 99 } });
    expect(r.errors.map((e) => e.code)).toContain('MAPPING_COLUMN_OUT_OF_RANGE');
  });

  it('requires explicit acknowledgement for non-confident fields', () => {
    const lowDet = detectSheet([
      ['بوليصة', 'الحالة', 'الفرع المرسل', 'تاريخ الشحنة'],
      ...Array.from({ length: 10 }, (_, i) => [`EG${i}00000`, 'جديد', 'الجيزة', '2026-10-01']),
    ])!;
    const body = lowDet.headers.length ? [] : [];
    const input: SheetMappingInput = { sheetIndex: 0, include: true, acknowledged: [], fields: { tracking: 0, status: 1, branch: 2, createdDate: 3 } };
    const refused = validateMapping('S', lowDet, body, input);
    expect(refused.ok).toBe(false);
    expect(refused.errors.map((e) => e.code)).toContain('MAPPING_FIELD_NOT_CONFIDENT');
    const accepted = validateMapping('S', lowDet, body, { ...input, acknowledged: ['branch'] });
    expect(accepted.ok).toBe(true);
    expect(accepted.warnings.some((w) => w.code === 'MAPPING_FIELD_NOT_CONFIDENT')).toBe(true);
  });

  it('warns when the chosen date column does not look like dates', () => {
    const r = validateMapping('S', det, rows.slice(1), { ...base, acknowledged: ['status'], fields: { ...base.fields, createdDate: 1, status: 4 } });
    expect(r.warnings.map((w) => w.code)).toContain('MAPPING_CONTENT_MISMATCH');
  });

  it('warns that the employee column is missing but still allows ingestion', () => {
    const r = validateMapping('S', det, rows.slice(1), { ...base, fields: { ...base.fields, employee: null } });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.code)).toContain('MAPPING_EMPLOYEE_COLUMN_MISSING');
  });
});
