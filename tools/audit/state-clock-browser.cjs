// Real browser clock-recovery UI, synthetic jobs only; all external requests blocked.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let pw;
try { pw = require('../runner/node_modules/playwright-core'); } catch (e) { pw = require('playwright-core'); }
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const lecture = '8-0-1';
const farFuture = Date.parse('2500-01-01T00:00:00Z');
const tests = [];
const test = (name, run) => tests.push([name, run]);
const baseMark = () => ({ studied: '2026-10-20', anki: '2026-10-20' });
function stateWithRequest(hb) {
  return { aiv: 1, marks: { [lecture]: { ...baseMark(), akq: JSON.stringify({ at: Date.now() - 60000, st: 'run', hb, t: 'Synthetic generation in progress' }) } } };
}
async function openAnki(page, state) {
  await page.evaluate(s => { localStorage.clear(); localStorage.setItem('uqu-state-v2', JSON.stringify(s)); }, state);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(id => sheetAnki(id), lecture);
}
test('opening a future-clock ANKI request shows setup and preserves the original request', async page => {
  const state = stateWithRequest(farFuture);
  await openAnki(page, state);
  await page.locator('#akGo').waitFor({ timeout: 2500 });
  assert.equal(await page.locator('#akStop').count(), 0);
  const current = await page.evaluate(id => JSON.parse(mk(id).akq), lecture);
  assert.equal(current.at, JSON.parse(state.marks[lecture].akq).at);
  assert.equal(current.hb, farFuture);
  assert.equal(current.st, 'run');
});
test('two-minute skew keeps ANKI following; a later future-clock update exits with a visible explanation', async page => {
  const state = stateWithRequest(Date.now() + 2 * 60000);
  await openAnki(page, state);
  await page.locator('#akStop').waitFor({ timeout: 2500 });
  assert.equal(await page.evaluate(() => !!AKQW), true);
  await page.evaluate(({ id, future }) => {
    const request = JSON.parse(mk(id).akq);
    quietPatch(id, { akq: JSON.stringify({ ...request, hb: future }) });
    akFollow();
  }, { id: lecture, future: farFuture });
  await page.locator('#akGo').waitFor({ timeout: 2500 });
  assert.equal(await page.locator('#akStop').count(), 0);
  assert.match(await page.locator('#akBox').innerText(), /وقت المهمة غير متوافق مع ساعة الجهاز/);
  assert.equal(await page.evaluate(() => AKQW), null);
  const current = await page.evaluate(id => JSON.parse(mk(id).akq), lecture);
  assert.equal(current.hb, farFuture);
  assert.equal(current.st, 'run');
});
test('split progress visibly explains the stale remote worker despite its future heartbeat', async page => {
  const state = { aiv: 1, marks: { [lecture]: { ...baseMark(), spj: JSON.stringify({ at: Date.now() - 60000, hb: farFuture, st: 'kimi', d: 'otherdevice', dn: 'Synthetic device', gid: 'synthetic_drive_id', pc: 42, np: 3, nd: 1 }) } } };
  await page.evaluate(s => { localStorage.clear(); localStorage.setItem('uqu-state-v2', JSON.stringify(s)); }, state);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate(id => sheetClipSetup(id), lecture);
  await page.locator('#csAlt').waitFor({ state: 'visible', timeout: 2500 });
  assert.match(await page.locator('#csAlt').innerText(), /ما رسل تحديث/);
  assert.equal(await page.evaluate(id => spState(id).stale, lecture), true);
  assert.equal(await page.evaluate(id => JSON.parse(mk(id).spj).hb, lecture), farFuture);
});
test('impossible or far-future runner pulses cannot disable local background work', async page => {
  for (const at of [1e308, farFuture]) {
    const result = await page.evaluate(at => { S.rnr = JSON.stringify({ at, ok: 1 }); return { info: rnInfo(), on: rnOn(), fresh: rnFresh() }; }, at);
    assert.deepEqual(result, { info: null, on: false, fresh: false });
  }
});
(async () => {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let failed = 0;
  try {
    for (const [name, run] of tests) {
      const context = await browser.newContext();
      await context.route('**/*', r => r.request().url() === 'http://state-clock.test/' ? r.fulfill({ contentType: 'text/html', body: html }) : r.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
      try {
        await page.goto('http://state-clock.test/');
        await run(page);
        assert.deepEqual(errors, []);
        console.log('PASS ' + name);
      } catch (e) { failed++; console.error('FAIL ' + name + ': ' + (errors[0] || e.message)); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  console.log(`${tests.length - failed}/${tests.length} browser job clock checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
