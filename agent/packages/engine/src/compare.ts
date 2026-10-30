import { diffDays } from './dates.js';
import { type ChangeType } from '@arrive/shared';

export interface ComparableShipment {
  trackingKey: string;
  trackingNumber: string;
  statusKey: string | null;
  statusRaw: string | null;
  branchKey: string | null;
  branchRaw: string | null;
  employeeKey: string | null;
  employeeRaw: string | null;
}

export interface LastSeen {
  snapshotId: string;
  snapshotDate: string;
  shipment: ComparableShipment;
}

export interface ComparisonItem {
  trackingKey: string;
  trackingNumber: string;
  changeTypes: ChangeType[];
  previous: ComparableShipment | null;
  current: ComparableShipment | null;
  /** For REAPPEARED: the last earlier snapshot in which the shipment was present. */
  lastSeenSnapshotId: string | null;
  lastSeenDate: string | null;
}

export interface ComparisonWarning {
  code: 'NO_PREVIOUS_SNAPSHOT' | 'SNAPSHOT_GAP' | 'NON_INCREASING_DATES';
  message: string;
}

export interface ComparisonResult {
  mode: 'BASELINE' | 'COMPARED' | 'INVALID';
  warnings: ComparisonWarning[];
  daysBetween: number | null;
  items: ComparisonItem[];
  counts: Record<ChangeType, number>;
}

export const emptyCounts = (): Record<ChangeType, number> => ({
  NEW: 0, CONTINUED: 0, STATUS_CHANGED: 0, BRANCH_CHANGED: 0, EMPLOYEE_CHANGED: 0, DISAPPEARED: 0, REAPPEARED: 0,
});

export interface CompareInput {
  currentDate: string;
  current: ComparableShipment[];
  previousDate: string | null;
  previous: ComparableShipment[] | null;
  /** Earlier-than-previous presence of shipments that are in `current` but not in `previous`. */
  everSeenBefore: Map<string, LastSeen>;
}

const sameKey = (a: string | null, b: string | null) => a === b;

/**
 * Compares two snapshots by tracking number. Inputs must contain at most one record per tracking key
 * (the primary occurrence). A shipment missing today is DISAPPEARED — nothing is inferred about its outcome.
 */
export function compareSnapshots(input: CompareInput): ComparisonResult {
  const counts = emptyCounts();
  const warnings: ComparisonWarning[] = [];

  if (input.previous === null || input.previousDate === null) {
    return {
      mode: 'BASELINE',
      daysBetween: null,
      items: [],
      counts,
      warnings: [{ code: 'NO_PREVIOUS_SNAPSHOT', message: 'هذا أول جرد صالح؛ لا توجد مقارنة ولا يمكن حساب عمر الحالة الحالية من التاريخ.' }],
    };
  }
  const gap = diffDays(input.previousDate, input.currentDate);
  if (gap <= 0) {
    return {
      mode: 'INVALID',
      daysBetween: gap,
      items: [],
      counts,
      warnings: [{ code: 'NON_INCREASING_DATES', message: `تاريخ الجرد الحالي (${input.currentDate}) ليس لاحقًا لتاريخ الجرد السابق (${input.previousDate}). لم تُجرَ المقارنة.` }],
    };
  }
  if (gap > 1) {
    warnings.push({ code: 'SNAPSHOT_GAP', message: `الفاصل بين الجردين ${gap} أيام (ليس يومًا واحدًا). قد تشمل التغيّرات عدة أيام ولا تُنسب ليوم محدد.` });
  }

  const prevMap = new Map(input.previous.map((s) => [s.trackingKey, s]));
  const currMap = new Map(input.current.map((s) => [s.trackingKey, s]));
  const items: ComparisonItem[] = [];

  for (const curr of input.current) {
    const prev = prevMap.get(curr.trackingKey);
    if (prev) {
      const types: ChangeType[] = ['CONTINUED'];
      if (!sameKey(prev.statusKey, curr.statusKey)) types.push('STATUS_CHANGED');
      if (!sameKey(prev.branchKey, curr.branchKey)) types.push('BRANCH_CHANGED');
      if (!sameKey(prev.employeeKey, curr.employeeKey)) types.push('EMPLOYEE_CHANGED');
      for (const t of types) counts[t]++;
      items.push({ trackingKey: curr.trackingKey, trackingNumber: curr.trackingNumber, changeTypes: types, previous: prev, current: curr, lastSeenSnapshotId: null, lastSeenDate: null });
      continue;
    }
    const seen = input.everSeenBefore.get(curr.trackingKey);
    const type: ChangeType = seen ? 'REAPPEARED' : 'NEW';
    counts[type]++;
    items.push({
      trackingKey: curr.trackingKey, trackingNumber: curr.trackingNumber, changeTypes: [type],
      previous: null, current: curr,
      lastSeenSnapshotId: seen?.snapshotId ?? null, lastSeenDate: seen?.snapshotDate ?? null,
    });
  }
  for (const prev of input.previous) {
    if (!currMap.has(prev.trackingKey)) {
      counts.DISAPPEARED++;
      items.push({ trackingKey: prev.trackingKey, trackingNumber: prev.trackingNumber, changeTypes: ['DISAPPEARED'], previous: prev, current: null, lastSeenSnapshotId: null, lastSeenDate: null });
    }
  }
  return { mode: 'COMPARED', daysBetween: gap, items, counts, warnings };
}
