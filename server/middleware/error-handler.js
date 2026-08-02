// =============================================================================
// Fusion-Doc — 错误处理中间件
// 统一错误响应格式
// =============================================================================

function errorHandler(req, res, pipeline) {
  // 这个中间件只作为兜底，不主动拦截请求
  // 实际的错误处理由路由中的 try-catch 完成
  return false;
}

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

module.exports = { errorHandler, errorResponse, successResponse };