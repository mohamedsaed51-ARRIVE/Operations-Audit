import {
  FIELD_KEYS, type ColumnCandidate, type FieldDetection, type FieldKey, type SheetDetection,
} from '@arrive/shared';
import { CREATED_DATE_EXCLUDES, DATE_WORDS, FIELD_ALIASES, NON_DATE_FIELDS, SENSITIVE_HEADER_WORDS } from './aliases.js';
import { parseDateValue } from './dates.js';
import { cleanText, editDistance, foldKey } from './text.js';

export const CONFIDENT_MIN_SCORE = 0.85;
export const AMBIGUITY_MARGIN = 0.15;
export const CANDIDATE_MIN_SCORE = 0.3;
const HEADER_SCAN_ROWS = 30;
const CONTENT_SAMPLE_ROWS = 1000;

const isTextual = (v: unknown) => typeof v === 'string' && v.trim() !== '' && Number.isNaN(Number(v.trim()));
const isEmptyCell = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

// ───────────────────────── Header row ─────────────────────────

const ALIAS_KEYS: string[] = [...new Set(FIELD_KEYS.flatMap((f) => FIELD_ALIASES[f].map((al) => foldKey(al.text))))];

function aliasHitCount(row: unknown[]): number {
  let n = 0;
  for (const cell of row) {
    if (!isTextual(cell)) continue;
    const k = foldKey(cell);
    if (ALIAS_KEYS.includes(k) || ALIAS_KEYS.some((al) => al.length >= 4 && containsPhrase(k, al))) n++;
  }
  return n;
}

export function detectHeaderRow(rows: unknown[][]): { index: number; confidence: 'HIGH' | 'LOW' } | null {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  let best = -1;
  let bestHits = 0;
  for (let i = 0; i < limit; i++) {
    const hits = aliasHitCount(rows[i]!);
    if (hits > bestHits) { best = i; bestHits = hits; }
  }
  if (best >= 0 && bestHits >= 2) return { index: best, confidence: 'HIGH' };
  if (best >= 0 && bestHits === 1) {
    // a single recognised header is still plausible if the row looks like text labels
    const textual = rows[best]!.filter(isTextual).length;
    if (textual >= 2) return { index: best, confidence: 'LOW' };
  }
  for (let i = 0; i < limit; i++) {
    if (rows[i]!.filter(isTextual).length >= 2) return { index: i, confidence: 'LOW' };
  }
  return null;
}

// ───────────────────────── Scoring ─────────────────────────

function containsPhrase(headerKey: string, aliasKey: string): boolean {
  if (aliasKey === '') return false;
  return ` ${headerKey} `.includes(` ${aliasKey} `);
}

function headerTokens(headerKey: string): string[] {
  return headerKey.split(' ').filter(Boolean);
}

interface HeaderScore { score: number; reason: string }

function scoreHeader(field: FieldKey, header: string): HeaderScore {
  const hk = foldKey(header);
  if (hk === '') return { score: 0, reason: '' };
  const tokens = headerTokens(hk);

  // Date-ness gates
  const hasDateWord = DATE_WORDS.some((w) => tokens.includes(foldKey(w)));
  if ((NON_DATE_FIELDS as readonly string[]).includes(field) && hasDateWord) return { score: 0, reason: '' };
  if (field === 'createdDate' && CREATED_DATE_EXCLUDES.some((w) => tokens.includes(foldKey(w)))) return { score: 0, reason: '' };

  let best: HeaderScore = { score: 0, reason: '' };
  for (const alias of FIELD_ALIASES[field]) {
    const ak = foldKey(alias.text);
    const w = alias.weight ?? 1;
    let s = 0;
    let why = '';
    if (hk === ak) { s = 1 * w; why = `تطابق تام مع «${alias.text}»`; }
    else if (containsPhrase(hk, ak)) { s = 0.75 * w; why = `يحتوي على «${alias.text}» مع كلمات إضافية`; }
    else if (ak.length >= 5 && hk.length >= 5 && editDistance(hk, ak, 1) === 1) { s = 0.7 * w; why = `قريب من «${alias.text}» (فرق حرف واحد)`; }
    if (s > best.score) best = { score: s, reason: why };
  }
  return best;
}

interface ColumnStats {
  nonEmpty: number;
  uniqueRatio: number;
  dateRatio: number;
  numericRatio: number;
  avgLen: number;
}

function columnStats(rows: unknown[][], col: number): ColumnStats {
  const vals: unknown[] = [];
  for (const r of rows) if (!isEmptyCell(r[col])) vals.push(r[col]);
  const n = vals.length;
  if (n === 0) return { nonEmpty: 0, uniqueRatio: 0, dateRatio: 0, numericRatio: 0, avgLen: 0 };
  const uniq = new Set(vals.map((v) => foldKey(v))).size;
  const dates = vals.filter((v) => parseDateValue(v).kind === 'date').length;
  const numeric = vals.filter((v) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)))).length;
  const avgLen = vals.reduce<number>((s, v) => s + cleanText(v).length, 0) / n;
  return { nonEmpty: n, uniqueRatio: uniq / n, dateRatio: dates / n, numericRatio: numeric / n, avgLen };
}

