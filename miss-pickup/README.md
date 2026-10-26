# ARRIVE — لوحة رقابة Miss Pickup

لوحة ثابتة (HTML واحد) بنفس هوية لوحة الشكاوى. لا تحتاج build.

## الملفات
- `index.html` — اللوحة (التصميم + الحسابات).
- `miss_pickup_cases.json` — نسخة بيانات محلية (احتياطية) من سجل الحالات.
- `apps-script/Code.gs` — API يقرأ الشيت مباشرة.
- `assets/` — الشعار والأيقونة.

## الميزات (نفس فكرة لوحة الشكاوى)
- بطاقات مؤشرات تفاعلية: الضغط على بطاقة يفلتر سجل الحالات، وكذلك الضغط على صف في أي جدول توزيع.
- مسار المتابعة (شريط توزيع) ونسبة الاستجابة.
- جودة البيانات: فحوصات آلية (تكرار، فراغات، فرع غير محدد، تاريخ إنشاء، مراجعة أوديت).
- زر «تقرير A4»: غلاف، ملخص تنفيذي، توزيعات، فروع وجودة بيانات، ملاحظات وتوصيات، توقيع. الطباعة / حفظ PDF من نفس الشاشة.
- المسؤول والموعد في التوصيات «غير محدد بالمصدر» لأنهما غير موجودين في الشيت.

## مصدر البيانات
1. اللوحة تحاول أولًا رابط Apps Script (من الإعدادات ⚙ أو `DEFAULT_API_URL` داخل `index.html`).
2. إن لم يوجد أو فشل، تقرأ `miss_pickup_cases.json`.

### تفعيل الربط بالشيت
1. افتح ARRIVE_Miss_Pickup_Audit_Template > Extensions > Apps Script، والصق `Code.gs`.
2. Deploy > New deployment > Web app (Execute as: Me، Access: Anyone with the link).
3. انسخ الرابط (ينتهي بـ `/exec`) وضعه في ⚙ إعدادات اللوحة.

## النشر
```
git init && git add . && git commit -m "Miss Pickup dashboard"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```
ثم Vercel > Add New Project > Import الريبو (Framework: Other، بدون build command).

## ملاحظات بيانات
- «الفرع المخطئ» معروض كما في الشيت وغير مؤكد قبل مراجعة الأوديت.
- تاريخ إنشاء الحالة غير متوفر في المصدر حاليًا، لذلك عمر الحالة غير محسوب.
