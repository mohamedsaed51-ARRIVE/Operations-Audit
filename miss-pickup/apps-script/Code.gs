/**
 * ARRIVE Miss Pickup — Apps Script API
 * يقرأ الشيت «سجل الحالات» ويرجع JSON بنفس مفاتيح ملف miss_pickup_cases.json.
 * النشر: Deploy > New deployment > Web app (Execute as: Me, Access: Anyone with the link).
 * شغّله من داخل ملف ARRIVE_Miss_Pickup_Audit_Template (Extensions > Apps Script).
 */
var SHEET_NAME = 'سجل الحالات';
var CLEAN_PHRASE = 'برجاء الرجوع للحسابات قبل التعامل';
var MAP = {
  id: 'رقم الحالة', type: 'نوع الحالة', name: 'اسم العميل', f: 'حالة العميل / الطلب',
  g: 'حالة الاستعلام', h: 'حالة First Mile', i: 'الفرع المسؤول عن الرد',
  j: 'الفرع المخطئ بعد التحقق', k: 'حالة المتابعة', m: 'نتيجة مراجعة الأوديت',
  c: 'تاريخ إنشاء الحالة', d: 'تاريخ التقرير'
};

function doGet() {
  try { return build_(); } catch (err) { return out_({ ok: false, error: String(err && err.message || err) }); }
}
function build_() {
  var tz = Session.getScriptTimeZone();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return out_({ ok: false, error: 'Script is not bound to a spreadsheet (open it from Extensions > Apps Script inside the sheet)' });
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) return out_({ ok: false, error: 'Sheet not found: ' + SHEET_NAME });
  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(String);
  var idx = {};
  Object.keys(MAP).forEach(function (k) {
    idx[k] = head.indexOf(MAP[k]);
    if (idx[k] < 0) throw new Error('Missing column: ' + MAP[k]);
  });
  var rows = [];
  for (var r = 1; r < vals.length; r++) {
    var row = vals[r], o = {};
    if (!String(row[idx.id]).trim()) continue;
    Object.keys(idx).forEach(function (k) {
      var v = row[idx[k]];
      if (v instanceof Date) v = Utilities.formatDate(v, tz, 'dd/MM/yyyy');
      o[k] = (v == null ? '' : String(v)).trim();
    });
    o.name = o.name.replace(CLEAN_PHRASE, '').trim();
    rows.push(o);
  }
  return out_({ ok: true, updatedAt: new Date().toISOString(), rows: rows });
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
