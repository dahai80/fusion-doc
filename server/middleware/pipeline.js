// =============================================================================
// Fusion-Doc — 中间件管道
// 参考 Wiki.js 中间件链设计，实现可组合的中间件执行栈
// =============================================================================

class MiddlewarePipeline {
  constructor() {
    this._middlewares = []; // [{ name, handler, priority }]
  }

  // 注册中间件（priority 越小越先执行）
  use(name, handler, priority = 50) {
    this._middlewares.push({ name, handler, priority });
    this._middlewares.sort((a, b) => a.priority - b.priority);
    return this;
  }

  // 移除中间件
  remove(name) {
    this._middlewares = this._middlewares.filter(m => m.name !== name);
    return this;
  }

  // 执行中间件管道
  async run(req, res) {
    // 如果响应已发送，跳过
    if (res.writableEnded) return true;

    for (const mw of this._middlewares) {
      try {
        const handled = await mw.handler(req, res, this);
        // 如果中间件返回 true 或已发送响应，停止管道
        if (handled === true || res.writableEnded) {
          return true;
        }
      } catch (err) {
        console.error(`[Middleware:${mw.name}] 错误: ${err.message}`);
        if (!res.writableEnded) {
          // R21 修复: 生产环境屏蔽内部错误细节, 仅回通用信息
          const isProd = process.env.NODE_ENV === 'production';
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: isProd ? 'Internal Server Error' : `Middleware error: ${err.message}`,
            code: 'MIDDLEWARE_ERROR',
          }));
        }
        return true;
      }
    }
    return false;
  }
}

function createMiddlewarePipeline() {
  return new MiddlewarePipeline();
}

module.exports = { MiddlewarePipeline, createMiddlewarePipeline };