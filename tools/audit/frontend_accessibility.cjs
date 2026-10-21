#!/usr/bin/env node
// npm install --prefix /tmp/audit-axe axe-core@4.11.0 --no-audit --no-fund --ignore-scripts
// AXE_MODULE=/tmp/audit-axe/node_modules/axe-core node tools/audit/frontend_accessibility.cjs
const fs = require('node:fs');
const path = require('node:path');
let playwright;
try { playwright = require('playwright-core'); } catch { playwright = require('../runner/node_modules/playwright-core'); }
const axePath = require.resolve(process.env.AXE_MODULE || 'axe-core');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
(async () => {
  const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    // Test-only axe injection needs CSP bypass; functional tests keep the production policy enabled.
    const ctx = await browser.newContext({ bypassCSP: true, viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await ctx.route('**/*', r => r.fulfill({ body: r.request().resourceType() === 'document' ? html : '', contentType: r.request().resourceType() === 'document' ? 'text/html' : r.request().resourceType() === 'stylesheet' ? 'text/css' : 'text/plain' }));
    const page = await ctx.newPage();
    await page.goto('http://audit.test/');
    await page.addScriptTag({ path: axePath });
    for (const theme of ['light', 'dark']) for (const pg of ['main', 'ai', 'ideas', 'settings', 'career', 'month', 'exams', 'radar', 'offers', 'sleep']) {
      await page.evaluate(({ pg, theme }) => { closeSheet(true); document.activeElement?.blur(); S.aiv = 1; document.documentElement.dataset.theme = theme; setPage(pg, { instant: true }); }, { pg, theme });
      await page.waitForTimeout(250);
      const scan = await page.evaluate(async () => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } }));
      // The user explicitly requires pinch/double-tap zoom disabled. Keep this recorded exception visible.
      const accepted = scan.violations.filter(v => v.id === 'meta-viewport').map(v => v.id);
      const violations = scan.violations.filter(v => v.id !== 'meta-viewport').map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length, samples: v.nodes.slice(0, 3).map(n => ({ target: n.target, reason: n.failureSummary })) }));
      results.push({ pg, theme, accepted, violations });
      console.log((violations.length ? 'FAIL ' : 'PASS ') + theme + '/' + pg + (violations.length ? ' ' + violations.map(v => v.id).join(', ') : ''));
    }
    await page.evaluate(() => openSheet('<h2>Accessible audit dialog</h2><label>Name<input></label><button>Save</button>'));
    const modal = await page.evaluate(async () => axe.run(document.querySelector('[role="dialog"]'), { runOnly: { type: 'rule', values: ['aria-dialog-name', 'aria-required-children', 'label', 'button-name', 'color-contrast'] } }));
    results.push({ pg: 'modal', theme: 'dark', violations: modal.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length })) });
    console.log((modal.violations.length ? 'FAIL ' : 'PASS ') + 'modal semantics');
    const summary = { engine: 'chromium', version: browser.version(), axe: require(path.join(path.dirname(axePath), 'package.json')).version, results };
    if (process.env.AUDIT_OUTPUT) fs.writeFileSync(process.env.AUDIT_OUTPUT, JSON.stringify(summary, null, 2));
    if (results.some(r => r.violations.length)) process.exitCode = 1;
    console.log(JSON.stringify({ cases: results.length, failed: results.filter(r => r.violations.length).length, intentionalException: 'meta-viewport: user-required no zoom' }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
