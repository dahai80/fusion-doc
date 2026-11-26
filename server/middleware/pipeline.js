// =============================================================================
// Fusion-Doc — middleware pipeline
// Composable middleware execution stack, modeled on the Wiki.js middleware chain
// =============================================================================

class MiddlewarePipeline {
  constructor() {
    this._middlewares = []; // [{ name, handler, priority }]
  }

  // Register middleware (lower priority runs first)
  use(name, handler, priority = 50) {
    this._middlewares.push({ name, handler, priority });
    this._middlewares.sort((a, b) => a.priority - b.priority);
    return this;
  }

  // Remove middleware
  remove(name) {
    this._middlewares = this._middlewares.filter(m => m.name !== name);
    return this;
  }

  // Run the middleware pipeline
  async run(req, res) {
    // Skip if the response has already been sent
    if (res.writableEnded) return true;

    for (const mw of this._middlewares) {
      try {
        const handled = await mw.handler(req, res, this);
        // Stop the pipeline if the middleware returns true or has sent a response
        if (handled === true || res.writableEnded) {
          return true;
        }
      } catch (err) {
        console.error(`[Middleware:${mw.name}] Error: ${err.message}`);
        if (!res.writableEnded) {
          // R21 fix: hide internal error details in production; return only a generic message
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