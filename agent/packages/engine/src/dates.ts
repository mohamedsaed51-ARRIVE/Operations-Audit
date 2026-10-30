import type { DateOrder } from '@arrive/shared';
import { normalizeDigits } from './text.js';

/**
 * Calendar-day date handling.
 *
 * Everything is reduced to a plain `YYYY-MM-DD` string. No timezone conversion is ever applied:
 * the calendar date as written in the source is the date used. A time-of-day component, if present,
 * is ignored for aging (the approved rule is calendar-day arithmetic).
 */

export type ParsedDate =
  | { kind: 'empty' }
  | { kind: 'date'; iso: string }
  | { kind: 'invalid'; reason: string };

export const MIN_PLAUSIBLE_YEAR = 2000;
export const MAX_PLAUSIBLE_YEAR = 2100;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function makeIso(y: number, m: number, d: number): ParsedDate {
  if (!isValidYmd(y, m, d)) return { kind: 'invalid', reason: 'تاريخ غير موجود في التقويم' };
  if (y < MIN_PLAUSIBLE_YEAR || y > MAX_PLAUSIBLE_YEAR) {
    return { kind: 'invalid', reason: `السنة ${y} خارج النطاق المنطقي (${MIN_PLAUSIBLE_YEAR}–${MAX_PLAUSIBLE_YEAR})` };
  }
  return { kind: 'date', iso: `${pad(y, 4)}-${pad(m)}-${pad(d)}` };
}

/** Excel serial number → ISO date. Handles the 1900 leap-year bug and the 1904 date system. */
export function excelSerialToIso(serial: number, date1904 = false): ParsedDate {
  if (!Number.isFinite(serial) || serial < 1) return { kind: 'invalid', reason: 'رقم تاريخ إكسل غير صالح' };
  const whole = Math.floor(serial);
  let ms: number;
  if (date1904) {
    ms = Date.UTC(1904, 0, 1) + whole * 86_400_000;
  } else {
    // Serial 60 is the non-existent 1900-02-29; serials after it are shifted by one day.
    if (whole === 60) return { kind: 'invalid', reason: 'تاريخ إكسل 1900-02-29 غير موجود' };
    const offset = whole > 60 ? whole - 1 : whole;
    ms = Date.UTC(1899, 11, 31) + offset * 86_400_000;
  }
  const dt = new Date(ms);
  return makeIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

const TIME_TAIL = String.raw`(?:[ T]+\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:[AaPp][Mm]|[صم])?\s*(?:Z|[+-]\d{2}:?\d{2})?)?`;
const RE_YMD = new RegExp(String.raw`^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})${TIME_TAIL}$`);
const RE_DMY = new RegExp(String.raw`^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})${TIME_TAIL}$`);

export interface DateParseOptions {
  dateOrder?: DateOrder;
  date1904?: boolean;
}

export function parseDateValue(value: unknown, opts: DateParseOptions = {}): ParsedDate {
  const order = opts.dateOrder ?? 'DMY';
  if (value === null || value === undefined) return { kind: 'empty' };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { kind: 'invalid', reason: 'تاريخ غير صالح' };
    return makeIso(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === 'boolean') return { kind: 'invalid', reason: 'قيمة منطقية وليست تاريخًا' };
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 19_000_101 && value <= 21_001_231) {
      const s = String(value);
      return makeIso(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
    }
    return excelSerialToIso(value, opts.date1904);
  }
  const s = normalizeDigits(String(value)).replace(/\s+/g, ' ').trim();
  if (s === '') return { kind: 'empty' };

  let m = RE_YMD.exec(s);
  if (m) return makeIso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = RE_DMY.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = Number(m[3]);
    return order === 'DMY' ? makeIso(y, b, a) : makeIso(y, a, b);
  }
  if (/^\d{8}$/.test(s)) return makeIso(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
  return { kind: 'invalid', reason: 'صيغة التاريخ غير معروفة' };
}

function ymdToUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Whole calendar days from `fromIso` to `toIso` (negative if `toIso` is earlier). */
export function diffDays(fromIso: string, toIso: string): number {
  return Math.round((ymdToUtc(toIso) - ymdToUtc(fromIso)) / 86_400_000);
}

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return isValidYmd(y, m, d);
}

/** Today's calendar date in the given IANA timezone. */
export function todayIso(timeZone = 'Africa/Cairo', now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts; // en-CA yields YYYY-MM-DD
}