function adjustByContent(field: FieldKey, score: number, st: ColumnStats, reasons: string[]): number {
  if (score === 0 || st.nonEmpty === 0) return score;
  let s = score;
  if (field === 'createdDate' || field === 'statusEntryDate' || field === 'lastUpdateDate') {
    if (st.dateRatio < 0.5) { s *= 0.4; reasons.push('أقل من نصف القيم تُقرأ كتواريخ'); }
  } else if (field === 'tracking') {
    if (st.uniqueRatio < 0.5) { s *= 0.7; reasons.push('قيم متكررة كثيرًا لعمود رقم شحنة'); }
  } else if (field === 'status' || field === 'branch' || field === 'governorate') {
    if (st.uniqueRatio > 0.8 && st.nonEmpty > 20) { s *= 0.6; reasons.push('كل القيم تقريبًا فريدة (غير معتاد لهذا الحقل)'); }
  } else if (field === 'employee') {
    if (st.numericRatio > 0.8) { s *= 0.5; reasons.push('القيم رقمية بالكامل (قد يكون كود وليس اسمًا)'); }
  }
  return s;
}

// ───────────────────────── Column detection ─────────────────────────

export function headersFromRow(row: unknown[]): string[] {
  return row.map((c) => cleanText(c));
}

export function detectColumns(rows: unknown[][], headerRowIndex: number, headerConfidence: 'HIGH' | 'LOW' = 'HIGH'): SheetDetection {
  const headerRow = rows[headerRowIndex] ?? [];
  const headers = headersFromRow(headerRow);
  const dataRows = rows.slice(headerRowIndex + 1, headerRowIndex + 1 + CONTENT_SAMPLE_ROWS);
  const width = Math.max(headers.length, ...dataRows.map((r) => r.length), 0);

  const seen = new Map<string, number>();
  for (const h of headers) if (h !== '') seen.set(foldKey(h), (seen.get(foldKey(h)) ?? 0) + 1);
  const duplicateHeaders = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);

  const stats: ColumnStats[] = Array.from({ length: width }, (_, c) => columnStats(dataRows, c));

  // candidate lists per field
  const perField = {} as Record<FieldKey, ColumnCandidate[]>;
  for (const field of FIELD_KEYS) {
    const cands: ColumnCandidate[] = [];
    for (let c = 0; c < width; c++) {
      const header = headers[c] ?? '';
      const hs = scoreHeader(field, header);
      const reasons = hs.reason ? [hs.reason] : [];
      let score = adjustByContent(field, hs.score, stats[c]!, reasons);
      // Headerless-tracking heuristic: unlabeled/unrecognised column that looks like a tracking id.
      if (field === 'tracking' && hs.score === 0 && stats[c]!.nonEmpty >= 5 && stats[c]!.uniqueRatio > 0.95 && stats[c]!.avgLen >= 6 && stats[c]!.avgLen <= 20) {
        score = 0.32;
        reasons.push('قيم فريدة بطول يشبه أرقام الشحنات (استدلال من المحتوى فقط)');
      }
      if (score >= CANDIDATE_MIN_SCORE) cands.push({ columnIndex: c, header, score: round2(score), reasons });
    }
    cands.sort((x, y) => y.score - x.score || x.columnIndex - y.columnIndex);
    perField[field] = cands;
  }

  const fields = {} as Record<FieldKey, FieldDetection>;
  for (const field of FIELD_KEYS) {
    const cands = perField[field];
    const top = cands[0];
    if (!top) {
      fields[field] = { field, status: 'MISSING', suggestedColumn: null, confidence: 0, candidates: [] };
      continue;
    }
    const second = cands[1];
    const closeRival = second !== undefined && top.score - second.score < AMBIGUITY_MARGIN;
    // Another field claims the same column with a similar score → ambiguous across fields.
    const claimedElsewhere = FIELD_KEYS.some((other) => {
      if (other === field) return false;
      const o = perField[other][0];
      return o !== undefined && o.columnIndex === top.columnIndex && Math.abs(o.score - top.score) < AMBIGUITY_MARGIN;
    });
    let status: FieldDetection['status'];
    if (closeRival || claimedElsewhere) status = 'AMBIGUOUS';
    else if (top.score >= CONFIDENT_MIN_SCORE) status = 'CONFIDENT';
    else status = 'LOW';
    fields[field] = { field, status, suggestedColumn: top.columnIndex, confidence: top.score, candidates: cands.slice(0, 5) };
  }

  return { headerRowIndex, headerConfidence, headers, duplicateHeaders, fields };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Detects header row then columns. Returns null when the sheet has no usable header. */
export function detectSheet(rows: unknown[][]): SheetDetection | null {
  const h = detectHeaderRow(rows);
  if (!h) return null;
  return detectColumns(rows, h.index, h.confidence);
}

export function isSensitiveHeader(header: string): boolean {
  const hk = foldKey(header);
  if (hk === '') return false;
  return SENSITIVE_HEADER_WORDS.some((w) => {
    const wk = foldKey(w);
    if (wk.includes(' ')) return hk.includes(wk);
    // also match with the Arabic definite article removed («العنوان» ↔ «عنوان»)
    return headerTokens(hk).some((t) => t === wk || (t.startsWith('ال') && t.slice(2) === wk));
  });
}
