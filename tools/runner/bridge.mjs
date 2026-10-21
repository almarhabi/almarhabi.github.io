import http from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { nonce } from "./safety.mjs";

const TARGETS = Object.freeze({ ai: "https://api.moonshot.ai/v1/chat/completions", cn: "https://api.moonshot.cn/v1/chat/completions" });
export const KIMI_TARGETS = TARGETS;
const MAX_BODY = 4 * 1024 * 1024;

// Only the exact Kimi completion endpoints use this same-origin streaming bridge. Browser web security stays enabled;
// an endpoint cannot become an arbitrary proxy, and upstream redirects never receive credentials.
export async function serveSite(html, { aiKey, upstreamFetch, dispatcher, signal } = {}) {
  const token = nonce(), active = new Set();
  let host = "";
  const server = http.createServer(async (req, res) => {
    const reply = (status, message) => { if (!res.headersSent) res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); res.end(message); };
    if (req.headers.host !== host) { reply(403, "Invalid host"); return; }
    const pathname = String(req.url || "").split("?")[0];
    if (pathname === "/" && req.method === "GET") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }); res.end(html); return; }
    const key = pathname === "/__kimi/ai" ? "ai" : pathname === "/__kimi/cn" ? "cn" : "";
    if (!key) { reply(404, "Not found"); return; }
    if (req.method !== "POST") { reply(405, "POST required"); return; }
    if (req.headers["x-uqu-runner"] !== token || req.headers.origin && req.headers.origin !== `http://${host}`) { reply(403, "Forbidden"); return; }
    const ctl = new AbortController(); active.add(ctl);
    const stop = () => ctl.abort(); res.once("close", stop);
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_BODY) { reply(413, "Request too large"); return; } chunks.push(chunk); }
      const response = await upstreamFetch(TARGETS[key], { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + aiKey }, body: Buffer.concat(chunks), redirect: "error", dispatcher: dispatcher && typeof dispatcher.forURL === "function" ? dispatcher.forURL(TARGETS[key]) : dispatcher,
        signal: AbortSignal.any([ctl.signal, signal || new AbortController().signal, AbortSignal.timeout(15 * 60_000)]) });
      const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
      for (const k of ["content-type", "retry-after", "x-ratelimit-reset"]) if (response.headers.has(k)) headers[k] = response.headers.get(k);
      res.writeHead(response.status, headers);
      if (response.body) await pipeline(Readable.fromWeb(response.body), res); else res.end();
    } catch {
      if (!res.headersSent && !res.destroyed) reply(502, "The Kimi request failed"); else res.destroy();
    } finally { active.delete(ctl); res.removeListener("close", stop); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  host = `127.0.0.1:${server.address().port}`;
  return { url: `http://${host}/`, origin: `http://${host}`, token,
    close: async () => { for (const ctl of active) ctl.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
