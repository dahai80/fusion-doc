// =============================================================================
// Fusion-Doc — LibreOffice 集成
// Office 文档格式转换（通过 LibreOffice CLI 或 Pandoc）
// =============================================================================

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

class LibreOfficeIntegration {
  constructor(app) {
    this.app = app;
    this.tmpDir = path.join(app.config.dataDir, 'exports');
    fs.mkdirSync(this.tmpDir, { recursive: true });
  }

  // 检查是否可用
  isAvailable() {
    try {
      execSync('pandoc --version 2>/dev/null || libreoffice --version 2>/dev/null', { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  // 转换到文本
  toText(inputPath) {
    const ext = path.extname(inputPath).toLowerCase();
    const outputPath = path.join(this.tmpDir, `${path.basename(inputPath, ext)}.txt`);

    try {
      execSync(
        `pandoc "${inputPath}" -t plain -o "${outputPath}" 2>/dev/null || libreoffice --headless --convert-to txt --outdir "${this.tmpDir}" "${inputPath}" 2>/dev/null || true`,
        { timeout: 30000, stdio: 'pipe' }
      );
      if (fs.existsSync(outputPath)) {
        const text = fs.readFileSync(outputPath, 'utf-8');
        fs.unlinkSync(outputPath);
        return text;
      }
    } catch { /* ignore */ }
    return null;
  }

  // 转换到 PDF
  toPDF(inputPath) {
    const ext = path.extname(inputPath).toLowerCase();
    const outputPath = path.join(this.tmpDir, `${path.basename(inputPath, ext)}.pdf`);

    try {
      execSync(
        `pandoc "${inputPath}" -o "${outputPath}" --pdf-engine=weasyprint 2>/dev/null || pandoc "${inputPath}" -o "${outputPath}" 2>/dev/null || libreoffice --headless --convert-to pdf --outdir "${this.tmpDir}" "${inputPath}" 2>/dev/null || true`,
        { timeout: 30000, stdio: 'pipe' }
      );
      if (fs.existsSync(outputPath)) {
        const data = fs.readFileSync(outputPath);
        fs.unlinkSync(outputPath);
        return data;
      }
    } catch { /* ignore */ }
    return null;
  }

  // 转换到 DOCX
  toDocx(inputPath) {
    const ext = path.extname(inputPath).toLowerCase();
    const outputPath = path.join(this.tmpDir, `${path.basename(inputPath, ext)}.docx`);

    try {
      execSync(
        `pandoc "${inputPath}" -o "${outputPath}" 2>/dev/null || libreoffice --headless --convert-to docx --outdir "${this.tmpDir}" "${inputPath}" 2>/dev/null || true`,
        { timeout: 30000, stdio: 'pipe' }
      );
      if (fs.existsSync(outputPath)) {
        const data = fs.readFileSync(outputPath);
        fs.unlinkSync(outputPath);
        return data;
      }
    } catch { /* ignore */ }
    return null;
  }

  // 支持的格式
  supportedFormats() {
    return {
      input: ['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp', '.rtf', '.html', '.md', '.txt', '.csv'],
      output: ['txt', 'pdf', 'docx', 'html', 'md'],
    };
  }
}

module.exports = LibreOfficeIntegration;