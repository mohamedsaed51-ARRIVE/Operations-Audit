import { createHash, randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FieldKey, SheetDetection, SheetMappingInput } from '@arrive/shared';
import { FIELD_KEYS } from '@arrive/shared';
import {
  DEFAULT_FILE_LIMITS, FileProcessingError, detectColumns, detectSheet, headersFromRow, isSensitiveHeader, makeIssue, normalizeSheet,
  parseUploadedFile, todayIso, isIsoDate, validateMapping, type EngineIssue, type FileLimits, type MappingValidation,
} from '@arrive/engine';
import {
  countProcessedWithSha, createUpload, getLatestMappings, getRawRows, getSheets, getUpload, insertIssues, insertRawRows, insertSheet,
  issueSummary, loadRegistries, loadSettings, saveMapping, setSheetStatus, setUploadStatus, withTransaction, writeAudit,
  type IssueInsert, type SheetRow, type UploadRow,
} from '@arrive/database';
import { AppError, conflict, notFound, unprocessable } from '../errors.js';
import type { ServiceContext } from './context.js';

const toInsert = (uploadId: string, stage: IssueInsert['stage'], sheetId: string | null, i: EngineIssue): IssueInsert =>
  ({ ...i, uploadId, sheetId, snapshotId: null, rawRowId: null, stage });

export function limitsFromSettings(s: Awaited<ReturnType<typeof loadSettings>>): FileLimits {
  return {
    ...DEFAULT_FILE_LIMITS,
    maxBytes: s.upload.maxMb * 1024 * 1024,
    maxRows: s.upload.maxRows,
    maxColumns: s.upload.maxColumns,
    maxSheets: s.upload.maxSheets,
  };
}

/** Keeps only a safe display name; the stored file never uses the client-supplied name. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'upload';
  const printable = [...base].filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f).join('');
  return printable.slice(0, 200) || 'upload';
}

// ───────────────────────── Create (POST /api/uploads) ─────────────────────────

export interface CreateUploadInput {
  filename: string;
  buffer: Buffer;
  snapshotDate: string;
  /** Set when the multipart size limit cut the stream. */
  truncated?: boolean;
}

