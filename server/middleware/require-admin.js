// =============================================================================
// Fusion-Doc — admin permission guard (shared middleware)
// Reused by all high-risk write operations (office command/training/backup) so controllers don't each reimplement it
// =============================================================================

const { errorResponse } = require('./error-handler');

// Returns true if allowed, false if a response was already written (caller must return)
// issue #45: roles map to 4 unified roles; the admin gate uses tenant_admin (legacy admin still accepted)
function requireAdmin(req, res) {
    const role = req.user?.role;
    if (role !== 'admin' && role !== 'tenant_admin') {
        errorResponse(res, 403, 'Admin permission required', 'FORBIDDEN');
        return false;
    }
    return true;
}

module.exports = { requireAdmin };
