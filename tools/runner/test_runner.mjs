import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { fetch } from "undici";
import { runRunner } from "./run.mjs";
import { serveSite } from "./bridge.mjs";
import { proxyFor } from "./transport.mjs";
import { escapeCommand, secretValues, redact, validConfig, timezone, runnerMinutes, safeState } from "./safety.mjs";

const cfg = { v: 1, fb: { config: { apiKey: "mock-public-api-config", databaseURL: "https://example.firebaseio.com" }, key: "mock-sync-secret-aaaaaaaa" }, ai: { key: "mock-kimi-secret", host: "ai", gtok: "mock-bridge-secret" }, tz: "Asia/Riyadh" };
const env = { UQU_RUNNER: JSON.stringify(cfg), GH_TOKEN: "mock-github-secret", RUNNER_MAX_MIN: ".01" };
const transport = () => ({ closed: false, async close() { this.closed = true; } });
function browserStub({ launchError, navigationError, evaluateError, evaluateHang, closeError, state = {} } = {}) {
  const calls = { profile: "", closed: false, init: null, route: null, options: null, url: "" };
  const page = { isClosed: () => false, on() {}, async goto(url) { calls.url = url; if (navigationError) throw new Error(navigationError); }, async evaluate(fn, keys) { if (keys) return state; if (evaluateError) throw new Error(evaluateError); if (evaluateHang) return new Promise(() => {}); return { done: true, merged: true, live: "fb", sp: 0, ak: 0, ai: "", q: 0 }; } };
  const ctx = { async route(_, handler) { calls.route = handler; }, on() {}, async addInitScript(fn, data) { calls.init = { fn, data }; }, pages: () => [page], async close() { calls.closed = true; if (closeError) throw new Error(closeError); } };
  return { calls, playwright: { chromium: { async launchPersistentContext(profile, options) { calls.profile = profile; calls.options = options; if (launchError) throw new Error(launchError); return ctx; } } } };
}
const sampleState = {
  "uqu-ai": JSON.stringify({ key: "must-not-restore" }), "uqu-fb": JSON.stringify({ key: "must-not-restore" }), arbitrary: "must-not-restore",
  "uqu-aiuse": JSON.stringify({ d: { "2026-10-21": { i: 1, c: 0, o: 2, n: 1, private: "mock-kimi-secret" } }, t: { i: 1, c: 0, o: 2, n: 1, key: "mock-github-secret" }, log: [{ content: "private lecture" }] }),
  "uqu-aitry": JSON.stringify({ d: "2026-10-21", k: { "rq|lecture|hash": 1 } }),
  "uqu-aiq": JSON.stringify([{ k: "rq", key: "rq|lecture|hash", a: { id: "lecture", key: "mock-kimi-secret", text: "private lecture" }, pr: 3, at: 1, n: 0, next: 0 }, { k: "hk", key: "hk|lecture", a: { id: "lecture", q0: "private bookmark question" } }]),
  "uqu-runlim": JSON.stringify({ lim: { conc: 1, at: 1, key: "mock-sync-secret" }, cap: { fmt: "schema", key: "mock-sync-secret" } })
};

