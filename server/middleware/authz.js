// =============================================================================
// Fusion-Doc — authorization guards (shared middleware)
// Page read/write ownership checks, reusing the page.js R13 read isolation + R12 write isolation logic.
// Shared by multiple controllers (file/office/copilot/rag/graph) so none reimplements it with IDOR bugs.
// issue #45: tenant isolation guard — cross-tenant access is always denied (red line 2), even for published pages.
// =============================================================================

const { errorResponse } = require('./error-handler');

// admin allowed; published pages (is_published=1) readable by anyone; private pages only by owner/admin.
// Legacy rows without created_by are treated as owned by the local user. Returns true=allowed, false=403 already written (caller must return)
function canReadPage(req, res, page) {
    if (!page) {
        errorResponse(res, 404, 'Page not found', 'NOT_FOUND');
        return false;
    }
    // issue #45: tenant boundary (deny cross-tenant, including published pages)
    const tid = req.user?.tid;
    if (tid && page.tenant_id && page.tenant_id !== tid) {
        errorResponse(res, 404, 'Page not found', 'NOT_FOUND');
        return false;
    }
    if (req.user?.role === 'tenant_admin' || req.user?.role === 'admin') return true;
    if (page.is_published === 1 || page.is_published === '1') return true;
    const owner = page.created_by;
    if (!owner) return true;
    if (owner === (req.user?.id || 'local')) return true;
    errorResponse(res, 403, 'Not allowed to read a private page owned by another user', 'FORBIDDEN');
    return false;
}

// admin allowed, otherwise created_by must match; legacy rows without created_by are treated as owned by the local user.
function canModifyPage(req, res, page) {
    if (!page) {
        errorResponse(res, 404, 'Page not found', 'NOT_FOUND');
        return false;
    }
    // issue #45: tenant boundary (deny cross-tenant)
    const tid = req.user?.tid;
    if (tid && page.tenant_id && page.tenant_id !== tid) {
        errorResponse(res, 404, 'Page not found', 'NOT_FOUND');
        return false;
    }
    if (req.user?.role === 'tenant_admin' || req.user?.role === 'admin') return true;
    const owner = page.created_by;
    if (!owner) return true;
    if (owner === (req.user?.id || 'local')) return true;
    errorResponse(res, 403, 'Not allowed to modify a page owned by another user', 'FORBIDDEN');
    return false;
}

// Fetch page object (DB/JSON); returns null if missing
function getPage(db, id) {
    if (!id) return null;
    return db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : require('../db').readJSON('pages', id);
}

module.exports = { canReadPage, canModifyPage, getPage };
