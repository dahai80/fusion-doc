// =============================================================================
// Fusion-Doc — 控制器注册中心
// 自动注册所有领域控制器到应用路由
// 参考 BookStack MVC + Wiki.js 模块化路由设计
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