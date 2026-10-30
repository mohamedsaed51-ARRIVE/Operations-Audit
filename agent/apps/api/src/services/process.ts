import {
  compareSnapshots, computeStatusAge, normalizeWorkbook, type ComparableShipment, type NormalizedRecord, type RegistryContext, type SheetInput,
} from '@arrive/engine';
import {
  completeSnapshot, createBranch, createEmployee, createSnapshot, getLatestMappings, getLatestSnapshot, getPreviousSnapshot, getRawRows, getSheets,
  getUpload, insertComparison, insertIssues, insertShipmentRows, issueSummary, loadLastSeen, loadPrimaryShipments,
  loadRegistries, loadSettings, setUploadStatus, withTransaction, writeAudit, type IssueInsert, type ShipmentInsert,
} from '@arrive/database';
import { AppError, conflict, notFound } from '../errors.js';
import type { ServiceContext } from './context.js';

export interface ProcessOptions {
  /** Allow a new version of an already-ingested snapshot date (the old version is kept untouched). */
  replaceExisting?: boolean;
  /** Create branch registry entries (source = AUTO_REGISTERED_FROM_UPLOAD) for unseen branch names. */
  registerUnknownBranches?: boolean;
  /** Create UNVERIFIED employee registry entries for unseen employee names. */
  registerUnknownEmployees?: boolean;
}

/** Test seam: lets tests inject a failure after rows were written to prove nothing partial is committed. */
export interface ProcessHooks {
  afterRowsInserted?: () => Promise<void> | void;
}

const SNAPSHOT_LOCK = 7_204_002;

