// =============================================================================
// Fusion-Doc — 插件加载器
// 动态加载插件目录中的所有插件，管理插件生命周期
// 参考 Wiki.js 模块化插件架构设计
// =============================================================================

const fs = require('fs');
const path = require('path');
const SKIP_FILES = new Set(['loader.js', 'registry.js']);

// ── 加载插件 ──────────────────────────────────────────────────────────────
async function loadPlugins(app) {
  const plugins = [];
  const pluginsDir = app.config.pluginsDir;

  // 确保插件目录存在
  try {
    fs.mkdirSync(pluginsDir, { recursive: true });
  } catch (e) { /* ignore */ }

  // 扫描插件目录
  let entries;
  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch (e) {
    console.log(`  [插件] 插件目录不可用: ${pluginsDir}`);
    return plugins;
  }

  for (const entry of entries) {
    const pluginPath = path.join(pluginsDir, entry.name);

    // 只加载目录或 .js 文件（跳过基础设施文件）
    if (SKIP_FILES.has(entry.name)) continue;
    if (!entry.isDirectory() && !entry.name.endsWith('.js')) continue;

    try {
      let plugin;
      if (entry.isDirectory()) {
        // 目录插件（package.json 或 index.js）
        const pkgPath = path.join(pluginPath, 'package.json');
        const indexJsPath = path.join(pluginPath, 'index.js');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          const mainPath = path.join(pluginPath, pkg.main || 'index.js');
          if (fs.existsSync(mainPath)) {
            plugin = require(mainPath);
          }
        } else if (fs.existsSync(indexJsPath)) {
          plugin = require(indexJsPath);
        }
      } else {
        // 单文件插件
        plugin = require(pluginPath);
      }

      if (!plugin || typeof plugin.activate !== 'function') {
        console.log(`  [插件] 跳过 ${entry.name}: 缺少 activate() 方法`);
        continue;
      }

      // 激活插件
      const instance = await plugin.activate(app);
      const pluginInfo = {
        name: plugin.name || entry.name,
        version: plugin.version || '0.1.0',
        description: plugin.description || '',
        instance,
        path: pluginPath,
        hooks: plugin.hooks || {},
        shutdown: plugin.shutdown || null,
      };

      plugins.push(pluginInfo);
      console.log(`  [插件] ✓ ${pluginInfo.name} v${pluginInfo.version}`);

      // 注册插件钩子
      if (plugin.hooks) {
        registerPluginHooks(app, pluginInfo);
      }
    } catch (e) {
      console.log(`  [插件] ✗ ${entry.name}: ${e.message}`);
    }
  }

  return plugins;
}

// ── 注册插件钩子 ──────────────────────────────────────────────────────────
function registerPluginHooks(app, plugin) {
  const hooks = plugin.hooks;
  if (!hooks) return;

  // 路由钩子
  if (hooks.routes && typeof hooks.routes === 'function') {
    try {
      hooks.routes(app);
      console.log(`  [插件]   ✓ 路由已注册`);
    } catch (e) {
      console.log(`  [插件]   ✗ 路由注册失败: ${e.message}`);
    }
  }

  // 中间件钩子
  if (hooks.middleware && typeof hooks.middleware === 'function') {
    try {
      const middleware = hooks.middleware(app);
      if (middleware) {
        app.middleware.use(`plugin:${plugin.name}`, middleware, 50);
        console.log(`  [插件]   ✓ 中间件已注册`);
      }
    } catch (e) {
      console.log(`  [插件]   ✗ 中间件注册失败: ${e.message}`);
    }
  }

  // 事件钩子
  if (hooks.events && typeof hooks.events === 'function') {
    try {
      hooks.events(app);
      console.log(`  [插件]   ✓ 事件监听已注册`);
    } catch (e) {
      console.log(`  [插件]   ✗ 事件注册失败: ${e.message}`);
    }
  }
}

// ── 创建插件骨架 ──────────────────────────────────────────────────────────
function createPluginSkeleton(name, version = '0.1.0', description = '') {
  return {
    name,
    version,
    description,
    async activate(app) {
      console.log(`  [${name}] 插件已激活`);
      return { app };
    },
    hooks: {
      routes(app) {},
      middleware(app) {},
      events(app) {},
    },
    shutdown() {
      console.log(`  [${name}] 插件已关闭`);
    },
  };
}

module.exports = { loadPlugins, createPluginSkeleton };