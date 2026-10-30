import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AR_MAPPING_FIELDS, DAY1, DAY2, DAY3, DAY4, EN_MAPPING_FIELDS } from '../fixtures/expected.js';
import { ingest, json, startHarness, type Harness } from '../support/harness.js';

let h: Harness;
const ids: Record<string, { uploadId: string; snapshotId: string }> = {};

const summaryOf = async (snapshotId: string) => json((await h.app.inject({ method: 'GET', url: `/api/snapshots/${snapshotId}/summary` })));
const shipmentsOf = async (snapshotId: string) => {
  const out: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (let page = 1; ; page++) {
    const r = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${snapshotId}/shipments?pageSize=200&page=${page}` }));
    out.push(...r.data);
    if (page >= r.pagination.totalPages) return out;
  }
};
const byTracking = (rows: Record<string, any>[]) => new Map(rows.filter((r) => r.isPrimary).map((r) => [r.trackingNumber as string, r])); // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => { h = await startHarness(); });
afterAll(async () => { await h.close(); });

async function run(key: string, file: string, date: string, fields: Record<string, number>) {
  const { uploadId, processRes } = await ingest(h, file, date, fields);
  expect(processRes.statusCode, processRes.body).toBe(200);
  const body = await json(processRes);
  ids[key] = { uploadId, snapshotId: body.snapshotId };
  return body;
}

describe('Day 1 — first snapshot (no history)', () => {
  let body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  beforeAll(async () => { body = await run('d1', DAY1.file, DAY1.date, AR_MAPPING_FIELDS); });

  it('reports exact row accounting; nothing is silently dropped', () => {
    expect(body.stats).toEqual(DAY1.stats);
    expect(body.stats.totalRows).toBe(body.stats.emptyRows + body.stats.rejectedRows + body.stats.ingestedRows);
  });

  it('computes shipment age and category on the boundaries (same-day, 15, 16, 25, 26)', async () => {
    const rows = byTracking(await shipmentsOf(ids.d1!.snapshotId));
    expect(rows.size).toBe(DAY1.uniqueShipments);
    for (const [t, [age, cat]] of Object.entries(DAY1.ages)) {
      expect(rows.get(t)?.shipmentAgeDays, `${t} age`).toBe(age);
      expect(rows.get(t)?.ageCategory, `${t} category`).toBe(cat);
    }
  });

  it('summarises aging KPIs with the approved thresholds', async () => {
    const s = await summaryOf(ids.d1!.snapshotId);
    expect(s.totals.uniqueShipments).toBe(DAY1.uniqueShipments);
    expect(s.totals.overMaxAge).toBe(DAY1.overMaxAge);
    expect(s.totals.overCriticalAge).toBe(DAY1.overCriticalAge);
    expect(s.totals.ageUnknown).toBe(DAY1.ageUnknown);
    expect(s.totals.missingEmployee).toBe(DAY1.missingEmployee);
    const cats = Object.fromEntries(s.byAgeCategory.map((c: any) => [c.ageCategory ?? 'none', c.n])); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(cats).toEqual(DAY1.byAgeCategory);
  });

  it('keeps the two duplicate rows, flags both, and marks only the first as primary', async () => {
    const all = (await shipmentsOf(ids.d1!.snapshotId)).filter((r) => r.trackingNumber === 'EG1012');
    expect(all).toHaveLength(2);
    expect(all.map((r) => [r.excelRow, r.isPrimary, r.duplicateRank, r.duplicateGroupSize])).toEqual([[13, true, 1, 2], [14, false, 2, 2]]);
    expect(all[0]!.statusRaw).toBe('جديد'); // original values preserved on both
    expect(all[1]!.statusRaw).toBe('تم التسليم');
  });

  it('status age is UNKNOWN for every shipment — never fabricated', async () => {
    const rows = await shipmentsOf(ids.d1!.snapshotId);
    expect(rows.every((r) => r.statusAgeDays === null && r.statusAgeBasis === 'UNKNOWN_INSUFFICIENT_HISTORY')).toBe(true);
    expect((await summaryOf(ids.d1!.snapshotId)).totals.statusAgeUnknown).toBe(DAY1.statusAgeUnknown);
  });

  it('records last-update age separately from shipment age', async () => {
    const r = byTracking(await shipmentsOf(ids.d1!.snapshotId)).get('EG1002')!;
    expect(r.shipmentAgeDays).toBe(15);
    expect(r.lastUpdateAgeDays).toBe(3); // 2026-10-17 → 2026-10-20
    expect(byTracking(await shipmentsOf(ids.d1!.snapshotId)).get('EG1011')!.lastUpdateAgeDays).toBeNull(); // no value → not computed
  });

  it('classifies the comparison as a baseline with an explicit warning', async () => {
    const c = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${ids.d1!.snapshotId}/comparison` }));
    expect(c.comparison.mode).toBe('BASELINE');
    expect(c.comparison.warnings[0].code).toBe('NO_PREVIOUS_SNAPSHOT');
    expect(c.items.pagination.total).toBe(0);
  });

  it('reports every expected data-quality issue with exact Excel row numbers', async () => {
    const all: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let page = 1; ; page++) {
      const r = await json(await h.app.inject({ method: 'GET', url: `/api/uploads/${ids.d1!.uploadId}/issues?stage=PROCESS&pageSize=200&page=${page}` }));
      all.push(...r.data);
      if (page >= r.pagination.totalPages) break;
    }
    const counts: Record<string, number> = {};
    for (const i of all) counts[i.code] = (counts[i.code] ?? 0) + 1;
    expect(counts).toEqual(DAY1.issues);
    for (const [code, rows] of Object.entries(DAY1.issueRows)) {
      expect(all.filter((i) => i.code === code && i.rowNumber !== null).map((i) => i.rowNumber).sort((a, b) => a - b), code).toEqual(rows);
    }
    const sample = all.find((i) => i.code === 'INVALID_DATE');
    expect(sample).toMatchObject({ worksheet: 'الجرد', field: 'createdDate', originalValue: '2026-02-30', category: 'ROW_LEVEL', severity: 'ERROR' });
    expect(sample.issueId).toBeTypeOf('number');
    expect(sample.explanation).toBeTruthy();
    expect(sample.suggestion).toBeTruthy();
    // custody exception is a warning for review, not an accusation
    expect(all.find((i) => i.code === 'MISSING_EMPLOYEE')).toMatchObject({ category: 'BUSINESS_WARNING', severity: 'WARNING', rowNumber: 12 });
  });
});