export async function createUploadFromFile(ctx: ServiceContext, input: CreateUploadInput) {
  const settings = await loadSettings(ctx.pool);
  const limits = limitsFromSettings(settings);
  const filename = safeFilename(input.filename);

  if (!isIsoDate(input.snapshotDate)) {
    throw unprocessable('INVALID_SNAPSHOT_DATE', 'تاريخ الجرد مطلوب بصيغة YYYY-MM-DD وبتاريخ صحيح.');
  }
  const today = todayIso(settings.dates.timezone, ctx.now());
  if (input.snapshotDate > today) {
    throw unprocessable('INVALID_SNAPSHOT_DATE', `تاريخ الجرد ${input.snapshotDate} في المستقبل (اليوم ${today}).`);
  }

  const sha256 = createHash('sha256').update(input.buffer).digest('hex');
  const reject = async (issue: EngineIssue): Promise<never> => {
    await withTransaction(ctx.pool, async (tx) => {
      const u = await createUpload(tx, {
        originalFilename: filename, storedPath: null, sha256, sizeBytes: input.buffer.byteLength, fileType: null,
        snapshotDate: input.snapshotDate, status: 'REJECTED', failureReason: issue.explanation,
        uploadedByLabel: ctx.actor.label, uploadedBy: ctx.actor.id, requestId: ctx.requestId,
      });
      await insertIssues(tx, [toInsert(u.id, 'UPLOAD', null, issue)]);
      await writeAudit(tx, { requestId: ctx.requestId, actorId: ctx.actor.id, actorLabel: ctx.actor.label, action: 'UPLOAD_REJECTED', entityType: 'upload', entityId: u.id, outcome: 'FAILURE', details: { filename, code: issue.code } });
    });
    throw new AppError(422, 'FILE_REJECTED', issue.explanation, { issues: [issue] });
  };

  if (input.truncated) {
    return reject(makeIssue('FILE_TOO_LARGE', { field: 'file', originalValue: filename, detail: `الحد ${settings.upload.maxMb} MB.` }));
  }

  let parsed;
  try {
    parsed = await parseUploadedFile({ filename, buffer: input.buffer }, limits);
  } catch (e) {
    if (e instanceof FileProcessingError) return reject({ ...e.issue, originalValue: filename });
    throw e;
  }

  // Persist the original file first; remove it again if the database transaction fails.
  await mkdir(ctx.config.uploadDir, { recursive: true });
  const storedPath = join(ctx.config.uploadDir, `${randomUUID()}.${parsed.fileType}`);
  await writeFile(storedPath, input.buffer, { mode: 0o600 });

  try {
    const uploadId = await withTransaction(ctx.pool, async (tx) => {
      const upload = await createUpload(tx, {
        originalFilename: filename, storedPath, sha256, sizeBytes: input.buffer.byteLength, fileType: parsed.fileType,
        snapshotDate: input.snapshotDate, status: 'UPLOADED', date1904: parsed.date1904,
        uploadedByLabel: ctx.actor.label, uploadedBy: ctx.actor.id, requestId: ctx.requestId,
      });
      const issues: IssueInsert[] = parsed.warnings.map((w) => toInsert(upload.id, 'UPLOAD', null, w));
      if ((await countProcessedWithSha(tx, sha256)) > 0) issues.push(toInsert(upload.id, 'UPLOAD', null, makeIssue('FILE_DUPLICATE_CONTENT', { field: 'file', originalValue: filename })));

      for (const sheet of parsed.sheets) {
        const empty = sheet.rows.length === 0 || sheet.rows.every((r) => r.every((c) => c === null || c === undefined || (typeof c === 'string' && c.trim() === '')));
        const detection: SheetDetection | null = empty ? null : detectSheet(sheet.rows);
        const sheetId = await insertSheet(tx, {
          uploadId: upload.id, sheetIndex: sheet.index, name: sheet.name, hidden: sheet.hidden, rowCount: sheet.rows.length,
          firstExcelRow: sheet.firstExcelRow, firstColumn: sheet.firstColumn, headerRowIndex: detection?.headerRowIndex ?? null,
          headers: detection ? detection.headers : [], detection, status: empty ? 'SKIPPED' : 'DETECTED',
        });
        await insertRawRows(tx, upload.id, sheetId, sheet.firstExcelRow, sheet.rows);
        if (empty) issues.push(toInsert(upload.id, 'UPLOAD', sheetId, makeIssue('SHEET_EMPTY', { worksheet: sheet.name })));
        else if (!detection) issues.push(toInsert(upload.id, 'UPLOAD', sheetId, makeIssue('SHEET_NO_HEADER', { worksheet: sheet.name })));
        else {
          if (detection.headerConfidence === 'LOW') issues.push(toInsert(upload.id, 'UPLOAD', sheetId, makeIssue('SHEET_HEADER_UNCERTAIN', { worksheet: sheet.name })));
          if (detection.duplicateHeaders.length > 0) issues.push(toInsert(upload.id, 'UPLOAD', sheetId, makeIssue('SHEET_DUPLICATE_HEADERS', { worksheet: sheet.name, detail: detection.duplicateHeaders.join('، ') })));
        }
      }
      await insertIssues(tx, issues);
      await writeAudit(tx, {
        requestId: ctx.requestId, actorId: ctx.actor.id, actorLabel: ctx.actor.label, action: 'UPLOAD_CREATED', entityType: 'upload', entityId: upload.id,
        details: { filename, sha256, sizeBytes: input.buffer.byteLength, fileType: parsed.fileType, sheets: parsed.sheets.length, snapshotDate: input.snapshotDate },
      });
      return upload.id;
    });
    return getUploadDetail(ctx, uploadId);
  } catch (e) {
    await unlink(storedPath).catch(() => undefined);
    throw e;
  }
}

// ───────────────────────── Read ─────────────────────────

export async function getUploadDetail(ctx: Pick<ServiceContext, 'pool'>, id: string) {
  const upload = await getUpload(ctx.pool, id);
  if (!upload) throw notFound('الرفع');
  const [sheets, mappings, issues] = await Promise.all([getSheets(ctx.pool, id), getLatestMappings(ctx.pool, id), issueSummary(ctx.pool, id)]);
  const { storedPath: _hidden, ...publicUpload } = upload;
  const snap = (await ctx.pool.query<{ id: string; snapshot_date: string; version: number }>(
    "SELECT id, snapshot_date, version FROM snapshots WHERE upload_id = $1 AND status = 'COMPLETED'", [id])).rows[0];
  return {
    upload: publicUpload,
    snapshot: snap ? { id: snap.id, snapshotDate: snap.snapshot_date, version: snap.version } : null,
    sheets: sheets.map((s) => ({ ...s, mapping: mappings.find((m) => m.sheetId === s.id) ?? null })),
    issueSummary: issues,
  };
}

export const MASKED = '••• (محجوب)';
const MAX_CELL_CHARS = 80;

