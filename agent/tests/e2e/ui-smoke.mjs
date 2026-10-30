/**
 * End-to-end browser smoke test of the Phase 2 interface against a RUNNING stack:
 *   API on :3001 (empty database) and the built web app served on :4173 (vite preview, proxying /api).
 * Uses the Chromium/Playwright preinstalled in the environment (not a project dependency).
 *
 *   SHOTS_DIR=/some/dir node tests/e2e/ui-smoke.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const API = process.env.API_URL ?? 'http://127.0.0.1:3001';
const SHOTS = process.env.SHOTS_DIR ?? '/tmp/arrive-shots';
const FILES = fileURLToPath(new URL('../fixtures/files/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

let page;
const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { await page.screenshot({ path: `${SHOTS}/FAIL-${results.length}.png`, fullPage: true }).catch(() => {}); console.log('  url:', page.url(), '\n  text:', (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500)); results.push(['FAIL', name]); console.log('FAIL', name, '\n  ', e.message.split('\n')[0]); process.exitCode = 1; }
};

// registry: the three branches (and English aliases) used by the fixtures
for (const b of [
  { name: 'القاهرة', governorate: 'القاهرة', aliases: ['Cairo'] },
  { name: 'الجيزة', governorate: 'الجيزة', aliases: ['Giza'] },
  { name: 'الإسكندرية', governorate: 'الإسكندرية', aliases: ['Alexandria'] },
]) await fetch(`${API}/api/branches`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

const browser = await chromium.launch();
page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-EG' })).newPage();
page.setDefaultTimeout(15000);
// Google Fonts is unreachable in sandboxes and must not block the run; the Cairo stack falls back gracefully.
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_(NAME_NOT_RESOLVED|INTERNET|CONNECTION|TUNNEL|PROXY)|Failed to load resource/i.test(m.text())) consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

async function uploadThroughUi(file, date) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.setInputFiles('[data-testid=file-input]', file.startsWith('/') ? file : FILES + file);
  await page.fill('[data-testid=snapshot-date] >> nth=0', date);
  await page.click('[data-testid=upload-btn]');
}

await step('Upload Center renders RTL with Arabic UI and Cairo font', async () => {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=مركز الرفع');
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
  assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFamily), /Cairo/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('h1')).direction), 'rtl');
  await shot('01-upload-center');
});

await step('Day-1 file uploads, preview shows records and masks the phone column', async () => {
  await uploadThroughUi('inventory_day1_2026-10-20_ar.xlsx', '2026-10-20');
  await page.waitForURL(/\/preview$/);
  await page.waitForSelector('text=EG1001');
  assert.ok(await page.locator('text=محجوب').count() >= 1);
  assert.equal(await page.locator('text=01000000001').count(), 0);
  await shot('02-file-preview');
});

await step('Column mapping pre-selects only confident suggestions; notes sheet starts excluded or skippable', async () => {
  await page.click('[data-testid=go-mapping]');
  await page.waitForSelector('[data-testid=sheet-0]');
  const text = await page.locator('[data-testid=sheet-0]').innerText();
  assert.match(text, /A — بوليصة/);
  assert.match(text, /واثق/);
  await shot('03-column-mapping');
});

await step('Dry run shows normalised records without saving; save + process creates the snapshot', async () => {
  await page.click('[data-testid=dry-run]');
  await page.waitForSelector('[data-testid=normalized-preview]');
  assert.match(await page.locator('[data-testid=normalized-preview]').innerText(), /EG1001/);
  await page.click('[data-testid=save-mapping]');
  await page.waitForSelector('[data-testid=process]');
  await page.click('[data-testid=process]');
  await page.waitForSelector('[data-testid=process-done]');
  assert.match(await page.locator('[data-testid=process-done]').innerText(), /18 صفًا مُدرجًا/);
  await shot('04-processed');
});

await step('Data-quality page lists issues with row numbers and original values', async () => {
  await page.getByRole('button', { name: 'نتائج جودة البيانات' }).click();
  await page.waitForSelector('[data-testid=cat-ROW_LEVEL]');
  await page.click('[data-testid=cat-ROW_LEVEL]');
  await page.waitForSelector('text=2026-02-30');
  const body = await page.locator('table').innerText();
  assert.match(body, /INVALID_DATE/);
  assert.match(body, /MISSING_TRACKING/);
  await shot('05-data-quality');
});

await step('Ambiguous columns are not auto-selected and saving without a choice is refused', async () => {
  await uploadThroughUi('ambiguous_columns.xlsx', '2026-10-21');
  await page.waitForURL(/\/preview$/);
  await page.click('[data-testid=go-mapping]');
  await page.waitForSelector('[data-testid=sheet-0]');
  const text = await page.locator('[data-testid=sheet-0]').innerText();
  assert.match(text, /ملتبس/);
  await page.click('[data-testid=save-mapping]');
  await page.waitForSelector('text=يلزم');
  await shot('06-ambiguous-mapping');
});

await step('Day-2 file produces the daily comparison with change counts', async () => {
  await uploadThroughUi('inventory_day2_2026-10-21_ar.xlsx', '2026-10-21');
  await page.waitForURL(/\/preview$/);
  await page.click('[data-testid=go-mapping]');
  await page.waitForSelector('[data-testid=sheet-0]');
  await page.click('[data-testid=save-mapping]');
  await page.waitForSelector('[data-testid=process]');
  await page.click('[data-testid=process]');
  await page.waitForSelector('[data-testid=process-done]');
  await page.getByRole('button', { name: 'مقارنة الجرد' }).click();
  await page.waitForSelector('[data-testid=chip-STATUS_CHANGED]');
  assert.match(await page.locator('[data-testid=chip-NEW]').innerText(), /2/);
  assert.match(await page.locator('[data-testid=chip-DISAPPEARED]').innerText(), /2/);
  assert.match(await page.locator('[data-testid=chip-CONTINUED]').innerText(), /15/);
  await page.click('[data-testid=chip-STATUS_CHANGED]');
  await page.waitForSelector('text=EG1007');
  await shot('07-comparison');
});

await step('Snapshot history lists both snapshots', async () => {
  await page.getByRole('tab', { name: 'سجل الجرد' }).click();
  await page.waitForSelector('text=2026-10-21');
  assert.ok(await page.locator('text=2026-10-20').count() >= 1);
  await shot('08-snapshot-history');
});

await step('A fake .xlsx is rejected with an explanation and nothing is created', async () => {
  const fake = `${SHOTS}/fake.xlsx`;
  writeFileSync(fake, 'plain text pretending to be a workbook');
  await uploadThroughUi(fake, '2026-10-22');
  await page.waitForSelector('[data-testid=rejection]');
  assert.match(await page.locator('[data-testid=rejection]').innerText(), /FILE_CONTENT_MISMATCH/);
  await shot('09-rejected-file');
});

await step('No unexpected browser console errors', async () => { assert.deepEqual(consoleErrors, []); });

await browser.close();
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} UI steps passed; screenshots in ${SHOTS}`);
