import { parse } from 'csv-parse/sync';
import { makeIssue, type EngineIssue } from '../issues.js';
import { FileProcessingError, type FileLimits, type RawSheet } from './types.js';

export interface CsvResult {
  sheet: RawSheet;
  warnings: EngineIssue[];
  encoding: 'utf-8' | 'windows-1256';
}

function decode(buf: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1256' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1256').decode(buf), encoding: 'windows-1256' };
  }
}

/** Picks the delimiter that appears most often in the first non-empty line (outside quotes). */
export function sniffDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch]!++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ',';
}

export function extractCsv(buffer: Uint8Array, limits: FileLimits): CsvResult {
  const { text, encoding } = decode(buffer);
  const warnings: EngineIssue[] = [];
  if (encoding !== 'utf-8') warnings.push(makeIssue('FILE_ENCODING_FALLBACK', { field: 'file' }));

  let records: string[][];
  try {
    records = parse(text, {
      delimiter: sniffDelimiter(text),
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      trim: false,
    }) as string[][];
  } catch (e) {
    throw new FileProcessingError(makeIssue('FILE_UNREADABLE', { detail: (e as Error).message }));
  }
  // csv-parse yields [''] hmm for blank lines in some versions; normalise those to empty rows.
  const rows: unknown[][] = records.map((r) => (r.length === 1 && r[0] === '' ? [] : r));
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c === '' || c === null)) rows.pop();

  if (rows.length > limits.maxRows) throw new FileProcessingError(makeIssue('FILE_TOO_MANY_ROWS', { detail: `${rows.length} صفًا.` }));
  const widest = rows.reduce((m, r) => Math.max(m, r.length), 0);
  if (widest > limits.maxColumns) throw new FileProcessingError(makeIssue('FILE_TOO_MANY_COLUMNS', { detail: `${widest} عمودًا.` }));

  return {
    sheet: { name: 'CSV', index: 0, hidden: false, rows, firstExcelRow: 1, firstColumn: 0 },
    warnings,
    encoding,
  };
}
