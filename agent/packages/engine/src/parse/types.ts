import type { EngineIssue } from '../issues.js';

export type FileType = 'xlsx' | 'xls' | 'csv';

export interface RawSheet {
  name: string;
  index: number;
  hidden: boolean;
  /** Original cell values, one array per spreadsheet row, starting at `firstExcelRow`. */
  rows: unknown[][];
  /** Excel (1-based) row number of rows[0]. */
  firstExcelRow: number;
  /** Zero-based column offset of the used range (columns before it are not materialised). */
  firstColumn: number;
}

export interface ParsedFile {
  fileType: FileType;
  sheets: RawSheet[];
  date1904: boolean;
  /** Non-blocking file-level observations (encoding fallback, removed control characters…). */
  warnings: EngineIssue[];
}

export interface FileLimits {
  maxBytes: number;
  maxRows: number;
  maxColumns: number;
  maxSheets: number;
  /** Wall-clock budget for spreadsheet parsing. */
  parseTimeoutMs: number;
  /** Heap limit for the parsing worker. */
  parseMemoryMb: number;
}

export const DEFAULT_FILE_LIMITS: FileLimits = {
  maxBytes: 20 * 1024 * 1024,
  maxRows: 200_000,
  maxColumns: 200,
  maxSheets: 20,
  parseTimeoutMs: 30_000,
  parseMemoryMb: 768,
};

export class FileProcessingError extends Error {
  constructor(public readonly issue: EngineIssue) {
    super(`${issue.code}: ${issue.explanation}`);
    this.name = 'FileProcessingError';
  }
}
