// =============================================================================
// Fusion-Doc — 日志中间件
// 参考 Wiki.js 审计追踪设计
// =============================================================================

const levels = { debug: 0, info: 1, warn: 2, error: 3 };

function logger(req, res, pipeline) {
  const start = Date.now();
  const { method, url } = req;
  const logLevel = process.env.LOG_LEVEL || 'info';

  // 响应结束时记录日志
  const originalEnd = res.end.bind(res);
  res.end = function(...args) {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    if (levels[level] >= levels[logLevel]) {
      const timestamp = new Date().toISOString().slice(11, 23);
      console.log(`  [${timestamp}] ${method} ${url} → ${res.statusCode} (${duration}ms) [${level}]`);
    }

    return originalEnd(...args);
  };

  return false; // 继续管道
}

module.exports = { logger };