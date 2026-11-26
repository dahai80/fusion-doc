// =============================================================================
// Fusion-Doc — unified response helpers
// Removes the json() inline functions duplicated across controllers
// =============================================================================

// ── JSON success response ─────────────────────────────────────────────────────────
function json(res, data, status = 200) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ── Success response (with data wrapper) ──────────────────────────────────────────────
function success(res, data, status = 200) {
  return json(res, data, status);
}

// ── Error response ──────────────────────────────────────────────────────────────
// R21 fix: in production, 5xx responses hide internal error details (SQL fragments/upstream URLs/stacks)
// and return a generic message; 4xx keep the message (usually a user-readable validation hint). Dev echoes everything for debugging.
function error(res, message, status = 500, code = null) {
  const isProd = process.env.NODE_ENV === 'production';
  const safeMessage = (status >= 500 && isProd) ? 'Internal Server Error' : message;
  return json(res, {
    error: safeMessage,
    code: code || `ERR_${status}`,
    timestamp: new Date().toISOString(),
  }, status);
}

// ── 404 response ──────────────────────────────────────────────────────────────
function notFound(res, message = 'Not found') {
  return error(res, message, 404, 'NOT_FOUND');
}

// ── Created response (201) ───────────────────────────────────────────────────────
function created(res, data) {
  return json(res, data, 201);
}

// ── List response (with data wrapper) ──────────────────────────────────────────────
function list(res, items) {
  return json(res, { data: items });
}

module.exports = { json, success, error, notFound, created, list };