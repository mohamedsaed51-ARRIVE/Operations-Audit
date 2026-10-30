'use strict';
/**
 * Spreadsheet extraction worker (XLSX / XLS).
 *
 * Runs inside a worker_thread with a hard memory limit and a wall-clock timeout enforced by the parent,
 * because the pinned SheetJS release (0.18.5) is the last one published on npm and has known
 * parser issues (prototype pollution, ReDoS) on crafted files. Isolating it contains those risks:
 * a hostile file can hang or crash only this thread, never the API process.
 *
 * The worker returns a plain matrix of the ORIGINAL cell values (numbers stay numbers; dates stay Excel
 * serial numbers) — no interpretation happens here.
 */
const { parentPort, workerData } = require('node:worker_threads');
const XLSX = require('xlsx');

function fail(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

try {
  const { buffer, maxRows, maxCols, maxSheets } = workerData;
  const wb = XLSX.read(Buffer.from(buffer), {
    type: 'buffer',
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false,
    sheetStubs: false,
    bookVBA: false,
  });
  if (wb.SheetNames.length > maxSheets) throw fail('FILE_TOO_MANY_SHEETS', `عدد الأوراق ${wb.SheetNames.length}`);

  const date1904 = Boolean(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
  let nulCount = 0;
  const sheets = wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name];
    const hiddenFlag = wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[index] ? wb.Workbook.Sheets[index].Hidden : 0;
    if (!ws || !ws['!ref']) return { name, index, hidden: Boolean(hiddenFlag), rows: [], firstExcelRow: 1, firstColumn: 0 };
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rowCount = range.e.r - range.s.r + 1;
    const colCount = range.e.c - range.s.c + 1;
    if (rowCount > maxRows) throw fail('FILE_TOO_MANY_ROWS', `الورقة «${name}» تحتوي ${rowCount} صفًا`);
    if (colCount > maxCols) throw fail('FILE_TOO_MANY_COLUMNS', `الورقة «${name}» تحتوي ${colCount} عمودًا`);

    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    // Trim trailing rows that are entirely empty (formatting-only range).
    const isEmptyCell = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    while (rows.length > 0 && rows[rows.length - 1].every(isEmptyCell)) rows.pop();

    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        const v = row[i];
        if (typeof v === 'string' && v.indexOf('\u0000') !== -1) {
          row[i] = v.split('\u0000').join('');
          nulCount++;
        }
      }
    }
    return { name, index, hidden: Boolean(hiddenFlag), rows, firstExcelRow: range.s.r + 1, firstColumn: range.s.c };
  });
  parentPort.postMessage({ ok: true, result: { sheets, date1904, nulCount } });
} catch (e) {
  parentPort.postMessage({ ok: false, code: e && e.code ? e.code : 'FILE_UNREADABLE', message: String(e && e.message ? e.message : e) });
}
