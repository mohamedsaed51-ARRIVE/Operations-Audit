/**
 * Text normalisation helpers.
 *
 * Two distinct outputs are produced for every text value:
 *  - `clean…`: the human-readable value (trimmed, whitespace collapsed, digits unified). Spelling is untouched.
 *  - `…Key`:   an aggressively folded matching key (Arabic letter variants, diacritics, case).
 * The original cell is never altered — it stays in raw_rows.
 */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXT_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(s: string): string {
  let out = '';
  for (const ch of s) {
    const a = ARABIC_INDIC.indexOf(ch);
    if (a >= 0) { out += String(a); continue; }
    const b = EXT_ARABIC_INDIC.indexOf(ch);
    out += b >= 0 ? String(b) : ch;
  }
  return out;
}

/** Zero-width / bidi control characters that commonly sneak into copied Excel text. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00AD]/g;

export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(INVISIBLE, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TASHKEEL = /[ً-ٰٟۖ-ۭ]/g;

/** Matching key: Arabic letter folding, digits unified, punctuation reduced, lower-cased. */
export function foldKey(value: unknown): string {
  const s = normalizeDigits(cleanText(value))
    .replace(TASHKEEL, '')
    .replace(/ـ/g, '') // tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .toLowerCase();
  return s
    .replace(/[\s_\-./\\:;,،؛|()[\]{}'"`~*+=<>!?؟@#$%^&]+/g, ' ')
    .trim();
}

const MISSING_SENTINELS = new Set([
  '', '-', '--', '---', 'null', 'none', 'n/a', 'na', 'nan', 'nil', '#n/a', 'undefined',
  'غير محدد', 'غير معروف', 'لا يوجد', 'لايوجد', 'بدون', 'فارغ', 'مفيش',
].map((s) => foldKey(s)));

/** True for empty cells and for placeholder text that means "no value". */
export function isMissingValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return MISSING_SENTINELS.has(foldKey(value));
  return false;
}

/** Levenshtein distance with an early-exit bound. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
    cur = [];
  }
  return prev[b.length]!;
}
