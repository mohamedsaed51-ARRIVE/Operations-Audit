import { describe, expect, it } from 'vitest';
import { cleanText, editDistance, findPossibleDuplicateNames, foldKey, isMissingValue, normalizeDigits, normalizeEmployee } from '../src/index.js';

describe('text normalisation', () => {
  it('folds Arabic letter variants for matching but keeps the display spelling', () => {
    expect(foldKey('أحمد  إبراهيم')).toBe(foldKey('احمد ابراهيم'));
    expect(foldKey('القاهرة')).toBe(foldKey('القاهره'));
    expect(foldKey('مُحَمَّد')).toBe(foldKey('محمد'));
    expect(foldKey('عهدة_العضو')).toBe(foldKey('عهدة العضو'));
    expect(cleanText('  أحمد   إبراهيم ')).toBe('أحمد إبراهيم');
  });
  it('unifies Arabic-Indic digits', () => {
    expect(normalizeDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(normalizeDigits('۱۲۳')).toBe('123');
  });
  it('removes invisible characters', () => {
    expect(cleanText('ab​c d')).toBe('abc d');
  });
  it('recognises missing-value sentinels', () => {
    for (const v of [null, undefined, '', '  ', '-', 'N/A', 'null', 'غير محدد', 'لا يوجد']) expect(isMissingValue(v)).toBe(true);
    for (const v of ['محمد', 0, 'ok']) expect(isMissingValue(v)).toBe(false);
  });
  it('computes bounded edit distance', () => {
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('abc', 'abd', 1)).toBe(1);
    expect(editDistance('abcdef', 'xyzxyz', 1)).toBeGreaterThan(1);
  });
});

describe('employee identity', () => {
  it('returns null for missing custody', () => {
    expect(normalizeEmployee(null)).toBeNull();
    expect(normalizeEmployee('غير محدد')).toBeNull();
  });
  it('keeps display spelling and a folded key', () => {
    expect(normalizeEmployee(' أحمد   علي ')).toEqual({ display: 'أحمد علي', key: foldKey('احمد علي') });
  });
  it('flags near-identical distinct names but not different people', () => {
    const pairs = findPossibleDuplicateNames([foldKey('محمد عبدالله حسن'), foldKey('محمد عبدالله حسين'), foldKey('احمد سمير علي')]);
    expect(pairs).toHaveLength(1);
  });
});
