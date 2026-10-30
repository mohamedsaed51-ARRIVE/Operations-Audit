import {
  FIELD_KEYS, REQUIRED_FIELDS, type DateOrder, type FieldKey, type SheetDetection, type SheetMappingInput,
} from '@arrive/shared';
import { parseDateValue } from './dates.js';
import { makeIssue, type EngineIssue } from './issues.js';
import { foldKey, isMissingValue } from './text.js';

export interface ResolvedSheetMapping {
  sheetIndex: number;
  headerRowIndex: number;
  /** field → zero-based column index (within the materialised row arrays). */
  columns: Partial<Record<FieldKey, number>>;
  dateOrder: DateOrder;
}

export interface MappingValidation {
  ok: boolean;
  mapping: ResolvedSheetMapping | null;
  /** Blocking problems (severity ERROR). */
  errors: EngineIssue[];
  /** Non-blocking observations. */
  warnings: EngineIssue[];
}

/**
 * Validates a user-submitted mapping against what detection found.
 *
 * Policy: a field whose detection was not CONFIDENT may only be mapped when the user lists it in
 * `acknowledged` — the suggestion is never applied silently.
 */
export function validateMapping(
  sheetName: string,
  detection: SheetDetection,
  sampleRows: unknown[][],
  input: SheetMappingInput,
): MappingValidation {
  const errors: EngineIssue[] = [];
  const warnings: EngineIssue[] = [];
  const ctx = (field: FieldKey | null, extra: Partial<Parameters<typeof makeIssue>[1]> = {}) => ({
    worksheet: sheetName, field: field ?? undefined, ...extra,
  });

  const width = Math.max(detection.headers.length, ...sampleRows.map((r) => r.length), 0);
  const columns: Partial<Record<FieldKey, number>> = {};
  const used = new Map<number, FieldKey>();

  for (const field of FIELD_KEYS) {
    const col = input.fields[field];
    if (col === null || col === undefined) continue;
    if (!Number.isInteger(col) || col < 0 || col >= width) {
      errors.push(makeIssue('MAPPING_COLUMN_OUT_OF_RANGE', ctx(field, { originalValue: col })));
      continue;
    }
    const prior = used.get(col);
    if (prior) {
      errors.push(makeIssue('MAPPING_COLUMN_CONFLICT', ctx(field, { detail: `العمود ${col + 1} مربوط أيضًا بالحقل «${prior}».` })));
      continue;
    }
    used.set(col, field);
    columns[field] = col;

    const det = detection.fields[field];
    const acknowledged = input.acknowledged.includes(field);
    if (det.status !== 'CONFIDENT') {
      if (!acknowledged) {
        errors.push(makeIssue('MAPPING_FIELD_NOT_CONFIDENT', ctx(field, {
          severity: 'ERROR',
          detail: `حالة الكشف: ${det.status}. أكّد الاختيار صراحةً.`,
        })));
      } else {
        warnings.push(makeIssue('MAPPING_FIELD_NOT_CONFIDENT', ctx(field, { detail: `حالة الكشف: ${det.status}؛ أكّده المستخدم.` })));
      }
    } else if (det.suggestedColumn !== col && !acknowledged) {
      // Confident suggestion overridden manually: allowed, but recorded.
      warnings.push(makeIssue('MAPPING_FIELD_NOT_CONFIDENT', ctx(field, {
        severity: 'INFO', detail: 'اختار المستخدم عمودًا مختلفًا عن الاقتراح الواثق.',
      })));
    }

    // content sanity on the chosen column
    const sample = sampleRows.map((r) => r[col]).filter((v) => !isMissingValue(v));
    if (sample.length >= 3) {
      if (['createdDate', 'statusEntryDate', 'lastUpdateDate'].includes(field)) {
        const ok = sample.filter((v) => parseDateValue(v, { dateOrder: input.dateOrder ?? 'DMY' }).kind === 'date').length;
        if (ok / sample.length < 0.5) {
          warnings.push(makeIssue('MAPPING_CONTENT_MISMATCH', ctx(field, { detail: `${ok} من ${sample.length} قيمة فقط تُقرأ كتاريخ.` })));
        }
      }
      if (field === 'tracking') {
        const uniq = new Set(sample.map((v) => foldKey(v))).size;
        if (uniq / sample.length < 0.5) {
          warnings.push(makeIssue('MAPPING_CONTENT_MISMATCH', ctx(field, { detail: 'أكثر من نصف قيم العمود مكررة.' })));
        }
      }
    }
  }

  for (const field of REQUIRED_FIELDS) {
    if (columns[field] === undefined && !errors.some((e) => e.field === field)) {
      errors.push(makeIssue('MAPPING_REQUIRED_MISSING', ctx(field)));
    }
  }
  if (columns.employee === undefined) warnings.push(makeIssue('MAPPING_EMPLOYEE_COLUMN_MISSING', ctx('employee')));
  for (const field of ['statusEntryDate', 'lastUpdateDate', 'governorate'] as const) {
    if (columns[field] === undefined) warnings.push(makeIssue('MAPPING_OPTIONAL_MISSING', ctx(field)));
  }
  if (detection.duplicateHeaders.length > 0) {
    warnings.push(makeIssue('SHEET_DUPLICATE_HEADERS', ctx(null, { detail: detection.duplicateHeaders.join('، ') })));
  }
  if (detection.headerConfidence === 'LOW') warnings.push(makeIssue('SHEET_HEADER_UNCERTAIN', ctx(null)));

  const ok = errors.length === 0;
  return {
    ok,
    mapping: ok ? { sheetIndex: input.sheetIndex, headerRowIndex: detection.headerRowIndex, columns, dateOrder: input.dateOrder ?? 'DMY' } : null,
    errors,
    warnings,
  };
}
