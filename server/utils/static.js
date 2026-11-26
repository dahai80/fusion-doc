// =============================================================================
// Fusion-Doc — static file serving
// Modeled on MacDown's native macOS response design
// =============================================================================

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

// R1 fix: path sandbox. Every static request must resolve inside publicDir; reject .. traversal and symlink escapes.
// The old design let path.join(publicDir, '/branding/../../.env') read the project-root .env and leak secrets.
function isPathSafe(publicDir, targetPath) {
  const root = path.resolve(publicDir);
  const resolved = path.resolve(targetPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return false;
  }
  try {
    // Key point: publicDir itself may contain symlinks (e.g. macOS /tmp → /private/tmp),
    // so compare against realRoot, otherwise legitimate root paths are misjudged as escaping.
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(resolved);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return false;
  } catch (_) {
    return false;
  }
  return true;
}

function serveStatic(res, filePath, publicDir) {
  if (!publicDir || !isPathSafe(publicDir, filePath)) {
    console.error(`[static] Rejected path outside public dir: ${filePath}`);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

// issue #60: deep-link fix. The build output uses base './' (one build shared by root deployment and the /shell/ subpath),
// so visiting /page/<uuid> directly makes the browser resolve ./assets to /page/assets/ — which falls back to the SPA
// fallback, gets text/html, and shows a blank page on MIME errors. The caller computes the correct mount root
// ('/' for root-deployment deep links, /shell/<id>/ behind the gateway shell proxy); this function only injects it safely.
function serveSPA(res, publicDir, baseHref) {
    const indexPath = path.join(publicDir, 'index.html');
    fs.readFile(indexPath, (_, data) => {
        if (_) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'SPA index.html not found' }));
            return;
        }
        // Only accept safe prefixes: plain path segment sequences starting with / (including a bare '/'); reject .. segments / encoded injection
        const safeHref = typeof baseHref === 'string'
            && /^\/(?:[A-Za-z0-9\-._]+\/)*$/.test(baseHref)
            && !/(^|\/)\.\.(\/|$)/.test(baseHref)
            ? baseHref
            : null;
        let html = data;
        if (safeHref) {
            const text = data.toString('utf8');
            const injected = text.replace(
                /<head([^>]*)>/i,
                `<head$1>\n    <base href="${safeHref}">`
            );
            if (injected !== text) {
                html = Buffer.from(injected, 'utf8');
                console.log(`[static] SPA fallback -> base href="${safeHref}"`);
            }
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    });
}

module.exports = { serveStatic, serveSPA, isPathSafe, MIME };