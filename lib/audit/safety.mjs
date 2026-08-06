import dns from "node:dns/promises";
import net from "node:net";

const IPV4_BLOCKS = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];

function ipv4Number(address) {
  return address.split(".").reduce((value, octet) => ((value << 8) + Number(octet)) >>> 0, 0);
}

function ipv4InBlock(address, base, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

export function isBlockedAddress(address) {
  const kind = net.isIP(address);
  if (kind === 4) return IPV4_BLOCKS.some(([base, prefix]) => ipv4InBlock(address, base, prefix));
  if (kind !== 6) return true;
  const value = address.toLowerCase().split("%")[0];
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")) return true;
  if (value.startsWith("ff")) return true;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isBlockedAddress(mapped[1]) : false;
}

export function validateUrlShape(value, target) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid URL: ${value}`);
  }
  if (url.protocol !== "https:") throw new Error(`Only HTTPS targets are allowed: ${url.href}`);
  if (url.username || url.password) throw new Error(`Credentials in URLs are forbidden: ${url.href}`);
  if (url.port && url.port !== "443") throw new Error(`Non-standard port is forbidden: ${url.href}`);
  const hosts = new Set(target.allowedHosts.map((host) => host.toLowerCase()));
  if (!hosts.has(url.hostname.toLowerCase())) throw new Error(`Host is outside the exact allowlist: ${url.hostname}`);
  const allowedPath = target.allowedPathPrefixes.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
  if (!allowedPath) throw new Error(`Path is outside the allowlist: ${url.pathname}`);
  return url;
}

export async function assertUrlAllowed(value, target, lookup = dns.lookup) {
  const url = validateUrlShape(value, target);
  if (net.isIP(url.hostname)) {
    if (isBlockedAddress(url.hostname)) throw new Error(`Private or reserved IP target is forbidden: ${url.hostname}`);
    return url;
  }
  const results = await lookup(url.hostname, { all: true, verbatim: true });
  if (!results.length) throw new Error(`Target hostname did not resolve: ${url.hostname}`);
  const blocked = results.find(({ address }) => isBlockedAddress(address));
  if (blocked) throw new Error(`Target resolved to a private or reserved address: ${blocked.address}`);
  return url;
}

export async function safeFetch(value, target, { timeoutMs = 12000, maxRedirects = 5, method = "GET", fetchImpl = fetch, lookup = dns.lookup } = {}) {
  if (!new Set(["GET", "HEAD"]).has(method)) throw new Error(`Unsafe HTTP method rejected: ${method}`);
  let current = await assertUrlAllowed(value, target, lookup);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    let response;
    try {
      response = await fetchImpl(current, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "SiteScoutAudit/1.0 (+read-only; quality validation)", accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      });
    } finally {
      clearTimeout(timer);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: current.href, redirects: hop };
    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect ${response.status} had no Location header: ${current.href}`);
    if (hop === maxRedirects) throw new Error(`Redirect limit exceeded: ${value}`);
    current = await assertUrlAllowed(new URL(location, current).href, target, lookup);
  }
  throw new Error(`Request failed unexpectedly: ${value}`);
}
