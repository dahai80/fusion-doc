// =============================================================================
// Fusion-Doc — CORS middleware
// Supports configurable allowed origins; production must configure CORS_ORIGINS
// =============================================================================

const { version: APP_VERSION } = require('../../package.json');

function getOrigins(config) {
  const configured = config?.cors?.origins;
  if (!configured || configured.length === 0) {
    // Production: with no config, only allow local access
    if (process.env.NODE_ENV === 'production') {
      return ['http://localhost:11449', 'http://127.0.0.1:11449'];
    }
    return ['*'];
  }
  return configured;
}

function cors(req, res, pipeline) {
  const origins = getOrigins(req.ctx?.config);
  const origin = req.headers['origin'];

  // P3-37: only echo ACAO when the request origin matches the allowlist; otherwise omit the header (browser cross-origin request is rejected)
  // Wildcard '*' mode carries no credentials, which is safe; only exact-match mode echoes the specific origin
  let allowOrigin = null;
  let wildcard = false;
  if (origins.includes('*')) {
    allowOrigin = '*';
    wildcard = true;
  } else if (origin) {
    if (origins.includes(origin)) {
      allowOrigin = origin;
    } else {
      // Wildcard subdomain match: *.example.com → matches only subdomains of example.com, not evilexample.com
      for (const o of origins) {
        if (o.startsWith('*.')) {
          const suffix = o.slice(1); // .example.com
          // R20 fix: exact dot-delimited anchoring. The origin hostname without port must satisfy:
          //   (a) hostname === the suffix root domain itself, or
          //   (b) hostname ends with ".example.com" (a dot boundary before the subdomain),
          // preventing the evil-example.com endsWith('.example.com') bypass.
          let host = origin;
          try { host = new URL(origin).hostname; } catch (_) { continue; }
          if (host === suffix.slice(1) || host.endsWith(suffix)) {
            allowOrigin = origin; break;
          }
        }
      }
    }
  }

  if (allowOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowOrigin);
    // Only exact origin matches (not *) may carry credentials
    if (!wildcard) res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Fusion-Doc', APP_VERSION);

  // Return preflight requests directly
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true; // Stop the pipeline
  }

  return false; // Continue the pipeline
}

module.exports = { cors };