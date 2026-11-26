// =============================================================================
// Fusion-Doc — plugin registry
// Manages plugin registration, discovery and dependency resolution
// =============================================================================

class PluginRegistry {
  constructor() {
    this._plugins = new Map();
    this._hooks = new Map(); // hookName → [handler, ...]
  }

  // Register a plugin
  register(plugin) {
    if (this._plugins.has(plugin.name)) {
      throw new Error(`Plugin ${plugin.name} is already registered`);
    }
    this._plugins.set(plugin.name, plugin);
    return this;
  }

  // Unregister a plugin
  unregister(name) {
    const plugin = this._plugins.get(name);
    if (plugin && plugin.shutdown) {
      plugin.shutdown();
    }
    this._plugins.delete(name);
    // Clean up hooks
    for (const [hookName, handlers] of this._hooks) {
      this._hooks.set(hookName, handlers.filter(h => h.plugin !== name));
    }
    return this;
  }

  // Get a plugin
  get(name) {
    return this._plugins.get(name);
  }

  // Get all plugins
  getAll() {
    return Array.from(this._plugins.values());
  }

  // Register a hook
  on(hookName, handler, pluginName = 'anonymous') {
    if (!this._hooks.has(hookName)) {
      this._hooks.set(hookName, []);
    }
    this._hooks.get(hookName).push({ plugin: pluginName, handler });
    return this;
  }

  // Trigger a hook
  async emit(hookName, ...args) {
    const handlers = this._hooks.get(hookName);
    if (!handlers) return [];
    const results = [];
    for (const { plugin, handler } of handlers) {
      try {
        const result = await handler(...args);
        results.push({ plugin, result });
      } catch (e) {
        console.error(`[Plugin:${plugin}] hook ${hookName} error: ${e.message}`);
      }
    }
    return results;
  }

  // Check dependencies
  checkDependencies(plugin) {
    const deps = plugin.dependencies || [];
    const missing = deps.filter(dep => !this._plugins.has(dep));
    if (missing.length > 0) {
      return { ok: false, missing };
    }
    return { ok: true, missing: [] };
  }
}

module.exports = PluginRegistry;