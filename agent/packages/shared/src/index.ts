/**
 * Contracts shared by engine, database, API and web.
 * Pure types and constants only — no runtime dependencies.
 */

// ───────────────────────── Column mapping ─────────────────────────

export const FIELD_KEYS = [
  'tracking',
  'status',
  'branch',
  'employee',
  'createdDate',
  'statusEntryDate',
  'lastUpdateDate',
  'governorate',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

/** Fields without which a sheet cannot be ingested. */
export const REQUIRED_FIELDS: readonly FieldKey[] = ['tracking', 'status', 'branch', 'createdDate'];

export const FIELD_LABELS_AR: Record<FieldKey, string> = {
  tracking: 'رقم الشحنة / البوليصة',
  status: 'حالة الشحنة',
  branch: 'الفرع',
  employee: 'الموظف (عهدة)',
  createdDate: 'تاريخ إنشاء الشحنة',
  statusEntryDate: 'تاريخ دخول الحالة',
  lastUpdateDate: 'تاريخ آخر تحديث',
  governorate: 'المحافظة',
};

export const DATE_FIELDS: readonly FieldKey[] = ['createdDate', 'statusEntryDate', 'lastUpdateDate'];

export type DateOrder = 'DMY' | 'MDY';

export type DetectionStatus = 'CONFIDENT' | 'AMBIGUOUS' | 'LOW' | 'MISSING';

export interface ColumnCandidate {
  columnIndex: number;
  header: string;
  score: number;
  reasons: string[];
}

export interface FieldDetection {
  field: FieldKey;
  status: DetectionStatus;
  /** Best candidate. It is a suggestion only; never applied without explicit confirmation. */
  suggestedColumn: number | null;
  confidence: number;
  candidates: ColumnCandidate[];
}

export interface SheetDetection {
  headerRowIndex: number;
  headerConfidence: 'HIGH' | 'LOW';
  headers: string[];
  duplicateHeaders: string[];
  fields: Record<FieldKey, FieldDetection>;
}

export interface SheetMappingInput {
  sheetIndex: number;
  include: boolean;
  headerRowIndex?: number;
  fields: Partial<Record<FieldKey, number | null>>;
  /** Fields whose detection was not CONFIDENT but that the user explicitly confirmed. */
  acknowledged: FieldKey[];
  dateOrder?: DateOrder;
}

// ───────────────────────── Data quality ─────────────────────────

export type IssueCategory = 'FILE_LEVEL' | 'ROW_LEVEL' | 'BUSINESS_WARNING' | 'MAPPING_WARNING';
export type IssueSeverity = 'ERROR' | 'WARNING' | 'INFO';

export interface DataQualityIssue {
  code: string;
  category: IssueCategory;
  severity: IssueSeverity;
  worksheet: string | null;
  rowNumber: number | null;
  field: string | null;
  originalValue: string | null;
  explanation: string;
  suggestion: string;
}

// ───────────────────────── Aging ─────────────────────────

export const AGE_CATEGORIES = ['D0_3', 'D4_7', 'D8_15', 'D16_25', 'D26_PLUS'] as const;
export type AgeCategory = (typeof AGE_CATEGORIES)[number];

export const AGE_CATEGORY_LABELS_AR: Record<AgeCategory, string> = {
  D0_3: 'من 0 إلى 3 أيام',
  D4_7: 'من 4 إلى 7 أيام',
  D8_15: 'من 8 إلى 15 يومًا',
  D16_25: 'من 16 إلى 25 يومًا',
  D26_PLUS: 'أكثر من 25 يومًا',
};

export type StatusAgeBasis = 'STATUS_ENTRY_DATE' | 'OBSERVED_SNAPSHOTS' | 'UNKNOWN_INSUFFICIENT_HISTORY';

export const STATUS_AGE_UNKNOWN_LABEL = 'UNKNOWN — INSUFFICIENT HISTORICAL DATA';

export interface AgingConfig {
  /** Shipments older than this are over the permitted age (inclusive boundary stays compliant). */
  maxDays: number;
  /** Shipments older than this are critical. */
  criticalDays: number;
  /** Upper bounds (inclusive) of the first four buckets; the fifth is open-ended. */
  bucketBounds: [number, number, number, number];
}

export const DEFAULT_AGING_CONFIG: AgingConfig = {
  maxDays: 15,
  criticalDays: 25,
  bucketBounds: [3, 7, 15, 25],
};

// ───────────────────────── Snapshot comparison ─────────────────────────

export const CHANGE_TYPES = [
  'NEW',
  'CONTINUED',
  'STATUS_CHANGED',
  'BRANCH_CHANGED',
  'EMPLOYEE_CHANGED',
  'DISAPPEARED',
  'REAPPEARED',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_TYPE_LABELS_AR: Record<ChangeType, string> = {
  NEW: 'جديدة',
  CONTINUED: 'مستمرة',
  STATUS_CHANGED: 'تغيّرت حالتها',
  BRANCH_CHANGED: 'تغيّر فرعها',
  EMPLOYEE_CHANGED: 'تغيّرت عهدتها',
  DISAPPEARED: 'اختفت من الجرد',
  REAPPEARED: 'عادت للظهور',
};

// ───────────────────────── API envelopes ─────────────────────────

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
}

export type UploadStatus = 'UPLOADED' | 'MAPPED' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'REJECTED';
