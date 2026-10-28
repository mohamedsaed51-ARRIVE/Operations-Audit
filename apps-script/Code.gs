/**
 * ARRIVE Operations Audit — Apps Script API (قراءة مباشرة للداشبورد)
 * يقرأ تابات: مطابقه التحويلات، مسح الحالات، رصد المشاكل اليومي، لائحة الجزاءات
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
    var vals = sh.getDataRange().getValues();
    var head = (vals[0] || []).map(key_);
    var idx = {}, missing = [];
    Object.keys(cfg.cols).forEach(function (f) {
      idx[f] = -1;
      cfg.cols[f].some(function (name) { var i = head.indexOf(key_(name)); if (i >= 0) { idx[f] = i; return true; } return false; });
      if (idx[f] < 0) missing.push(cfg.cols[f][0]);
    });
    if (missing.length) { problems.push(cfg.sheet + ': أعمدة غير موجودة: ' + missing.join('، ')); return; }
    var rows = [];
    for (var r = 1; r < vals.length; r++) {
      var o = { _r: r + 1 }, any = false;
      Object.keys(idx).forEach(function (f) {
        var v = vals[r][idx[f]];
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
