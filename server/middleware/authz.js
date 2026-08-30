// =============================================================================
// Fusion-Doc — 授权守卫 (共享中间件)
// 页面读/写归属校验, 复用 page.js R13 读隔离 + R12 写隔离逻辑。
// 多控制器 (file/office/copilot/rag/graph) 共用, 杜绝各自实现 IDOR 漏洞。
// =============================================================================

const { errorResponse } = require('./error-handler');

// admin 放行; 已发布页 (is_published=1) 任何人可读; 私有页仅 owner/admin 可读。
// 历史数据无 created_by 视为本地所有者兼容。返回 true=放行, false=已写 403 (调用方须 return)
function canReadPage(req, res, page) {
    if (!page) {
        errorResponse(res, 404, '页面不存在', 'NOT_FOUND');
        return false;
    }
    if (req.user?.role === 'admin') return true;
    if (page.is_published === 1 || page.is_published === '1') return true;
    const owner = page.created_by;
    if (!owner) return true;
    if (owner === (req.user?.id || 'local')) return true;
    errorResponse(res, 403, '无权读取他人私有页面', 'FORBIDDEN');
    return false;
}

// admin 放行, 否则需 created_by 匹配; 历史数据无 created_by 视为本地所有者兼容。
function canModifyPage(req, res, page) {
    if (!page) {
        errorResponse(res, 404, '页面不存在', 'NOT_FOUND');
        return false;
    }
    if (req.user?.role === 'admin') return true;
    const owner = page.created_by;
    if (!owner) return true;
    if (owner === (req.user?.id || 'local')) return true;
    errorResponse(res, 403, '无权修改他人页面', 'FORBIDDEN');
    return false;
}

// 取页面对象 (DB/JSON), 不存在返 null
function getPage(db, id) {
    if (!id) return null;
    return db ? db.prepare('SELECT * FROM pages WHERE id = ?').get(id) : require('../db').readJSON('pages', id);
}

module.exports = { canReadPage, canModifyPage, getPage };
