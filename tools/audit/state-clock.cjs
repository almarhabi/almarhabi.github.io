// Actual production lifecycle functions, fake clocks, synthetic jobs, no network/storage.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
const now = 1792576800000;
const remoteFuture = Date.parse('2500-01-01T00:00:00Z');
class Clock extends Date { static now() { return now; } }
function fn(name) {
  const m = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(html);
  assert(m, `Missing production function ${name}`);
  for (let end = html.indexOf('\n', m.index); end >= 0; end = html.indexOf('\n', end + 1)) {
    const text = html.slice(m.index, end);
    try { new vm.Script(text); return text; } catch (e) { /* complete statement not reached */ }
  }
  throw Error('Cannot extract ' + name);
}
function optionalStatement(name) {
  const match = new RegExp('(?:const|let)\\s+' + name + '\\s*=').exec(html);
  if (!match) return '';
  for (let end = html.indexOf('\n', match.index); end >= 0; end = html.indexOf('\n', end + 1)) {
    const text = html.slice(match.index, end);
    try { new vm.Script(text); return text; } catch (e) { /* complete statement not reached */ }
  }
  throw Error('Cannot extract helper ' + name);
}
function context(values) {
  const c = vm.createContext({ console, Date: Clock, Math, ...values });
  // These helpers are optional so the pre-fix functions produce genuine assertion failures.
  for (const name of ['JOB_SKEW', 'jobFuture', 'jobStale']) {
    const text = optionalStatement(name);
    if (text) vm.runInContext(text, c);
  }
  return c;
}
const tests = [];
const test = (name, run) => tests.push([name, run]);
function splitView(hb) {
  const shared = { st: 'kimi', d: 'otherdevice', at: now - 60000, hb, pc: 42, gid: 'synthetic_drive_id' };
  const c = context({ spGet: () => null, mk: () => ({}), spjOf: () => shared, SP_DEV: 'thisdevice', RN_DEV: 'ghrunner', spShowPc: () => 42 });
  vm.runInContext(fn('spState'), c);
  return { view: c.spState('lecture'), shared };
}
test('a year-2500 split heartbeat exposes resume instead of following forever', () => {
  const { view, shared } = splitView(remoteFuture);
  assert.equal(view.stale, true);
  assert.equal(shared.hb, remoteFuture, 'recovery must preserve stored identity and heartbeat');
});
test('ordinary two-minute device skew does not take a live split away', () => {
  const { view } = splitView(now + 2 * 60000);
  assert.equal(view.stale, false);
});
function fallback(state) {
  const started = [];
  const c = context({ RUNNER: false, document: { hidden: false }, aiOn: () => true, gasOn: () => true,
    ALL: [{ id: 'lecture' }], spBusy: {}, spState: () => state, spStart: (...args) => started.push(args) });
  vm.runInContext(fn('spQueueFallback'), c);
  c.spQueueFallback();
  return started;
}
test('future runner heartbeat permits local split fallback', () => {
  assert.equal(fallback({ own: 0, rn: true, st: 'kimi', at: now - 60000, hb: remoteFuture, sj: { gid: 'synthetic_drive_id' } }).length, 1);
});
test('future request identity permits the queued split fallback', () => {
  assert.equal(fallback({ own: 0, rn: true, st: 'q', at: remoteFuture, hb: now, sj: { gid: 'synthetic_drive_id' } }).length, 1);
});
function runner({ split = null, anki = null }) {
  const splitStarted = [], ankiStarted = [];
  const c = context({ RUNNER: true, merged: true, canW: true, achReady: true,
    RNS: { beat: now, sm: now, t0: now, ak: {}, idle: 0, end: 0 }, ALL: [{ id: 'lecture' }],
    spGet: () => null, spjOf: () => split, mk: () => ({}), SP_DEV: 'ghrunner', HR: 3600000, spBusy: {},
    spStart: (...args) => splitStarted.push(args), spQPc: () => 0, akqOf: () => anki, AKRUN: {},
    rnAnki: async (...args) => ankiStarted.push(args), aiBusy: false, aiJobs: () => [], AI_RUN: {}, pending: {}, pendingTop: {} });
  vm.runInContext(fn('rnTick'), c);
  c.rnTick();
  return { splitStarted, ankiStarted };
}
test('runner recovers a foreign split with a far-future heartbeat', () => {
  const split = { st: 'kimi', d: 'otherdevice', at: now - 60000, hb: remoteFuture, gid: 'synthetic_drive_id' };
  assert.equal(runner({ split }).splitStarted.length, 1);
});
test('runner recovers ANKI marked running by an invalid future clock', () => {
  const anki = { st: 'run', at: now - 60000, hb: remoteFuture };
  assert.equal(runner({ anki }).ankiStarted.length, 1);
  assert.equal(anki.hb, remoteFuture);
});
test('runner tolerates two-minute ANKI heartbeat skew without duplicate generation', () => {
  assert.equal(runner({ anki: { st: 'run', at: now - 60000, hb: now + 2 * 60000 } }).ankiStarted.length, 0);
});
(async () => {
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
  }
  console.log(`${tests.length - failed}/${tests.length} job clock checks passed`);
  process.exitCode = failed ? 1 : 0;
})();
