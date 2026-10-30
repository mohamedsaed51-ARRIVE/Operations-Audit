import { describe, expect, it } from 'vitest';
import {
  ageCategory, computeStatusAge, isOverCriticalAge, isOverMaxAge, lastUpdateAgeDays, shipmentAgeDays,
} from '../src/index.js';

const SNAP = '2026-10-20';

describe('shipment age boundaries (snapshot 2026-10-20)', () => {
  // [creation date, expected age, expected category, over 15, over 25] — expectations hand-computed
  const cases: [string, number, string, boolean, boolean][] = [
    ['2026-10-20', 0, 'D0_3', false, false], // same day
    ['2026-10-17', 3, 'D0_3', false, false],
    ['2026-10-16', 4, 'D4_7', false, false],
    ['2026-10-13', 7, 'D4_7', false, false],
    ['2026-10-12', 8, 'D8_15', false, false],
    ['2026-10-05', 15, 'D8_15', false, false], // exactly 15 → still compliant
    ['2026-10-04', 16, 'D16_25', true, false], // 16 → over the permitted age
    ['2026-09-25', 25, 'D16_25', true, false], // exactly 25 → not critical
    ['2026-09-24', 26, 'D26_PLUS', true, true], // 26 → critical
  ];
  it.each(cases)('created %s → age %i / %s', (created, age, cat, over15, over25) => {
    const a = shipmentAgeDays(SNAP, created);
    expect(a).toBe(age);
    expect(ageCategory(a)).toBe(cat);
    expect(isOverMaxAge(a)).toBe(over15);
    expect(isOverCriticalAge(a)).toBe(over25);
  });

  it('returns null for missing or future creation dates', () => {
    expect(shipmentAgeDays(SNAP, null)).toBeNull();
    expect(shipmentAgeDays(SNAP, '2026-10-21')).toBeNull();
    expect(ageCategory(null)).toBeNull();
    expect(isOverMaxAge(null)).toBe(false);
  });

  it('honours a changed configuration', () => {
    const cfg = { maxDays: 10, criticalDays: 20, bucketBounds: [2, 5, 10, 20] as [number, number, number, number] };
    expect(isOverMaxAge(11, cfg)).toBe(true);
    expect(isOverMaxAge(10, cfg)).toBe(false);
    expect(ageCategory(6, cfg)).toBe('D8_15');
  });
});

describe('last update age', () => {
  it('is computed only from a valid, non-future date', () => {
    expect(lastUpdateAgeDays(SNAP, '2026-10-17')).toBe(3);
    expect(lastUpdateAgeDays(SNAP, null)).toBeNull();
    expect(lastUpdateAgeDays(SNAP, '2026-10-25')).toBeNull();
  });
});

describe('current status age', () => {
  it('first snapshot without a status-entry date → unknown (never fabricated)', () => {
    const r = computeStatusAge({ snapshotDate: SNAP, statusKey: 'مع المندوب', statusEntryDate: null, prior: null });
    expect(r).toEqual({ ageDays: null, basis: 'UNKNOWN_INSUFFICIENT_HISTORY', observedSince: SNAP });
  });
  it('a real status-entry date is authoritative', () => {
    const r = computeStatusAge({ snapshotDate: SNAP, statusKey: 'x', statusEntryDate: '2026-10-10', prior: null });
    expect(r.ageDays).toBe(10);
    expect(r.basis).toBe('STATUS_ENTRY_DATE');
  });
  it('same status as the previous snapshot → observed unchanged duration from the first sighting', () => {
    const r = computeStatusAge({
      snapshotDate: SNAP, statusKey: 'x', statusEntryDate: null,
      prior: { statusKey: 'x', observedSince: '2026-10-18' },
    });
    expect(r).toEqual({ ageDays: 2, basis: 'OBSERVED_SNAPSHOTS', observedSince: '2026-10-18' });
  });
  it('a changed status restarts the run and is unknown again', () => {
    const r = computeStatusAge({
      snapshotDate: SNAP, statusKey: 'y', statusEntryDate: null,
      prior: { statusKey: 'x', observedSince: '2026-10-01' },
    });
    expect(r).toEqual({ ageDays: null, basis: 'UNKNOWN_INSUFFICIENT_HISTORY', observedSince: SNAP });
  });
  it('a missing status never gets an age', () => {
    const r = computeStatusAge({ snapshotDate: SNAP, statusKey: null, statusEntryDate: null, prior: { statusKey: null, observedSince: '2026-10-01' } });
    expect(r.ageDays).toBeNull();
  });
  it('an unusable (future) status-entry date falls back to observation, not to the bad date', () => {
    const r = computeStatusAge({ snapshotDate: SNAP, statusKey: 'x', statusEntryDate: '2026-10-30', prior: null });
    expect(r.basis).toBe('UNKNOWN_INSUFFICIENT_HISTORY');
  });
});
