import { Agent, ProxyAgent } from "undici";

export function proxyFor(url, env = process.env) {
  const u = new URL(url), host = u.hostname.toLowerCase(), port = u.port || (u.protocol === "https:" ? "443" : "80");
  const exclusions = String(env.no_proxy || env.NO_PROXY || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (exclusions.some(entry => {
    if (entry === "*") return true;
    const split = entry.lastIndexOf(":"), hasPort = split >= 0;
    if (hasPort && entry.slice(split + 1) !== port) return false;
    const name = (hasPort ? entry.slice(0, split) : entry).replace(/^\*?\./, "");
    return host === name || host.endsWith("." + name);
  })) return "";
  return u.protocol === "https:" ? env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY || "" : env.http_proxy || env.HTTP_PROXY || "";
}
export function createTransport(env = process.env) {
  const agents = new Map();
  return {
    forURL(url) { const proxy = proxyFor(url, env); if (!agents.has(proxy)) agents.set(proxy, proxy ? new ProxyAgent(proxy) : new Agent()); return agents.get(proxy); },
    async close() { await Promise.all([...agents.values()].map(agent => agent.close())); }
  };
}
