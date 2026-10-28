/**
 * ARRIVE Operations Audit — Apps Script API (قراءة مباشرة للداشبورد)
 * يقرأ تابات: المطابقه صباحا، مطابقه التحويلات، مسح الحالات، رصد المشاكل اليومي، لائحة الجزاءات
 * ويرجع الصفوف الخام (بدون أي تنظيف). التنظيف (توحيد الفروع، فحص التواريخ...) يتم داخل index.html.
 *
 * التركيب: افتح شيت «Operations Audit» > Extensions > Apps Script، والصق الملف،
 * ثم Deploy > New deployment > Web app (Execute as: Me، Who has access: Anyone with the link)
 * وانسخ الرابط الذي ينتهي بـ /exec.
 * ملاحظة: بعد أي تعديل على هذا الملف لازم Deploy > Manage deployments > Edit > New version.
 *
 * الأعمدة تُقرأ بأسماء العناوين (لا بمواقعها)، فإضافة أعمدة أو إعادة ترتيبها لا تكسر القراءة.
 */
var TABS = {
  // المطابقة الصباحية. «التأخير بالدقائق» له عمودان؛ المطلوب الثاني (عمود I = تبليغ الفرع المستلم)، و dl تُقرأ كما تظهر في الشيت.
  t1: { sheet: 'المطابقه صباحا', disp: ['dl'], bool: ['rv'], cols: {
    d: ['التاريخ'], mo: ['الشهر'], br: ['الفرع المستلم'], m: ['تبليغ الفرع الرئيسي (العدد)'],
    r: ['تبيلغ فرع المستلم ( العدد)', 'تبليغ فرع المستلم (العدد)'], st: ['حاله التبيلغ', 'حاله التبليغ'],
    dl: { n: ['التأخير بالدقائق'], nth: 2 }, wb: ['رقم البوليصه'], err: ['سبب الخطا'],
    inv: ['التحقيق فى الشكوى'], res: ['نتيجة التحقيق'], who: ['المتسبب فى الخظأ', 'المتسبب فى الخطأ'],
    at: ['الفرع المخطي'], pr: ['حالة المشكلة'], rv: ['مسؤل المراجعه'] } },
  t2: { sheet: 'مطابقه التحويلات', cols: {
    d: ['التاريخ'], br: ['فرع التحويل'], ok: ['صحه التحويل'], why: ['سبب التحويل'],
    desc: ['وصف التحويل'], at: ['الفرع المخطي'], wb: ['الكود'] } },
  t3: { sheet: 'مسح الحالات', cols: {
    d: ['التاريخ'], wb: ['البوليصه'], br: ['الفرع'], why: ['سبب المسح'], fn: ['وظيفه المخطا'] } },
  t4: { sheet: 'رصد المشاكل اليومي', cols: {
    d: ['تاريخ الاضافه'], br: ['الفرع'], wb: ['رقم البوليصه'], ty: ['نوع الخطا'],
    fin: ['الحاله النهائيه'], fn: ['وظيفه المخطأ', 'وظيفه المخطا'] } },
  t5: { sheet: 'لائحة الجزاءات', cols: {
    d: ['التاريخ'], br: ['الفرع'], ty: ['توع الخطأ', 'نوع الخطأ'], ac: ['الاجراء'], n: ['عدد الاجراءات'] } }
};

function doGet() {
  try { return build_(); } catch (err) { return out_({ ok: false, error: String(err && err.message || err) }); }
}

function key_(s) { // مقارنة العناوين: بدون مسافات زائدة أو اختلاف همزة/ياء/تاء مربوطة
  return String(s == null ? '' : s).replace(/\s+/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
}

function build_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return out_({ ok: false, error: 'السكريبت غير مرتبط بالشيت: افتحه من Extensions > Apps Script داخل الشيت' });
  var tz = ss.getSpreadsheetTimeZone();
  var byName = {};
  ss.getSheets().forEach(function (s) { byName[key_(s.getName())] = s; });
  var tabs = {}, problems = [];
  Object.keys(TABS).forEach(function (t) {
    var cfg = TABS[t], sh = byName[key_(cfg.sheet)];
    if (!sh) { problems.push('تاب غير موجود: ' + cfg.sheet); return; }
    var rng = sh.getDataRange(), vals = rng.getValues();
    var dvals = cfg.disp ? rng.getDisplayValues() : null;
    var head = (vals[0] || []).map(key_);
    var idx = {}, missing = [];
    Object.keys(cfg.cols).forEach(function (f) {
      idx[f] = -1;
      var spec = cfg.cols[f], names = spec.n || spec, nth = spec.nth || 1;
      names.some(function (name) {
        var k = key_(name), seen = 0;
        for (var i = 0; i < head.length; i++) { if (head[i] === k && ++seen === nth) { idx[f] = i; return true; } }
        return false;
      });
      if (idx[f] < 0) missing.push(names[0] + (nth > 1 ? ' (الثاني)' : ''));
    });
    if (missing.length) { problems.push(cfg.sheet + ': أعمدة غير موجودة: ' + missing.join('، ')); return; }
    var rows = [];
    for (var r = 1; r < vals.length; r++) {
      var o = { _r: r + 1 }, any = false;
      Object.keys(idx).forEach(function (f) {
        var v = vals[r][idx[f]];
        if (cfg.disp && cfg.disp.indexOf(f) >= 0) v = dvals[r][idx[f]];
        else if (cfg.bool && cfg.bool.indexOf(f) >= 0 && typeof v === 'boolean') v = v ? 'TRUE' : 'FALSE';
        if (v instanceof Date) v = Utilities.formatDate(v, tz, 'yyyy-MM-dd');
        else if (typeof v === 'boolean') v = '';
        v = (v == null ? '' : String(v)).trim();
        o[f] = v;
        if (v) any = true;
      });
      if (any) rows.push(o);
    }
    tabs[t] = { sheet: cfg.sheet, rows: rows };
  });
  return out_({ ok: problems.length === 0, problems: problems, updatedAt: new Date().toISOString(), tabs: tabs });
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
