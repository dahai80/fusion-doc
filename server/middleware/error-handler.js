// =============================================================================
// Fusion-Doc — error handling utilities
// Only exports the errorResponse / successResponse helpers (used by controllers/middleware).
// E11 fix: the old errorHandler middleware always returned false (a no-op) and has been unregistered from app.js.
// Actual error fallback: the catch in middleware/pipeline.js (middleware exceptions) +
// the catch in app.js _handleRequest (route exceptions); both hide 5xx details in production.
// =============================================================================

// Build a unified error response
function errorResponse(res, statusCode, message, code = null) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: message,
    code: code || `ERR_${statusCode}`,
    timestamp: new Date().toISOString(),
  }));
}

// Success response
function successResponse(res, data, statusCode = 200) {
  if (res.writableEnded) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

module.exports = { errorResponse, successResponse };