// ☁️ The GitHub runner (.github/workflows/runner.yml).
// It opens the study site (this checkout's index.html) in headless Chrome as one more "device" of yours. The page, in runner
// mode, does what your devices asked (split a lecture, make an ANKI deck) and the background analysis, syncs it, and says when
// it's done; then this closes it. Everything it needs comes from ONE secret, UQU_RUNNER, made by the site
// (Settings → 🤖 → ☁️ الشغل أونلاين). No key is ever printed (every value is masked) or saved between runs.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const MAX_MS = Math.max(1, +process.env.RUNNER_MAX_MIN || 50) * 60e3;
const STATE = process.env.RUNNER_STATE || "";                    // small, key-free state kept between runs (usage, tries, limits)
const STATE_KEYS = ["uqu-aiuse", "uqu-aitry", "uqu-aiq", "uqu-runlim"];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- the secret
const raw = (process.env.UQU_RUNNER || "").trim();
if (!raw) {   // not set up yet: a quiet success, so the hourly schedule doesn't flood you with failure emails
  console.log("::notice::UQU_RUNNER is not set yet. Make it from the site: Settings → 🤖 → ☁️ الشغل أونلاين على GitHub.");
  process.exit(0);
}
let cfg;
try { cfg = JSON.parse(raw); } catch (e) { console.log("::warning::UQU_RUNNER is not valid JSON. Copy it again from the site."); process.exit(0); }
const secrets = [];
const mask = v => { if (typeof v === "string") { if (v.length >= 6) { secrets.push(v); console.log("::add-mask::" + v); } } else if (v && typeof v === "object") Object.values(v).forEach(mask); };
mask(cfg);
const GH = process.env.GH_TOKEN || "";
if (GH) { secrets.push(GH); console.log("::add-mask::" + GH); }
const clean = t => { let s = String(t); for (const k of secrets) s = s.split(k).join("***"); return s.slice(0, 400); };
const ok = cfg && cfg.v === 1 && cfg.fb && cfg.fb.config && typeof cfg.fb.key === "string" && cfg.ai && typeof cfg.ai.key === "string";
if (!ok) { console.log("::warning::UQU_RUNNER is missing parts (sync, Kimi). Copy it again from the site."); process.exit(0); }

// ---- Chrome
let pw;
try { pw = require("playwright-core"); } catch (e) { pw = require(process.env.PW_MODULE || "playwright"); }
const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => p && fs.existsSync(p));

// ---- the site, served from this checkout (same code as the live site)
const html = fs.readFileSync(path.join(ROOT, "index.html"));
const srv = http.createServer((q, s) => {
  if (q.url === "/" || q.url.startsWith("/?") || q.url.startsWith("/#")) { s.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); s.end(html); }
  else { s.writeHead(404); s.end(); }
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${srv.address().port}/`;

let state = {};
if (STATE) try { state = JSON.parse(fs.readFileSync(STATE, "utf8")) || {}; } catch (e) { state = {}; }

const prof = fs.mkdtempSync(path.join(os.tmpdir(), "uqu-runner-"));
const ctx = await pw.chromium.launchPersistentContext(prof, {
  headless: true, ...(chrome ? { executablePath: chrome } : {}),
  args: ["--disable-web-security", "--no-first-run", "--no-default-browser-check"],   // only our own page runs here; Kimi is called straight from it
  timezoneId: typeof cfg.tz === "string" && /^[A-Za-z_]+\/[A-Za-z_\/-]+$/.test(cfg.tz) ? cfg.tz : "Asia/Riyadh",
  viewport: { width: 1024, height: 900 },
});
await ctx.addInitScript(({ c, gh, repo, st }) => {
  try {
    const L = localStorage;
    if (!L.getItem("uqu-runner")) for (const k in st) if (typeof st[k] === "string") L.setItem(k, st[k]);
    L.setItem("uqu-runner", "1"); L.setItem("uqu-dev", "ghrunner"); L.setItem("uqu-sfx", "0"); L.setItem("uqu-csimg", c.ai.img ? "1" : "0");
    L.setItem("uqu-fb", JSON.stringify({ config: c.fb.config, key: c.fb.key }));
    let lim = null; try { lim = JSON.parse(L.getItem("uqu-runlim") || "null"); } catch (e) { }
    L.setItem("uqu-ai", JSON.stringify({ key: c.ai.key, host: c.ai.host === "cn" ? "cn" : "ai", gas: c.ai.gas || "", gtok: c.ai.gtok || "", gdir: c.ai.gdir || "",
      budget: +c.ai.budget || 300000, gh, ghr: repo, auto: true, ...(lim && lim.lim ? { lim: lim.lim } : {}), ...(lim && lim.cap ? { cap: lim.cap } : {}) }));
  } catch (e) { }
}, { c: cfg, gh: GH, repo: process.env.GITHUB_REPOSITORY || "", st: state });
if (process.env.RUNNER_HOOK) { const h = await import(pathToFileURL(path.resolve(process.env.RUNNER_HOOK)).href); await h.default(ctx); }   // tests only

const page = ctx.pages()[0] || await ctx.newPage();
page.on("pageerror", e => log("page crash:", clean(e)));
page.on("console", m => { if ((m.type() === "error" || m.type() === "warning") && !/Failed to load resource/.test(m.text())) log("page " + m.type() + ":", clean(m.text())); });   // a 429 or 404 the page handles is not news
const t0 = Date.now();
await page.goto(url);
log("runner started");

let last = "", done = false;
while (Date.now() - t0 < MAX_MS) {
  await new Promise(r => setTimeout(r, 5000));
  let st;
  try {
    st = await page.evaluate(() => {
      const sp = Object.values(spAll()).filter(spActive).length, ak = Object.keys(AKRUN).length, q = aiJobs().length;
      return { done: !!window.__runnerDone, live: typeof live === "string" ? live : String(live), merged: !!merged, sp, ak, ai: aiBusy ? aiLive.k || "busy" : "", q };
    });
  } catch (e) { log("page gone:", clean(e)); break; }
  const line = `sync=${st.live}${st.merged ? "" : " (waiting)"} split=${st.sp} anki=${st.ak} ai=${st.ai || "-"} queue=${st.q}`;
  if (line !== last) { log(line); last = line; }
  if (st.done) { done = true; break; }
}
log(done ? "all done" : "time is up: what's left continues next run");

// keep the small state (never a key), then close
try {
  const kept = await page.evaluate(keys => {
    const o = {}; keys.forEach(k => { const v = localStorage.getItem(k); if (v != null) o[k] = v; });
    try { const a = JSON.parse(localStorage.getItem("uqu-ai") || "{}"); o["uqu-runlim"] = JSON.stringify({ lim: a.lim || null, cap: a.cap || null }); } catch (e) { }
    localStorage.removeItem("uqu-ai"); localStorage.removeItem("uqu-fb");
    return o;
  }, STATE_KEYS);
  if (STATE) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(kept)); }
} catch (e) { log("state not saved:", clean(e)); }
await ctx.close().catch(() => { });
fs.rmSync(prof, { recursive: true, force: true });
srv.close();
process.exit(0);
