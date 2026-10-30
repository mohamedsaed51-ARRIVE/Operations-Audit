/**
 * Deterministic fixture generator. Every file is built from the explicit tables below, and the
 * expected results live separately (and by hand) in expected.ts — never derived from the engine.
 *
 * Run: npm run fixtures
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const OUT = fileURLToPath(new URL('./files/', import.meta.url));
mkdirSync(OUT, { recursive: true });

// ── cell helpers ──
type Cell = string | number | null | { serial: string } | { dmy: string };
const serial = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
};
const S = (iso: string) => ({ serial: iso }); // real Excel date cell
const T = (iso: string) => iso; // ISO text date

function sheetOf(rows: Cell[][]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxC = 0;
  rows.forEach((row, r) => row.forEach((cell, c) => {
    maxC = Math.max(maxC, c);
    if (cell === null) return;
    const ref = XLSX.utils.encode_cell({ r, c });
    if (typeof cell === 'string') ws[ref] = { t: 's', v: cell };
    else if (typeof cell === 'number') ws[ref] = { t: 'n', v: cell };
    else if ('serial' in cell) ws[ref] = { t: 'n', v: serial(cell.serial), z: 'yyyy-mm-dd' };
    else { ws[ref] = { t: 's', v: cell.dmy }; }
  }));
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: maxC } });
  return ws;
}

function writeBook(name: string, sheets: Record<string, Cell[][]>, bookType: XLSX.BookType = 'xlsx') {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, sheetOf(rows), sheetName);
  writeFileSync(`${OUT}${name}`, XLSX.write(wb, { type: 'buffer', bookType }) as Buffer);
}

const csvEscape = (v: Cell) => (v === null ? '' : typeof v === 'object' ? ('serial' in v ? v.serial : v.dmy) : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function writeCsv(name: string, rows: Cell[][]) {
  writeFileSync(`${OUT}${name}`, '﻿' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n', 'utf8');
}

// ── Arabic inventory layout ──
const AR_HEAD: Cell[] = ['بوليصة', 'حالة الشحنة', 'الفرع', 'عهدة العضو', 'تاريخ الشحنة', 'المحافظة', 'تاريخ آخر تحديث', 'تليفون العميل'];
const row = (t: string | null, status: string | null, branch: string | null, emp: string | null, created: Cell, gov: string | null, upd: Cell, phone = '01000000001'): Cell[] =>
  [t, status, branch, emp, created, gov, upd, phone];

// DAY 1 — snapshot 2026-10-20. Excel row = index + 1 (header is row 1).
const day1: Cell[][] = [
  AR_HEAD,
  row('EG1001', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-20'), 'القاهرة', T('2026-10-20')), // 2  same-day → age 0
  row('EG1002', 'مع المندوب', 'القاهرة', 'أحمد علي', S('2026-10-05'), 'القاهرة', T('2026-10-17')), // 3  age 15
  row('EG1003', 'مع المندوب', 'الجيزة', 'محمد حسن', S('2026-10-04'), 'الجيزة', T('2026-10-10')), // 4  age 16
  row('EG1004', 'معلق', 'الجيزة', 'محمد حسن', S('2026-09-25'), 'الجيزة', T('2026-10-01')), // 5  age 25
  row('EG1005', 'معلق', 'الإسكندرية', 'سمير علي', S('2026-09-24'), 'الإسكندرية', T('2026-09-30')), // 6  age 26
  row('EG1006', 'مع المندوب', 'القاهرة', 'أحمد علي', S('2026-10-18'), 'القاهرة', T('2026-10-19')), // 7  age 2
  row('EG1007', 'بالفرع', 'الإسكندرية', 'سمير علي', { dmy: '15/10/2026' }, 'الإسكندرية', T('2026-10-16')), // 8  age 5 (text DMY date)
  row('EG1008', 'بالفرع', 'القاهرة', 'أحمد علي', S('2026-10-16'), 'القاهرة', T('2026-10-18')), // 9  age 4
  row('EG1009', 'مع المندوب', 'الجيزة', 'محمد حسن', S('2026-10-17'), 'الجيزة', T('2026-10-18')), // 10 age 3
  row('EG1010', 'بالفرع', 'القاهرة', 'أحمد علي', S('2026-10-12'), 'القاهرة', T('2026-10-14')), // 11 age 8
  row('EG1011', 'بالفرع', 'الجيزة', null, S('2026-10-19'), 'الجيزة', null), // 12 missing employee, age 1
  row('EG1012', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-19'), 'القاهرة', null), // 13 duplicate (primary)
  row('EG1012', 'تم التسليم', 'القاهرة', 'أحمد علي', S('2026-10-19'), 'القاهرة', null), // 14 duplicate, different status
  row('EG1013', 'جديد', 'القاهرة', 'أحمد علي', '2026-02-30', 'القاهرة', null), // 15 invalid date
  row('EG1014', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-25'), 'القاهرة', null), // 16 future date
  row('EG1015', 'معلق', 'الجيزة', 'محمد حسن', S('2026-10-10'), 'الجيزة', null), // 17 age 10
  [null, null, null, null, null, null, null, null], // 18 empty row
  row(null, 'جديد', 'القاهرة', 'ليلى محمد', S('2026-10-19'), 'القاهرة', null), // 19 missing tracking
  row('EG1016', 'حالة غريبة', 'القاهرة', 'أحمد علي', S('2026-10-19'), 'القاهرة', null), // 20 unknown status
  row('EG1017', 'جديد', 'مدينة نصر', 'أحمد علي', S('2026-10-19'), 'القاهرة', null), // 21 unknown branch
];
writeBook('inventory_day1_2026-10-20_ar.xlsx', {
  الجرد: day1,
  ملاحظات: [['ملاحظات عامة'], ['هذه الورقة ليست جردًا']],
});

// DAY 2 — snapshot 2026-10-21
writeBook('inventory_day2_2026-10-21_ar.xlsx', {
  الجرد: [
    AR_HEAD,
    row('EG1001', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-20'), 'القاهرة', T('2026-10-21')),
    row('EG1002', 'مع المندوب', 'القاهرة', 'أحمد علي', S('2026-10-05'), 'القاهرة', T('2026-10-17')),
    row('EG1003', 'مع المندوب', 'الجيزة', 'محمد حسن', S('2026-10-04'), 'الجيزة', T('2026-10-10')),
    row('EG1004', 'معلق', 'الجيزة', 'محمد حسن', S('2026-09-25'), 'الجيزة', T('2026-10-01')),
    row('EG1005', 'معلق', 'الإسكندرية', 'سمير علي', S('2026-09-24'), 'الإسكندرية', T('2026-09-30')),
    row('EG1006', 'مع المندوب', 'القاهرة', 'أحمد علي', S('2026-10-18'), 'القاهرة', T('2026-10-19')),
    row('EG1007', 'مع المندوب', 'الإسكندرية', 'سمير علي', S('2026-10-15'), 'الإسكندرية', T('2026-10-21')), // STATUS_CHANGED
    row('EG1008', 'بالفرع', 'الجيزة', 'أحمد علي', S('2026-10-16'), 'القاهرة', T('2026-10-18')), // BRANCH_CHANGED
    row('EG1009', 'مع المندوب', 'الجيزة', 'سمير علي', S('2026-10-17'), 'الجيزة', T('2026-10-18')), // EMPLOYEE_CHANGED
    // EG1010 disappears
    row('EG1011', 'بالفرع', 'الجيزة', null, S('2026-10-19'), 'الجيزة', null),
    row('EG1012', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-19'), 'القاهرة', null), // duplicate resolved
    row('EG1013', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-19'), 'القاهرة', null), // date corrected
    // EG1014 disappears
    row('EG1015', 'معلق', 'الجيزة', 'محمد حسن', S('2026-10-10'), 'الجيزة', null),
    row('EG1016', 'حالة غريبة', 'القاهرة', 'أحمد علي', S('2026-10-19'), 'القاهرة', null),
    row('EG1017', 'جديد', 'مدينة نصر', 'أحمد علي', S('2026-10-19'), 'القاهرة', null),
    row('EG2001', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-21'), 'القاهرة', null), // NEW
    row('EG2002', 'جديد', 'الجيزة', 'محمد حسن', S('2026-10-20'), 'الجيزة', null), // NEW
  ],
});

// DAY 3 — snapshot 2026-10-22 (EG1010 reappears after being absent on day 2)
writeBook('inventory_day3_2026-10-22_ar.xlsx', {
  الجرد: [
    AR_HEAD,
    row('EG1001', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-20'), 'القاهرة', null),
    row('EG1007', 'مع المندوب', 'الإسكندرية', 'سمير علي', S('2026-10-15'), 'الإسكندرية', null),
    row('EG1010', 'بالفرع', 'القاهرة', 'أحمد علي', S('2026-10-12'), 'القاهرة', null), // REAPPEARED
    row('EG1015', 'معلق', 'الجيزة', 'محمد حسن', S('2026-10-10'), 'الجيزة', null),
    row('EG2001', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-21'), 'القاهرة', null),
    row('EG3001', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-22'), 'القاهرة', null), // NEW
  ],
});

// DAY 4 — English CSV, snapshot 2026-10-25 (3-day gap after day 3)
writeCsv('inventory_day4_2026-10-25_en.csv', [
  ['Tracking Number', 'Shipment Status', 'Current Branch', 'Employee', 'Created At', 'Governorate'],
  ['EG1001', 'New', 'Cairo', 'Ahmed Ali', '2026-10-20', 'Cairo'],
  ['EG1007', 'Out For Delivery', 'Alexandria', 'Samir Ali', '2026-10-15', 'Alexandria'],
  ['EG4001', 'New', 'Cairo', 'Ahmed Ali', '2026-10-25', 'Cairo'],
]);

// ── standalone mapping fixtures ──
writeBook('english_valid.xlsx', {
  Inventory: [
    ['Shipment ID', 'Status', 'Branch', 'Assigned Employee', 'Order Date', 'Updated At', 'Governorate'],
    ['EN5001', 'Delivered', 'Cairo', 'Ahmed Ali', S('2026-10-01'), S('2026-10-02'), 'Cairo'],
    ['EN5002', 'Pending', 'Giza', 'Mohamed Hassan', S('2026-10-03'), S('2026-10-04'), 'Giza'],
    ['EN5003', 'In Transit', 'Cairo', 'Ahmed Ali', S('2026-10-05'), null, 'Cairo'],
  ],
});
writeBook('legacy_ar.xls', {
  الجرد: [
    ['رقم الشحنة', 'الحالة', 'الفرع الحالي', 'اسم الموظف', 'تاريخ الإنشاء'],
    ['XL7001', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-18')],
    ['XL7002', 'مع المندوب', 'الجيزة', 'محمد حسن', S('2026-10-19')],
  ],
}, 'biff8');
writeBook('multi_sheet.xlsx', {
  القاهرة: [
    ['بوليصة', 'الحالة', 'الفرع', 'عهدة العضو', 'تاريخ الشحنة'],
    ['MS8001', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-19')],
    ['MS8002', 'مع المندوب', 'القاهرة', 'أحمد علي', S('2026-10-18')],
    ['MS8099', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-19')], // also on the Giza sheet
  ],
  الجيزة: [
    ['بوليصة', 'الحالة', 'الفرع', 'عهدة العضو', 'تاريخ الشحنة'],
    ['MS8003', 'معلق', 'الجيزة', 'محمد حسن', S('2026-10-17')],
    ['MS8099', 'جديد', 'الجيزة', 'محمد حسن', S('2026-10-19')],
  ],
  ملخص: [['إجمالي', 5], ['ملاحظة', 'ورقة تلخيص']],
});
writeBook('missing_columns.xlsx', {
  الجرد: [
    ['بوليصة', 'الفرع', 'عهدة العضو'],
    ['MC9001', 'القاهرة', 'أحمد علي'],
    ['MC9002', 'الجيزة', 'محمد حسن'],
  ],
});
writeBook('ambiguous_columns.xlsx', {
  الجرد: [
    ['Tracking Number', 'Shipment ID', 'Status', 'Branch', 'Created At', 'Employee'],
    ...Array.from({ length: 8 }, (_, i): Cell[] => [`AM60${10 + i}`, `SH90${10 + i}`, 'New', 'Cairo', S('2026-10-18'), 'Ahmed Ali']),
  ],
});
writeBook('header_offset.xlsx', {
  الجرد: [
    ['تقرير الجرد اليومي — فرع القاهرة'],
    ['تاريخ التصدير: 2026-10-20'],
    [null],
    [null],
    ['بوليصة', 'حالة الشحنة', 'الفرع', 'عهدة العضو', 'تاريخ الشحنة'],
    ['HO3001', 'جديد', 'القاهرة', 'أحمد علي', S('2026-10-19')], // Excel row 6
    ['HO3002', 'جديد', 'القاهرة', null, S('2026-10-19')], // Excel row 7 → missing employee
  ],
});

console.log(`fixtures written to ${OUT}`);
