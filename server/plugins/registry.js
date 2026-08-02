// =============================================================================
// Fusion-Doc — 插件注册表
// 管理插件的注册、发现、依赖解析
// =============================================================================

class PluginRegistry {
  constructor() {
    this._plugins = new Map();
    this._hooks = new Map(); // hookName → [handler, ...]
  }

  // 注册插件
  register(plugin) {
    if (this._plugins.has(plugin.name)) {
      throw new Error(`插件 ${plugin.name} 已注册`);
    }
    this._plugins.set(plugin.name, plugin);
    return this;
  }

  // 注销插件
  unregister(name) {
    const plugin = this._plugins.get(name);
    if (plugin && plugin.shutdown) {
      plugin.shutdown();
    }
    this._plugins.delete(name);
    // 清理钩子
    for (const [hookName, handlers] of this._hooks) {
      this._hooks.set(hookName, handlers.filter(h => h.plugin !== name));
    }
    return this;
  }

  // 获取插件
  get(name) {
    return this._plugins.get(name);
  }

  // 获取所有插件
  getAll() {
    return Array.from(this._plugins.values());
  }

  // 注册钩子
  on(hookName, handler, pluginName = 'anonymous') {
    if (!this._hooks.has(hookName)) {
      this._hooks.set(hookName, []);
    }
    this._hooks.get(hookName).push({ plugin: pluginName, handler });
    return this;
  }

  // 触发钩子
  async emit(hookName, ...args) {
    const handlers = this._hooks.get(hookName);
    if (!handlers) return [];
    const results = [];
    for (const { plugin, handler } of handlers) {
      try {
        const result = await handler(...args);
        results.push({ plugin, result });
      } catch (e) {
        console.error(`[插件:${plugin}] 钩子 ${hookName} 错误: ${e.message}`);
      }
    }
    return results;
  }

  // 检查依赖
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