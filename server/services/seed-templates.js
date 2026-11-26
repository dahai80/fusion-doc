const { uid } = require('../utils/helpers');

// ── Preset templates ──
// Template names, descriptions, bodies and field labels are user-facing product
// content (Chinese), kept as data in seed-templates.json rather than in source.
const PRESET_TEMPLATES = require('./seed-templates.json');

function seedTemplates(db) {
    if (!db) return;
    try {
        const existing = db.prepare('SELECT COUNT(*) as cnt FROM templates').get();
        if (existing.cnt > 0) {
            console.log('  [Seed] Templates already exist, skipping seed');
            return;
        }
        const now = Date.now();
        const insert = db.prepare(`
            INSERT INTO templates (id, name, category, description, content, schema, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const tpl of PRESET_TEMPLATES) {
            insert.run(
                uid(), tpl.name, tpl.category, tpl.description,
                tpl.content, JSON.stringify(tpl.schema), now, now,
            );
        }
        console.log(`  [Seed] Seeded ${PRESET_TEMPLATES.length} preset templates`);
    } catch (e) {
        console.error(`  [Seed] Template seeding failed: ${e.message}`);
    }
}

module.exports = { seedTemplates, PRESET_TEMPLATES };
