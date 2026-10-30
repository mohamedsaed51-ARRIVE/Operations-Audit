import type { DataQualityIssue, IssueCategory, IssueSeverity } from '@arrive/shared';

/**
 * Catalogue of every data-quality issue the ingestion engine can raise.
 * Each entry fixes the classification, severity and the Arabic explanation/suggestion template,
 * so the same condition is always reported the same way.
 */
interface IssueDef {
  category: IssueCategory;
  severity: IssueSeverity;
  explanation: string;
  suggestion: string;
}

export const ISSUE_CATALOG = {
  // ── File level ──
  FILE_UNSUPPORTED_EXTENSION: { category: 'FILE_LEVEL', severity: 'ERROR', explanation: 'امتداد الملف غير مدعوم. المسموح: XLSX و XLS و CSV.', suggestion: 'احفظ الملف بصيغة XLSX أو CSV ثم أعد الرفع.' },
  FILE_CONTENT_MISMATCH: { category: 'FILE_LEVEL', severity: 'ERROR', explanation: 'محتوى الملف الفعلي لا يطابق امتداده.', suggestion: 'افتح الملف في Excel ثم احفظه بالصيغة الصحيحة وأعد الرفع.' },
  FILE_EMPTY: { category: 'FILE_LEVEL', severity: 'ERROR', explanation: 'الملف فارغ.', suggestion: 'تأكد من تصدير تقرير الجرد بالكامل.' },
  FILE_TOO_LARGE: { category: 'FILE_LEVEL', severity: 'ERROR', explanation: 'حجم الملف أكبر من الحد المسموح.', suggestion: 'قسّم الملف أو احذف الأعمدة والصفوف غير اللازمة.' },
  FILE_UNREADABLE: { category: 'FILE_LEVEL', severity: 'ERROR', explanation: 'تعذّر قراءة الملف (تالف أو بصيغة غير صالحة).', suggestion: 'أعد تصدير الملف من المصدر ثم أعد الرفع.' },
  FILE_TOO_MANY_ROWS: { category: 'FILE_LEVEL', severity: 'ERROR', explanation: 'عدد الصفوف يتجاوز الحد المسموح.', suggestion: 'احذف الصفوف الفارغة المنسّقة أو قسّم الملف.' },
  FILE_TOO_MANY_COLUMNS: { category: 'FILE_LEVEL', severity: 'ERROR', explanation: 'عدد الأعمدة يتجاوز الحد المسموح.', suggestion: 'احذف الأعمدة غير اللازمة.' },
  FILE_TOO_MANY_SHEETS: { category: 'FILE_LEVEL', severity: 'ERROR', explanation: 'عدد أوراق العمل يتجاوز الحد المسموح.', suggestion: 'احتفظ بأوراق الجرد فقط.' },
  FILE_NO_SHEETS: { category: 'FILE_LEVEL', severity: 'ERROR', explanation: 'لا توجد أوراق عمل قابلة للقراءة في الملف.', suggestion: 'تأكد من أن الملف يحتوي بيانات.' },
  FILE_ENCODING_FALLBACK: { category: 'FILE_LEVEL', severity: 'WARNING', explanation: 'الملف ليس بترميز UTF-8؛ تمت قراءته بترميز Windows-1256. قد تظهر حروف عربية غير صحيحة.', suggestion: 'احفظ الملف بترميز UTF-8 وأعد الرفع إن ظهرت رموز مشوّهة في المعاينة.' },
  FILE_DUPLICATE_CONTENT: { category: 'FILE_LEVEL', severity: 'WARNING', explanation: 'نفس محتوى هذا الملف (بصمة SHA-256) سبق رفعه.', suggestion: 'تأكد أن هذا ليس تكرارًا لجرد سبق رفعه.' },
  FILE_CONTROL_CHARS_REMOVED: { category: 'FILE_LEVEL', severity: 'WARNING', explanation: 'احتوت بعض الخلايا على محارف تحكم (NUL) لا يمكن تخزينها وتمت إزالتها من النسخة المخزّنة.', suggestion: 'راجع الخلايا المتأثرة في الملف الأصلي.' },
  SHEET_EMPTY: { category: 'FILE_LEVEL', severity: 'WARNING', explanation: 'ورقة العمل فارغة.', suggestion: 'لن تُستخدم هذه الورقة ما لم تحتوِ بيانات.' },
  SHEET_NO_HEADER: { category: 'FILE_LEVEL', severity: 'WARNING', explanation: 'لم يتم العثور على صف عناوين واضح في الورقة.', suggestion: 'حدّد صف العناوين يدويًا في شاشة الربط.' },
  SHEET_HEADER_UNCERTAIN: { category: 'MAPPING_WARNING', severity: 'WARNING', explanation: 'صف العناوين المكتشف غير مؤكد (لا يطابق أسماء أعمدة معروفة).', suggestion: 'تحقق من صف العناوين في المعاينة وعدّله عند الحاجة.' },
  SHEET_DUPLICATE_HEADERS: { category: 'MAPPING_WARNING', severity: 'WARNING', explanation: 'توجد عناوين أعمدة مكررة في الورقة.', suggestion: 'اختر العمود الصحيح يدويًا بحسب رقمه.' },
  SHEET_SKIPPED_NOT_INVENTORY: { category: 'MAPPING_WARNING', severity: 'INFO', explanation: 'لم تُستخدم هذه الورقة في الجرد.', suggestion: 'لا إجراء مطلوب إن كانت الورقة غير متعلقة بالجرد.' },

  // ── Mapping ──
  MAPPING_REQUIRED_MISSING: { category: 'MAPPING_WARNING', severity: 'ERROR', explanation: 'عمود مطلوب غير مربوط.', suggestion: 'اختر العمود المناسب يدويًا.' },
  MAPPING_FIELD_NOT_CONFIDENT: { category: 'MAPPING_WARNING', severity: 'WARNING', explanation: 'الكشف التلقائي لهذا العمود غير حاسم (ملتبس أو ثقة منخفضة) ويتطلب تأكيدًا صريحًا.', suggestion: 'اختر العمود يدويًا وأكّد الاختيار.' },
  MAPPING_COLUMN_CONFLICT: { category: 'MAPPING_WARNING', severity: 'ERROR', explanation: 'العمود نفسه مربوط بأكثر من حقل.', suggestion: 'اربط كل حقل بعمود مختلف.' },
  MAPPING_COLUMN_OUT_OF_RANGE: { category: 'MAPPING_WARNING', severity: 'ERROR', explanation: 'رقم العمود المختار غير موجود في الورقة.', suggestion: 'اختر عمودًا من القائمة.' },
  MAPPING_CONTENT_MISMATCH: { category: 'MAPPING_WARNING', severity: 'WARNING', explanation: 'محتوى العمود المختار لا يشبه النوع المتوقع للحقل.', suggestion: 'تحقق من أن العمود صحيح قبل المتابعة.' },
  MAPPING_EMPLOYEE_COLUMN_MISSING: { category: 'MAPPING_WARNING', severity: 'WARNING', explanation: 'لا يوجد عمود موظف/عهدة؛ لا يمكن التحقق من العهدة لأي شحنة في هذه الورقة.', suggestion: 'اربط عمود الموظف (مثل «عهدة العضو») إن كان موجودًا.' },
  MAPPING_OPTIONAL_MISSING: { category: 'MAPPING_WARNING', severity: 'INFO', explanation: 'عمود اختياري غير مربوط؛ المؤشرات المعتمدة عليه ستكون غير متاحة.', suggestion: 'اربطه إن كان موجودًا في الملف.' },
  MAPPING_SHEET_HEADER_OVERRIDDEN: { category: 'MAPPING_WARNING', severity: 'INFO', explanation: 'تم تحديد صف العناوين يدويًا.', suggestion: 'لا إجراء مطلوب.' },

  // ── Row level ──
  EMPTY_ROW: { category: 'ROW_LEVEL', severity: 'INFO', explanation: 'صف فارغ تم تجاهله (محفوظ في البيانات الأصلية).', suggestion: 'لا إجراء مطلوب.' },
  MISSING_TRACKING: { category: 'ROW_LEVEL', severity: 'ERROR', explanation: 'رقم الشحنة مفقود؛ لا يمكن إدراج الصف في الجرد.', suggestion: 'أكمل رقم الشحنة في المصدر ثم أعد الرفع.' },
  INVALID_TRACKING_TYPE: { category: 'ROW_LEVEL', severity: 'ERROR', explanation: 'رقم الشحنة بنوع بيانات غير صالح (قيمة عشرية أو أكبر من دقة الأرقام في إكسل).', suggestion: 'نسّق عمود رقم الشحنة كنص ثم أعد الإدخال.' },
  INVALID_TRACKING_FORMAT: { category: 'ROW_LEVEL', severity: 'WARNING', explanation: 'رقم الشحنة يحتوي رموزًا غير معتادة أو طوله غير معتاد.', suggestion: 'راجع رقم الشحنة في المصدر.' },
  MISSING_STATUS: { category: 'ROW_LEVEL', severity: 'ERROR', explanation: 'حالة الشحنة مفقودة. أُدرج الصف مع حالة غير معروفة.', suggestion: 'أكمل حالة الشحنة في المصدر.' },
  MISSING_BRANCH: { category: 'ROW_LEVEL', severity: 'ERROR', explanation: 'الفرع مفقود. أُدرج الصف مع فرع غير محدد.', suggestion: 'أكمل الفرع في المصدر.' },
  MISSING_CREATED_DATE: { category: 'ROW_LEVEL', severity: 'ERROR', explanation: 'تاريخ إنشاء الشحنة مفقود؛ لا يمكن حساب عمر الشحنة.', suggestion: 'أكمل تاريخ الإنشاء في المصدر.' },
  INVALID_DATE: { category: 'ROW_LEVEL', severity: 'ERROR', explanation: 'قيمة التاريخ غير صالحة.', suggestion: 'صحّح التاريخ في المصدر (يفضّل صيغة YYYY-MM-DD).' },
  INVALID_DATA_TYPE: { category: 'ROW_LEVEL', severity: 'ERROR', explanation: 'نوع البيانات في الخلية غير متوقع.', suggestion: 'صحّح القيمة في المصدر.' },

  // ── Business warnings ──
  MISSING_EMPLOYEE: { category: 'BUSINESS_WARNING', severity: 'WARNING', explanation: 'لا يوجد موظف مسجَّل للشحنة (استثناء عهدة يحتاج مراجعة). هذا ليس دليلًا على تقصير أي شخص.', suggestion: 'راجع سجلات العهدة وأكمل اسم الموظف في المصدر.' },
  UNKNOWN_EMPLOYEE: { category: 'BUSINESS_WARNING', severity: 'WARNING', explanation: 'اسم الموظف غير موجود في سجل الموظفين المعتمد.', suggestion: 'أضف الموظف إلى السجل أو صحّح الاسم.' },
  EMPLOYEE_BRANCH_MISMATCH: { category: 'BUSINESS_WARNING', severity: 'WARNING', explanation: 'فرع الشحنة يختلف عن الفرع المسجَّل للموظف في سجل الموظفين المعتمد.', suggestion: 'تحقق من الفرع الحالي للموظف أو للشحنة.' },
  EMPLOYEE_NAME_VARIANTS: { category: 'BUSINESS_WARNING', severity: 'INFO', explanation: 'الاسم نفسه ورد بأكثر من كتابة (اختلاف همزات/مسافات) ودُمج في مفتاح واحد للمقارنة.', suggestion: 'يُفضّل توحيد كتابة الاسم في المصدر.' },
  EMPLOYEE_POSSIBLE_DUPLICATE: { category: 'BUSINESS_WARNING', severity: 'WARNING', explanation: 'اسمان متقاربان جدًا وقد يخصّان الشخص نفسه.', suggestion: 'راجع الاسمين ووحّدهما إن كانا لشخص واحد.' },
  UNKNOWN_STATUS: { category: 'BUSINESS_WARNING', severity: 'WARNING', explanation: 'الحالة غير موجودة في قاموس الحالات.', suggestion: 'أضف الحالة إلى القاموس أو صحّحها.' },
  UNKNOWN_BRANCH: { category: 'BUSINESS_WARNING', severity: 'WARNING', explanation: 'اسم الفرع غير موجود في سجل الفروع أو أسمائه البديلة.', suggestion: 'أضف الفرع/الاسم البديل إلى السجل أو صحّح الاسم.' },
  BRANCH_REGISTRY_EMPTY: { category: 'BUSINESS_WARNING', severity: 'INFO', explanation: 'سجل الفروع فارغ؛ لم يُتحقق من أسماء الفروع.', suggestion: 'سجّل الفروع المعتمدة لتفعيل التحقق.' },
  EMPLOYEE_REGISTRY_EMPTY: { category: 'BUSINESS_WARNING', severity: 'INFO', explanation: 'لا يوجد سجل موظفين معتمد؛ لم يُتحقق من الموظفين المجهولين ولا من اتساق الموظف مع الفرع.', suggestion: 'اعتمد قائمة الموظفين لتفعيل التحقق.' },
  FUTURE_DATE: { category: 'BUSINESS_WARNING', severity: 'ERROR', explanation: 'التاريخ لاحق لتاريخ الجرد.', suggestion: 'راجع التاريخ في المصدر أو تاريخ الجرد المُدخل.' },
  CONFLICTING_DATES: { category: 'BUSINESS_WARNING', severity: 'WARNING', explanation: 'تواريخ الشحنة متعارضة (تاريخ لاحق يسبق تاريخ الإنشاء).', suggestion: 'راجع التواريخ في المصدر.' },
  DUPLICATE_TRACKING: { category: 'BUSINESS_WARNING', severity: 'WARNING', explanation: 'رقم الشحنة مكرر داخل الجرد. حُفظت كل الصفوف، وتُعتمد أول ورود في المقارنات.', suggestion: 'راجع الصفوف المكررة وحدّد السجل الصحيح.' },
  DUPLICATE_CONFLICTING_VALUES: { category: 'BUSINESS_WARNING', severity: 'WARNING', explanation: 'صفوف مكررة لنفس الشحنة بقيم مختلفة (حالة/فرع/موظف).', suggestion: 'راجع الصفوف المكررة وحدّد القيمة الصحيحة.' },
} as const satisfies Record<string, IssueDef>;

export type IssueCode = keyof typeof ISSUE_CATALOG;

export interface IssueContext {
  worksheet?: string | null;
  rowNumber?: number | null;
  field?: string | null;
  originalValue?: unknown;
  /** Appended to the catalogue explanation to give the specific facts. */
  detail?: string;
  severity?: IssueSeverity;
}

export type EngineIssue = DataQualityIssue & { code: IssueCode };

export function stringifyOriginal(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

export function makeIssue(code: IssueCode, ctx: IssueContext = {}): EngineIssue {
  const def: IssueDef = ISSUE_CATALOG[code];
  return {
    code,
    category: def.category,
    severity: ctx.severity ?? def.severity,
    worksheet: ctx.worksheet ?? null,
    rowNumber: ctx.rowNumber ?? null,
    field: ctx.field ?? null,
    originalValue: stringifyOriginal(ctx.originalValue),
    explanation: ctx.detail ? `${def.explanation} ${ctx.detail}` : def.explanation,
    suggestion: def.suggestion,
  };
}
