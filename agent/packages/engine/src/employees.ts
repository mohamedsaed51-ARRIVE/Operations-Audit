import { cleanText, editDistance, foldKey, isMissingValue } from './text.js';

export interface EmployeeIdentity {
  /** Display value: trimmed, whitespace-collapsed, spelling preserved. */
  display: string;
  /** Matching key (Arabic-folded). */
  key: string;
}

/** Returns null when the cell means "no employee" (empty, dash, «غير محدد»…). */
export function normalizeEmployee(value: unknown): EmployeeIdentity | null {
  if (isMissingValue(value)) return null;
  const display = cleanText(value);
  const key = foldKey(display);
  return key === '' ? null : { display, key };
}

export interface NamePair { a: string; b: string; distance: number }

/**
 * Finds distinct employee keys that are suspiciously close (edit distance ≤ 1, length ≥ 8) and may be
 * the same person typed twice. Purely advisory — nothing is merged automatically.
 */
export function findPossibleDuplicateNames(keys: string[], maxPairs = 200): NamePair[] {
  const sorted = [...new Set(keys)].sort();
  const out: NamePair[] = [];
  for (let i = 0; i < sorted.length && out.length < maxPairs; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (a.length < 8 || b.length < 8) continue;
      if (Math.abs(a.length - b.length) > 1) continue;
      const d = editDistance(a, b, 1);
      if (d <= 1) {
        out.push({ a, b, distance: d });
        if (out.length >= maxPairs) break;
      }
    }
  }
  return out;
}
