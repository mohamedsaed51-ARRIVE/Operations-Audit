# واجهة REST — المرحلة 2

الأساس: `/api`. الأخطاء بصيغة موحدة: `{ "error": { "code", "message", "details?", "requestId" } }`.
كل رد يحمل `x-request-id` (يُقبل من العميل إن كان `[A-Za-z0-9._-]{8,64}`). الترقيم: `?page=1&pageSize=50` (الحد الأقصى 200)، والرد `{ data, pagination:{page,pageSize,total,totalPages} }`.

| الطريقة | المسار | الوصف |
| --- | --- | --- |
| GET | `/api/health` | حالة الخادم وقاعدة البيانات (503 عند انقطاعها) |
| POST | `/api/uploads` | `multipart/form-data`: `file` + `snapshotDate` (YYYY-MM-DD). 201 مع اكتشاف الأعمدة، أو 422 `FILE_REJECTED` (يُسجَّل الرفض) |
| GET | `/api/uploads` | قائمة الرفع |
| GET | `/api/uploads/:id` | تفاصيل الرفع: الأوراق، الاكتشاف، آخر ربط، ملخص المشكلات، اللقطة الناتجة |
| GET | `/api/uploads/:id/preview?sheet=0&limit=20` | معاينة السجلات (الأعمدة الحساسة محجوبة) |
| GET | `/api/uploads/:id/issues` | مشكلات الجودة. فلاتر: `category,severity,code,stage,worksheet` |
| POST | `/api/uploads/:id/mapping[?dryRun=true]` | `{ sheets:[{ sheetIndex, include, headerRowIndex?, fields:{tracking,status,branch,employee,createdDate,statusEntryDate,lastUpdateDate,governorate}, acknowledged:[field…], dateOrder? }] }` |
| POST | `/api/uploads/:id/process` | `{ replaceExisting?, registerUnknownBranches?, registerUnknownEmployees? }` — معاملة واحدة |
| GET | `/api/snapshots` | سجل اللقطات (النسخة المعتمدة `isActive`) |
| GET | `/api/snapshots/:id` | لقطة + رأس المقارنة |
| GET | `/api/snapshots/:id/summary` | مؤشرات: فريدة، >15، >25، بدون عمر، بدون موظف، توزيع الأعمار والحالات والفروع وأساس عمر الحالة |
| GET | `/api/snapshots/:id/shipments` | الشحنات المطبّعة. فلاتر: `branch,ageCategory,employeeMissing,duplicatesOnly,q` |
| GET | `/api/snapshots/:id/comparison?changeType=` | المقارنة بالجرد السابق مع العناصر (قبل/بعد) |
| GET | `/api/branches` · POST `/api/branches` | سجل الفروع + الأسماء البديلة (`q` للبحث) |
| GET | `/api/employees` | سجل الموظفين |

أكواد أخطاء أعمال شائعة: `FILE_REJECTED` 422، `MAPPING_INVALID` 422، `INVALID_UPLOAD_STATE` 409، `ALREADY_PROCESSED` 409، `SNAPSHOT_DATE_EXISTS` 409، `SNAPSHOT_OUT_OF_ORDER` 409، `PROCESSING_FAILED` 500 (لا لقطة جزئية).
