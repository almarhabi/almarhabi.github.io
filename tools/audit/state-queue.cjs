// Actual queue orchestration; controlled CAS acknowledgements and lost replies, no backend/network.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(process.env.STATE_QUEUE_SOURCE || path.join(__dirname, '../../index.html'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const e1 = Date.UTC(2026, 9, 21, 12).toString(36);
const e2 = Date.UTC(2026, 9, 21, 12, 0, 1).toString(36);
const day = '2026-10-21';
function fn(name) {
  const match = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(html);
  assert(match, 'Missing production function ' + name);
  for (let end = html.indexOf('\n', match.index); end >= 0; end = html.indexOf('\n', end + 1)) {
    const source = html.slice(match.index, end);
    try { new vm.Script(source); return source; } catch (e) { /* more lines needed */ }
  }
  throw Error('Cannot extract ' + name);
}
function declaration(name) {
  const match = html.match(new RegExp('^const ' + name + '=.*;$', 'm'));
  assert(match, 'Missing production declaration ' + name);
  return match[0];
}
const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};
const aborted = value => ({ committed: false, snapshot: { exists: () => value !== null, val: () => value } });
const tests = [];
const test = (name, run) => tests.push([name, run]);
function queueContext(overrides = {}) {
  const observations = [];
  const c = vm.createContext({
    console, Date, Math, Object, Array, JSON, Promise, Set, Map,
    S: { epoch: e1, marks: {} }, pending: {}, pendingTop: {}, jobs: [],
    epochPush: false, busy: false, flushQ: true, resetPend: null,
    merged: true, remoteExists: true, canW: true, achReady: true, live: 'fb', syncErr: '',
    LV: 0, st: {}, FS: null, fiveRun: null, blkSig: null, sleepRun: null,
    localStorage: { removeItem() {} }, LINK_LS: 'fixture-link', MERGE: {},
    // Validation/UI are independent of queue orchestration; these fixtures already have valid schemas.
    cleanS: clone, cleanMark: value => value, syncKey: () => '', linking: () => false,
    pend: () => { throw Error('Unexpected bootstrap mutation'); },
    savePend() {}, cache() {}, render() {}, renderSync() {}, saveSitLocal() {},
    clearLocalAudio() {}, aiWipe() {}, $: () => ({ hidden: true }),
    schedFlush: () => { c.scheduledFlushes++; }, scheduledFlushes: 0, pump() {},
    ...overrides,
  });
  const top = html.match(/const TOPF=(\[[^\]]+\])/);
  assert(top);
  c.TOPF = JSON.parse(top[1]);
  for (const name of ['isObj', 'BAD_K', 'safeId', 'vClean', 'sameV', 'epochMs', 'fullDoc', 'pendN']) vm.runInContext(declaration(name), c);
  for (const name of ['wipeLocal', 'applyRemote', 'flushNow', 'pushReset']) vm.runInContext(fn(name), c);
  const apply = c.applyRemote;
  c.applyRemote = snap => {
    observations.push({ pending: clone(c.pending), pendingTop: clone(c.pendingTop), reset: c.resetPend, exists: snap.exists, data: clone(snap.data()), metadata: clone(snap.metadata) });
    return apply(snap);
  };
  return { c, observations };
}

test('aborted field flush delegates the authoritative snapshot before clearing any pending edit', async () => {
  const gate = deferred();
  let sent;
  const authoritative = { epoch: e2, marks: { server: { studied: day } }, goal: 70 };
  const { c, observations } = queueContext({
    S: { epoch: e1, marks: { old: { cards: 1 } } },
    pending: { 'old|cards': 1 }, pendingTop: { goal: 60 },
    remote: { updatePaths: async (paths, epoch) => { sent = { paths: clone(paths), epoch }; await gate.promise; return aborted(authoritative); } },
  });
  const running = c.flushNow();
  c.pending['old|cards'] = 2;
  c.pending['later|studied'] = day;
  c.pendingTop.goal = 80;
  gate.resolve();
  await running;
  assert.deepEqual(sent, { paths: { 'marks/old/cards': 1, goal: 60 }, epoch: e1 });
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0].pending, { 'old|cards': 2, 'later|studied': day });
  assert.deepEqual(observations[0].pendingTop, { goal: 80 });
  assert.deepEqual(observations[0].data, authoritative);
  assert.deepEqual(observations[0].metadata, { fromCache: false });
  assert.equal(c.S.epoch, e2);
  assert.equal(c.S.marks.old, undefined, 'the newer reset must remove old local data');
  assert.equal(c.S.marks.server.studied, day);
  assert.deepEqual(Object.keys(c.pending), []);
});

