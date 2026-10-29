// اختبارات أمان Operations-Audit — بيانات اصطناعية فقط. يشغّل apps-script/Code.gs الحقيقي في vm بشيت ضار.
// التشغيل: node tests/security.test.js     INDEX=<مسار> لاختبار نسخة أخرى.   (playwright + chromium)
const { chromium } = require('playwright');
const fs = require('fs'), vm = require('vm'), path = require('path');
const INDEX = process.env.INDEX || path.join(__dirname, '..', 'index.html');
const X = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
let pass = 0, fail = 0;
const check = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL') + ' - ' + n + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra))); };

const sb = { console, Date, Math, JSON, Object, Number, String, Array, RegExp, Error, isNaN,
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) }, SpreadsheetApp: null };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), sb);
const TABS = vm.runInContext('TABS', sb);
const sheets = [];
for (const [t, cfg] of Object.entries(TABS)) {
  const fields = Object.keys(cfg.cols);
  const head = [], seen = {};
  fields.forEach((f) => { const spec = cfg.cols[f]; const names = spec.n || spec; head.push(names[0]); });
  const data = [head];
  for (let i = 0; i < 14; i++) data.push(fields.map((f) => {
    if (f === 'd') return new Date(2026, 9, 1 + (i % 20));
    if (['br', 'brr', 'at', 'atr', 'who', 'ty', 'fin', 'fn', 'why', 'desc', 'err', 'ac', 'wb', 'st', 'pr', 'inv', 'res'].includes(f)) return i < 8 ? X + f + (i % 3) : 'قيمة ' + f + (i % 3);
    if (['m', 'r', 'n', 'dl'].includes(f)) return 5 + i;
    return 'x';
  }));
  sheets.push({ name: cfg.sheet, data });
}
const ss = { getSpreadsheetTimeZone: () => 'Africa/Cairo', getSheets: () => sheets.map((s) => ({ getName: () => s.name, getDataRange: () => ({ getValues: () => s.data, getDisplayValues: () => s.data }) })) };
sb.SpreadsheetApp = { getActiveSpreadsheet: () => ss };
const apiBody = sb.doGet().s;
const EVIL = 'https://evil.example.com/steal/exec';

(async () => {
  const j = JSON.parse(apiBody);
  check('Code.gs الحقيقي (vm) أعاد بيانات التبويبات', j && j.tabs && Object.keys(j.tabs).length >= 4, j.problems);
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const run = async (query, initStorage) => {
    const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const hosts = []; const errs = []; pg.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    await pg.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.protocol !== 'file:') hosts.push(u.hostname);
      if (u.hostname === 'script.google.com') return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: apiBody });
      return u.protocol === 'file:' ? r.continue() : r.abort(); });
    if (initStorage) await pg.addInitScript((v) => { try { localStorage.setItem('arrive_ops_api', v); } catch (e) {} }, initStorage);
    await pg.goto('file://' + INDEX + (query || ''), { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(5000);
    return { pg, hosts, errs };
  };
  // 1) XSS عبر المسار الكامل
  let { pg, hosts, errs } = await run('');
  const tabIds = await pg.evaluate(() => [...document.querySelectorAll('.tab')].map((t) => t.dataset.t));
  for (const t of tabIds) { // تنقّل حقيقي بين التبويبات (يُعاد الاستعلام كل مرة لأن اللوحة تعيد بناء العناصر)
    await pg.evaluate((id) => { const el = [...document.querySelectorAll('.tab')].find((x) => x.dataset.t === id); el && el.click(); }, t);
    await pg.waitForTimeout(500);
    await pg.evaluate(() => { document.querySelectorAll('#dd input[type=checkbox]').forEach((c) => { try { c.click(); } catch (e) {} }); });
    await pg.waitForTimeout(300);
  }
  check('الواجهة جلبت من رابط Apps Script الافتراضي', hosts.includes('script.google.com'), hosts);
  check('الوظيفة: النص الضار ظاهر كنص (لم يُحذف)', await pg.evaluate("/img src=x onerror/.test(document.body.innerText)"));
  const n = await pg.evaluate('window.__xss||0');
  check('XSS: لا تنفيذ لأي حمولة (5 تبويبات، فلاتر، جداول)', n === 0, n);
  check('XSS: لا img[onerror] في DOM', (await pg.evaluate("document.querySelectorAll('img[onerror]').length")) === 0);
  check('لا أخطاء JavaScript', errs.length === 0, errs.slice(0, 2));
  await pg.close();
  // 2) ?api= الخبيث يُتجاهل
  ({ pg, hosts } = await run('?api=' + encodeURIComponent(EVIL)));
  check('?api= خبيث: لا طلبات إلى النطاق الغريب', !hosts.includes('evil.example.com'), hosts);
  check('?api= خبيث: لم يُحفظ في localStorage', (await pg.evaluate("localStorage.getItem('arrive_ops_api')")) !== EVIL);
  await pg.close();
  // 3) قيمة خبيثة موجودة مسبقًا في التخزين المحلي تُتجاهل
  ({ pg, hosts } = await run('', EVIL));
  check('تخزين محلي مسموم: لا طلبات إلى النطاق الغريب', !hosts.includes('evil.example.com'), hosts);
  await pg.close();
  // 4) رابط Apps Script رسمي بديل ما زال مقبولًا
  const good = 'https://script.google.com/macros/s/AKfycbTEST_only/exec';
  ({ pg, hosts } = await run('?api=' + encodeURIComponent(good)));
  check('?api= رسمي (script.google.com/.../exec) ما زال مقبولًا ومحفوظًا', (await pg.evaluate("localStorage.getItem('arrive_ops_api')")) === good);
  await pg.close();
  await b.close();
  console.log(`\n${pass}/${pass + fail} اختبارًا ناجحًا`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(2); });
