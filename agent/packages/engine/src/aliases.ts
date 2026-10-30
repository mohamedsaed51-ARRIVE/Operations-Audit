import type { FieldKey } from '@arrive/shared';

/**
 * CANDIDATE header aliases per field — never guaranteed mappings.
 * `weight` < 1 marks aliases that are plausible but not equivalent (e.g. a courier column is not
 * necessarily the custody holder), so they can never reach "confident" without user confirmation.
 */
export interface AliasDef {
  text: string;
  weight?: number;
}

const a = (text: string, weight = 1): AliasDef => ({ text, weight });

export const FIELD_ALIASES: Record<FieldKey, AliasDef[]> = {
  tracking: [
    a('بوليصة'), a('رقم البوليصة'), a('رقم الشحنة'), a('كود الشحنة'), a('رقم التتبع'),
    a('باركود'), a('رقم الاوردر', 0.85), a('رقم الأوردر', 0.85), a('رقم الطلب', 0.8),
    a('Tracking Number'), a('Tracking No'), a('Tracking ID'), a('Tracking'),
    a('Shipment ID'), a('Shipment Number'), a('Shipment No'), a('AWB'), a('Waybill'),
    a('Airway Bill'), a('Barcode'), a('Order Number', 0.85), a('Order ID', 0.85),
  ],
  status: [
    a('حالة الشحنة'), a('الحالة'), a('الحالة الحالية'), a('حالة الاوردر'), a('حالة الطلب'),
    a('Shipment Status'), a('Status'), a('Current Status'), a('Order Status'),
  ],
  branch: [
    a('الفرع'), a('الفرع الحالي'), a('فرع'), a('اسم الفرع'),
    a('Branch'), a('Current Branch'), a('Branch Name'),
  ],
  employee: [
    a('عهدة العضو'), a('اسم الموظف'), a('الموظف المسؤول'), a('الموظف'), a('عهدة'),
    a('المندوب', 0.6), a('اسم المندوب', 0.6), a('Courier', 0.6),
    a('Employee'), a('Assigned Employee'), a('Custodian'), a('Employee Name'),
  ],
  createdDate: [
    a('تاريخ الشحنة'), a('تاريخ الانشاء'), a('تاريخ الإنشاء'), a('تاريخ انشاء الشحنة'),
    a('تاريخ الاوردر'), a('تاريخ الطلب', 0.9), a('تاريخ التسجيل', 0.8),
    a('Order Date'), a('Created At'), a('Creation Date'), a('Created Date'), a('Shipment Date'),
  ],
  statusEntryDate: [
    a('تاريخ الحالة'), a('تاريخ دخول الحالة'), a('تاريخ تغيير الحالة'),
    a('Status Date'), a('Status Changed At'), a('Status Change Date'),
  ],
  lastUpdateDate: [
    a('آخر تحديث'), a('اخر تحديث'), a('تاريخ آخر تحديث'), a('تاريخ اخر تحديث'),
    a('Last Updated'), a('Last Update'), a('Updated At'), a('Last Modified'),
  ],
  governorate: [
    a('المحافظة'), a('محافظة'), a('Governorate'), a('Province'), a('المدينة', 0.5), a('City', 0.5),
  ],
};

/**
 * A header that contains one of these words describes a date/time, so it can never be the
 * value column of these (non-date) fields. This is what keeps «تاريخ الحالة» from being read as the status.
 */
export const DATE_WORDS = ['تاريخ', 'date', 'time', 'وقت', 'at'];
export const NON_DATE_FIELDS: readonly FieldKey[] = ['tracking', 'status', 'branch', 'employee', 'governorate'];

/** Words that make a date-field header mean something else (e.g. «تاريخ الحالة» is not the creation date). */
export const CREATED_DATE_EXCLUDES = ['الحالة', 'status', 'تحديث', 'update', 'updated', 'تسليم', 'delivery', 'delivered'];

/** Sensitive columns that must be masked in previews when not mapped. */
export const SENSITIVE_HEADER_WORDS = [
  'phone', 'mobile', 'tel', 'telephone', 'whatsapp', 'تليفون', 'هاتف', 'موبايل', 'محمول', 'جوال', 'رقم الهاتف',
  'address', 'عنوان', 'customer', 'عميل', 'receiver', 'consignee', 'recipient', 'مستلم', 'المرسل اليه', 'المرسل إليه',
  'sender', 'shipper', 'مرسل', 'email', 'ايميل', 'بريد', 'cod', 'تحصيل', 'amount', 'مبلغ', 'قيمة',
];
