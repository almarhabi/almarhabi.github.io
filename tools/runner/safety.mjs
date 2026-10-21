import crypto from "node:crypto";

export const STATE_KEYS = ["uqu-aiuse", "uqu-aitry", "uqu-aiq", "uqu-runlim"];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = v => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v, max = Number.MAX_SAFE_INTEGER) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;
const cleanJSON = s => { try { return typeof s === "string" && s.length <= 250_000 ? JSON.parse(s) : null; } catch { return null; } };
const jobKinds = new Set(["am", "rq", "wk"]);
const jobId = v => typeof v === "string" && /^[\w.-]{1,100}$/.test(v) && !["__proto__", "constructor", "prototype"].includes(v);

export const escapeCommand = value => String(value).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
export function secretValues(value) {
  const out = new Set(), seen = new WeakSet(), stack = [value];
  while (stack.length) {
    const next = stack.pop();
    if (typeof next === "string" && next) { out.add(next); out.add(JSON.stringify(next).slice(1, -1)); try { out.add(encodeURIComponent(next)); } catch { /* an invalid Unicode scalar still has raw/JSON redaction */ } }
    else if (next && typeof next === "object" && !seen.has(next)) { seen.add(next); for (const value of Object.values(next)) stack.push(value); }
  }
  return [...out].sort((a, b) => b.length - a.length);
}
export async function deadline(promise, milliseconds, message = "Runner operation timed out") {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

export function redact(text, secrets) {
  let clean = String(text);
  for (const value of secrets) if (value) clean = clean.split(value).join("***");
  return clean.slice(0, 400);
}
export function validConfig(cfg) {
  if (!object(cfg) || cfg.v !== 1 || !object(cfg.fb) || !object(cfg.fb.config) || !object(cfg.ai)) return false;
  if (typeof cfg.fb.key !== "string" || !/^[A-Za-z0-9_-]{20,768}$/.test(cfg.fb.key)) return false;
  if (typeof cfg.ai.key !== "string" || !/^[\x21-\x7e]{12,300}$/.test(cfg.ai.key)) return false;
  const config = cfg.fb.config;
  if (typeof config.apiKey !== "string" || !config.apiKey.trim() || config.apiKey.length > 300) return false;
  if (config.projectId != null && (typeof config.projectId !== "string" || !/^[a-z][a-z0-9-]{3,62}$/.test(config.projectId))) return false;
  if (typeof config.databaseURL !== "string") return false;
  try {
    const url = new URL(config.databaseURL);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && url.pathname === "/" && !url.search && !url.hash && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname);
  } catch { return false; }
}
export function timezone(value) {
  try { if (typeof value === "string") { new Intl.DateTimeFormat("en", { timeZone: value }); return value; } } catch { /* use the site's default */ }
  return "Asia/Riyadh";
}
export function runnerMinutes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(.01, Math.min(55, n)) : 50;
}

// Restore only bounded, structurally validated meter/scheduler fields. A poisoned cache can never seed credentials,
// application state, arbitrary localStorage entries or extra request arguments into a fresh runner.
export function safeState(input) {
  if (!object(input)) return {};
  const state = {};
  const usage = cleanJSON(input["uqu-aiuse"]);
  if (object(usage) && object(usage.d) && object(usage.t)) {
    const meter = x => object(x) && ["i", "c", "o", "n"].every(k => finite(x[k] ?? 0, 1e15));
    const d = Object.fromEntries(Object.entries(usage.d).filter(([k, v]) => /^\d{4}-\d\d-\d\d$/.test(k) && meter(v)).sort().slice(-30).map(([k, v]) => [k, Object.fromEntries(["i", "c", "o", "n"].map(f => [f, v[f] || 0]))]));
    if (meter(usage.t)) state["uqu-aiuse"] = JSON.stringify({ d, t: Object.fromEntries(["i", "c", "o", "n"].map(k => [k, usage.t[k] || 0])), log: [] });
  }
  const tries = cleanJSON(input["uqu-aitry"]);
  if (object(tries) && /^\d{4}-\d\d-\d\d$/.test(tries.d || "") && object(tries.k)) {
    const k = Object.fromEntries(Object.entries(tries.k).filter(([key, n]) => /^[\w|.-]{1,180}$/.test(key) && finite(n, 100)).slice(-500));
    state["uqu-aitry"] = JSON.stringify({ d: tries.d, k });
  }
  const queue = cleanJSON(input["uqu-aiq"]);
  if (Array.isArray(queue)) {
    const jobs = queue.slice(-40).flatMap(j => {
      if (!object(j) || !jobKinds.has(j.k) || typeof j.key !== "string" || !/^[\w|.-]{1,180}$/.test(j.key) || !object(j.a) || !j.key.startsWith(j.k + "|")) return [];
      const a = {};
      if (j.k === "rq" && jobId(j.a.id)) a.id = j.a.id;
      else if (j.k === "rq") return [];
      if (j.k === "am" && /^\d{4}-\d\d-\d\d$/.test(j.a.d || "")) a.d = j.a.d;
      if (j.k === "wk" && /^\d{4}-\d\d-\d\d$/.test(j.a.ws || "")) a.ws = j.a.ws;

      return [{ k: j.k, key: j.key, a, pr: finite(j.pr, 100) ? j.pr : 5, at: finite(j.at) ? j.at : 0, n: finite(j.n, 5) ? j.n : 0, next: finite(j.next) ? j.next : 0 }];
    });
    state["uqu-aiq"] = JSON.stringify(jobs);
  }
  const limits = cleanJSON(input["uqu-runlim"]);
  if (object(limits)) {
    const lim = object(limits.lim) ? Object.fromEntries(["at", "conc", "rpm", "tpm"].filter(k => finite(limits.lim[k])).map(k => [k, limits.lim[k]])) : null;
    const cap = object(limits.cap) ? Object.fromEntries(["mt", "eff", "fmt"].filter(k => own(limits.cap, k) && (typeof limits.cap[k] === "boolean" || ["schema", "object", "text", 1].includes(limits.cap[k]))).map(k => [k, limits.cap[k]])) : null;
    state["uqu-runlim"] = JSON.stringify({ lim, cap });
  }
  return state;
}
export function nonce() { return crypto.randomBytes(24).toString("hex"); }
