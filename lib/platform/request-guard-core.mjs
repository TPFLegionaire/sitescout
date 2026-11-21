/** Request-boundary rules the Worker applies before any application route runs. */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TRUSTED_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * True when a state-changing request did not come from this application's own
 * origin. Browsers label every request with Sec-Fetch-Site, which page script
 * cannot set, so it decides when present; Origin covers browsers that do not
 * send it. A client that sends neither is not a browser, carries no ambient
 * session, and is not a forgery vector.
 */
export function isCrossOriginWrite({ method, url, origin, secFetchSite }) {
  if (SAFE_METHODS.has(String(method ?? "").toUpperCase())) return false;
  const fetchSite = String(secFetchSite ?? "").trim().toLowerCase();
  if (fetchSite) return !TRUSTED_FETCH_SITES.has(fetchSite);
  const source = String(origin ?? "").trim();
  if (!source) return false;
  try {
    return new URL(source).origin !== new URL(url).origin;
  } catch {
    return true;
  }
}

/**
 * Content Security Policy for one response. The nonce must be fresh per
 * request: vinext reads it from the request header and stamps it on the inline
 * scripts it emits, so only those scripts and same-origin files may run.
 * `allowEval` exists for development servers only, where React and Vite
 * evaluate strings; a production build must never set it.
 */
export function contentSecurityPolicy(nonce, { allowEval = false } = {}) {
  if (typeof nonce !== "string" || !/^[A-Za-z0-9+/_-]{16,}={0,2}$/.test(nonce)) {
    throw new Error("A base64 nonce of at least 16 characters is required.");
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${allowEval === true ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
