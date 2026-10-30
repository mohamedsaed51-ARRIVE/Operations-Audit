import { makeIssue, type EngineIssue } from '../issues.js';
import type { FileLimits, FileType } from './types.js';

const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const XLS_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const startsWith = (buf: Uint8Array, magic: number[]) => magic.every((b, i) => buf[i] === b);

export function extensionOf(filename: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return m ? m[1]!.toLowerCase() : '';
}

export interface FileBasics {
  filename: string;
  size: number;
  /** First bytes of the file (at least 8 KB when available). */
  head: Uint8Array;
}

export interface FileValidationResult {
  fileType: FileType | null;
  issues: EngineIssue[];
}

/**
 * Validates extension, size and real content signature *before* any parser touches the file.
 * An extension alone is never trusted.
 */
export function validateFileBasics(file: FileBasics, limits: FileLimits): FileValidationResult {
  const issues: EngineIssue[] = [];
  const ext = extensionOf(file.filename);
  const ctx = { worksheet: null, rowNumber: null, field: 'file', originalValue: file.filename };

  if (ext !== 'xlsx' && ext !== 'xls' && ext !== 'csv') {
    issues.push(makeIssue('FILE_UNSUPPORTED_EXTENSION', ctx));
    return { fileType: null, issues };
  }
  if (file.size === 0) {
    issues.push(makeIssue('FILE_EMPTY', ctx));
    return { fileType: null, issues };
  }
  if (file.size > limits.maxBytes) {
    issues.push(makeIssue('FILE_TOO_LARGE', { ...ctx, detail: `الحجم ${(file.size / 1048576).toFixed(1)} MB والحد ${(limits.maxBytes / 1048576).toFixed(0)} MB.` }));
    return { fileType: null, issues };
  }

  const isZip = startsWith(file.head, XLSX_MAGIC);
  const isOle = startsWith(file.head, XLS_MAGIC);
  let ok: boolean;
  if (ext === 'xlsx') ok = isZip;
  else if (ext === 'xls') ok = isOle;
  else ok = !isZip && !isOle && !file.head.subarray(0, 8192).includes(0);

  if (!ok) {
    issues.push(makeIssue('FILE_CONTENT_MISMATCH', { ...ctx, detail: `الامتداد .${ext} لا يطابق المحتوى الفعلي.` }));
    return { fileType: null, issues };
  }
  return { fileType: ext, issues };
}
