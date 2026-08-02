// =============================================================================
// Fusion-Doc — 模型注册中心
// 所有模型统一注册，方便控制器引用
// 参考 DocMost Prisma Schema 设计
// =============================================================================

const Model = require('./base');

function registerModels(db) {
  const models = {};

  const definitions = [
    { name: 'User', table: 'users', jsonDir: 'users' },
    { name: 'Workspace', table: 'workspaces', jsonDir: 'workspaces' },
    { name: 'Book', table: 'books', jsonDir: 'books' },
    { name: 'Chapter', table: 'chapters', jsonDir: 'chapters' },
    { name: 'Page', table: 'pages', jsonDir: 'pages' },
    { name: 'PageVersion', table: 'page_versions', jsonDir: 'page_versions' },
    { name: 'Tag', table: 'tags', jsonDir: 'tags' },
    { name: 'File', table: 'files', jsonDir: 'files' },
    { name: 'Comment', table: 'comments', jsonDir: 'comments' },
    { name: 'Setting', table: 'settings', jsonDir: 'settings' },
    { name: 'Activity', table: 'activity', jsonDir: 'activity' },
    { name: 'Webhook', table: 'webhooks', jsonDir: 'webhooks' },
    { name: 'Metadata', table: 'metadata', jsonDir: 'metadata' },
    { name: 'Vocabulary', table: 'vocabulary', jsonDir: 'vocabulary' },
  ];

  for (const def of definitions) {
    models[def.name] = new Model(db, def.table, def.jsonDir);
  }

  return models;
}

module.exports = { registerModels };