import {
  DEFAULT_AGING_CONFIG, type AgeCategory, type AgingConfig, type StatusAgeBasis,
} from '@arrive/shared';
import { diffDays } from './dates.js';

/** Shipment age in whole calendar days: snapshot_date − creation date. Same day → 0. Negative → null (invalid). */
export function shipmentAgeDays(snapshotDate: string, createdDate: string | null): number | null {
  if (!createdDate) return null;
  const d = diffDays(createdDate, snapshotDate);
  return d < 0 ? null : d;
}

export function ageCategory(ageDays: number | null, cfg: AgingConfig = DEFAULT_AGING_CONFIG): AgeCategory | null {
  if (ageDays === null) return null;
  const [b1, b2, b3, b4] = cfg.bucketBounds;
  if (ageDays <= b1) return 'D0_3';
  if (ageDays <= b2) return 'D4_7';
  if (ageDays <= b3) return 'D8_15';
  if (ageDays <= b4) return 'D16_25';
  return 'D26_PLUS';
}

/** Over the permitted age = strictly more than maxDays (exactly 15 days is still compliant). */
export const isOverMaxAge = (ageDays: number | null, cfg: AgingConfig = DEFAULT_AGING_CONFIG) =>
  ageDays !== null && ageDays > cfg.maxDays;

export const isOverCriticalAge = (ageDays: number | null, cfg: AgingConfig = DEFAULT_AGING_CONFIG) =>
  ageDays !== null && ageDays > cfg.criticalDays;

/** Last-update age: only when a valid last-update date exists and is not in the future. */
export function lastUpdateAgeDays(snapshotDate: string, lastUpdate: string | null): number | null {
  if (!lastUpdate) return null;
  const d = diffDays(lastUpdate, snapshotDate);
  return d < 0 ? null : d;
}

export interface PriorStatusObservation {
  statusKey: string | null;
  /** Date of the first snapshot in the current unbroken run with this status. */
  observedSince: string;
}

export interface StatusAgeInput {
  snapshotDate: string;
  statusKey: string | null;
  /** Validated status-entry date from the file, if any. */
  statusEntryDate: string | null;
  /** The shipment's record in the immediately preceding valid snapshot, if present there. */
  prior: PriorStatusObservation | null;
}

export interface StatusAgeResult {
  ageDays: number | null;
  basis: StatusAgeBasis;
  /** First snapshot date of the current unbroken run with this status (state carried to the next snapshot). */
  observedSince: string;
}

/**
 * Current-status age, with strict evidence rules:
 *  1. A valid status-entry date in the file is authoritative.
 *  2. Otherwise the shipment must have been seen with the SAME status in the previous snapshot; the age is then
 *     the *observed* unchanged duration (a lower bound: the real entry may be earlier).
 *  3. Otherwise (new, reappeared, status changed, first snapshot) the entry date is unknowable → no age.
 * A status-entry date is never assumed.
 */
export function computeStatusAge(input: StatusAgeInput): StatusAgeResult {
  const continuing =
    input.prior !== null && input.statusKey !== null && input.prior.statusKey === input.statusKey;
  const observedSince = continuing ? input.prior!.observedSince : input.snapshotDate;

  if (input.statusEntryDate) {
    const d = diffDays(input.statusEntryDate, input.snapshotDate);
    if (d >= 0) return { ageDays: d, basis: 'STATUS_ENTRY_DATE', observedSince };
  }
  if (continuing) {
    return { ageDays: diffDays(observedSince, input.snapshotDate), basis: 'OBSERVED_SNAPSHOTS', observedSince };
  }
  return { ageDays: null, basis: 'UNKNOWN_INSUFFICIENT_HISTORY', observedSince };
}