test("configuration, timezone and lifetime reject malformed or infinite values", () => {
  assert(validConfig(cfg)); for (const bad of [null, {}, [], { ...cfg, ai: { key: "" } }, { ...cfg, fb: { key: "" } }]) assert(!validConfig(bad));
  for (const key of ["a".repeat(19), "a".repeat(769), "contains spaces long enough", "مفتاحمزامنةطويلجدًاواختبار", 123]) assert(!validConfig({ ...cfg, fb: { ...cfg.fb, key } }));
  for (const key of ["a".repeat(20), "a".repeat(200), "a".repeat(768)]) assert(validConfig({ ...cfg, fb: { ...cfg.fb, key } }));
  for (const apiKey of [undefined, "", " ", 123, {}, "a".repeat(301)]) assert(!validConfig({ ...cfg, fb: { ...cfg.fb, config: { ...cfg.fb.config, apiKey } } }));
  for (const databaseURL of [undefined, {}, "https://evil.example", "https://firebaseio.com", "https://a.firebaseio.com.evil.example", "http://a.firebaseio.com", "https://user:pass@a.firebaseio.com", "https://a.firebaseio.com:8443", "https://a.firebaseio.com/path", "https://a.firebaseio.com?x=1", "https://a.firebaseio.com/#fragment"]) assert(!validConfig({ ...cfg, fb: { ...cfg.fb, config: { ...cfg.fb.config, databaseURL } } }));
  for (const databaseURL of ["https://example.firebaseio.com/", "https://project-default-rtdb.europe-west1.firebasedatabase.app"]) assert(validConfig({ ...cfg, fb: { ...cfg.fb, config: { ...cfg.fb.config, databaseURL } } }));
  assert.equal(timezone("Invalid/Timezone"), "Asia/Riyadh"); assert.equal(timezone("Etc/UTC"), "Etc/UTC");
  assert.equal(runnerMinutes("Infinity"), 50); assert.equal(runnerMinutes("10000"), 55); assert.equal(runnerMinutes("-1"), 50);
});
test("mask commands escape workflow control characters and redaction covers encoded secrets", () => {
  const secret = "secret%\n::error::value"; assert.equal(escapeCommand(secret), "secret%25%0A::error::value");
  assert.doesNotThrow(()=>secretValues({key:"\ud800"})); const values = secretValues({ key: secret }); assert(!redact("Error " + secret + " " + encodeURIComponent(secret), values).includes("secret"));
});
test("cache whitelist never retains credentials, free text, bookmark questions or arbitrary keys", () => {
  const clean = safeState(sampleState), text = JSON.stringify(clean);
  for (const forbidden of ["must-not-restore", "mock-kimi-secret", "mock-github-secret", "mock-sync-secret", "private lecture", "private bookmark question", '"uqu-ai"', '"uqu-fb"']) assert(!text.includes(forbidden), forbidden);
  assert.equal(JSON.parse(clean["uqu-aiq"])[0].a.id, "lecture"); assert.equal(JSON.parse(clean["uqu-aiq"]).length, 1);
  assert.deepEqual(safeState([]), {}); assert.deepEqual(safeState({ "uqu-aiq": "not JSON" }), {});
});
test("missing setup is a quiet no-op, configured invalid setup fails", async () => {
  assert.equal(await runRunner({}), 0); assert.equal(await runRunner({ UQU_RUNNER: "{" }), 1); for(const value of ["{}","null","[]","42",JSON.stringify("text")]) assert.equal(await runRunner({ UQU_RUNNER: value }), 1);
});
test("browser launch failure closes transport, removes profile and frees the listening socket", async () => {
  const stub = browserStub({ launchError: "launch failed" }), agent = transport();
  assert.equal(await runRunner(env, { playwright: stub.playwright, dispatcher: agent }), 1);
  assert(!fs.existsSync(stub.calls.profile)); assert(agent.closed);
});
test("navigation failure still closes browser/profile/server and emits no mock credentials", async () => {
  const stub = browserStub({ navigationError: "navigation mock-kimi-secret failed" }), agent = transport(), logs = [], original = console.log;
  try { console.log = (...args) => logs.push(args.join(" ")); assert.equal(await runRunner(env, { playwright: stub.playwright, dispatcher: agent }), 1); } finally { console.log = original; }
  assert(stub.calls.closed); assert(!fs.existsSync(stub.calls.profile)); assert(agent.closed); assert(!logs.join("\n").includes("mock-kimi-secret"));
  await assert.rejects(fetch(stub.calls.url));
});
test("failure in browser cleanup does not skip remaining resource cleanup", async () => {
  const stub = browserStub({ closeError: "close failed" }), agent = transport();
  assert.equal(await runRunner(env, { playwright: stub.playwright, dispatcher: agent }), 1); assert(agent.closed); assert(!fs.existsSync(stub.calls.profile));
  await assert.rejects(fetch(stub.calls.url));
});
test("successful runtime writes a sanitized atomic snapshot and keeps browser web security enabled", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "runner-test-")), statePath = path.join(temp, "state.json"), stub = browserStub({ state: sampleState }), agent = transport();
  try {
    fs.writeFileSync(statePath, JSON.stringify(sampleState)); assert.equal(await runRunner({ ...env, RUNNER_STATE: statePath }, { playwright: stub.playwright, dispatcher: agent }), 0);
    assert(!stub.calls.options.args.includes("--disable-web-security")); assert(!fs.existsSync(stub.calls.profile)); assert(agent.closed);
    assert.deepEqual(stub.calls.init.data.st, safeState(sampleState)); const snapshot = fs.readFileSync(statePath, "utf8");
    assert(!snapshot.includes("secret")); assert(!snapshot.includes("private")); assert.equal(fs.readdirSync(temp).length, 1); assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
    let aborted = false, continued = false;
    await stub.calls.route({ request: () => ({ isNavigationRequest: () => true, frame: () => ({ parentFrame: () => null }), url: () => "https://untrusted.example/" }), abort: () => { aborted = true; }, continue: () => { continued = true; } });
    assert(aborted); assert(!continued);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
test("same-origin bridge permits only fixed authenticated Kimi endpoints and preserves stream/status headers", async () => {
  const seen = [], bridge = await serveSite("<html>ok</html>", { aiKey: "mock-kimi-secret", upstreamFetch: async (url, init) => { seen.push({ url, init }); return new Response('data: {"ok":true}\n\n', { status: 429, headers: { "content-type": "text/event-stream", "retry-after": "3" } }); } });
  try {
    assert.equal((await fetch(bridge.url)).status, 200); assert.equal((await fetch(new URL("/unexpected", bridge.url))).status, 404);
    assert.equal((await fetch(new URL("/__kimi/ai", bridge.url))).status, 405);
    assert.equal((await fetch(new URL("/__kimi/ai", bridge.url), { method: "POST" })).status, 403);
    assert.equal((await fetch(new URL("/__kimi/ai", bridge.url), { method: "POST", headers: { "x-uqu-runner": bridge.token, Origin: "https://untrusted.example" } })).status, 403);
    const response = await fetch(new URL("/__kimi/cn?target=https://untrusted.example", bridge.url), { method: "POST", headers: { "x-uqu-runner": bridge.token }, body: '{"stream":true}' });
    assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "3"); assert.equal(await response.text(), 'data: {"ok":true}\n\n');
    assert.equal(seen.length, 1); assert.equal(seen[0].url, "https://api.moonshot.cn/v1/chat/completions"); assert.equal(seen[0].init.redirect, "error"); assert.equal(seen[0].init.headers.Authorization, "Bearer mock-kimi-secret");
  } finally { await bridge.close(); }
});
test("bridge rejects DNS-rebinding Host headers and oversized request bodies", async () => {
  let forwarded = 0; const bridge = await serveSite("ok", { aiKey: "mock-kimi-secret", upstreamFetch: async () => { forwarded++; return new Response("ok"); } });
  try {
    const status = await new Promise((resolve, reject) => { const req = http.get(bridge.url, { headers: { Host: "untrusted.example" } }, res => { res.resume(); resolve(res.statusCode); }); req.on("error", reject); }); assert.equal(status, 403);
    const response = await fetch(new URL("/__kimi/ai", bridge.url), { method: "POST", headers: { "x-uqu-runner": bridge.token }, body: "x".repeat(4 * 1024 * 1024 + 1) }); assert.equal(response.status, 413); assert.equal(forwarded, 0);
  } finally { await bridge.close(); }
});

