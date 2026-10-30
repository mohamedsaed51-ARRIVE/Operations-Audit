import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AR_MAPPING_FIELDS } from '../fixtures/expected.js';
import { json, mappingFor, startHarness, upload, type Harness, type UploadDetail } from '../support/harness.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

const postMapping = (id: string, sheets: unknown[], dryRun = false) =>
  h.app.inject({ method: 'POST', url: `/api/uploads/${id}/mapping${dryRun ? '?dryRun=true' : ''}`, payload: { sheets } });
const uploadOk = async (file: string, date = '2026-10-20') => {
  const r = await upload(h, file, date);
  expect(r.statusCode, r.body).toBe(201);
  return json<UploadDetail>(r);
};
const issuesOf = async (id: string, q = '') => (await json(await h.app.inject({ method: 'GET', url: `/api/uploads/${id}/issues?pageSize=200${q}` }))).data;

describe('Arabic and English column detection', () => {
  it('detects the Arabic headers confidently', async () => {
    const d = await uploadOk('inventory_day1_2026-10-20_ar.xlsx');
    const f = d.sheets[0]!.detection.fields;
    for (const [field, col] of Object.entries(AR_MAPPING_FIELDS)) {
      expect(f[field], field).toMatchObject({ status: 'CONFIDENT', suggestedColumn: col });
    }
    expect(f.statusEntryDate.status).toBe('MISSING');
    expect(d.sheets.map((s) => s.name)).toEqual(['الجرد', 'ملاحظات']);
    expect(d.upload.fileType).toBe('xlsx');
  });

  it('detects the English headers confidently', async () => {
    const d = await uploadOk('english_valid.xlsx');
    const f = d.sheets[0]!.detection.fields;
    expect(f.tracking).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 0 }); // «Shipment ID»
    expect(f.createdDate).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 4 }); // «Order Date»
    expect(f.lastUpdateDate).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 5 }); // «Updated At»
    expect(f.employee).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 3 }); // «Assigned Employee»
    const r = await postMapping(d.upload.id, [mappingFor(0, { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4, lastUpdateDate: 5, governorate: 6 })]);
    expect(r.statusCode, r.body).toBe(200);
  });

  it('reads legacy .xls files', async () => {
    const d = await uploadOk('legacy_ar.xls');
    expect(d.upload.fileType).toBe('xls');
    expect(d.sheets[0]!.detection.fields.tracking).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 0 });
    expect(d.sheets[0]!.detection.fields.employee).toMatchObject({ status: 'CONFIDENT', suggestedColumn: 3 }); // «اسم الموظف»
  });

  it('finds the header below title rows and keeps true Excel row numbers', async () => {
    const d = await uploadOk('header_offset.xlsx');
    expect(d.sheets[0]!.headerRowIndex).toBe(4);
    const m = await postMapping(d.upload.id, [mappingFor(0, { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4 })]);
    expect(m.statusCode, m.body).toBe(200);
    const p = await h.app.inject({ method: 'POST', url: `/api/uploads/${d.upload.id}/process`, payload: {} });
    expect(p.statusCode, p.body).toBe(200);
    const miss = (await issuesOf(d.upload.id, '&code=MISSING_EMPLOYEE'))[0];
    expect(miss).toMatchObject({ worksheet: 'الجرد', rowNumber: 7, originalValue: null });
  });
});