test('lost reset reply retries its first immutable snapshot and retains all edits made afterward', async () => {
  const attempts = [];
  let server;
  const { c, observations } = queueContext({
    S: { epoch: e1, marks: { lecture: { studied: day, cards: 1 } }, goal: 60, cap: 10 },
    resetPend: e1, pending: { 'lecture|studied': day, 'lecture|cards': 1 }, pendingTop: { goal: 60, cap: 10 },
    remote: { set: async snapshot => {
      attempts.push(clone(snapshot));
      if (attempts.length === 1) { server = clone(snapshot); throw Object.assign(Error('lost commit acknowledgement'), { code: 'unavailable' }); }
      return aborted(server);
    } },
  });
  c.pushReset();
  const queued = c.jobs[0];
  await assert.rejects(queued(), /lost commit acknowledgement/);
  assert.equal(c.epochPush, false);
  assert.equal(c.resetPend, e1);
  c.S.marks.lecture.cards = 2;
  c.S.marks.later = { studied: day };
  c.S.goal = 80;
  c.S.pts = 10;
  c.pending['lecture|cards'] = 2;
  c.pending['later|studied'] = day;
  c.pendingTop.goal = 80;
  c.pendingTop.pts = 10;
  server.marks.otherDevice = { studied: day };
  await queued();
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], attempts[0], 'retrying a reset must not replace its snapshot with later state');
  assert.equal(attempts[1].marks.lecture.cards, 1);
  assert.equal(attempts[1].marks.later, undefined);
  assert.deepEqual(observations[0].pending, { 'lecture|cards': 2, 'later|studied': day });
  assert.deepEqual(observations[0].pendingTop, { goal: 80, pts: 10 });
  assert.equal(c.resetPend, null);
  assert.equal(c.S.marks.otherDevice.studied, day, 'replaying the reset must preserve another device edit');
  assert.equal(c.S.marks.lecture.cards, 2);
  assert.equal(c.S.marks.later.studied, day);
  assert.equal(c.S.goal, 80);
  assert.deepEqual(Object.keys(c.pending).sort(), ['later|studied', 'lecture|cards']);
  assert.equal(c.scheduledFlushes, 1, 'later edits must be scheduled for an ordinary conditional patch');
});

test('a newer remote epoch abort cannot acknowledge an old reset or its old pending fields', async () => {
  const authoritative = { epoch: e2, marks: { replacement: { studied: day } }, goal: 75 };
  const { c, observations } = queueContext({
    S: { epoch: e1, marks: { old: { studied: day } }, goal: 60 },
    resetPend: e1, pending: { 'old|studied': day }, pendingTop: { goal: 60 },
    remote: { set: async () => aborted(authoritative) },
  });
  c.pushReset();
  await c.jobs[0]();
  assert.equal(observations.length, 1);
  assert.equal(observations[0].reset, e1, 'only applying the authoritative epoch may retire this reset intent');
  assert.deepEqual(observations[0].pending, { 'old|studied': day }, 'an aborted old reset did not upload these fields');
  assert.deepEqual(observations[0].pendingTop, { goal: 60 });
  assert.equal(c.S.epoch, e2);
  assert.equal(c.resetPend, null);
  assert.equal(c.epochPush, false);
  assert.equal(c.S.marks.old, undefined);
  assert.equal(c.S.marks.replacement.studied, day);
  assert.equal(c.S.goal, 75);
  assert.deepEqual(Object.keys(c.pending), []);
  assert.equal(c.scheduledFlushes, 0, 'old pending data must not be scheduled after the newer reset');
});

test('pump executes a replacement queue head created while its previous job was awaiting', async () => {
  const gate = deferred();
  let replacedRan = 0, obsoleteRan = 0;
  const first = async () => { await gate.promise; };
  const replacement = async () => { replacedRan++; };
  const c = vm.createContext({ console, Promise, busy: false, remote: {}, canW: true,
    jobs: [first, async () => { obsoleteRan++; }], syncErr: '', offErr: () => false, renderSync() {}, resync() {}, setTimeout() {} });
  vm.runInContext(fn('pump'), c);
  const running = c.pump();
  c.jobs.splice(0, c.jobs.length, replacement);
  gate.resolve();
  await running;
  assert.equal(replacedRan, 1, 'the old completion must not shift away the new queue head');
  assert.equal(obsoleteRan, 0);
  assert.equal(c.jobs.length, 0);
  assert.equal(c.busy, false);
});

(async () => {
  let failed = 0;
  for (const [name, run] of tests) {
    try { await run(); console.log('PASS ' + name); }
    catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.stack); }
  }
  console.log(`${tests.length - failed}/${tests.length} queue orchestration checks passed`);
  process.exitCode = failed ? 1 : 0;
})();