describe('Day 2 — comparison with history', () => {
  beforeAll(async () => { await run('d2', DAY2.file, DAY2.date, AR_MAPPING_FIELDS); });

  it('counts each change type exactly', async () => {
    const c = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${ids.d2!.snapshotId}/comparison` }));
    expect(c.comparison.mode).toBe('COMPARED');
    expect(c.comparison.daysBetween).toBe(1);
    expect(c.comparison.warnings).toEqual([]);
    expect({
      NEW: c.comparison.newCount, CONTINUED: c.comparison.continuedCount, STATUS_CHANGED: c.comparison.statusChangedCount,
      BRANCH_CHANGED: c.comparison.branchChangedCount, EMPLOYEE_CHANGED: c.comparison.employeeChangedCount,
      DISAPPEARED: c.comparison.disappearedCount, REAPPEARED: c.comparison.reappearedCount,
    }).toEqual(DAY2.comparison);
  });

  it.each(Object.entries(DAY2.changed))('lists the right shipments for %s', async (type, expected) => {
    const r = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${ids.d2!.snapshotId}/comparison?changeType=${type}&pageSize=100` }));
    expect(r.items.data.map((i: any) => i.trackingNumber).sort()).toEqual([...expected].sort()); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('shows before/after values and never labels a disappeared shipment as delivered', async () => {
    const r = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${ids.d2!.snapshotId}/comparison?changeType=DISAPPEARED&pageSize=100` }));
    const gone = r.items.data.find((i: any) => i.trackingNumber === 'EG1010'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(gone).toMatchObject({ changeTypes: ['DISAPPEARED'], prevStatusRaw: 'بالفرع', currStatusRaw: null });
    const st = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${ids.d2!.snapshotId}/comparison?changeType=STATUS_CHANGED` }));
    expect(st.items.data[0]).toMatchObject({ trackingNumber: 'EG1007', prevStatusRaw: 'بالفرع', currStatusRaw: 'مع المندوب', changeTypes: ['CONTINUED', 'STATUS_CHANGED'] });
  });

  it('ages advance by one calendar day and cross the thresholds', async () => {
    const rows = byTracking(await shipmentsOf(ids.d2!.snapshotId));
    for (const [t, [age, cat]] of Object.entries(DAY2.ages)) {
      expect(rows.get(t)?.shipmentAgeDays, t).toBe(age);
      expect(rows.get(t)?.ageCategory, t).toBe(cat);
    }
    const s = await summaryOf(ids.d2!.snapshotId);
    expect(s.totals.overMaxAge).toBe(DAY2.overMaxAge);
    expect(s.totals.overCriticalAge).toBe(DAY2.overCriticalAge);
  });

  it('derives status age from consecutive snapshots only where evidence exists', async () => {
    const rows = byTracking(await shipmentsOf(ids.d2!.snapshotId));
    for (const [t, age] of Object.entries(DAY2.statusAgeOf)) {
      expect(rows.get(t)).toMatchObject({ statusAgeDays: age, statusAgeBasis: 'OBSERVED_SNAPSHOTS' });
    }
    for (const t of DAY2.statusAgeNull) {
      expect(rows.get(t)).toMatchObject({ statusAgeDays: null, statusAgeBasis: 'UNKNOWN_INSUFFICIENT_HISTORY' });
    }
    const s = await summaryOf(ids.d2!.snapshotId);
    expect(s.totals.statusAgeUnknown).toBe(DAY2.statusAgeUnknown);
    expect(s.byStatusAgeBasis.find((b: any) => b.basis === 'OBSERVED_SNAPSHOTS').n).toBe(DAY2.statusAgeObserved); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('keeps the previous snapshot untouched', async () => {
    const s = await summaryOf(ids.d1!.snapshotId);
    expect(s.totals.uniqueShipments).toBe(DAY1.uniqueShipments);
    expect(s.totals.overMaxAge).toBe(DAY1.overMaxAge);
    expect(s.snapshot.status).toBe('COMPLETED');
  });
});

