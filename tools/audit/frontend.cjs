#!/usr/bin/env node
// Browser-only production regressions. All requests are fulfilled locally: no live accounts or paid APIs.
// node tools/audit/frontend.cjs
// PLAYWRIGHT_BROWSERS_PATH=/tmp/audit-pw-browsers AUDIT_BROWSER=firefox node tools/audit/frontend.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let playwright;
try { playwright = require('playwright-core'); } catch { playwright = require('../runner/node_modules/playwright-core'); }
const ROOT = path.resolve(__dirname, '../..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const ENGINE = process.env.AUDIT_BROWSER || 'chromium';
const WIDTHS = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const result = { engine: ENGINE, checks: [], limitations: ['Integrations are isolated/local mocks; no real user records are read or changed.'] };
let browser;
async function check(name, fn) {
  try { await fn(); result.checks.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (e) { result.checks.push({ name, ok: false, error: String(e.message).slice(0, 1000) }); console.error('FAIL ' + name + ': ' + String(e.message).slice(0, 500)); }
}
async function isolated(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', ...options });
  await ctx.route('**/*', async route => {
    const request = route.request();
    if (request.resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '' });
    if (request.resourceType() === 'document' && new URL(request.url()).hostname === 'audit.test') {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: HTML });
    }
    const filename = path.basename(new URL(request.url()).pathname);
    if (/^(?:favicon|icon-192|icon-512|apple-touch-icon)\.png$/.test(filename)) {
      return route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(ROOT, filename)) });
    }
    return route.fulfill({ status: 200, body: '', contentType: 'text/plain' });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const faults = [];
  page.on('pageerror', e => faults.push('exception: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') faults.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    window.__auditRejections = [];
    addEventListener('unhandledrejection', e => window.__auditRejections.push(String(e.reason?.message || e.reason)));
  });
  await page.goto('http://audit.test/');
  await page.waitForFunction(() => typeof st === 'object' && typeof setPage === 'function');
  return { ctx, page, faults };
}
async function settleModal(page) { await page.waitForTimeout(360); }
(async () => {
  assert(playwright[ENGINE], 'Unknown AUDIT_BROWSER: ' + ENGINE);
  browser = await playwright[ENGINE].launch({ headless: true, ...(process.env.AUDIT_BROWSER_PATH ? { executablePath: process.env.AUDIT_BROWSER_PATH } : {}), ...(ENGINE === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
  result.version = browser.version();
  const app = await isolated();
  const p = app.page;
  const pages = await p.evaluate(() => PAGES.map(([key]) => key));
  await check('all pages at nine widths, portrait/landscape, without page or control overflow', async () => {
    const overflow = [];
    for (const width of WIDTHS) {
      const height = width < 768 ? 844 : 900;
      await p.setViewportSize({ width, height });
      for (const pg of pages) {
        const data = await p.evaluate(pg => {
          S.aiv = 1;
          closeSheet(true);
          document.activeElement?.blur();
          setPage(pg, { instant: true });
          const clipped = [...document.querySelectorAll('button,input,select,textarea,a')].filter(e => {
            const r = e.getBoundingClientRect();
            if (getComputedStyle(e).visibility !== 'visible') return false;
            if (!r.width || !r.height || (r.left >= -1 && r.right <= innerWidth + 1)) return false;
            for (let a = e.parentElement; a; a = a.parentElement) {
              if (/auto|scroll/.test(getComputedStyle(a).overflowX) && a.scrollWidth > a.clientWidth + 2) return false;
            }
            return true;
          }).map(e => e.id || e.tagName + '.' + e.className);
          return { scroll: document.documentElement.scrollWidth, width: innerWidth, clipped, actual: st.page };
        }, pg);
        assert.equal(data.actual, pg, 'navigation did not render requested page');
        if (data.scroll > data.width + 1 || data.clipped.length) overflow.push({ width, pg, ...data });
      }
    }
    await p.setViewportSize({ width: 844, height: 390 });
    await p.evaluate(() => setPage('main', { instant: true }));
    assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(overflow, []);
  });
  await check('day, week grid/list and doctor controls update their visible views', async () => {
    await p.evaluate(() => { document.activeElement?.blur(); setPage('main', { instant: true }); });
    await p.locator('#vWeek').click();
    assert(await p.locator('#weekView').isVisible());
    await p.locator('#wList').click();
    assert(await p.locator('#wListBox').isVisible());
    await p.locator('#wGrid').click();
    assert(await p.locator('#wGridBox').isVisible());
    await p.locator('#vDoc').click();
    assert(await p.locator('#docView').isVisible());
    await p.locator('#vDay').click();
    assert(await p.locator('#dayView').isVisible());
  });
  await check('empty ideas, Unicode/HTML-safe creation and refresh persistence', async () => {
    await p.evaluate(() => { setTop('parked', JSON.stringify([])); setPage('ideas', { instant: true }); });
    assert.equal(await p.locator('[data-ix]').count(), 0);
    const text = 'مراجعة القلب 🫀 <img src=x onerror=alert(1)> & physiology';
    await p.locator('#ideaIn').fill(text);
    await p.locator('#ideaIn').press('Enter');
    assert.equal(await p.locator('[data-ix]').count(), 1);
    assert.equal(await p.locator('#pg-ideas .idea img').count(), 0);
    await p.reload();
    await p.waitForFunction(() => typeof st === 'object');
    assert((await p.locator('#pg-ideas').innerText()).includes(text));
    await p.locator('[data-ix]').click();
    assert(await p.evaluate(() => !!ideasList()[0].x));
  });
  await check('lecture editor rejects an empty title, saves Unicode, survives refresh and preserves study marks', async () => {
    await p.evaluate(() => { document.activeElement?.blur(); closeSheet(true); setPage('main', { instant: true }); sheetEdit(null, { day: MOD_DAYS[0].date }); });
    await settleModal(p);
    await p.locator('#edSave').click();
    assert(await p.locator('#edErr').isVisible());
    const title = 'محاضرة تجريبية 🧪 <script>throw 1</script>';
    await p.locator('#edN').fill(title);
    await p.locator('#edSave').click();
    const id = await p.evaluate(title => extraList().find(e => e.topic === title)?.id, title);
    assert(id);
    await p.evaluate(id => { quietPatch(id, { studied: '2026-10-20', cards: 4, anki: '2026-10-20' }); sheetEdit(id); }, id);
    await settleModal(p);
    await p.locator('#edN').fill(title + ' edited');
    await p.locator('#edSave').click();
    await p.reload();
    await p.waitForFunction(() => typeof ALL !== 'undefined');
    const value = await p.evaluate(id => ({ b: BY_ID[id], m: mk(id) }), id);
    assert.equal(value.b.topic, title + ' edited');
    assert.equal(value.m.studied, '2026-10-20');
    assert.equal(value.m.cards, 4);
  });
  await check('manual study gate rejects malformed clips and starts after valid clips + priming', async () => {
    const id = await p.evaluate(() => { closeSheet(true); S.aiv = false; const id = ALL.find(b => needsStudy(b) && !mk(b.id).studied).id; window.__auditStudyId = id; startFlow(id, { ok: true }); return id; });
    assert(await p.locator('#csIn').isVisible());
    assert(!(await p.evaluate(id => !!mk(id).startAt, id)));
    await p.locator('#csIn').fill('{bad json');
    await p.waitForTimeout(280);
    assert(await p.locator('#csGo').isDisabled());
    await p.locator('#csIn').fill(JSON.stringify({ app: 'uqu-clips', v: 1, lecture: 'Audit lecture', slides: 4, clips: [{ title: 'Mechanisms', ar: 'آليات', from: 1, to: 4, min: 10, hook: 'ليش؟', keys: ['Mechanism one', 'Mechanism two'], type: 'why', prompt: 'اشرح الآلية' }] }));
    await p.waitForTimeout(280);
    await p.locator('#csGo').click();
    await p.waitForSelector('#prGo');
    await settleModal(p);
    await p.locator('#prGo').click();
    assert(await p.evaluate(id => !!mk(id).startAt && !!clipsOf(id), id));
    await p.evaluate(id => pauseSession(id), id);
    const acc = await p.evaluate(id => sessMs(id), id);
    await p.reload();
    await p.waitForFunction(() => typeof mk === 'function');
    assert(await p.evaluate(id => !!mk(id).pz, id));
    assert((await p.evaluate(id => sessMs(id), id)) >= acc);
    await p.evaluate(id => { resumeSession(id); stopSession(id, 'stop'); if (focusOpen()) hideFocus(); closeSheet(true); }, id);
    assert(!(await p.evaluate(id => !!mk(id).startAt, id)));
  });
  await check('manual ANKI counts reject decimals and out-of-range exponents in legacy and AI modes', async () => {
    await p.evaluate(() => { document.activeElement?.blur(); closeSheet(true); });
    for (const ai of [false, true]) {
      for (const value of ['1.9', '1e3', '-1', '0', '1000']) {
        await p.evaluate(ai => { S.aiv = ai ? 1 : false; const id = ALL.find(needsStudy).id; window.__auditCountId = id; quietPatch(id, { cards: false, anki: false }); sheetCards(id); }, ai);
        await settleModal(p);
        await p.locator('#cN').fill(value);
        await p.locator('#cSave').click();
        assert(!(await p.evaluate(() => mk(window.__auditCountId).cards)), `${ai ? 'AI' : 'legacy'} ${value} mutated cards`);
        assert(await p.locator('#cErr').isVisible());
      }
      await p.locator('#cN').fill('12');
      await p.locator('#cSave').click();
      assert.equal(await p.evaluate(() => mk(window.__auditCountId).cards), 12);
    }
  });
  await check('modal has an accessible name, initial focus, focus containment and restores trigger', async () => {
    await p.evaluate(() => { closeSheet(true); setPage('main', { instant: true }); document.querySelector('#thinkBtn').focus(); openSheet('<h2 id="auditHeading">Audit dialog</h2><input id="auditFirst" aria-label="First"><button id="auditLast">Last</button>'); });
    const initial = await p.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return { inside: d.contains(document.activeElement), named: !!(d.getAttribute('aria-label') || (d.getAttribute('aria-labelledby') && document.getElementById(d.getAttribute('aria-labelledby'))?.textContent.trim())) }; });
    assert(initial.inside, 'initial focus remained behind modal');
    assert(initial.named, 'dialog has no accessible name');
    await p.locator('#auditLast').focus();
    await p.keyboard.press('Tab');
    assert(await p.evaluate(() => document.querySelector('#ov').contains(document.activeElement)), 'Tab escaped dialog');
    await p.keyboard.press('Escape');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'thinkBtn');
  });
  await check('browser Back/Forward and an empty hash match the visible route', async () => {
    const nav = await isolated();
    try {
      await nav.page.evaluate(() => { setPage('ideas', { instant: true }); setPage('settings', { instant: true }); });
      await nav.page.goBack();
      await nav.page.waitForTimeout(30);
      assert.equal(await nav.page.evaluate(() => st.page), 'ideas');
      await nav.page.goForward();
      await nav.page.waitForTimeout(30);
      assert.equal(await nav.page.evaluate(() => st.page), 'settings');
      await nav.page.evaluate(() => { location.hash = ''; });
      await nav.page.waitForTimeout(30);
      assert.equal(await nav.page.evaluate(() => st.page), 'main');
    } finally { await nav.ctx.close(); }
  });
  await check('open app accepts local edits while offline and retains them after reconnection', async () => {
    await p.evaluate(() => { closeSheet(true); document.activeElement?.blur(); setPage('ideas', { instant: true }); });
    await app.ctx.setOffline(true);
    try {
      await p.locator('#ideaIn').fill('فكرة محفوظة بدون شبكة — offline');
      await p.locator('#ideaAdd').click();
      assert(await p.evaluate(() => ideasList().some(x => x.t === 'فكرة محفوظة بدون شبكة — offline')));
    } finally { await app.ctx.setOffline(false); }
    await p.reload();
    await p.waitForFunction(() => typeof ideasList === 'function');
    assert((await p.locator('#pg-ideas').innerText()).includes('فكرة محفوظة بدون شبكة — offline'));
  });
  await check('OS reduced-motion preference disables CSS transitions as well as JavaScript motion', async () => {
    await p.evaluate(() => { closeSheet(true); document.activeElement?.blur(); setPage('main', { instant: true }); });
    const motion = await p.evaluate(() => ({ matches: matchMedia('(prefers-reduced-motion: reduce)').matches, js: motionOn(), transitions: getComputedStyle(document.querySelector('.wk')).transitionDuration.split(',').map(x => parseFloat(x)) }));
    assert(motion.matches);
    assert.equal(motion.js, false);
    assert(motion.transitions.every(x => x === 0), 'CSS transitions still run under OS reduce motion');
  });
  await check('valid deep links render directly and survive refresh', async () => {
    for (const pg of ['month', 'radar', 'settings', 'sleep', 'ideas']) {
      await p.goto('http://audit.test/#' + pg);
      await p.waitForFunction(pg => st.page === pg, pg);
      assert(await p.locator('#pg-' + pg).isVisible());
      await p.reload();
      await p.waitForFunction(pg => st.page === pg, pg);
    }
  });
  await check('main site renders when localStorage or IndexedDB access is denied', async () => {
    for (const storage of ['localStorage', 'indexedDB']) {
      const ctx = await browser.newContext({ reducedMotion: 'reduce' });
      await ctx.route('**/*', r => r.fulfill({ body: r.request().resourceType() === 'document' ? HTML : '', contentType: r.request().resourceType() === 'document' ? 'text/html' : r.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/plain' }));
      await ctx.addInitScript(storage => Object.defineProperty(window, storage, { get() { throw new DOMException('Storage access denied', 'SecurityError'); } }), storage);
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://audit.test/');
      await page.waitForFunction(() => !!document.querySelector('#weeks button'));
      assert.deepEqual(errors, []);
      await ctx.close();
    }
  });
  await check('the visible app emits no console errors, exceptions or unhandled rejections', async () => {
    assert.deepEqual(app.faults, []);
    assert.deepEqual(await p.evaluate(() => window.__auditRejections), []);
  });
  await app.ctx.close();
})().catch(e => { result.checks.push({ name: 'browser/setup', ok: false, error: String(e.message).slice(0, 2000) }); console.error(e.message); }).finally(async () => {
  if (browser) await browser.close();
  if (process.env.AUDIT_OUTPUT) fs.writeFileSync(process.env.AUDIT_OUTPUT, JSON.stringify(result, null, 2));
  const failed = result.checks.filter(c => !c.ok);
  console.log(JSON.stringify({ engine: ENGINE, passed: result.checks.length - failed.length, failed: failed.length }));
  if (failed.length) process.exitCode = 1;
});
