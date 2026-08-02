// =============================================================================
// Fusion-Doc — 请求体解析中间件
// =============================================================================

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);

    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      try {
        req.body = body ? JSON.parse(body) : {};
        resolve(req.body);
      } catch (e) {
        reject(new Error('Invalid JSON in request body'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = { parseBody };