describe('Day 3 — reappearance', () => {
  beforeAll(async () => { await run('d3', DAY3.file, DAY3.date, AR_MAPPING_FIELDS); });

  it('detects the reappeared shipment (absent yesterday, present on day 1) and not as NEW', async () => {
    const c = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${ids.d3!.snapshotId}/comparison?changeType=REAPPEARED` }));
    expect(c.items.data).toHaveLength(1);
    expect(c.items.data[0]).toMatchObject({ trackingNumber: DAY3.reappeared.tracking, changeTypes: ['REAPPEARED'], lastSeenDate: DAY3.reappeared.lastSeenDate });
    expect({
      NEW: c.comparison.newCount, CONTINUED: c.comparison.continuedCount, STATUS_CHANGED: c.comparison.statusChangedCount,
      BRANCH_CHANGED: c.comparison.branchChangedCount, EMPLOYEE_CHANGED: c.comparison.employeeChangedCount,
      DISAPPEARED: c.comparison.disappearedCount, REAPPEARED: c.comparison.reappearedCount,
    }).toEqual(DAY3.comparison);
  });

  it('carries status runs across three snapshots, and restarts them after a change or absence', async () => {
    const rows = byTracking(await shipmentsOf(ids.d3!.snapshotId));
    for (const [t, age] of Object.entries(DAY3.statusAgeOf)) expect(rows.get(t)?.statusAgeDays, t).toBe(age);
    for (const t of DAY3.statusAgeNull) expect(rows.get(t)?.statusAgeBasis, t).toBe('UNKNOWN_INSUFFICIENT_HISTORY');
  });
});

describe('Day 4 — English CSV after a gap', () => {
  beforeAll(async () => { await run('d4', DAY4.file, DAY4.date, EN_MAPPING_FIELDS); });

  it('compares with an explicit warning about the multi-day gap', async () => {
    const c = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${ids.d4!.snapshotId}/comparison` }));
    expect(c.comparison.mode).toBe('COMPARED');
    expect(c.comparison.daysBetween).toBe(DAY4.daysBetween);
    expect(c.comparison.warnings.map((w: any) => w.code)).toEqual([DAY4.warning]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect({
      NEW: c.comparison.newCount, CONTINUED: c.comparison.continuedCount, STATUS_CHANGED: c.comparison.statusChangedCount,
      BRANCH_CHANGED: c.comparison.branchChangedCount, EMPLOYEE_CHANGED: c.comparison.employeeChangedCount,
      DISAPPEARED: c.comparison.disappearedCount, REAPPEARED: c.comparison.reappearedCount,
    }).toEqual(DAY4.comparison);
  });

  it('treats English/Arabic aliases of the same status and branch as unchanged', async () => {
    const r = await json(await h.app.inject({ method: 'GET', url: `/api/snapshots/${ids.d4!.snapshotId}/comparison?changeType=CONTINUED` }));
    for (const item of r.items.data) {
      expect(item.changeTypes).not.toContain('STATUS_CHANGED');
      expect(item.changeTypes).not.toContain('BRANCH_CHANGED');
    }
  });

  it('computes observed status age over the gap using snapshot dates', async () => {
    const rows = byTracking(await shipmentsOf(ids.d4!.snapshotId));
    for (const [t, age] of Object.entries(DAY4.statusAgeOf)) expect(rows.get(t)?.statusAgeDays, t).toBe(age);
  });
});

describe('Snapshot history', () => {
  it('lists every snapshot, newest first, none overwritten', async () => {
    const r = await json(await h.app.inject({ method: 'GET', url: '/api/snapshots' }));
    expect(r.data.map((s: any) => s.snapshotDate)).toEqual([DAY4.date, DAY3.date, DAY2.date, DAY1.date]); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(r.data.every((s: any) => s.version === 1 && s.isActive)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});
