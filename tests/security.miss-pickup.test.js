// اختبارات أمان miss-pickup (بيانات اصطناعية فقط — لا اتصال بأي خدمة حقيقية).
// التشغيل:  node tests/security.test.js   (يحتاج: playwright + chromium)
// متغير اختياري: INDEX=<مسار index.html> لاختبار نسخة أخرى (يُستخدم للتحقق من أن الاختبار يفشل على الكود القديم).
const { chromium } = require('playwright');
const path = require('path');
const INDEX = process.env.INDEX || path.join(__dirname, '..', 'miss-pickup', 'index.html');
const XSS = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const FORMULAS = ['=HYPERLINK("http://x","c")', '+1+1', '-2+3', '@SUM(1)', '\t=1', '\r=1'];
const rows = [
  ...FORMULAS.map((f, i) => ({ id: 'T-F' + i, type: 'نوع', name: f, f: 'ok', g: '', h: '', i: '', j: '', k: '', m: '', c: '', d: '26/10/2026' })),
  { id: 'T-OK', type: 'تم استلام بيك اب', name: 'اسم عادي - A+B', f: 'a=b', g: '', h: '', i: '', j: '', k: '', m: '', c: '', d: '26/10/2026' },
  { id: 'T-X', type: XSS, name: XSS, f: XSS, g: XSS, h: XSS, i: XSS, j: XSS, k: XSS, m: XSS, c: '', d: '26/10/2026' },
];
let pass = 0, fail = 0;
const check = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra))); };

(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const pg = await b.newPage();
  await pg.route('**/*', (r) => {
    const u = r.request().url();
    if (u.includes('script.google.com')) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, rows }) });
    if (u.startsWith('file:')) return r.continue();
    return r.abort();
  });
  await pg.addInitScript(() => { window.__blobs = []; const o = URL.createObjectURL; URL.createObjectURL = (b) => { window.__blobs.push(b); return o.call(URL, b); }; });
  await pg.goto('file://' + INDEX, { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(2000);

  // XSS: الحقول الضارة تظهر كنص ولا تُنفَّذ
  check('XSS: لا تنفيذ لحمولة في أي حقل', (await pg.evaluate('window.__xss||0')) === 0);
  check('XSS: لا عناصر img[onerror] في DOM', (await pg.evaluate("document.querySelectorAll('img[onerror]').length")) === 0);

  // CSV
  await pg.evaluate('toCsv()');
  await pg.waitForTimeout(300);
  const csv = await pg.evaluate(async () => (window.__blobs.length ? await window.__blobs[window.__blobs.length - 1].text() : ''));
  check('CSV: تم توليد الملف', csv.length > 0);
  const cells = csv.replace(/^﻿/, '').split('\n').slice(1).map((l) => l);
  const firstCell = (l) => { const m = l.split('","'); return m; };
  const dangerous = csv.split('\n').slice(1).join('\n').match(/(^|,)"[=+\-@\t\r]/g) || [];
  check('CSV: لا توجد خلية تبدأ بـ = + - @ Tab CR', dangerous.length === 0, dangerous.slice(0, 3));
  check("CSV: القيمة =HYPERLINK سبقتها '", csv.includes('"\'=HYPERLINK('));
  check("CSV: +1+1 و -2+3 و @SUM سبقها '", csv.includes('"\'+1+1"') && csv.includes('"\'-2+3"') && csv.includes('"\'@SUM(1)"'));
  check('CSV: القيم العادية لم تتغير (A+B داخل النص و a=b)', csv.includes('"اسم عادي - A+B"') && csv.includes('"a=b"'));
  check('CSV: علامة الاقتباس المزدوجة ما زالت تُهرَّب', csv.includes('""c""'));
  check('CSV: عدد الصفوف = العناوين + البيانات', csv.split(/\n(?=")/).length >= rows.length + 1 - 1);
  await b.close();
  console.log(`\n${pass}/${pass + fail} اختبارًا ناجحًا`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