export async function previewUpload(ctx: Pick<ServiceContext, 'pool'>, id: string, sheetIndex: number, limit: number) {
  const upload = await getUpload(ctx.pool, id);
  if (!upload) throw notFound('الرفع');
  const sheet = (await getSheets(ctx.pool, id)).find((s) => s.sheetIndex === sheetIndex);
  if (!sheet) throw notFound('ورقة العمل');
  const headerIdx = sheet.headerRowIndex ?? 0;
  const rows = await getRawRows(ctx.pool, sheet.id, { limit: headerIdx + 1 + limit });
  const width = Math.max(sheet.headers.length, ...rows.map((r) => r.cells.length), 0);
  const headers = sheet.headers.length ? sheet.headers : headersFromRow(rows[headerIdx]?.cells ?? []);
  const masked = Array.from({ length: width }, (_, c) => isSensitiveHeader(headers[c] ?? ''));
  const cell = (v: unknown, col: number) => {
    if (v === null || v === undefined || v === '') return null;
    if (masked[col]) return MASKED;
    const s = typeof v === 'string' ? v : String(v);
    return s.length > MAX_CELL_CHARS ? `${s.slice(0, MAX_CELL_CHARS)}…` : s;
  };
  return {
    sheet: { index: sheet.sheetIndex, name: sheet.name, rowCount: sheet.rowCount, firstExcelRow: sheet.firstExcelRow, headerRowIndex: sheet.headerRowIndex },
    headers,
    maskedColumns: masked.map((m, i) => (m ? i : -1)).filter((i) => i >= 0),
    detection: sheet.detection as SheetDetection | null,
    rows: rows.slice(headerIdx + 1).map((r) => ({ rowNumber: r.rowNumber, cells: Array.from({ length: width }, (_, c) => cell(r.cells[c], c)) })),
    note: 'الأعمدة الحساسة (هاتف/عنوان/عميل/مبالغ…) محجوبة في المعاينة؛ البيانات الأصلية محفوظة دون تعديل.',
  };
}

// ───────────────────────── Mapping ─────────────────────────

export interface SheetMappingOutcome {
  sheetIndex: number;
  sheetName: string;
  included: boolean;
  ok: boolean;
  errors: EngineIssue[];
  warnings: EngineIssue[];
  columns: Partial<Record<FieldKey, number>> | null;
  normalizedPreview: unknown[];
  previewIssues: EngineIssue[];
}

const SAMPLE_ROWS = 1000;
const PREVIEW_RECORDS = 10;

