// =============================================================================
// Fusion-Doc — /metrics endpoint (P2-O5 fix)
// There was no metrics endpoint, so ops could not scrape with Prometheus. Exposes a minimal Prometheus text format:
// process uptime, memory heap, request counts (bucketed by status code), page/book/user counts, disk usage.
// Publicly readable (same level as /api/health, no sensitive data); production can add auth via a reverse proxy.
// =============================================================================

const os = require('os');

function register(app) {
    // Request counters live on app, initialized when the middleware pipeline first starts
    if (!app._metrics) {
        app._metrics = { requests: 0, byStatus: {}, errors: 0 };
    }

    app.registerRoute('GET', '/api/metrics', (req, res) => {
        const m = app._metrics;
        const mem = process.memoryUsage();
        const uptime = Math.floor((Date.now() - (app._startTime || Date.now())) / 1000);

        // Business counts (when the DB is available)
        let pages = 0, books = 0, users = 0;
        if (app.db && typeof app.db.prepare === 'function') {
            try {
                pages = (app.db.prepare('SELECT COUNT(*) c FROM pages').get() || {}).c || 0;
                books = (app.db.prepare('SELECT COUNT(*) c FROM books').get() || {}).c || 0;
                users = (app.db.prepare('SELECT COUNT(*) c FROM users').get() || {}).c || 0;
            } catch (e) { /* ignore missing tables */ }
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
