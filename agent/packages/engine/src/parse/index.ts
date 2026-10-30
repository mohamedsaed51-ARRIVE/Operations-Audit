import { makeIssue } from '../issues.js';
import { extractCsv } from './csv.js';
import { DEFAULT_FILE_LIMITS, FileProcessingError, type FileLimits, type FileType, type ParsedFile } from './types.js';
import { validateFileBasics } from './validateFile.js';
import { extractWorkbook } from './workbook.js';

export * from './types.js';
export { validateFileBasics, extensionOf } from './validateFile.js';
export { sniffDelimiter } from './csv.js';

/**
 * Validates and parses an uploaded file into the matrix of its original cell values.
 * Throws FileProcessingError for file-level failures.
 */
export async function parseUploadedFile(
  input: { filename: string; buffer: Uint8Array },
  limits: FileLimits = DEFAULT_FILE_LIMITS,
): Promise<ParsedFile> {
  const basics = validateFileBasics(
    { filename: input.filename, size: input.buffer.byteLength, head: input.buffer.subarray(0, 8192) },
    limits,
  );
  if (!basics.fileType) throw new FileProcessingError(basics.issues[0]!);
  const fileType: FileType = basics.fileType;

  if (fileType === 'csv') {
    const csv = extractCsv(input.buffer, limits);
    return { fileType, sheets: [csv.sheet], date1904: false, warnings: csv.warnings };
  }

  const wb = await extractWorkbook(input.buffer, limits);
  if (wb.sheets.length === 0) throw new FileProcessingError(makeIssue('FILE_NO_SHEETS'));
  const warnings = wb.nulCount > 0 ? [makeIssue('FILE_CONTROL_CHARS_REMOVED', { detail: `عدد الخلايا: ${wb.nulCount}.` })] : [];
  return { fileType, sheets: wb.sheets, date1904: wb.date1904, warnings };
}
