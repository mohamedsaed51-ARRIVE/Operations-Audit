import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CHANGE_TYPES, FIELD_KEYS, type ChangeType, type SheetMappingInput } from '@arrive/shared';
import {
  createBranch, getComparison, getSnapshot, getSnapshotSummary, getUpload, isUuid, listBranches, listComparisonItems, listEmployees, listIssues,
  listShipments, listSnapshots, listUploads, type Pool, writeAudit,
} from '@arrive/database';
import type { Config } from '../config.js';
import { AppError, conflict, notFound, unprocessable } from '../errors.js';
import { pageQuery, paginate } from '../pagination.js';
import type { ServiceContext } from '../services/context.js';
import { processUpload } from '../services/process.js';
import { createUploadFromFile, getUploadDetail, previewUpload, submitMapping } from '../services/uploads.js';

interface Deps { config: Config; pool: Pool; clock: () => Date }

const uuidParam = z.object({ id: z.string().refine(isUuid, 'معرّف غير صالح') });

const mappingBody = z.object({
  sheets: z.array(z.object({
    sheetIndex: z.number().int().min(0),
    include: z.boolean(),
    headerRowIndex: z.number().int().min(0).optional(),
    fields: z.object(Object.fromEntries(FIELD_KEYS.map((k) => [k, z.number().int().min(0).nullable().optional()])) as Record<(typeof FIELD_KEYS)[number], z.ZodOptional<z.ZodNullable<z.ZodNumber>>>).strict(),
    acknowledged: z.array(z.enum(FIELD_KEYS)).default([]),
    dateOrder: z.enum(['DMY', 'MDY']).optional(),
  }).strict()).min(1).max(50),
}).strict();

const processBody = z.object({
  replaceExisting: z.boolean().default(false),
  registerUnknownBranches: z.boolean().default(false),
  registerUnknownEmployees: z.boolean().default(false),
}).strict();