test("real Chromium forwards Kimi streams without disabling web security or making paid calls", async () => {
  const require = (await import("node:module")).createRequire(import.meta.url), playwright = require("playwright-core");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "runner-browser-test-")), hook = path.join(temp, "hook.mjs"), calls = [];
  const fixture = `<!doctype html><script>var live='fb',merged=true,AKRUN={},aiBusy=false,aiLive={};function spAll(){return{}}function spActive(){return false}function aiJobs(){return[]}fetch('https://api.moonshot.ai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer mock-kimi-secret','Content-Type':'application/json'},body:'{"stream":true}'}).then(async r=>{if((await r.text()).includes('stream ok'))window.__runnerDone=1;else throw new Error('stream missing')})</script>`;
  fs.writeFileSync(hook, `export default async ctx=>{await ctx.route('**/*',route=>new URL(route.request().url()).pathname==='/'?route.fulfill({contentType:'text/html',body:${JSON.stringify(fixture)}}):route.fallback())}`);
  try {
    const result = await runRunner({ ...env, CHROME_PATH: process.env.CHROMIUM_PATH || "/usr/bin/chromium", RUNNER_HOOK: hook, RUNNER_MAX_MIN: ".2" }, { playwright, fetch: async (url, init) => { calls.push({ url, auth: init.headers.Authorization }); return new Response('data: stream ok\n\n', { headers: { "content-type": "text/event-stream" } }); } });
    assert.equal(result, 0); assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://api.moonshot.ai/v1/chat/completions"); assert.equal(calls[0].auth, "Bearer mock-kimi-secret");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});


test("upstream transport respects inherited HTTPS proxy and exact/domain NO_PROXY entries", () => {
  const e={HTTPS_PROXY:"http://proxy.example:8080",NO_PROXY:"localhost,.internal.example"};
  assert.equal(proxyFor("https://api.moonshot.ai/v1/chat/completions",e),e.HTTPS_PROXY);
  assert.equal(proxyFor("https://a.internal.example",e),"");
  assert.equal(proxyFor("https://api.moonshot.ai",{...e,NO_PROXY:"*.moonshot.ai:443"}),"");
  assert.equal(proxyFor("https://api.moonshot.ai",{...e,NO_PROXY:"moonshot.ai:8443"}),e.HTTPS_PROXY);
});


test("a frozen page cannot bypass the runner deadline or retain its resources", async () => {
 const stub=browserStub({evaluateHang:true}),agent=transport(),start=Date.now();
 assert.equal(await runRunner(env,{playwright:stub.playwright,dispatcher:agent,operationTimeout:20}),1);
 assert(Date.now()-start<1000);assert(agent.closed);assert(stub.calls.closed);assert(!fs.existsSync(stub.calls.profile));
});

test("workflow marks missing runner configuration without exposing settings or starting work", async () => {
  const { execFileSync } = await import('node:child_process');
  const source = fs.readFileSync(new URL('../../.github/workflows/runner.yml', import.meta.url),'utf8');
  const block=source.match(/      - name: Check background runner configuration[\s\S]*?        run: \|\n([\s\S]*?)\n      - /);
  assert(block);const script=block[1].split('\n').map(s=>s.replace(/^          /,'')).join('\n');
  for(const value of ['', ' \n\t ', 'mock-runner-config-secret']){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'uqu-workflow-'));
    try{
      const output=path.join(dir,'output'),summary=path.join(dir,'summary');
      const log=execFileSync('bash',['-e','-c',script],{encoding:'utf8',env:{...process.env,UQU_RUNNER:value,GITHUB_OUTPUT:output,GITHUB_STEP_SUMMARY:summary}});
      const configured=!!value.trim();assert.equal(fs.readFileSync(output,'utf8').trim(),'configured='+configured);
      if(!configured){assert(log.includes('::warning::'));assert(fs.readFileSync(summary,'utf8').includes('No lecture splitting'));}else{assert(!log.includes(value));assert(!fs.existsSync(summary));}
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
