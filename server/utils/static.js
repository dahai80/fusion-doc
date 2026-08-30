// =============================================================================
// Fusion-Doc — 静态文件服务
// 参考 MacDown 的 macOS 原生响应设计
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

// R1 修复: 路径沙箱。所有静态请求必须落在 publicDir 内, 拒绝 .. 越界与符号链接逃逸。
// 原设计 path.join(publicDir, '/branding/../../.env') 直读项目根 .env 窃取密钥。
function isPathSafe(publicDir, targetPath) {
  const root = path.resolve(publicDir);
  const resolved = path.resolve(targetPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return false;
  }
  try {
    // 关键: publicDir 本身可能含符号链接 (如 macOS /tmp → /private/tmp),
    // 必须用 realRoot 比较, 否则合法根路径被误判越界。
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
    console.error(`[static] 拒绝越界路径: ${filePath}`);
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

function serveSPA(res, publicDir) {
    const indexPath = path.join(publicDir, 'index.html');
    fs.readFile(indexPath, (_, data) => {
        if (_) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'SPA index.html not found' }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
    });
}

module.exports = { serveStatic, serveSPA, isPathSafe, MIME };