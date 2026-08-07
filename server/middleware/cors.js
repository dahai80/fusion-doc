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

  // 确定允许的来源
  let allowOrigin = '*';
  if (!origins.includes('*')) {
    if (origin && (origins.includes(origin) || origins.includes('*'))) {
      allowOrigin = origin;
    } else if (origin && origins.length > 0) {
      // 检查通配符匹配
      for (const o of origins) {
        if (o.startsWith('*.')) {
          const suffix = o.slice(1); // .example.com
          if (origin.endsWith(suffix)) { allowOrigin = origin; break; }
        }
      }
      // 未匹配的来源，使用第一个配置的来源
      if (allowOrigin === '*') allowOrigin = origins[0];
    }
  }

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
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