export function registerRoutes(app: import('fastify').FastifyInstance, deps: Deps) {
  const ctxOf = (req: FastifyRequest): ServiceContext => ({ pool: deps.pool, config: deps.config, actor: req.actor, requestId: req.id, now: deps.clock });

  // ───── health ─────
  app.get('/api/health', async (_req, reply) => {
    try {
      await deps.pool.query('SELECT 1');
      return { status: 'ok', database: 'up', time: new Date().toISOString() };
    } catch {
      return reply.status(503).send({ status: 'degraded', database: 'down', time: new Date().toISOString() });
    }
  });

  // ───── uploads ─────
  app.post('/api/uploads', async (req, reply) => {
    if (!req.isMultipart()) throw unprocessable('MULTIPART_REQUIRED', 'يجب إرسال الملف بصيغة multipart/form-data.');
    const fields: Record<string, string> = {};
    let file: { filename: string; buffer: Buffer; truncated: boolean } | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        if (file) throw unprocessable('SINGLE_FILE_ONLY', 'ملف واحد فقط في كل طلب.');
        const buffer = await part.toBuffer();
        file = { filename: part.filename, buffer, truncated: part.file.truncated };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
    if (!file) throw unprocessable('FILE_REQUIRED', 'لم يتم إرفاق ملف.');
    const result = await createUploadFromFile(ctxOf(req), {
      filename: file.filename, buffer: file.buffer, truncated: file.truncated, snapshotDate: (fields.snapshotDate ?? '').trim(),
    });
    return reply.status(201).send(result);
  });

  app.get('/api/uploads', async (req) => {
    const q = pageQuery.parse(req.query);
    const { rows, total } = await listUploads(deps.pool, q.page, q.pageSize);
    return paginate(rows.map(({ storedPath: _p, ...r }) => r), total, q.page, q.pageSize);
  });

  app.get('/api/uploads/:id', async (req) => getUploadDetail(ctxOf(req), uuidParam.parse(req.params).id));

  app.get('/api/uploads/:id/preview', async (req) => {
    const { id } = uuidParam.parse(req.params);
    const q = z.object({ sheet: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
    return previewUpload(ctxOf(req), id, q.sheet, q.limit);
  });

  app.get('/api/uploads/:id/issues', async (req) => {
    const { id } = uuidParam.parse(req.params);
    const q = pageQuery.extend({
      category: z.enum(['FILE_LEVEL', 'ROW_LEVEL', 'BUSINESS_WARNING', 'MAPPING_WARNING']).optional(),
      severity: z.enum(['ERROR', 'WARNING', 'INFO']).optional(),
      code: z.string().max(60).optional(),
      stage: z.enum(['UPLOAD', 'MAPPING', 'PROCESS']).optional(),
      worksheet: z.string().max(200).optional(),
    }).parse(req.query);
    if (!(await getUpload(deps.pool, id))) throw notFound('الرفع');
    const { rows, total } = await listIssues(deps.pool, id, q, q.page, q.pageSize);
    return paginate(rows, total, q.page, q.pageSize);
  });

  app.post('/api/uploads/:id/mapping', async (req) => {
    const { id } = uuidParam.parse(req.params);
    const q = z.object({ dryRun: z.enum(['true', 'false']).default('false') }).parse(req.query);
    const body = mappingBody.parse(req.body);
    const sheets: SheetMappingInput[] = body.sheets.map((s) => ({
      sheetIndex: s.sheetIndex, include: s.include, headerRowIndex: s.headerRowIndex, acknowledged: s.acknowledged, dateOrder: s.dateOrder,
      fields: Object.fromEntries(Object.entries(s.fields).filter(([, v]) => v !== undefined)),
    }));
    return submitMapping(ctxOf(req), id, { sheets }, { dryRun: q.dryRun === 'true' });
  });

  app.post('/api/uploads/:id/process', async (req) => {
    const { id } = uuidParam.parse(req.params);
    const body = processBody.parse(req.body ?? {});
    return processUpload(ctxOf(req), id, body);
  });

  // ───── snapshots ─────
  app.get('/api/snapshots', async (req) => {
    const q = pageQuery.parse(req.query);
    const { rows, total } = await listSnapshots(deps.pool, q.page, q.pageSize);
    return paginate(rows, total, q.page, q.pageSize);
  });

  const snapshotOr404 = async (id: string) => {
    const s = await getSnapshot(deps.pool, id);
    if (!s || s.status !== 'COMPLETED') throw notFound('الجرد');
    return s;
  };

  app.get('/api/snapshots/:id', async (req) => {
    const s = await snapshotOr404(uuidParam.parse(req.params).id);
    const comparison = await getComparison(deps.pool, s.id);
    return { snapshot: s, comparison };
  });

  app.get('/api/snapshots/:id/summary', async (req) => getSnapshotSummary(deps.pool, await snapshotOr404(uuidParam.parse(req.params).id)));

  app.get('/api/snapshots/:id/shipments', async (req) => {
    const s = await snapshotOr404(uuidParam.parse(req.params).id);
    const q = pageQuery.extend({
      branch: z.string().max(200).optional(),
      ageCategory: z.enum(['D0_3', 'D4_7', 'D8_15', 'D16_25', 'D26_PLUS']).optional(),
      employeeMissing: z.enum(['true', 'false']).optional(),
      duplicatesOnly: z.enum(['true', 'false']).optional(),
      q: z.string().max(60).optional(),
    }).parse(req.query);
    const { foldKey } = await import('@arrive/engine');
    const { rows, total } = await listShipments(deps.pool, s.id, {
      branch: q.branch ? foldKey(q.branch) : undefined, ageCategory: q.ageCategory,
      employeeMissing: q.employeeMissing === undefined ? undefined : q.employeeMissing === 'true',
      duplicatesOnly: q.duplicatesOnly === 'true', q: q.q,
    }, q.page, q.pageSize);
    return paginate(rows, total, q.page, q.pageSize);
  });

  app.get('/api/snapshots/:id/comparison', async (req) => {
    const s = await snapshotOr404(uuidParam.parse(req.params).id);
    const q = pageQuery.extend({ changeType: z.enum(CHANGE_TYPES).optional() }).parse(req.query);
    const comparison = (await getComparison(deps.pool, s.id)) as { id: string } | null;
    if (!comparison) throw conflict('NO_COMPARISON', 'لا توجد مقارنة لهذا الجرد.');
    const { rows, total } = await listComparisonItems(deps.pool, comparison.id, q.changeType as ChangeType | undefined, q.page, q.pageSize);
    return { comparison, items: paginate(rows, total, q.page, q.pageSize) };
  });

  // ───── registries ─────
  app.get('/api/branches', async (req) => {
    const q = pageQuery.extend({ q: z.string().max(100).optional() }).parse(req.query);
    const { rows, total } = await listBranches(deps.pool, q, q.q);
    return paginate(rows, total, q.page, q.pageSize);
  });

  app.post('/api/branches', async (req, reply) => {
    const body = z.object({
      name: z.string().trim().min(1).max(120),
      code: z.string().trim().max(30).nullish(),
      governorate: z.string().trim().max(60).nullish(),
      aliases: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    }).strict().parse(req.body);
    try {
      const id = await createBranch(deps.pool, body);
      await writeAudit(deps.pool, { requestId: req.id, actorId: req.actor.id, actorLabel: req.actor.label, action: 'BRANCH_CREATED', entityType: 'branch', entityId: id, details: body });
      return reply.status(201).send({ id });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw conflict('BRANCH_EXISTS', 'الفرع أو أحد أسمائه البديلة مسجّل مسبقًا.');
      throw e;
    }
  });

  app.get('/api/employees', async (req) => {
    const q = pageQuery.extend({ q: z.string().max(100).optional() }).parse(req.query);
    const { rows, total } = await listEmployees(deps.pool, q, q.q);
    return paginate(rows, total, q.page, q.pageSize);
  });
}

export { AppError };
