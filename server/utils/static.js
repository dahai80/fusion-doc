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

// issue #60: 深链修复。构建产物 base 为 './' (根部署 + /shell/ 子路径共用一份),
// 直接访问 /page/<uuid> 时浏览器把 ./assets 解析到 /page/assets/ — 又落回 SPA
// fallback 拿到 text/html, MIME 报错白屏。由调用方计算正确的挂载根
// (根部署深链为 '/', 网关 shell 代理为 /shell/<id>/), 此处只负责安全注入。
function serveSPA(res, publicDir, baseHref) {
    const indexPath = path.join(publicDir, 'index.html');
    fs.readFile(indexPath, (_, data) => {
        if (_) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'SPA index.html not found' }));
            return;
        }
        // 只接受安全前缀: 以 / 开头的纯路径段序列 (含单独 '/'), 拒绝 .. 段 / 编码注入
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