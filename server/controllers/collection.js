// =============================================================================
// Fusion-Doc — Collections controller (issue #73)
// Social/organizational layer: named collections grouping pages across books.
// Tenant-isolated (issue #45 tier): every query filters by req.user tid.
// Cascade delete handled by FK ON DELETE CASCADE (migration 020) + explicit
// membership cleanup inside a transaction for JSON-fallback parity.
// =============================================================================

const { parseBody } = require('../middleware/body-parser');
const { uid, now, tenantId } = require('../utils/helpers');
const { json, list, created, notFound, error } = require('../utils/response');

const MAX_NAME = 200;
const MAX_DESC = 2000;
const MAX_PAGE_IDS = 500;

function register(app) {
    const { db } = app;

    // Owner-or-admin guard (mirrors authz tier: admins + creator may mutate)
    function canModify(req, row) {
        if (req.user?.role === 'admin' || req.user?.role === 'tenant_admin') return true;
        return !!row && row.created_by === (req.user?.id || 'local');
    }

    // Load one collection tenant-scoped; undefined when missing or foreign
    function getScoped(id, tid) {
        if (!db) return require('../db').readJSON('collections', id);
        return db.prepare('SELECT * FROM collections WHERE id = ? AND tenant_id = ?').get(id, tid);
    }

    // Replace membership set inside a transaction (collection delete cascades in DB,
    // JSON fallback deletes manually)
    function setMembers(id, pageIds) {
        if (db) {
            db.transaction(() => {
                db.prepare('DELETE FROM collection_pages WHERE collection_id = ?').run(id);
                const ins = db.prepare('INSERT OR IGNORE INTO collection_pages (collection_id, page_id) VALUES (?, ?)');
                for (const pid of pageIds) ins.run(id, pid);
            })();
        }
    }

    // Attach member page ids (only pages visible in the same tenant)
    function withMembers(row, tid) {
        if (!row) return row;
        if (!db) return { ...row, page_ids: [] };
        const pages = db.prepare(`
            SELECT p.id FROM collection_pages cp
            JOIN pages p ON p.id = cp.page_id
            WHERE cp.collection_id = ? AND p.tenant_id = ?
            ORDER BY cp.added_at
        `).all(row.id, tid);
        return { ...row, page_ids: pages.map((p) => p.id) };
    }

    // ── List (tenant-scoped) ─────────────────────────────────────────────
    app.registerRoute('GET', '/api/collections', (req, res) => {
        const tid = tenantId(req);
        if (!db) {
            const all = require('../db').listJSON('collections').filter((c) => c.tenant_id === tid);
            return list(res, all);
        }
        list(res, db.prepare('SELECT * FROM collections WHERE tenant_id = ? ORDER BY updated_at DESC').all(tid));
    });

    // ── Create { name, description?, page_ids? } ─────────────────────────
    app.registerRoute('POST', '/api/collections', async (req, res) => {
        const body = await parseBody(req);
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, MAX_NAME) : '';
        if (!name) return error(res, 'name is required', 400);
        const row = {
            id: uid(),
            tenant_id: tenantId(req),
            name,
            description: typeof body.description === 'string' ? body.description.slice(0, MAX_DESC) : '',
            created_by: req.user?.id || 'local',
            created_at: now(),
            updated_at: now(),
        };
        if (db) {
            db.prepare('INSERT INTO collections (id, tenant_id, name, description, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(row.id, row.tenant_id, row.name, row.description, row.created_by, row.created_at, row.updated_at);
        } else {
            require('../db').writeJSON('collections', row.id, row);
        }
        const pageIds = Array.isArray(body.page_ids) ? body.page_ids.filter((x) => typeof x === 'string').slice(0, MAX_PAGE_IDS) : [];
        if (pageIds.length) setMembers(row.id, pageIds);
        console.log(`[Collection] created ${row.id} (${name}) by ${row.created_by}, ${pageIds.length} members`);
        created(res, withMembers(row, row.tenant_id));
    });

    // ── Read one ─────────────────────────────────────────────────────────
    app.registerRoute('GET', '/api/collections/:id', (req, res) => {
        const tid = tenantId(req);
        const row = getScoped(req.params.id, tid);
        if (!row) return notFound(res, 'collection not found');
        json(res, withMembers(row, tid));
    });

    // ── Update { name?, description?, page_ids? } ────────────────────────
    app.registerRoute('PUT', '/api/collections/:id', async (req, res) => {
        const tid = tenantId(req);
        const row = getScoped(req.params.id, tid);
        if (!row) return notFound(res, 'collection not found');
        if (!canModify(req, row)) return error(res, 'forbidden', 403, 'FORBIDDEN');
        const body = await parseBody(req);
        const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, MAX_NAME) : row.name;
        const description = typeof body.description === 'string' ? body.description.slice(0, MAX_DESC) : row.description;
        if (db) {
            db.prepare('UPDATE collections SET name = ?, description = ?, updated_at = ? WHERE id = ?')
                .run(name, description, now(), row.id);
        } else {
            Object.assign(row, { name, description, updated_at: now() });
            require('../db').writeJSON('collections', row.id, row);
        }
        if (Array.isArray(body.page_ids)) {
            setMembers(row.id, body.page_ids.filter((x) => typeof x === 'string').slice(0, MAX_PAGE_IDS));
        }
        json(res, withMembers(getScoped(row.id, tid) || { ...row, name, description }, tid));
    });

    // ── Delete (members cascade via FK; explicit cleanup for JSON mode) ──
    app.registerRoute('DELETE', '/api/collections/:id', (req, res) => {
        const tid = tenantId(req);
        const row = getScoped(req.params.id, tid);
        if (!row) return notFound(res, 'collection not found');
        if (!canModify(req, row)) return error(res, 'forbidden', 403, 'FORBIDDEN');
        if (db) {
            db.prepare('DELETE FROM collections WHERE id = ?').run(row.id);
        } else {
            require('../db').deleteJSON('collections', row.id);
        }
        console.log(`[Collection] deleted ${row.id} by ${req.user?.id || 'local'}`);
        json(res, { deleted: true });
    });

    // ── Membership add/remove single page ────────────────────────────────
    app.registerRoute('POST', '/api/collections/:id/pages', async (req, res) => {
        const tid = tenantId(req);
        const row = getScoped(req.params.id, tid);
        if (!row) return notFound(res, 'collection not found');
        if (!canModify(req, row)) return error(res, 'forbidden', 403, 'FORBIDDEN');
        const body = await parseBody(req);
        const pageId = typeof body.page_id === 'string' ? body.page_id : '';
        if (!pageId) return error(res, 'page_id is required', 400);
        const page = db ? db.prepare('SELECT id FROM pages WHERE id = ? AND tenant_id = ?').get(pageId, tid)
            : require('../db').readJSON('pages', pageId);
        if (!page) return notFound(res, 'page not found');
        if (db) {
            db.prepare('INSERT OR IGNORE INTO collection_pages (collection_id, page_id) VALUES (?, ?)').run(row.id, pageId);
        }
        json(res, { added: true }, 201);
    });

    app.registerRoute('DELETE', '/api/collections/:id/pages/:pageId', (req, res) => {
        const tid = tenantId(req);
        const row = getScoped(req.params.id, tid);
        if (!row) return notFound(res, 'collection not found');
        if (!canModify(req, row)) return error(res, 'forbidden', 403, 'FORBIDDEN');
        if (db) {
            db.prepare('DELETE FROM collection_pages WHERE collection_id = ? AND page_id = ?').run(row.id, req.params.pageId);
        }
        json(res, { removed: true });
    });
}

module.exports = { register };