describe('ambiguity and missing columns require the user', () => {
  it('flags two equally likely tracking columns as AMBIGUOUS and refuses to pick one', async () => {
    const d = await uploadOk('ambiguous_columns.xlsx');
    const t = d.sheets[0]!.detection.fields.tracking;
    expect(t.status).toBe('AMBIGUOUS');
    expect(t.candidates.map((c: any) => c.columnIndex).sort()).toEqual([0, 1]); // eslint-disable-line @typescript-eslint/no-explicit-any

    const fields = { tracking: 0, status: 2, branch: 3, createdDate: 4, employee: 5 };
    const refused = await postMapping(d.upload.id, [mappingFor(0, fields)]);
    expect(refused.statusCode).toBe(422);
    const body = await json(refused);
    expect(body.error.code).toBe('MAPPING_INVALID');
    expect(body.error.details.sheets[0].errors.map((e: any) => [e.code, e.field])).toContainEqual(['MAPPING_FIELD_NOT_CONFIDENT', 'tracking']); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await json<UploadDetail>(await h.app.inject({ method: 'GET', url: `/api/uploads/${d.upload.id}` }))).upload.status).toBe('UPLOADED'); // nothing saved

    const accepted = await postMapping(d.upload.id, [mappingFor(0, fields, ['tracking'])]);
    expect(accepted.statusCode, accepted.body).toBe(200);
    const detail = await json<UploadDetail>(await h.app.inject({ method: 'GET', url: `/api/uploads/${d.upload.id}` }));
    expect(detail.upload.status).toBe('MAPPED');
    expect((detail.sheets[0] as any).mapping).toMatchObject({ acknowledged: ['tracking'], columns: { tracking: 0 }, version: 1 }); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('rejects a mapping that omits required columns (status, creation date)', async () => {
    const d = await uploadOk('missing_columns.xlsx');
    expect(d.sheets[0]!.detection.fields.status.status).toBe('MISSING');
    const r = await postMapping(d.upload.id, [mappingFor(0, { tracking: 0, branch: 1, employee: 2 })]);
    expect(r.statusCode).toBe(422);
    const errs = (await json(r)).error.details.sheets[0].errors as { code: string; field: string }[];
    expect(errs.filter((e) => e.code === 'MAPPING_REQUIRED_MISSING').map((e) => e.field).sort()).toEqual(['createdDate', 'status']);
  });

  it('rejects the same column used twice, out-of-range columns, unknown fields and bad payloads', async () => {
    const d = await uploadOk('english_valid.xlsx');
    const dup = await postMapping(d.upload.id, [mappingFor(0, { tracking: 0, status: 0, branch: 2, createdDate: 4 })]);
    expect((await json(dup)).error.details.sheets[0].errors.map((e: any) => e.code)).toContain('MAPPING_COLUMN_CONFLICT'); // eslint-disable-line @typescript-eslint/no-explicit-any
    const oob = await postMapping(d.upload.id, [mappingFor(0, { tracking: 0, status: 1, branch: 2, createdDate: 99 })]);
    expect((await json(oob)).error.details.sheets[0].errors.map((e: any) => e.code)).toContain('MAPPING_COLUMN_OUT_OF_RANGE'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((await postMapping(d.upload.id, [{ sheetIndex: 0, include: true, fields: { bogus: 1 }, acknowledged: [] }])).statusCode).toBe(400);
    expect((await postMapping(d.upload.id, [{ sheetIndex: 7, include: true, fields: {}, acknowledged: [] }])).statusCode).toBe(422);
    expect((await postMapping(d.upload.id, [{ sheetIndex: 0, include: false, fields: {}, acknowledged: [] }])).statusCode).toBe(422); // NO_SHEETS_SELECTED
  });
});

describe('preview, dry run and re-mapping', () => {
  it('previews the first records, masking sensitive columns while the originals stay stored', async () => {
    const d = await uploadOk('inventory_day1_2026-10-20_ar.xlsx');
    const p = await json(await h.app.inject({ method: 'GET', url: `/api/uploads/${d.upload.id}/preview?sheet=0&limit=5` }));
    expect(p.headers).toEqual(['بوليصة', 'حالة الشحنة', 'الفرع', 'عهدة العضو', 'تاريخ الشحنة', 'المحافظة', 'تاريخ آخر تحديث', 'تليفون العميل']);
    expect(p.rows).toHaveLength(5);
    expect(p.rows[0].rowNumber).toBe(2);
    expect(p.rows[0].cells[0]).toBe('EG1001');
    expect(p.maskedColumns).toEqual([7]);
    expect(p.rows.every((r: any) => r.cells[7] === '••• (محجوب)')).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(JSON.stringify(p)).not.toContain('01000000001');
    const raw = await h.pool.query("SELECT cells->>7 AS phone FROM raw_rows WHERE upload_id = $1 AND row_number = 2", [d.upload.id]);
    expect(raw.rows[0].phone).toBe('01000000001');
  });

  it('dry-run validates and shows normalised records without saving anything', async () => {
    const d = await uploadOk('inventory_day1_2026-10-20_ar.xlsx');
    const r = await json(await postMapping(d.upload.id, [mappingFor(0, AR_MAPPING_FIELDS)], true));
    expect(r.saved).toBe(false);
    const rec = r.sheets[0].normalizedPreview[0];
    expect(rec).toMatchObject({ trackingNumber: 'EG1001', createdDate: '2026-10-20', shipmentAgeDays: 0, ageCategory: 'D0_3', rowNumber: 2 });
    expect((await json<UploadDetail>(await h.app.inject({ method: 'GET', url: `/api/uploads/${d.upload.id}` }))).upload.status).toBe('UPLOADED');
    expect((await h.pool.query('SELECT count(*)::int AS n FROM column_mappings WHERE upload_id = $1', [d.upload.id])).rows[0].n).toBe(0);
  });

  it('keeps every confirmed mapping as a new version', async () => {
    const d = await uploadOk('inventory_day1_2026-10-20_ar.xlsx');
    await postMapping(d.upload.id, [mappingFor(0, AR_MAPPING_FIELDS)]);
    await postMapping(d.upload.id, [mappingFor(0, { ...AR_MAPPING_FIELDS, lastUpdateDate: undefined as never })]);
    const v = await h.pool.query('SELECT version FROM column_mappings WHERE upload_id = $1 AND include_sheet ORDER BY version', [d.upload.id]);
    expect(v.rows.map((r) => r.version)).toEqual([1, 2]);
  });

  it('lets the user move the header row and re-evaluates detection', async () => {
    const d = await uploadOk('header_offset.xlsx');
    const r = await postMapping(d.upload.id, [{ ...mappingFor(0, { tracking: 0, status: 1, branch: 2, createdDate: 4, employee: 3 }), headerRowIndex: 4 }], true);
    expect(r.statusCode, r.body).toBe(200);
    const bad = await postMapping(d.upload.id, [{ ...mappingFor(0, { tracking: 0 }), headerRowIndex: 999 }]);
    expect(bad.statusCode).toBe(422);
  });
});

describe('multiple worksheets', () => {
  it('ingests chosen sheets, skips others, and detects duplicates across sheets', async () => {
    const d = await uploadOk('multi_sheet.xlsx', '2026-10-21');
    expect(d.sheets.map((s) => s.name)).toEqual(['القاهرة', 'الجيزة', 'ملخص']);
    const fields = { tracking: 0, status: 1, branch: 2, employee: 3, createdDate: 4 };
    const m = await postMapping(d.upload.id, [mappingFor(0, fields), mappingFor(1, fields), { sheetIndex: 2, include: false, fields: {}, acknowledged: [] }]);
    expect(m.statusCode, m.body).toBe(200);
    const p = await json(await h.app.inject({ method: 'POST', url: `/api/uploads/${d.upload.id}/process`, payload: {} }));
    expect(p.stats).toMatchObject({ ingestedRows: 5, duplicateRows: 1, rejectedRows: 0 });
    const dup = await issuesOf(d.upload.id, '&code=DUPLICATE_TRACKING');
    expect(dup.map((i: any) => [i.worksheet, i.rowNumber]).sort()).toEqual([['الجيزة', 3], ['القاهرة', 4]]); // eslint-disable-line @typescript-eslint/no-explicit-any
    const sum = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${p.snapshotId}/summary` }));
    expect(sum.totals.uniqueShipments).toBe(4);
    const sheets = (await json<UploadDetail>(await h.app.inject({ method: 'GET', url: `/api/uploads/${d.upload.id}` }))).sheets;
    expect(sheets.map((s) => s.status)).toEqual(['MAPPED', 'MAPPED', 'SKIPPED']);
  });
});
