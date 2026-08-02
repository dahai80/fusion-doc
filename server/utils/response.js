// =============================================================================
// Fusion-Doc — 统一响应工具函数
// 消除控制器中重复的 json() 内联函数
// =============================================================================

// ── JSON 成功响应 ─────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ── 成功响应（带 data 包装） ──────────────────────────────────────────────
function success(res, data, status = 200) {
  return json(res, data, status);
}

// ── 错误响应 ──────────────────────────────────────────────────────────────
function error(res, message, status = 500, code = null) {
  return json(res, {
    error: message,
    code: code || `ERR_${status}`,
    timestamp: new Date().toISOString(),
  }, status);
}

// ── 404 响应 ──────────────────────────────────────────────────────────────
function notFound(res, message = 'Not found') {
  return error(res, message, 404, 'NOT_FOUND');
}

// ── 创建响应（201） ───────────────────────────────────────────────────────
function created(res, data) {
  return json(res, data, 201);
}

// ── 列表响应（带 data 包装） ──────────────────────────────────────────────
function list(res, items) {
  return json(res, { data: items });
}

module.exports = { json, success, error, notFound, created, list };