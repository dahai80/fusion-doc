// =============================================================================
// Fusion-Doc — 模板引擎
// extractVariables → fillVariables → createFromTemplate
// =============================================================================

const { uid } = require('../utils/helpers');

function extractVariables(content) {
    if (!content || typeof content !== 'string') return [];
    const re = /\{\{(\w+)\}\}/g;
    const vars = new Set();
    let match;
    while ((match = re.exec(content)) !== null) {
        vars.add(match[1]);
    }
    return Array.from(vars);
}

function fillVariables(content, data) {
    if (!content || typeof content !== 'string') return content;
    return content.replace(/\{\{(\w+)\}\}/g, ( _, key) => {
        return data[key] !== undefined ? String(data[key]) : `{{${key}}}`;
    });
}

async function createFromTemplate(db, templateId, data) {
    if (!db) throw new Error('DB not available');

    const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!template) throw new Error('Template not found');

    const title = fillVariables(template.title || 'Untitled', data);
    const content = fillVariables(template.content || '', data);

    const pageId = uid();
    db.prepare('INSERT INTO pages (id, title, content, book_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(pageId, title, content, template.book_id || null, Date.now(), Date.now());

    console.log(`[TemplateEngine] Created page from template "${template.name}": ${pageId}`);
    return { page_id: pageId, title, template_id: templateId };
}

module.exports = { extractVariables, fillVariables, createFromTemplate };
