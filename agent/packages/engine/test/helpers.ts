import * as XLSX from 'xlsx';

/** Builds an XLSX/XLS buffer from {sheetName: matrix}. Test-only. */
export function makeWorkbook(sheets: Record<string, unknown[][]>, bookType: 'xlsx' | 'biff8' = 'xlsx'): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows as never), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType }) as Buffer;
}

export const AR_HEADERS = ['بوليصة', 'حالة الشحنة', 'الفرع', 'عهدة العضو', 'تاريخ الشحنة', 'المحافظة'];
export const EN_HEADERS = ['Tracking Number', 'Shipment Status', 'Current Branch', 'Employee', 'Created At', 'Governorate'];
