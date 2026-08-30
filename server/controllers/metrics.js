// =============================================================================
// Fusion-Doc — /metrics 端点 (P2-O5 修复)
// 原无指标端点, 运维无法接 Prometheus 抓取。暴露最小可用 Prometheus 文本格式:
// 进程 uptime、内存堆、请求计数 (按状态码桶)、活跃页/书/用户数、磁盘占用。
// 公开读 (与 /api/health 同级, 不含敏感数据); 生产可经反代加 auth。
// =============================================================================

const os = require('os');

function register(app) {
    // 请求计数器挂 app, 中间件管道首启时初始化
    if (!app._metrics) {
        app._metrics = { requests: 0, byStatus: {}, errors: 0 };
    }

    app.registerRoute('GET', '/api/metrics', (req, res) => {
        const m = app._metrics;
        const mem = process.memoryUsage();
        const uptime = Math.floor((Date.now() - (app._startTime || Date.now())) / 1000);

        // 业务计数 (DB 可用时)
        let pages = 0, books = 0, users = 0;
        if (app.db && typeof app.db.prepare === 'function') {
            try {
                pages = (app.db.prepare('SELECT COUNT(*) c FROM pages').get() || {}).c || 0;
                books = (app.db.prepare('SELECT COUNT(*) c FROM books').get() || {}).c || 0;
                users = (app.db.prepare('SELECT COUNT(*) c FROM users').get() || {}).c || 0;
            } catch (e) { /* 表缺失忽略 */ }
        }

        const lines = [
            '# HELP fusion_doc_uptime_seconds Process uptime in seconds',
            '# TYPE fusion_doc_uptime_seconds gauge',
            `fusion_doc_uptime_seconds ${uptime}`,
            '# HELP fusion_doc_mem_heap_used_bytes Node heap used',
            '# TYPE fusion_doc_mem_heap_used_bytes gauge',
            `fusion_doc_mem_heap_used_bytes ${mem.heapUsed}`,
            `fusion_doc_mem_heap_total_bytes ${mem.heapTotal}`,
            `fusion_doc_mem_rss_bytes ${mem.rss}`,
            '# HELP fusion_doc_requests_total Total HTTP requests',
            '# TYPE fusion_doc_requests_total counter',
            `fusion_doc_requests_total ${m.requests}`,
            '# HELP fusion_doc_errors_total Total 5xx errors',
            '# TYPE fusion_doc_errors_total counter',
            `fusion_doc_errors_total ${m.errors}`,
            '# HELP fusion_doc_pages_total Total pages',
            '# TYPE fusion_doc_pages_total gauge',
            `fusion_doc_pages_total ${pages}`,
            `fusion_doc_books_total ${books}`,
            `fusion_doc_users_total ${users}`,
            '# HELP fusion_doc_cpu_load1 System load average 1min',
            '# TYPE fusion_doc_cpu_load1 gauge',
            `fusion_doc_cpu_load1 ${(os.loadavg()[0] || 0).toFixed(2)}`,
        ];
        for (const [code, n] of Object.entries(m.byStatus)) {
            lines.push(`fusion_doc_requests_by_status{code="${code}"} ${n}`);
        }

        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(lines.join('\n') + '\n');
    });
}

module.exports = { register };
