#!/usr/bin/env node
// Owned recording URL lifecycles under the production CSP; no microphone or external service calls.
// node tools/audit/frontend_media.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let pw;
try { pw = require('playwright-core'); } catch { pw = require('../runner/node_modules/playwright-core'); }
const html = fs.readFileSync(process.env.AUDIT_MEDIA_SOURCE || path.join(__dirname, '../../index.html'), 'utf8');
const engine = process.env.AUDIT_BROWSER || 'chromium';
const results = { engine, checks: [] };
let browser;
async function open() {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (/^(blob|data):/.test(url)) return route.continue();
    if (url === 'https://uqu.test/') return route.fulfill({ contentType: 'text/html', body: html });
    if (url.startsWith('https://fonts.googleapis.com/')) return route.fulfill({ contentType: 'text/css', body: '' });
    return route.fulfill({ status: 204, body: '' });
  });
  await context.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    window.auditURLs = new Map();
    window.auditNativeAudio = [];
    const NativeAudio = Audio;
    window.Audio = function (...args) { const media = new NativeAudio(...args); auditNativeAudio.push(media); return media; };
    window.Audio.prototype = NativeAudio.prototype;
    window.auditRecorderCreated = 0;
    URL.createObjectURL = blob => { const url = create(blob); auditURLs.set(url, { size: blob.size, revoked: false }); return url; };
    URL.revokeObjectURL = url => { const item = auditURLs.get(String(url)); if (item) item.revoked = true; return revoke(url); };
    const stream = { getTracks: () => [{ stop() {} }] };
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => stream }, configurable: true });
    class Recorder {
      static isTypeSupported() { return false; }
      constructor() { auditRecorderCreated++; this.state = 'inactive'; this.mimeType = 'audio/wav'; }
      start() { this.state = 'recording'; }
      stop() { if (this.state === 'inactive') return; this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: encodeWav(new Float32Array(160000), 8000) }); this.onstop?.(); }); }
    }
    window.MediaRecorder = Recorder;
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const faults = [];
  page.on('pageerror', e => faults.push(e.message));
  page.on('console', message => { if (message.type() === 'error') faults.push(message.text()); });
  await page.goto('https://uqu.test/');
  await page.waitForFunction(() => typeof audioPlayer === 'function');
  await page.evaluate(() => { sUnlocked = true; localStorage.setItem('uqu-sfx', '0'); achReady = false; entered = false; clearTimeout(achT); closeSheet(true); });
  return { context, page, faults };
}
async function check(name, fn) {
  if (process.env.AUDIT_MEDIA_FILTER && !name.includes(process.env.AUDIT_MEDIA_FILTER)) return;
  const app = await open();
  try { const detail = await fn(app.page); assert.deepEqual(app.faults, []); results.checks.push({ name, ok: true, detail }); console.log('PASS ' + name); }
  catch (e) { const live = await app.page.evaluate(() => [...auditURLs.values()].filter(v => !v.revoked).length).catch(() => null); results.checks.push({ name, ok: false, error: e.message.slice(0, 2500), liveURLs: live, faults: app.faults, body: (await app.page.locator('#ov').innerText().catch(() => '')).slice(-600) }); console.error('FAIL ' + name + ': ' + e.message.slice(0, 300)); }
  finally { await app.context.close(); }
}
async function preview(page) {
  await page.evaluate(() => sheetSummary(ALL.find(b => needsStudy(b)).id, 'x'));
  await page.waitForTimeout(350);
  await page.locator('#goRec').click();
  await page.locator('#stopRec').click();
  await page.waitForSelector('#stage audio');
}
async function podcast(page) {
  await page.evaluate(() => {
    const exam = examsNow().find(e => e.scope.length >= 2);
    if (!exam) throw Error('No bundled exam has two lecture items');
    window.auditPodIds = exam.scope.slice(0, 2).map(b => b.id);
    auditPodIds.forEach((id, i) => { const r = { d: todayISO, at: Date.now(), a: true, w: 'local', fmt: 'wav', s: 20 }; quietPatch(id, { recs: { ['audit' + i]: r } }); });
    audioStore.get = async () => 'data:audio/wav;base64,';
    recBlob = async () => encodeWav(new Float32Array(160000), 8000);
    sheetPodcast(examKey(exam));
  });
  await page.waitForTimeout(350);
  await page.locator('#pPlay').click();
  await page.waitForFunction(() => auditURLs.size > 0);
}
(async () => {
  browser = await pw[engine].launch({ headless: true, ...(process.env.AUDIT_BROWSER_PATH ? { executablePath: process.env.AUDIT_BROWSER_PATH } : {}), ...(engine === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
  results.version = browser.version();
  try {
    await check('mini player survives page/sheet changes and ended replay while still mounted', async page => {
      await page.evaluate(() => { playNow(encodeWav(new Float32Array(160000), 8000), 'Lifecycle test'); window.auditMini = document.querySelector('#nowPlay audio'); });
      await page.waitForFunction(() => !auditMini.paused);
      await page.evaluate(() => { setPage('ideas', { instant: true }); openSheet('<h2>Temporary sheet</h2>'); closeSheet(true); });
      assert(await page.evaluate(() => !auditMini.paused && !auditURLs.get(auditMini.src).revoked));
      await page.evaluate(() => { auditMini.pause(); auditMini.dispatchEvent(new Event('ended')); });
      assert(await page.evaluate(() => !auditURLs.get(auditMini.src).revoked && !document.querySelector('#nowPlay').hidden));
    });
    await check('mini player close releases its recording URL', async page => {
      await page.evaluate(() => playNow(encodeWav(new Float32Array(160000), 8000), 'Close test'));
      await page.locator('#nowPlay .np-x').click();
      assert.equal(await page.evaluate(() => [...auditURLs.values()].filter(v => !v.revoked).length), 0);
    });
    await check('mini player replacement releases old recording and preserves new playback', async page => {
      const value = await page.evaluate(() => { const blob = encodeWav(new Float32Array(160000), 8000); playNow(blob, 'One'); const first = document.querySelector('#nowPlay audio').src; playNow(blob, 'Two'); const second = document.querySelector('#nowPlay audio').src; return { firstReleased: auditURLs.get(first).revoked, secondActive: !auditURLs.get(second).revoked }; });
      assert.deepEqual(value, { firstReleased: true, secondActive: true });
    });
    await check('recording preview close releases its URL and stops playback', async page => {
      await preview(page);
      await page.evaluate(async () => { window.auditPreview = document.querySelector('#stage audio'); await auditPreview.play(); closeSheet(true); });
      assert(await page.evaluate(() => auditPreview.paused));
      assert.equal(await page.evaluate(() => [...auditURLs.values()].filter(v => !v.revoked).length), 0);
    });
    await check('recording redo disposes previous preview before starting new capture', async page => {
      await preview(page);
      await page.locator('#redo').click();
      await page.waitForSelector('#stopRec');
      assert.equal(await page.evaluate(() => [...auditURLs.values()].filter(v => !v.revoked).length), 0);
    });
    for (const failure of ['constructor', 'start']) {
      await check('hardware ' + failure + ' failure releases tracks and permits text fallback without errors', async page => {
        await page.evaluate(failure => {
          window.auditHardwareTracks = [0, 1].map(() => ({ readyState: 'live', stop() { this.readyState = 'ended'; } }));
          navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => auditHardwareTracks });
          window.MediaRecorder = class {
            static isTypeSupported() { return false; }
            constructor() { if (failure === 'constructor') throw new DOMException('Controlled unsupported recorder', 'NotSupportedError'); this.state = 'inactive'; }
            start() { this.state = 'recording'; throw new DOMException('Controlled recording start failure', 'NotReadableError'); }
            stop() { this.state = 'inactive'; }
          };
          window.auditHardwareLecture = ALL.find(b => needsStudy(b)).id;
          sheetSummary(auditHardwareLecture, 'x');
        }, failure);
        await page.waitForTimeout(350);
        await page.locator('#goRec').click();
        await page.waitForTimeout(100);
        assert(await page.evaluate(() => auditHardwareTracks.every(track => track.readyState === 'ended')), 'all granted microphone tracks must stop on recorder failure');
        assert(await page.evaluate(() => document.querySelector('#typeBox').open));
        assert(await page.locator('#sumT').isVisible());
        assert(await page.locator('#saveSum').isVisible());
        assert.equal(await page.evaluate(() => st.recOn), false);
        await page.locator('#sumT').fill('Text fallback after controlled recorder failure');
        await page.locator('#saveSum').click();
        assert.equal(await page.evaluate(() => recsOf(auditHardwareLecture).length), 1);
        assert.equal(await page.evaluate(() => recsOf(auditHardwareLecture)[0].a), false);
      });
    }
    await check('podcast close releases all item URLs', async page => {
      await podcast(page);
      await page.evaluate(() => closeSheet(true));
      assert.equal(await page.evaluate(() => [...auditURLs.values()].filter(v => !v.revoked).length), 0);
    });
    await check('podcast skip releases old item URLs and leaves only current item', async page => {
      await podcast(page);
      await page.locator('#pNext').click();
      await page.waitForFunction(() => auditURLs.size >= 2);
      assert.equal(await page.evaluate(() => [...auditURLs.values()].filter(v => !v.revoked).length), 1);
    });
    await check('podcast ended events release each finished item and final recording', async page => {
      await podcast(page);
      await page.evaluate(() => auditNativeAudio.at(-1).dispatchEvent(new Event('ended')));
      await page.waitForFunction(() => auditURLs.size >= 2);
      assert.equal(await page.evaluate(() => [...auditURLs.values()].filter(v => !v.revoked).length), 1);
      await page.evaluate(() => auditNativeAudio.at(-1).dispatchEvent(new Event('ended')));
      assert.equal(await page.evaluate(() => [...auditURLs.values()].filter(v => !v.revoked).length), 0);
    });
    await check('podcast superseded read cannot play an older item after a skip', async page => {
      await page.evaluate(() => {
        const exam = examsNow().find(e => e.scope.length >= 2);
        exam.scope.slice(0, 2).forEach((b, i) => quietPatch(b.id, { recs: { ['late' + i]: { d: todayISO, a: true, w: 'local', fmt: 'wav' } } }));
        let reads = 0;
        audioStore.get = () => ++reads === 1 ? new Promise(resolve => { window.auditResolveOld = resolve; }) : Promise.resolve('data:audio/wav;base64,');
        recBlob = async () => encodeWav(new Float32Array(160000), 8000);
        sheetPodcast(examKey(exam));
      });
      await page.waitForTimeout(350);
      await page.locator('#pPlay').click();
      await page.locator('#pNext').click();
      await page.waitForFunction(() => auditURLs.size >= 1);
      await page.evaluate(() => auditResolveOld('data:audio/wav;base64,'));
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => auditURLs.size), 1);
    });
    await check('late microphone grant after close stops every granted track', async page => {
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.auditResolveMic = resolve; });
        window.auditTrack = { readyState: 'live', stop() { this.readyState = 'ended'; } };
        sheetSummary(ALL.find(b => needsStudy(b)).id, 'x');
        closeSheet(true);
        auditResolveMic({ getTracks: () => [auditTrack] });
      });
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => auditTrack.readyState), 'ended');
      assert.equal(await page.evaluate(() => auditRecorderCreated), 0);
    });
    await check('pending recorder start cannot affect a replacement sheet after mic grant', async page => {
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.auditResolveMic = resolve; });
        window.auditTrack = { readyState: 'live', stop() { this.readyState = 'ended'; } };
        sheetSummary(ALL.find(b => needsStudy(b)).id, 'x');
      });
      await page.waitForTimeout(350);
      await page.locator('#goRec').click();
      await page.evaluate(() => { openSheet('<h2>Replacement sheet</h2><p id="auditReplacement">Keep this sheet</p>'); auditResolveMic({ getTracks: () => [auditTrack] }); });
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => auditTrack.readyState), 'ended');
      assert.equal(await page.evaluate(() => auditRecorderCreated), 0);
      assert.equal(await page.locator('#auditReplacement').innerText(), 'Keep this sheet');
    });
    await check('late redo microphone grant after close stops its new stream', async page => {
      await preview(page);
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.auditResolveRedo = resolve; });
        window.auditRedoTrack = { readyState: 'live', stop() { this.readyState = 'ended'; } };
      });
      await page.locator('#redo').click();
      await page.evaluate(() => { closeSheet(true); auditResolveRedo({ getTracks: () => [auditRedoTrack] }); });
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => auditRedoTrack.readyState), 'ended');
      assert.equal(await page.evaluate(() => auditRecorderCreated), 1);
      assert.equal(await page.evaluate(() => [...auditURLs.values()].filter(v => !v.revoked).length), 0);
    });
    await check('pending recording conversion cannot append a preview after close', async page => {
      await page.evaluate(() => {
        cutPauses = () => new Promise(resolve => { window.auditResolveConversion = resolve; });
        blobSeconds = async () => 0.1;
        sheetSummary(ALL.find(b => needsStudy(b)).id, 'x');
      });
      await page.waitForTimeout(350);
      await page.locator('#goRec').click();
      await page.locator('#stopRec').click();
      await page.waitForFunction(() => typeof auditResolveConversion === 'function');
      await page.evaluate(() => { closeSheet(true); auditResolveConversion({ blob: encodeWav(new Float32Array(800), 8000), fmt: 'wav', sec: 0.1, cut: 0 }); });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => auditURLs.size), 0);
      assert(await page.locator('#ov').isHidden());
    });
    await check('pending recording save preserves a replacement sheet and still commits its recording', async page => {
      await preview(page);
      await page.evaluate(() => {
        window.auditSavedLecture = ALL.find(b => needsStudy(b)).id;
        audioStore.put = () => new Promise(resolve => { window.auditResolveSave = resolve; });
      });
      await page.locator('#saveSum').click();
      await page.waitForFunction(() => typeof auditResolveSave === 'function');
      await page.evaluate(() => { openSheet('<h2>Replacement</h2><p id="auditReplacement">Preserve me</p>'); auditResolveSave('local'); });
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#auditReplacement').count(), 1);
      assert.equal(await page.evaluate(() => recsOf(auditSavedLecture).length), 1);
    });
    await check('explicit save still commits successfully after its own sheet is closed', async page => {
      await preview(page);
      await page.evaluate(() => {
        window.auditSavedLecture = ALL.find(b => needsStudy(b)).id;
        audioStore.put = () => new Promise(resolve => { window.auditResolveSave = resolve; });
      });
      await page.locator('#saveSum').click();
      await page.waitForFunction(() => typeof auditResolveSave === 'function');
      await page.evaluate(() => { closeSheet(true); auditResolveSave('local'); });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => recsOf(auditSavedLecture).length), 1);
      assert(await page.locator('#ov').isHidden());
    });
    await check('lecture wipe during a pending recording save prevents late resurrection', async page => {
      await preview(page);
      await page.evaluate(() => {
        window.auditSavedLecture = ALL.find(b => needsStudy(b)).id;
        audioStore.put = () => new Promise(resolve => { window.auditResolveSave = resolve; });
        audioStore.del = async () => {};
      });
      await page.locator('#saveSum').click();
      await page.waitForFunction(() => typeof auditResolveSave === 'function');
      await page.evaluate(() => { closeSheet(true); wipeLecture(auditSavedLecture); auditResolveSave('local'); });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => recsOf(auditSavedLecture).length), 0);
    });
    await check('state reset during a pending recording save prevents late resurrection', async page => {
      await preview(page);
      await page.evaluate(() => {
        window.auditSavedLecture = ALL.find(b => needsStudy(b)).id;
        audioStore.put = () => new Promise(resolve => { window.auditResolveSave = resolve; });
        audioStore.del = async () => {};
      });
      await page.locator('#saveSum').click();
      await page.waitForFunction(() => typeof auditResolveSave === 'function');
      await page.evaluate(() => { closeSheet(true); wipeLocal({ marks: {}, epoch: Date.now().toString(36), since: Date.now() }); auditResolveSave('local'); });
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => recsOf(auditSavedLecture).length), 0);
    });
    await check('podcast pending read cannot revive audio after close', async page => {
      await page.evaluate(() => {
        const exam = examsNow().find(e => e.scope.length);
        quietPatch(exam.scope[0].id, { recs: { delayed: { d: todayISO, a: true, w: 'local', fmt: 'wav' } } });
        audioStore.get = () => new Promise(resolve => { window.auditResolveRead = resolve; });
        recBlob = async () => encodeWav(new Float32Array(800), 8000);
        sheetPodcast(examKey(exam));
      });
      await page.waitForTimeout(350);
  await page.locator('#pPlay').click();
      await page.waitForFunction(() => typeof auditResolveRead === 'function');
      await page.evaluate(() => { closeSheet(true); auditResolveRead('data:audio/wav;base64,'); });
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => auditURLs.size), 0);
    });
  } finally { await browser.close(); }
  if (process.env.AUDIT_OUTPUT) fs.writeFileSync(process.env.AUDIT_OUTPUT, JSON.stringify(results, null, 2) + '\n');
  console.log(results.checks.filter(c => c.ok).length + '/' + results.checks.length + ' media lifecycle checks passed');
  if (results.checks.some(c => !c.ok)) process.exitCode = 1;
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
