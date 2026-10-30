import { describe, expect, it } from 'vitest';
import { compareSnapshots, type ComparableShipment, type LastSeen } from '../src/index.js';

const s = (t: string, status = 'a', branch = 'b1', emp: string | null = 'e1'): ComparableShipment => ({
  trackingKey: t, trackingNumber: t, statusKey: status, statusRaw: status, branchKey: branch, branchRaw: branch, employeeKey: emp, employeeRaw: emp,
});
const typesOf = (r: ReturnType<typeof compareSnapshots>, t: string) => r.items.find((i) => i.trackingKey === t)?.changeTypes;

describe('compareSnapshots', () => {
  const prev = [s('CONT'), s('STAT', 'a'), s('BR', 'a', 'b1'), s('EMP', 'a', 'b1', 'e1'), s('GONE'), s('MULTI', 'a', 'b1', 'e1')];
  const curr = [s('CONT'), s('STAT', 'z'), s('BR', 'a', 'b2'), s('EMP', 'a', 'b1', 'e2'), s('NEWX'), s('BACK'), s('MULTI', 'z', 'b2', null)];
  const everSeen = new Map<string, LastSeen>([['BACK', { snapshotId: 'old', snapshotDate: '2026-10-10', shipment: s('BACK') }]]);
  const r = compareSnapshots({ currentDate: '2026-10-19', current: curr, previousDate: '2026-10-18', previous: prev, everSeenBefore: everSeen });

  it('classifies each shipment', () => {
    expect(typesOf(r, 'CONT')).toEqual(['CONTINUED']);
    expect(typesOf(r, 'STAT')).toEqual(['CONTINUED', 'STATUS_CHANGED']);
    expect(typesOf(r, 'BR')).toEqual(['CONTINUED', 'BRANCH_CHANGED']);
    expect(typesOf(r, 'EMP')).toEqual(['CONTINUED', 'EMPLOYEE_CHANGED']);
    expect(typesOf(r, 'MULTI')).toEqual(['CONTINUED', 'STATUS_CHANGED', 'BRANCH_CHANGED', 'EMPLOYEE_CHANGED']);
    expect(typesOf(r, 'NEWX')).toEqual(['NEW']);
    expect(typesOf(r, 'BACK')).toEqual(['REAPPEARED']);
    expect(typesOf(r, 'GONE')).toEqual(['DISAPPEARED']);
  });
  it('counts per type (hand-computed)', () => {
    expect(r.counts).toEqual({ NEW: 1, CONTINUED: 5, STATUS_CHANGED: 2, BRANCH_CHANGED: 2, EMPLOYEE_CHANGED: 2, DISAPPEARED: 1, REAPPEARED: 1 });
  });
  it('records where a reappeared shipment was last seen', () => {
    expect(r.items.find((i) => i.trackingKey === 'BACK')).toMatchObject({ lastSeenSnapshotId: 'old', lastSeenDate: '2026-10-10' });
  });
  it('never labels a disappeared shipment as delivered or resolved', () => {
    const gone = r.items.find((i) => i.trackingKey === 'GONE')!;
    expect(gone.current).toBeNull();
    expect(gone.changeTypes).toEqual(['DISAPPEARED']);
  });
  it('treats custody gaining/losing an employee as a change', () => {
    const x = compareSnapshots({ currentDate: '2026-10-19', current: [s('A', 'a', 'b1', 'e1')], previousDate: '2026-10-18', previous: [s('A', 'a', 'b1', null)], everSeenBefore: new Map() });
    expect(typesOf(x, 'A')).toContain('EMPLOYEE_CHANGED');
  });
  it('warns on a multi-day gap but still compares', () => {
    const x = compareSnapshots({ currentDate: '2026-10-22', current: curr, previousDate: '2026-10-18', previous: prev, everSeenBefore: new Map() });
    expect(x.mode).toBe('COMPARED');
    expect(x.warnings.map((w) => w.code)).toEqual(['SNAPSHOT_GAP']);
    expect(x.daysBetween).toBe(4);
  });
  it('baseline when no previous snapshot', () => {
    const x = compareSnapshots({ currentDate: '2026-10-19', current: curr, previousDate: null, previous: null, everSeenBefore: new Map() });
    expect(x.mode).toBe('BASELINE');
    expect(x.items).toEqual([]);
    expect(x.warnings[0]!.code).toBe('NO_PREVIOUS_SNAPSHOT');
  });
  it('refuses to compare non-increasing dates', () => {
    for (const prevDate of ['2026-10-19', '2026-10-25']) {
      const x = compareSnapshots({ currentDate: '2026-10-19', current: curr, previousDate: prevDate, previous: prev, everSeenBefore: new Map() });
      expect(x.mode).toBe('INVALID');
      expect(x.items).toEqual([]);
      expect(x.warnings[0]!.code).toBe('NON_INCREASING_DATES');
    }
  });
});
