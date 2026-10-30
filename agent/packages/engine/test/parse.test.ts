import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILE_LIMITS, FileProcessingError, extensionOf, parseUploadedFile, sniffDelimiter, validateFileBasics,
} from '../src/index.js';
import { AR_HEADERS, makeWorkbook } from './helpers.js';

const rows = [AR_HEADERS, ['EG100001', 'جديد', 'القاهرة', 'أحمد', 46300, 'القاهرة'], ['EG100002', 'جديد', 'الجيزة', 'محمد', '2026-10-05', 'الجيزة']];
const head = (b: Uint8Array) => b.subarray(0, 8192);

describe('file validation', () => {
  it('rejects unsupported extensions, empty files, oversize files', () => {
    expect(validateFileBasics({ filename: 'a.pdf', size: 10, head: new Uint8Array(10) }, DEFAULT_FILE_LIMITS).issues[0]!.code).toBe('FILE_UNSUPPORTED_EXTENSION');
    expect(validateFileBasics({ filename: 'a.csv', size: 0, head: new Uint8Array() }, DEFAULT_FILE_LIMITS).issues[0]!.code).toBe('FILE_EMPTY');
    expect(validateFileBasics({ filename: 'a.csv', size: 99, head: new Uint8Array(10) }, { ...DEFAULT_FILE_LIMITS, maxBytes: 50 }).issues[0]!.code).toBe('FILE_TOO_LARGE');
  });
  it('checks real content against the extension', () => {
    const xlsx = makeWorkbook({ S: rows });
    const xls = makeWorkbook({ S: rows }, 'biff8');
    const ok = (name: string, b: Uint8Array) => validateFileBasics({ filename: name, size: b.length, head: head(b) }, DEFAULT_FILE_LIMITS);
    expect(ok('a.xlsx', xlsx).fileType).toBe('xlsx');
    expect(ok('a.xls', xls).fileType).toBe('xls');
    expect(ok('a.xls', xlsx).issues[0]!.code).toBe('FILE_CONTENT_MISMATCH'); // xlsx renamed .xls
    expect(ok('a.xlsx', xls).issues[0]!.code).toBe('FILE_CONTENT_MISMATCH');
    expect(ok('a.csv', xlsx).issues[0]!.code).toBe('FILE_CONTENT_MISMATCH'); // binary renamed .csv
    expect(ok('a.xlsx', Buffer.from('not a zip')).issues[0]!.code).toBe('FILE_CONTENT_MISMATCH');
    expect(ok('a.exe.csv', Buffer.from([0x4d, 0x5a, 0, 0])).issues[0]!.code).toBe('FILE_CONTENT_MISMATCH');
  });
  it('reads the extension case-insensitively', () => {
    expect(extensionOf('Report.XLSX')).toBe('xlsx');
    expect(extensionOf('noext')).toBe('');
  });
});

describe('parseUploadedFile', () => {
  it('reads every worksheet of an XLSX with the original cell values', async () => {
    const buf = makeWorkbook({ جرد: rows, ملاحظات: [['ملاحظة'], ['x']] });
    const p = await parseUploadedFile({ filename: 'a.xlsx', buffer: buf });
    expect(p.sheets.map((s) => s.name)).toEqual(['جرد', 'ملاحظات']);
    expect(p.sheets[0]!.rows[1]![4]).toBe(46300); // date stays an Excel serial: original value untouched
    expect(p.sheets[0]!.rows[2]![4]).toBe('2026-10-05');
    expect(p.sheets[0]!.firstExcelRow).toBe(1);
  });
  it('reads legacy XLS', async () => {
    const p = await parseUploadedFile({ filename: 'a.xls', buffer: makeWorkbook({ جرد: rows }, 'biff8') });
    expect(p.fileType).toBe('xls');
    expect(p.sheets[0]!.rows).toHaveLength(3);
  });
  it('reads CSV with BOM, semicolons and quoted multi-line cells', async () => {
    const csv = '﻿بوليصة;الحالة;الفرع\r\nEG1;"جديد";"فرع\nالقاهرة"\r\n\r\nEG2;جديد;الجيزة\r\n';
    const p = await parseUploadedFile({ filename: 'a.csv', buffer: Buffer.from(csv, 'utf8') });
    expect(p.sheets[0]!.rows[0]).toEqual(['بوليصة', 'الحالة', 'الفرع']);
    expect(p.sheets[0]!.rows[1]![2]).toBe('فرع\nالقاهرة');
    expect(p.sheets[0]!.rows).toHaveLength(4); // blank line preserved as an (empty) row
  });
  it('keeps CSV values as text (leading zeros survive)', async () => {
    const p = await parseUploadedFile({ filename: 'a.csv', buffer: Buffer.from('a,b\n00123,1.50\n') });
    expect(p.sheets[0]!.rows[1]).toEqual(['00123', '1.50']);
  });
  it('falls back to Windows-1256 with a warning', async () => {
    const buf = Buffer.from([0xc7, 0xe1, 0xdd, 0xd1, 0xda, 0x2c, 0x31, 0x0a, 0x78, 0x2c, 0x32]); // "الفرع,1\nx,2" in cp1256
    const p = await parseUploadedFile({ filename: 'a.csv', buffer: buf });
    expect(p.warnings.map((w) => w.code)).toContain('FILE_ENCODING_FALLBACK');
    expect(p.sheets[0]!.rows[0]![0]).toBe('الفرع');
  });
  it('sniffs delimiters', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a\tb\tc')).toBe('\t');
    expect(sniffDelimiter('"a;b",c')).toBe(',');
  });
  it('rejects corrupt spreadsheets and oversize ranges with a file-level error', async () => {
    const corrupt = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('garbage-garbage-garbage')]);
    await expect(parseUploadedFile({ filename: 'a.xlsx', buffer: corrupt })).rejects.toBeInstanceOf(FileProcessingError);
    const big = makeWorkbook({ S: Array.from({ length: 50 }, (_, i) => [i]) });
    await expect(parseUploadedFile({ filename: 'a.xlsx', buffer: big }, { ...DEFAULT_FILE_LIMITS, maxRows: 10 })).rejects.toMatchObject({ issue: { code: 'FILE_TOO_MANY_ROWS' } });
    await expect(parseUploadedFile({ filename: 'a.pdf', buffer: Buffer.from('x') })).rejects.toMatchObject({ issue: { code: 'FILE_UNSUPPORTED_EXTENSION' } });
  });
});
