// =============================================================================
// Fusion-Doc — OCR 集成（Teedy 文档识别）
// 通过 Tesseract 或 MLX 视觉模型实现文档 OCR
// =============================================================================

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

class OCRIntegration {
  constructor(app) {
    this.app = app;
    this.mlxConfig = app.config.fusionMlx;
  }

  // 检查是否可用
  isAvailable() {
    try {
      execSync('tesseract --version 2>/dev/null', { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  // OCR 识别（通过 Tesseract）
  async recognize(imagePath, language = 'chi_sim+eng') {
    if (!this.isAvailable()) {
      return { error: 'Tesseract not available. Install with: brew install tesseract' };
    }

    const ext = path.extname(imagePath).toLowerCase();
    const supported = ['.png', '.jpg', '.jpeg', '.tiff', '.bmp', '.gif'];
    if (!supported.includes(ext)) {
      return { error: `Unsupported image format: ${ext}` };
    }

    try {
      const outputBase = path.join(path.dirname(imagePath), path.basename(imagePath, ext));
      execSync(`tesseract "${imagePath}" "${outputBase}" -l ${language} 2>/dev/null`, { timeout: 60000 });
      const txtPath = `${outputBase}.txt`;
      if (fs.existsSync(txtPath)) {
        const text = fs.readFileSync(txtPath, 'utf-8');
        fs.unlinkSync(txtPath);
        return { text, length: text.length };
      }
    } catch (e) {
      return { error: `OCR failed: ${e.message}` };
    }
    return { error: 'OCR produced no output' };
  }

  // 通过 MLX 视觉模型识别（如果可用）
  async recognizeWithMLX(imageBase64, prompt = '请识别图片中的文字内容') {
    const { callFusionMLX } = require('./fusion-mlx');
    try {
      const data = await callFusionMLX({
        method: 'POST', path: '/v1/chat/completions',
        body: {
          model: this.mlxConfig.chatModel,
          messages: [
            { role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ]},
          ],
          stream: false,
        },
        config: this.mlxConfig,
      });
      return { text: data.choices?.[0]?.message?.content || '', method: 'mlx-vision' };
    } catch (e) {
      return { error: `MLX vision OCR failed: ${e.message}` };
    }
  }
}

module.exports = OCRIntegration;