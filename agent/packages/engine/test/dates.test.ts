import { describe, expect, it } from 'vitest';
import { diffDays, excelSerialToIso, isIsoDate, parseDateValue, todayIso } from '../src/index.js';

describe('parseDateValue', () => {
  it.each([
    ['2026-10-05', '2026-10-05'],
    ['2026/10/05', '2026-10-05'],
    ['5/10/2026', '2026-10-05'],
    ['05-10-2026', '2026-10-05'],
    ['05.10.2026', '2026-10-05'],
    ['2026-10-05 14:30:00', '2026-10-05'],
    ['2026-10-05T23:59:59Z', '2026-10-05'],
    ['05/10/2026 02:15 PM', '2026-10-05'],
    ['٢٠٢٦-١٠-٠٥', '2026-10-05'],
    ['٥/١٠/٢٠٢٦', '2026-10-05'],
    ['20261005', '2026-10-05'],
    [20261005, '2026-10-05'],
  ])('reads %s as %s', (input, expected) => {
    expect(parseDateValue(input)).toEqual({ kind: 'date', iso: expected });
  });

  it('applies day-first by default and month-first on request', () => {
    expect(parseDateValue('03/04/2026')).toEqual({ kind: 'date', iso: '2026-04-03' });
    expect(parseDateValue('03/04/2026', { dateOrder: 'MDY' })).toEqual({ kind: 'date', iso: '2026-03-04' });
  });

  it('reads Excel serials (independently known: 45292 = 2024-01-01, 46300 = 2026-10-05)', () => {
    expect(excelSerialToIso(45292)).toEqual({ kind: 'date', iso: '2024-01-01' });
    expect(parseDateValue(46300)).toEqual({ kind: 'date', iso: '2026-10-05' });
    expect(parseDateValue(46300.75)).toEqual({ kind: 'date', iso: '2026-10-05' }); // time of day ignored
  });

  it('honours the 1904 date system', () => {
    // 1904 system serial = 1900 system serial − 1462
    expect(excelSerialToIso(46300 - 1462, true)).toEqual({ kind: 'date', iso: '2026-10-05' });
  });

  it.each(['2026-02-30', '31/04/2026', '2026-13-01', 'غير معروف', 'tomorrow', '99/99/9999'])('rejects %s as invalid', (v) => {
    expect(parseDateValue(v).kind).toBe('invalid');
  });

  it('rejects implausible years, booleans, and impossible serials', () => {
    expect(parseDateValue('1999-01-01').kind).toBe('invalid');
    expect(parseDateValue('2101-01-01').kind).toBe('invalid');
    expect(parseDateValue(true).kind).toBe('invalid');
    expect(parseDateValue(-5).kind).toBe('invalid');
    expect(parseDateValue(60).kind).toBe('invalid'); // phantom 1900-02-29
  });

  it('treats blanks as empty, not invalid', () => {
    expect(parseDateValue(null)).toEqual({ kind: 'empty' });
    expect(parseDateValue('   ')).toEqual({ kind: 'empty' });
    expect(parseDateValue(undefined)).toEqual({ kind: 'empty' });
  });
});

describe('diffDays', () => {
  it('counts calendar days', () => {
    expect(diffDays('2026-10-20', '2026-10-20')).toBe(0);
    expect(diffDays('2026-10-05', '2026-10-20')).toBe(15);
    expect(diffDays('2026-10-20', '2026-10-05')).toBe(-15);
  });
  it('is unaffected by month, leap-year and DST boundaries', () => {
    expect(diffDays('2024-02-28', '2024-03-01')).toBe(2); // leap year
    expect(diffDays('2025-02-28', '2025-03-01')).toBe(1);
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffDays('2025-12-31', '2026-01-01')).toBe(1);
  });
});

describe('helpers', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('26-02-28')).toBe(false);
    expect(isIsoDate(5)).toBe(false);
  });
  it('computes today in a timezone', () => {
    // 2026-10-30 22:30 UTC is already 2026-10-31 in Cairo (UTC+2; DST ended 2026-10-30)
    expect(todayIso('Africa/Cairo', new Date('2026-10-30T22:30:00Z'))).toBe('2026-10-31');
    expect(todayIso('UTC', new Date('2026-10-30T22:30:00Z'))).toBe('2026-10-30');
  });
});
