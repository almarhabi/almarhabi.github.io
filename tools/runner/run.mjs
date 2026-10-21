// Opens this checkout as a synchronized worker. No public-page navigation receives runner credentials.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetch as upstreamFetch } from "undici";
import { createTransport } from "./transport.mjs";
import { STATE_KEYS, escapeCommand, secretValues, redact, validConfig, timezone, runnerMinutes, safeState, deadline } from "./safety.mjs";
import { serveSite } from "./bridge.mjs";

const require = createRequire(import.meta.url), ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export async function runRunner(env = process.env, dependencies = {}) {
  const raw = (env.UQU_RUNNER || "").trim();
  if (!raw) { console.log("::notice::UQU_RUNNER is not set yet. Make it from the site's runner settings."); return 0; }
  if (raw.length > 64_000) { console.log("::warning::UQU_RUNNER is too large. Copy it again from the site."); return 1; }
  let cfg;
  try { cfg = JSON.parse(raw); } catch { console.log("::warning::UQU_RUNNER is not valid JSON. Copy it again from the site."); return 1; }
  const GH = env.GH_TOKEN || "", secrets = [...new Set([...secretValues(cfg).filter(s => s.length >= 6), ...secretValues([cfg?.fb?.key, cfg?.ai?.key, cfg?.ai?.gtok, GH])])];
  if (env.GITHUB_ACTIONS === "true") for (const secret of secrets) console.log("::add-mask::" + escapeCommand(secret));
  const log = (...values) => console.log(new Date().toISOString().slice(11, 19), ...values.map(v => redact(v, secrets)));
  if (!validConfig(cfg)) { console.log("::warning::UQU_RUNNER is missing valid sync or Kimi settings. Copy it again from the site."); return 1; }

  let ctx = null, bridge = null, profile = "", dispatcher = null, page = null, code = 0;
  const shutdown = new AbortController(), stop = () => shutdown.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  const statePath = env.RUNNER_STATE || "";
  const readPage = (fn, argument) => deadline(page.evaluate(fn, argument), dependencies.operationTimeout || 15_000);
  const saveState = async () => {
    if (!statePath || !page || page.isClosed()) return;
    const input = await readPage(keys => {
      const data = {}; for (const key of keys) data[key] = localStorage.getItem(key);
      try { const a = JSON.parse(localStorage.getItem("uqu-ai") || "{}"); data["uqu-runlim"] = JSON.stringify({ lim: a.lim || null, cap: a.cap || null }); } catch { /* ignore malformed limits */ }
      return data;
    }, STATE_KEYS);
    const clean = safeState(input), text = JSON.stringify(clean);
    if (secrets.some(secret => secret.length >= 6 && text.includes(secret))) throw new Error("State contained a credential; cache was not saved");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temp = statePath + ".tmp-" + process.pid;
    try { fs.writeFileSync(temp, text, { mode: 0o600 }); fs.renameSync(temp, statePath); } finally { fs.rmSync(temp, { force: true }); }
  };
  try {
    let pw = dependencies.playwright;
    if (!pw) { try { pw = require("playwright-core"); } catch { pw = require(env.PW_MODULE || "playwright"); } }
    dispatcher = dependencies.dispatcher || createTransport(env);
    bridge = await serveSite(fs.readFileSync(path.join(ROOT, "index.html")), { aiKey: cfg.ai.key, upstreamFetch: dependencies.fetch || upstreamFetch, dispatcher, signal: shutdown.signal });
    let state = {};
    if (statePath) try { if (fs.statSync(statePath).size <= 500_000) state = safeState(JSON.parse(fs.readFileSync(statePath, "utf8"))); } catch { state = {}; }
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "uqu-runner-"));
    const chrome = [env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => p && fs.existsSync(p));
    ctx = await pw.chromium.launchPersistentContext(profile, { headless: true, ...(chrome ? { executablePath: chrome } : {}),
      args: ["--no-first-run", "--no-default-browser-check"], timeout: 45_000, timezoneId: timezone(cfg.tz), viewport: { width: 1024, height: 900 } });
    await ctx.route("**/*", route => {
      const req = route.request();
      if (req.isNavigationRequest() && !req.frame().parentFrame() && new URL(req.url()).origin !== bridge.origin) return route.abort("blockedbyclient");
      return route.continue();
    });
    ctx.on("page", opened => { if (page && opened !== page) opened.close().catch(() => {}); });
    await ctx.addInitScript(({ c, gh, repo, st, origin, nonce }) => {
      if (location.origin !== origin || window.top !== window) return;
      const nativeFetch = window.fetch.bind(window), targets = { "https://api.moonshot.ai/v1/chat/completions": "ai", "https://api.moonshot.cn/v1/chat/completions": "cn" };
      window.fetch = (input, init) => {
        const address = typeof input === "string" || input instanceof URL ? String(input) : input.url, key = targets[address];
        if (!key) return nativeFetch(input, init);
        const headers = new Headers(init && init.headers || (input instanceof Request ? input.headers : undefined)); headers.set("X-UQU-Runner", nonce);
        const url = origin + "/__kimi/" + key;
        return nativeFetch(input instanceof Request ? new Request(url, input) : url, { ...init, headers });
      };
      const L = localStorage;
      for (const key in st) if (typeof st[key] === "string") L.setItem(key, st[key]);
      L.setItem("uqu-runner", "1"); L.setItem("uqu-dev", "ghrunner"); L.setItem("uqu-sfx", "0"); L.setItem("uqu-csimg", c.ai.img ? "1" : "0");
      L.setItem("uqu-fb", JSON.stringify({ config: c.fb.config, key: c.fb.key }));
      let limits = {}; try { limits = JSON.parse(L.getItem("uqu-runlim") || "{}"); } catch { /* use empty limits */ }
      L.setItem("uqu-ai", JSON.stringify({ key: c.ai.key, host: c.ai.host === "cn" ? "cn" : "ai", gas: c.ai.gas || "", gtok: c.ai.gtok || "", gdir: c.ai.gdir || "", budget: +c.ai.budget || 300000, gh, ghr: repo, auto: true, ...(limits.lim ? { lim: limits.lim } : {}), ...(limits.cap ? { cap: limits.cap } : {}) }));
    }, { c: cfg, gh: GH, repo: env.GITHUB_REPOSITORY || "", st: state, origin: bridge.origin, nonce: bridge.token });
    if (env.RUNNER_HOOK) { const hook = await import(pathToFileURL(path.resolve(env.RUNNER_HOOK)).href); await hook.default(ctx); }
    page = ctx.pages()[0] || await ctx.newPage();
    let crash = false;
    page.on("pageerror", e => { crash = true; log("page crash:", e); });
    page.on("console", m => { if (["error", "warning"].includes(m.type()) && !/Failed to load resource/.test(m.text())) log("page " + m.type() + ":", m.text()); });
    await page.goto(bridge.url, { waitUntil: "domcontentloaded", timeout: 45_000 }); log("runner started");
    const start = Date.now(), max = runnerMinutes(env.RUNNER_MAX_MIN) * 60_000;
    let last = "", done = false, synced = false;
    while (Date.now() - start < max && !shutdown.signal.aborted) {
      if (crash) throw new Error("The runner page raised an uncaught exception");
      const st = await readPage(() => ({ done: !!window.__runnerDone, live: typeof live === "string" ? live : String(live), merged: !!merged,
        sp: Object.values(spAll()).filter(spActive).length, ak: Object.keys(AKRUN).length, ai: aiBusy ? aiLive.k || "busy" : "", q: aiJobs().length }));
      synced ||= st.merged;
      const line = `sync=${st.live}${st.merged ? "" : " (waiting)"} split=${st.sp} anki=${st.ak} ai=${st.ai || "-"} queue=${st.q}`;
      if (line !== last) { log(line); last = line; }
      if (st.done) { done = true; break; }
      if (!synced && Date.now() - start > 120_000) throw new Error("Firebase synchronization did not initialize within two minutes");
      await new Promise(resolve => { const timer = setTimeout(finish, 5_000); function finish() { clearTimeout(timer); shutdown.signal.removeEventListener("abort", finish); resolve(); } shutdown.signal.addEventListener("abort", finish, { once: true }); });
    }
    if (!done && !synced && !shutdown.signal.aborted) throw new Error("The runner ended without a synchronized state");
    log(done ? "all done" : "time is up: remaining work continues next run");
  } catch (error) { code = 1; log("runner failed:", error); }
  finally {
    try { await saveState(); } catch (error) { code = 1; log("state not saved:", error); }
    shutdown.abort();
    const cleanup = async (name, fn) => { try { await fn(); } catch (error) { code = 1; log(name + " cleanup failed:", error); } };
    if (ctx) await cleanup("browser", () => ctx.close());
    if (profile) await cleanup("profile", () => fs.rmSync(profile, { recursive: true, force: true }));
    if (bridge) await cleanup("server", () => bridge.close());
    if (dispatcher && typeof dispatcher.close === "function") await cleanup("transport", () => dispatcher.close());
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
  }
  return code;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runRunner();
