// =============================================================================
// Fusion-Doc — CORS 中间件
// 支持可配置的允许来源，生产环境需配置 CORS_ORIGINS
// =============================================================================

const { version: APP_VERSION } = require('../../package.json');

function getOrigins(config) {
  const configured = config?.cors?.origins;
  if (!configured || configured.length === 0) {
    // 生产环境：无配置时只允许本机访问
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

  // P3-37: 仅在请求来源命中白名单时才回送 ACAO; 未匹配则不设该头 (浏览器跨域请求被拒)
  // 通配符 '*' 模式下不携带凭据, 安全; 精确匹配模式才回显具体 origin
  let allowOrigin = null;
  let wildcard = false;
  if (origins.includes('*')) {
    allowOrigin = '*';
    wildcard = true;
  } else if (origin) {
    if (origins.includes(origin)) {
      allowOrigin = origin;
    } else {
      // 通配符子域匹配: *.example.com → 仅匹配 example.com 的子域, 不匹配 evilexample.com
      for (const o of origins) {
        if (o.startsWith('*.')) {
          const suffix = o.slice(1); // .example.com
          // R20 修复: 精确点分锚点。origin 去掉端口的 hostname 必须满足:
          //   (a) hostname === suffix 根域自身, 或
          //   (b) hostname 以 ".example.com" 结尾 (子域前有点分界),
          // 杜绝 evil-example.com endsWith('.example.com') 的绕过。
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
    // 精确来源匹配 (非 *) 才允许携带凭据
    if (!wildcard) res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Fusion-Doc', APP_VERSION);

  // 预检请求直接返回
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true; // 管道停止
  }

  return false; // 继续管道
}

module.exports = { cors };