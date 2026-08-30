// =============================================================================
// Fusion-Doc — 错误处理工具
// 仅导出 errorResponse / successResponse 工具函数 (供控制器/中间件使用)。
// E11 修复: 原 errorHandler 中间件恒返回 false 为 no-op, 已从 app.js 移除注册。
// 实际错误兜底: middleware/pipeline.js 的 catch (中间件异常) +
// app.js _handleRequest 的 catch (路由异常), 两处均已在生产屏蔽 5xx 细节。
// =============================================================================

// 创建统一错误响应
function errorResponse(res, statusCode, message, code = null) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: message,
    code: code || `ERR_${statusCode}`,
    timestamp: new Date().toISOString(),
  }));
}

// 成功响应
function successResponse(res, data, statusCode = 200) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

module.exports = { errorResponse, successResponse };