// =============================================================================
// Fusion-Doc — Fusion-Coder 桥接
// 连接 Fusion-Coder AI 编码助手，提供代码辅助能力
// =============================================================================
//
// Fusion-Coder: Claude Code 兼容的 AI 编码工具，基于 fusion-mlx 本地运行
// 集成方式: 通过 HTTP API 调用，支持代码生成、审查、解释
// =============================================================================

const { callFusionMLX } = require('./fusion-mlx');

class FusionCoderBridge {
  constructor(app) {
    this.app = app;
    this.mlxConfig = app.config.fusionMlx;
  }

  // ── 代码生成 ──────────────────────────────────────────────────────────
  async generateCode(prompt, language = 'python', model = null) {
    const messages = [
      { role: 'system', content: `你是一个专业的 ${language} 开发者。请生成高质量、可运行的代码。只输出代码，不要额外解释。` },
      { role: 'user', content: prompt },
    ];
    const data = await callFusionMLX({
      method: 'POST', path: '/v1/chat/completions',
      body: { model: model || this.mlxConfig.chatModel, messages, stream: false },
      config: this.mlxConfig,
    });
    return data.choices?.[0]?.message?.content || '';
  }

  // ── 代码审查 ──────────────────────────────────────────────────────────
  async reviewCode(code, language = 'python') {
    const messages = [
      { role: 'system', content: '你是一个代码审查专家。请审查以下代码，指出潜在问题、安全漏洞、性能优化建议。' },
      { role: 'user', content: `请审查以下 ${language} 代码:\n\n\`\`\`${language}\n${code}\n\`\`\`` },
    ];
    const data = await callFusionMLX({
      method: 'POST', path: '/v1/chat/completions',
      body: { model: this.mlxConfig.chatModel, messages, stream: false },
      config: this.mlxConfig,
    });
    return data.choices?.[0]?.message?.content || '';
  }

  // ── 代码解释 ──────────────────────────────────────────────────────────
  async explainCode(code, language = 'python') {
    const messages = [
      { role: 'system', content: '你是一个代码教学专家。请用通俗易懂的语言解释以下代码的工作原理。' },
      { role: 'user', content: `请解释以下 ${language} 代码:\n\n\`\`\`${language}\n${code}\n\`\`\`` },
    ];
    const data = await callFusionMLX({
      method: 'POST', path: '/v1/chat/completions',
      body: { model: this.mlxConfig.chatModel, messages, stream: false },
      config: this.mlxConfig,
    });
    return data.choices?.[0]?.message?.content || '';
  }

  // ── 代码补全 ──────────────────────────────────────────────────────────
  async completeCode(context, cursor, language = 'python') {
    const messages = [
      { role: 'system', content: `你是一个 AI 代码补全引擎。请基于上下文，补全光标位置（<CURSOR>）的代码。` },
      { role: 'user', content: `语言: ${language}\n\n上下文:\n${context.replace('<CURSOR>', '<|CURSOR|>')}\n\n请补全 <|CURSOR|> 位置的代码：` },
    ];
    const data = await callFusionMLX({
      method: 'POST', path: '/v1/chat/completions',
      body: { model: this.mlxConfig.chatModel, messages, stream: false },
      config: this.mlxConfig,
    });
    return data.choices?.[0]?.message?.content || '';
  }

  // ── 代码转换 ──────────────────────────────────────────────────────────
  async convertCode(code, fromLang, toLang) {
    const messages = [
      { role: 'system', content: `你是一个代码转换专家。请将 ${fromLang} 代码转换为 ${toLang}，保持功能完全一致。` },
      { role: 'user', content: `将以下 ${fromLang} 代码转换为 ${toLang}:\n\n\`\`\`${fromLang}\n${code}\n\`\`\`` },
    ];
    const data = await callFusionMLX({
      method: 'POST', path: '/v1/chat/completions',
      body: { model: this.mlxConfig.chatModel, messages, stream: false },
      config: this.mlxConfig,
    });
    return data.choices?.[0]?.message?.content || '';
  }
}

module.exports = FusionCoderBridge;