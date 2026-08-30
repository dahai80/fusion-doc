// =============================================================================
// Fusion-Doc — 管理员权限守卫 (共享中间件)
// 所有高危写操作 (office command/training/backup) 复用, 杜绝各控制器各自实现
// =============================================================================

const { errorResponse } = require('./error-handler');

// 返回 true 表示放行, false 表示已写响应 (调用方须 return)
function requireAdmin(req, res) {
    if (req.user?.role !== 'admin') {
        errorResponse(res, 403, '需要管理员权限', 'FORBIDDEN');
        return false;
    }
    return true;
}

module.exports = { requireAdmin };