export async function submitMapping(
  ctx: ServiceContext,
  uploadId: string,
  body: { sheets: SheetMappingInput[] },
  opts: { dryRun: boolean },
) {
  const upload = await getUpload(ctx.pool, uploadId);
  if (!upload) throw notFound('الرفع');
  if (!['UPLOADED', 'MAPPED', 'FAILED'].includes(upload.status)) {
    throw conflict('INVALID_UPLOAD_STATE', `لا يمكن تعديل الربط والحالة ${upload.status}.`);
  }
  const sheets = await getSheets(ctx.pool, uploadId);
  const registries = await loadRegistries(ctx.pool);
  const settings = await loadSettings(ctx.pool);
  const byIndex = new Map(sheets.map((s) => [s.sheetIndex, s]));

  const seen = new Set<number>();
  for (const s of body.sheets) {
    if (!byIndex.has(s.sheetIndex)) throw unprocessable('UNKNOWN_SHEET', `ورقة العمل رقم ${s.sheetIndex} غير موجودة.`);
    if (seen.has(s.sheetIndex)) throw unprocessable('DUPLICATE_SHEET', `ورقة العمل رقم ${s.sheetIndex} مذكورة أكثر من مرة.`);
    seen.add(s.sheetIndex);
  }

  const outcomes: SheetMappingOutcome[] = [];
  const toSave: { sheet: SheetRow; input: SheetMappingInput; validation: MappingValidation; headerRowIndex: number }[] = [];

  for (const input of body.sheets) {
    const sheet = byIndex.get(input.sheetIndex)!;
    if (!input.include) {
      outcomes.push({ sheetIndex: sheet.sheetIndex, sheetName: sheet.name, included: false, ok: true, errors: [], warnings: [], columns: null, normalizedPreview: [], previewIssues: [] });
      continue;
    }
    if (sheet.headerRowIndex === null && input.headerRowIndex === undefined) {
      throw unprocessable('HEADER_ROW_REQUIRED', `لم يُكتشف صف عناوين في الورقة «${sheet.name}»؛ حدّد headerRowIndex يدويًا.`);
    }
    const headerRowIndex = input.headerRowIndex ?? sheet.headerRowIndex!;
    const raw = await getRawRows(ctx.pool, sheet.id, { limit: headerRowIndex + 1 + SAMPLE_ROWS });
    const matrix = raw.map((r) => r.cells);
    if (headerRowIndex < 0 || headerRowIndex >= Math.max(matrix.length, 1)) {
      throw unprocessable('HEADER_ROW_OUT_OF_RANGE', `صف العناوين ${headerRowIndex} خارج حدود الورقة «${sheet.name}».`);
    }
    // Re-detect when the user moved the header row, so confidence statuses match what they chose.
    const detection: SheetDetection = headerRowIndex === sheet.headerRowIndex && sheet.detection
      ? (sheet.detection as SheetDetection)
      : detectColumns(matrix, headerRowIndex, 'HIGH');
    const sample = matrix.slice(headerRowIndex + 1);
    const v = validateMapping(sheet.name, detection, sample, { ...input, dateOrder: input.dateOrder ?? settings.dates.defaultOrder });
    if (input.headerRowIndex !== undefined && input.headerRowIndex !== sheet.headerRowIndex) {
      v.warnings.push(makeIssue('MAPPING_SHEET_HEADER_OVERRIDDEN', { worksheet: sheet.name }));
    }

    let normalizedPreview: unknown[] = [];
    let previewIssues: EngineIssue[] = [];
    if (v.ok && v.mapping) {
      const previewRows = matrix.slice(0, headerRowIndex + 1 + PREVIEW_RECORDS);
      const r = normalizeSheet(
        { sheetName: sheet.name, rows: previewRows, firstExcelRow: sheet.firstExcelRow, mapping: v.mapping, date1904: upload.date1904 },
        { snapshotDate: upload.snapshotDate, registries, aging: settings.aging },
      );
      normalizedPreview = r.records;
      previewIssues = r.issues;
    }
    outcomes.push({
      sheetIndex: sheet.sheetIndex, sheetName: sheet.name, included: true, ok: v.ok, errors: v.errors, warnings: v.warnings,
      columns: v.mapping?.columns ?? null, normalizedPreview, previewIssues,
    });
    toSave.push({ sheet, input, validation: v, headerRowIndex });
  }

  if (toSave.length === 0) throw unprocessable('NO_SHEETS_SELECTED', 'اختر ورقة جرد واحدة على الأقل.');
  const failed = outcomes.filter((o) => o.included && !o.ok);
  if (failed.length > 0) {
    throw unprocessable('MAPPING_INVALID', 'الربط غير صالح؛ لم يُحفظ شيء.', { sheets: outcomes });
  }
  if (opts.dryRun) return { saved: false, sheets: outcomes };

  await withTransaction(ctx.pool, async (tx) => {
    // Mapping-stage diagnostics are derived data; replace them with those of the newly confirmed mapping.
    await tx.query("DELETE FROM data_quality_issues WHERE upload_id = $1 AND stage = 'MAPPING'", [uploadId]);
    const issues: IssueInsert[] = [];
    for (const s of sheets) {
      const saved = toSave.find((t) => t.sheet.id === s.id);
      if (!saved) {
        await saveMapping(tx, { uploadId, sheetId: s.id, includeSheet: false, headerRowIndex: s.headerRowIndex ?? 0, columns: {}, acknowledged: [], dateOrder: settings.dates.defaultOrder, validation: {}, confirmedByLabel: ctx.actor.label, confirmedBy: ctx.actor.id });
        await setSheetStatus(tx, s.id, 'SKIPPED');
        issues.push(toInsert(uploadId, 'MAPPING', s.id, makeIssue('SHEET_SKIPPED_NOT_INVENTORY', { worksheet: s.name })));
        continue;
      }
      await saveMapping(tx, {
        uploadId, sheetId: s.id, includeSheet: true, headerRowIndex: saved.headerRowIndex,
        columns: saved.validation.mapping!.columns as Record<string, number>, acknowledged: saved.input.acknowledged,
        dateOrder: saved.validation.mapping!.dateOrder, validation: { warnings: saved.validation.warnings },
        confirmedByLabel: ctx.actor.label, confirmedBy: ctx.actor.id,
      });
      await setSheetStatus(tx, s.id, 'MAPPED');
      for (const w of saved.validation.warnings) issues.push(toInsert(uploadId, 'MAPPING', s.id, w));
    }
    await insertIssues(tx, issues);
    await setUploadStatus(tx, uploadId, 'MAPPED');
    await writeAudit(tx, {
      requestId: ctx.requestId, actorId: ctx.actor.id, actorLabel: ctx.actor.label, action: 'MAPPING_CONFIRMED', entityType: 'upload', entityId: uploadId,
      details: { sheets: toSave.map((t) => ({ name: t.sheet.name, columns: t.validation.mapping!.columns, acknowledged: t.input.acknowledged })) },
    });
  });
  return { saved: true, sheets: outcomes };
}

export { FIELD_KEYS };
export type { UploadRow };
