// =============================================================================
// Fusion-Doc — controller registry
// Automatically registers all domain controllers on the app router
// Modeled on BookStack MVC + Wiki.js modular routing
// =============================================================================

const path = require('path');

function registerRoutes(app) {
  const controllers = [
    require('./health'),
    require('./metrics'),
    require('./auth'),
    require('./workspace'),
    require('./book'),
    require('./chapter'),
    require('./page'),
    require('./collection'),
    require('./tag'),
    require('./search'),
    require('./graph'),
    require('./ai'),
    require('./export'),
    require('./favorite'),
    require('./file'),
    require('./comment'),
    require('./activity'),
    require('./user'),
    require('./theme'),
    require('./webhook'),
    require('./metadata'),
    require('./branding'),
    require('./ai-copilot'),
    require('./office'),
    require('./template'),
    require('./workflow'),
    require('./collaboration'),
    require('./rag-enhanced'),
    require('./training'),
    require('./system'),
  ];

  for (const controller of controllers) {
    if (typeof controller.register === 'function') {
      controller.register(app);
    }
  }
}

module.exports = { registerRoutes };