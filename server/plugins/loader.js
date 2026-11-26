// =============================================================================
// Fusion-Doc — plugin loader
// Dynamically loads every plugin in the plugins directory and manages plugin lifecycle
// Modeled on the Wiki.js modular plugin architecture
// =============================================================================

const fs = require('fs');
const path = require('path');
const SKIP_FILES = new Set(['loader.js', 'registry.js']);

// ── Load plugins ──────────────────────────────────────────────────────────────
async function loadPlugins(app) {
  const plugins = [];
  const pluginsDir = app.config.pluginsDir;

  // Make sure the plugins directory exists
  try {
    fs.mkdirSync(pluginsDir, { recursive: true });
  } catch (e) { /* ignore */ }

  // Scan the plugins directory
  let entries;
  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch (e) {
    console.log(`  [plugin] Plugins directory unavailable: ${pluginsDir}`);
    return plugins;
  }

  for (const entry of entries) {
    const pluginPath = path.join(pluginsDir, entry.name);

    // Only load directories or .js files (skip infrastructure files)
    if (SKIP_FILES.has(entry.name)) continue;
    if (!entry.isDirectory() && !entry.name.endsWith('.js')) continue;

    try {
      let plugin;
      if (entry.isDirectory()) {
        // Directory plugin (package.json or index.js)
        const pkgPath = path.join(pluginPath, 'package.json');
        const indexJsPath = path.join(pluginPath, 'index.js');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          // A6 fix: fence the main field path. path.join does not enforce boundaries, so pkg.main="../../server/app.js"
          // could traverse to any .js and run it with server privileges (RCE). The resolved path must stay inside pluginPath.
          const mainPath = path.resolve(pluginPath, pkg.main || 'index.js');
          if (mainPath !== pluginPath && !mainPath.startsWith(pluginPath + path.sep)) {
            console.error(`  [plugin] ✗ ${entry.name}: main field escapes plugin dir (${pkg.main}), refusing to load`);
            continue;
          }
          if (fs.existsSync(mainPath)) {
            plugin = require(mainPath);
          }
        } else if (fs.existsSync(indexJsPath)) {
          plugin = require(indexJsPath);
        }
      } else {
        // Single-file plugin
        plugin = require(pluginPath);
      }

      if (!plugin || typeof plugin.activate !== 'function') {
        console.log(`  [plugin] Skipping ${entry.name}: missing activate() method`);
        continue;
      }

      // Activate plugin
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
      console.log(`  [plugin] ✓ ${pluginInfo.name} v${pluginInfo.version}`);

      // Register plugin hooks
      if (plugin.hooks) {
        registerPluginHooks(app, pluginInfo);
      }
    } catch (e) {
      console.log(`  [plugin] ✗ ${entry.name}: ${e.message}`);
    }
  }

  return plugins;
}

// ── Register plugin hooks ──────────────────────────────────────────────────────────
function registerPluginHooks(app, plugin) {
  const hooks = plugin.hooks;
  if (!hooks) return;

  // Route hooks
  if (hooks.routes && typeof hooks.routes === 'function') {
    try {
      hooks.routes(app);
      console.log(`  [plugin]   ✓ Routes registered`);
    } catch (e) {
      console.log(`  [plugin]   ✗ Route registration failed: ${e.message}`);
    }
  }

  // Middleware hooks
  if (hooks.middleware && typeof hooks.middleware === 'function') {
    try {
      const middleware = hooks.middleware(app);
      if (middleware) {
        app.middleware.use(`plugin:${plugin.name}`, middleware, 50);
        console.log(`  [plugin]   ✓ Middleware registered`);
      }
    } catch (e) {
      console.log(`  [plugin]   ✗ Middleware registration failed: ${e.message}`);
    }
  }

  // Event hooks
  if (hooks.events && typeof hooks.events === 'function') {
    try {
      hooks.events(app);
      console.log(`  [plugin]   ✓ Event listeners registered`);
    } catch (e) {
      console.log(`  [plugin]   ✗ Event registration failed: ${e.message}`);
    }
  }
}

// ── Create plugin skeleton ──────────────────────────────────────────────────────────
function createPluginSkeleton(name, version = '0.1.0', description = '') {
  return {
    name,
    version,
    description,
    async activate(app) {
      console.log(`  [${name}] Plugin activated`);
      return { app };
    },
    hooks: {
      routes(app) {},
      middleware(app) {},
      events(app) {},
    },
    shutdown() {
      console.log(`  [${name}] Plugin shut down`);
    },
  };
}

module.exports = { loadPlugins, createPluginSkeleton };