export async function processUpload(ctx: ServiceContext, uploadId: string, opts: ProcessOptions = {}, hooks: ProcessHooks = {}) {
  const pre = await getUpload(ctx.pool, uploadId);
  if (!pre) throw notFound('الرفع');

  try {
    return await withTransaction(ctx.pool, async (tx) => {
      // One snapshot is built at a time, so "previous snapshot" is well defined.
      await tx.query('SELECT pg_advisory_xact_lock($1)', [SNAPSHOT_LOCK]);
      await tx.query('SELECT 1 FROM uploads WHERE id = $1 FOR UPDATE', [uploadId]);
      const upload = (await getUpload(tx, uploadId))!;
      if (upload.status === 'PROCESSED') throw conflict('ALREADY_PROCESSED', 'هذا الرفع تمت معالجته سابقًا؛ ارفع الملف مرة أخرى لإنشاء نسخة جديدة.');
      if (upload.status !== 'MAPPED' && upload.status !== 'FAILED') throw conflict('INVALID_UPLOAD_STATE', `لا يمكن معالجة رفع بحالة ${upload.status}؛ أكّد ربط الأعمدة أولًا.`);

      const settings = await loadSettings(tx);
      const snapshotDate = upload.snapshotDate;

      // ── snapshot ordering & versioning ──
      const latest = await getLatestSnapshot(tx);
      let version = 1;
      let supersedes: string | null = null;
      if (latest) {
        if (snapshotDate < latest.snapshotDate) {
          throw conflict('SNAPSHOT_OUT_OF_ORDER', `تاريخ الجرد ${snapshotDate} أقدم من آخر جرد محفوظ (${latest.snapshotDate}). إدراج جرد بأثر رجعي غير مدعوم في هذه المرحلة حتى لا تتغير المقارنات المحفوظة.`);
        }
        if (snapshotDate === latest.snapshotDate) {
          if (!opts.replaceExisting) throw conflict('SNAPSHOT_DATE_EXISTS', `يوجد جرد محفوظ بتاريخ ${snapshotDate}. لإنشاء نسخة جديدة (تبقى القديمة محفوظة) أرسل replaceExisting=true.`);
          version = latest.version + 1;
          supersedes = latest.id;
        }
      }

      // ── load mapped sheets and original rows ──
      const mappings = (await getLatestMappings(tx, uploadId)).filter((m) => m.includeSheet);
      if (mappings.length === 0) throw conflict('NOT_MAPPED', 'لا توجد أوراق مربوطة للمعالجة.');
      const sheets = await getSheets(tx, uploadId);
      const rawRowIds = new Map<string, number>(); // `${sheetId}:${rowNumber}` → raw_rows.id
      const sheetInputs: (SheetInput & { sheetId: string })[] = [];
      for (const m of mappings) {
        const sheet = sheets.find((s) => s.id === m.sheetId)!;
        const raw = await getRawRows(tx, sheet.id);
        const rows: unknown[][] = [];
        for (const r of raw) {
          rows[r.rowNumber - sheet.firstExcelRow] = r.cells;
          rawRowIds.set(`${sheet.id}:${r.rowNumber}`, r.id);
        }
        for (let i = 0; i < rows.length; i++) rows[i] ??= [];
        sheetInputs.push({
          sheetId: sheet.id, sheetName: sheet.name, rows, firstExcelRow: sheet.firstExcelRow, date1904: upload.date1904,
          mapping: { sheetIndex: sheet.sheetIndex, headerRowIndex: m.headerRowIndex, columns: m.columns, dateOrder: m.dateOrder },
        });
      }

      // ── normalise (optionally registering unseen branches / employees first) ──
      let registries: RegistryContext = await loadRegistries(tx);
      const run = () => normalizeWorkbook(sheetInputs, { snapshotDate, registries, aging: settings.aging });
      let result = run();
      const registered = { branches: 0, employees: 0 };
      if (opts.registerUnknownBranches || opts.registerUnknownEmployees) {
        if (opts.registerUnknownBranches) {
          const seen = new Map<string, string>();
          for (const r of result.records) if (r.branchKey && r.branchRaw && !r.branchId && !seen.has(r.branchKey)) seen.set(r.branchKey, r.branchRaw);
          for (const [, name] of seen) { await createBranch(tx, { name, source: 'AUTO_REGISTERED_FROM_UPLOAD' }); registered.branches++; }
        }
        if (opts.registerUnknownEmployees) {
          const seen = new Map<string, string>();
          for (const r of result.records) if (r.employeeKey && r.employeeRaw && !r.employeeId && !seen.has(r.employeeKey)) seen.set(r.employeeKey, r.employeeRaw);
          for (const [, name] of seen) { await createEmployee(tx, { name, verified: false, source: 'AUTO_REGISTERED_FROM_UPLOAD' }); registered.employees++; }
        }
        registries = await loadRegistries(tx);
        result = run();
      }
      const records = result.records;

      // ── history: previous snapshot, status runs, comparison ──
      const previous = await getPreviousSnapshot(tx, snapshotDate);
      const prevShipments = previous ? await loadPrimaryShipments(tx, previous.id) : null;
      const prevByKey = new Map((prevShipments ?? []).map((s) => [s.trackingKey, s]));

      const primaries = records.filter((r) => r.isPrimary);
      const comparable = (r: NormalizedRecord): ComparableShipment => ({
        trackingKey: r.trackingKey, trackingNumber: r.trackingNumber, statusKey: r.statusKey, statusRaw: r.statusRaw,
        branchKey: r.branchKey, branchRaw: r.branchRaw, employeeKey: r.employeeKey, employeeRaw: r.employeeRaw,
      });
      const newKeys = previous ? primaries.filter((r) => !prevByKey.has(r.trackingKey)).map((r) => r.trackingKey) : [];
      const everSeenBefore = previous ? await loadLastSeen(tx, newKeys, previous.snapshotDate) : new Map();
      const comparison = compareSnapshots({
        currentDate: snapshotDate, current: primaries.map(comparable),
        previousDate: previous?.snapshotDate ?? null, previous: prevShipments ? prevShipments.map(({ statusObservedSince: _s, ...c }) => c) : null,
        everSeenBefore,
      });

      // Status-age evidence only flows from a *valid* previous snapshot comparison.
      const useHistory = comparison.mode === 'COMPARED';
      const shipmentRows: ShipmentInsert[] = [];
      const snapshotId = await createSnapshot(tx, {
        snapshotDate, version, uploadId, supersedesSnapshotId: supersedes, createdByLabel: ctx.actor.label,
        configUsed: { aging: settings.aging, dateOrderDefault: settings.dates.defaultOrder, registered },
      });
      for (const r of records) {
        const prior = useHistory ? prevByKey.get(r.trackingKey) : undefined;
        const age = computeStatusAge({
          snapshotDate, statusKey: r.statusKey, statusEntryDate: r.statusEntryUsable ? r.statusEntryDate : null,
          prior: prior ? { statusKey: prior.statusKey, observedSince: prior.statusObservedSince ?? previous!.snapshotDate } : null,
        });
        const sheetId = sheetInputs.find((s) => s.sheetName === r.sheetName)!.sheetId;
        shipmentRows.push({ ...r, rawRowId: rawRowIds.get(`${sheetId}:${r.rowNumber}`)!, statusAgeDays: age.ageDays, statusAgeBasis: age.basis, statusObservedSince: age.observedSince });
      }
      await insertShipmentRows(tx, { id: snapshotId, date: snapshotDate, uploadId }, shipmentRows);
      await hooks.afterRowsInserted?.();
      await insertComparison(tx, snapshotId, previous ? { id: previous.id, date: previous.snapshotDate } : null, comparison);

      // ── data-quality issues, linked to the untouched source rows ──
      await tx.query("DELETE FROM data_quality_issues WHERE upload_id = $1 AND stage = 'PROCESS'", [uploadId]);
      const sheetIdByName = new Map(sheetInputs.map((s) => [s.sheetName, s.sheetId]));
      const issues: IssueInsert[] = result.issues.map((i) => {
        const sheetId = i.worksheet ? sheetIdByName.get(i.worksheet) ?? null : null;
        return { ...i, uploadId, sheetId, snapshotId, rawRowId: sheetId && i.rowNumber ? rawRowIds.get(`${sheetId}:${i.rowNumber}`) ?? null : null, stage: 'PROCESS' };
      });
      await insertIssues(tx, issues);

      await completeSnapshot(tx, snapshotId, result.stats);
      await setUploadStatus(tx, uploadId, 'PROCESSED', { processed: true });
      await writeAudit(tx, {
        requestId: ctx.requestId, actorId: ctx.actor.id, actorLabel: ctx.actor.label, action: 'SNAPSHOT_CREATED', entityType: 'snapshot', entityId: snapshotId,
        details: { uploadId, snapshotDate, version, supersedes, stats: result.stats, comparison: comparison.counts, comparisonMode: comparison.mode, registered, options: opts },
      });

      return {
        uploadId, snapshotId, snapshotDate, version,
        stats: result.stats,
        issues: await issueSummary(tx, uploadId),
        comparison: { mode: comparison.mode, daysBetween: comparison.daysBetween, counts: comparison.counts, warnings: comparison.warnings },
        registered,
      };
    });
  } catch (err) {
    // Everything above ran in one transaction: nothing was committed. Record the failure outside it.
    const isExpected = err instanceof AppError;
    await writeAudit(ctx.pool, {
      requestId: ctx.requestId, actorId: ctx.actor.id, actorLabel: ctx.actor.label, action: 'PROCESS_FAILED', entityType: 'upload', entityId: uploadId,
      outcome: 'FAILURE', details: { reason: (err as Error).message, expected: isExpected },
    }).catch(() => undefined);
    if (!isExpected) {
      await setUploadStatus(ctx.pool, uploadId, 'FAILED', { failureReason: (err as Error).message.slice(0, 500) }).catch(() => undefined);
      throw new AppError(500, 'PROCESSING_FAILED', 'فشلت المعالجة ولم يُحفظ أي جرد جزئي. راجع سجل التدقيق.', { requestId: ctx.requestId });
    }
    throw err;
  }
}
